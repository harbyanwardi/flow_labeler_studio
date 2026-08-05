# backend/api/export.py
# Export a dataset VERSION with train/val/test split → ZIP download + log entry
import os, json, zipfile, shutil, tempfile, random, math, datetime, uuid
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pathlib import Path
from typing import List
import cv2

router = APIRouter()

from backend.utils.paths import PROJECTS_DIR, EXPORTS_DIR


class ExportRequest(BaseModel):
    project_id:  str
    dataset_id:  str
    version_id:  str
    format:      str   = "yolov11_detect"   # yolov11_detect | yolov11_segment | coco
    train_pct:   float = 70.0
    val_pct:     float = 20.0
    test_pct:    float = 10.0


# ── helpers ────────────────────────────────────────────────────────────

def _rj(p):
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

def _wj(p, d):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=2, ensure_ascii=False)


def _gather_from_version(project_id: str, dataset_id: str, version_id: str):
    """Read image references from a dataset version; return (files, unique_classes)."""
    datasets_dir = os.path.join(PROJECTS_DIR, project_id, "datasets")
    batches_dir  = os.path.join(PROJECTS_DIR, project_id, "batches")
    imgf = os.path.join(datasets_dir, dataset_id, "versions", version_id, "images.json")
    if not os.path.exists(imgf):
        return [], set()

    refs   = _rj(imgf)
    files  = []
    clses  = set()

    for ref in refs:
        bid  = ref["batch_id"]
        fn   = ref["filename"]
        annp = os.path.join(batches_dir, bid, "annotations", f"{fn}.json")
        imgp = os.path.join(batches_dir, bid, "images", fn)

        if not os.path.exists(imgp) or not os.path.exists(annp):
            continue
        try:
            d    = _rj(annp)
            anns = d.get("annotations", [])
            if not anns and not d.get("null_labeled", False):
                continue
        except Exception:
            continue

        files.append({"img_path": imgp, "filename": fn, "annotations": anns})
        for a in anns:
            lbl = a.get("label") or a.get("class")
            if lbl:
                clses.add(lbl)

    return files, clses


def _split(files, train_pct, val_pct, test_pct):
    random.shuffle(files)
    n      = len(files)
    total  = train_pct + val_pct + test_pct
    n_tr   = math.floor(n * train_pct / total)
    n_val  = math.floor(n * val_pct   / total)
    n_test = n - n_tr - n_val
    return {
        "train": files[:n_tr],
        "valid": files[n_tr:n_tr + n_val],
        "test":  files[n_tr + n_val:],
    }


def _write_yolo(export_path: Path, splits: dict, classes_list: list, c2id: dict, fmt: str):
    yaml = "\n".join([
        "# APIFlow Labeler — YOLO Export",
        "path: .", "train: train/images", "val: valid/images", "test: test/images", "",
        f"nc: {len(classes_list)}", "names:",
        *[f"  {i}: {n}" for i, n in enumerate(classes_list)],
    ])
    (export_path / "data.yaml").write_text(yaml, encoding="utf-8")

    for split, items in splits.items():
        if not items:
            continue
        idir = export_path / split / "images"
        ldir = export_path / split / "labels"
        idir.mkdir(parents=True, exist_ok=True)
        ldir.mkdir(parents=True, exist_ok=True)

        for item in items:
            img = cv2.imread(item["img_path"])
            if img is None:
                continue
            h, w, _ = img.shape
            shutil.copy(item["img_path"], idir / item["filename"])

            lbl_file = ldir / (Path(item["filename"]).stem + ".txt")
            with open(lbl_file, "w", encoding="utf-8") as f:
                for ann in item["annotations"]:
                    lbl  = ann.get("label") or ann.get("class")
                    cid  = c2id.get(lbl, 0)

                    if fmt == "yolov11_detect":
                        if ann.get("type") == "bbox" and "bbox" in ann:
                            x, y, bw, bh = ann["bbox"]
                        elif "mask" in ann and ann["mask"]:
                            xs = [p["x"] for p in ann["mask"]]
                            ys = [p["y"] for p in ann["mask"]]
                            x, y  = min(xs), min(ys)
                            bw, bh = max(xs)-x, max(ys)-y
                        else:
                            continue
                        cx = max(0., min(1., (x + bw/2) / w))
                        cy = max(0., min(1., (y + bh/2) / h))
                        nw = max(0., min(1., bw / w))
                        nh = max(0., min(1., bh / h))
                        f.write(f"{cid} {cx:.6f} {cy:.6f} {nw:.6f} {nh:.6f}\n")

                    elif fmt == "yolov11_segment":
                        if ann.get("type") == "polygon" and "mask" in ann:
                            pts = ann["mask"]
                        elif "bbox" in ann:
                            x, y, bw, bh = ann["bbox"]
                            pts = [{"x":x,"y":y},{"x":x+bw,"y":y},
                                   {"x":x+bw,"y":y+bh},{"x":x,"y":y+bh}]
                        else:
                            continue
                        if not pts:
                            continue
                        coords = " ".join(
                            f"{max(0.,min(1.,p['x']/w)):.6f} {max(0.,min(1.,p['y']/h)):.6f}"
                            for p in pts
                        )
                        f.write(f"{cid} {coords}\n")


def _write_coco(export_path: Path, splits: dict, classes_list: list, c2id: dict):
    for split, items in splits.items():
        if not items:
            continue
        sdir = export_path / split
        sdir.mkdir(parents=True, exist_ok=True)

        coco = {
            "info": {"description": "APIFlow Labeler Export", "version": "1.0"},
            "licenses": [],
            "images": [],
            "annotations": [],
            "categories": [
                {"id": i+1, "name": n, "supercategory": "object"}
                for i, n in enumerate(classes_list)
            ],
        }
        ann_id = 1
        for img_idx, item in enumerate(items, start=1):
            img = cv2.imread(item["img_path"])
            if img is None:
                continue
            h_img, w_img, _ = img.shape
            shutil.copy(item["img_path"], sdir / item["filename"])
            coco["images"].append({
                "id": img_idx, "file_name": item["filename"],
                "width": w_img, "height": h_img,
            })
            for ann in item["annotations"]:
                lbl  = ann.get("label") or ann.get("class")
                catid = c2id.get(lbl, 1)

                if "bbox" in ann and ann["bbox"]:
                    bbox = [float(c) for c in ann["bbox"]]
                elif "mask" in ann and ann["mask"]:
                    xs  = [p["x"] for p in ann["mask"]]
                    ys  = [p["y"] for p in ann["mask"]]
                    bbox = [float(min(xs)), float(min(ys)),
                            float(max(xs)-min(xs)), float(max(ys)-min(ys))]
                else:
                    continue

                area = bbox[2] * bbox[3]
                if "mask" in ann and ann["mask"]:
                    seg = [[float(c) for p in ann["mask"] for c in (p["x"], p["y"])]]
                else:
                    bx,by,bw,bh = bbox
                    seg = [[bx,by, bx+bw,by, bx+bw,by+bh, bx,by+bh]]

                coco["annotations"].append({
                    "id": ann_id, "image_id": img_idx, "category_id": catid,
                    "segmentation": seg, "area": float(area), "bbox": bbox, "iscrowd": 0,
                })
                ann_id += 1

        # ← correct COCO filename
        with open(sdir / "_annotations.coco.json", "w", encoding="utf-8") as f:
            json.dump(coco, f, indent=2)


# ── endpoint ───────────────────────────────────────────────────────────

@router.post("/download")
def export_version(req: ExportRequest):
    total_pct = req.train_pct + req.val_pct + req.test_pct
    if total_pct <= 0:
        raise HTTPException(status_code=400, detail="Split percentages must sum > 0.")

    files, unique_classes = _gather_from_version(req.project_id, req.dataset_id, req.version_id)
    if not files:
        raise HTTPException(status_code=400,
            detail="No annotated images found in this dataset version. Add images first.")

    classes_list = sorted(unique_classes) or ["object"]

    # COCO uses 1-indexed categories; YOLO uses 0-indexed
    if req.format == "coco":
        c2id = {n: i+1 for i, n in enumerate(classes_list)}
    else:
        c2id = {n: i for i, n in enumerate(classes_list)}

    splits = _split(files, req.train_pct, req.val_pct, req.test_pct)

    with tempfile.TemporaryDirectory() as tmp:
        export_path = Path(tmp) / "dataset"
        export_path.mkdir()

        if req.format.startswith("yolov11"):
            _write_yolo(export_path, splits, classes_list, c2id, req.format)
        elif req.format == "coco":
            _write_coco(export_path, splits, classes_list, c2id)

        zip_name = f"export_{req.dataset_id}_{req.version_id}_{req.format}.zip"
        zip_path = os.path.join(EXPORTS_DIR, zip_name)

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, _, flist in os.walk(export_path):
                for fn in flist:
                    full = os.path.join(root, fn)
                    zf.write(full, arcname=os.path.relpath(full, export_path))

    # ── write export log into version meta ──────────────────────────────
    export_entry = {
        "id":          uuid.uuid4().hex[:8],
        "exported_at": datetime.datetime.now().isoformat(),
        "format":      req.format,
        "train_pct":   req.train_pct,
        "val_pct":     req.val_pct,
        "test_pct":    req.test_pct,
        "image_count": len(files),
        "train_count": len(splits["train"]),
        "valid_count": len(splits["valid"]),
        "test_count":  len(splits["test"]),
        "zip_name":    zip_name,
    }
    mp = os.path.join(PROJECTS_DIR, req.project_id, "datasets", req.dataset_id, "versions", req.version_id, "meta.json")
    if os.path.exists(mp):
        m = _rj(mp)
        m.setdefault("exports", []).append(export_entry)
        m["status"] = "exported"
        _wj(mp, m)

    return FileResponse(zip_path, media_type="application/zip", filename=zip_name)
