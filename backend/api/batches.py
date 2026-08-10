# backend/api/batches.py
import os
import json
import uuid
import shutil
import zipfile
import tempfile
from fastapi import APIRouter, UploadFile, HTTPException, Form
from typing import List
from backend.utils.file import save_upload

router = APIRouter()

from backend.utils.paths import PROJECTS_DIR


def get_batches_dir(project_id: str) -> str:
    return os.path.join(PROJECTS_DIR, project_id, "batches")


def get_batch_meta(project_id: str, batch_id: str) -> dict:
    meta_path = os.path.join(get_batches_dir(project_id), batch_id, "meta.json")
    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_batch_meta(project_id: str, batch_id: str, meta: dict):
    batch_dir = os.path.join(get_batches_dir(project_id), batch_id)
    os.makedirs(batch_dir, exist_ok=True)
    with open(os.path.join(batch_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)


def get_batch_image_stats(project_id: str, batch_id: str) -> dict:
    batch_dir = os.path.join(get_batches_dir(project_id), batch_id)
    images_dir = os.path.join(batch_dir, "images")
    annotations_dir = os.path.join(batch_dir, "annotations")

    total = 0
    labeled = 0
    if os.path.exists(images_dir):
        for name in os.listdir(images_dir):
            if name.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                total += 1
                ann_path = os.path.join(annotations_dir, f"{name}.json")
                if os.path.exists(ann_path):
                    try:
                        with open(ann_path, "r", encoding="utf-8") as f:
                            d = json.load(f)
                            if d.get("annotations") or d.get("null_labeled", False):
                                labeled += 1
                    except Exception:
                        pass
    return {"total": total, "labeled": labeled}


# ── BATCHES ────────────────────────────────────────────────────────────

@router.get("/{project_id}/batches/list")
def list_batches(project_id: str):
    batches = []
    batches_dir = get_batches_dir(project_id)
    if not os.path.exists(batches_dir):
        return []
    for batch_id in os.listdir(batches_dir):
        batch_dir = os.path.join(batches_dir, batch_id)
        if not os.path.isdir(batch_dir):
            continue
        meta = get_batch_meta(project_id, batch_id)
        stats = get_batch_image_stats(project_id, batch_id)
        batches.append({
            "id": batch_id,
            "name": meta.get("name", batch_id),
            "created_at": meta.get("created_at", ""),
            "total_images": stats["total"],
            "labeled_images": stats["labeled"],
        })
    batches.sort(key=lambda x: x["created_at"], reverse=True)
    return batches


@router.post("/{project_id}/batches/create")
def create_batch(project_id: str, body: dict):
    batch_id = str(uuid.uuid4())[:8]
    name = body.get("name", f"Batch {batch_id}")
    import datetime
    meta = {
        "id": batch_id,
        "name": name,
        "created_at": datetime.datetime.now().isoformat(),
    }
    save_batch_meta(project_id, batch_id, meta)
    batches_dir = get_batches_dir(project_id)
    os.makedirs(os.path.join(batches_dir, batch_id, "images"), exist_ok=True)
    os.makedirs(os.path.join(batches_dir, batch_id, "annotations"), exist_ok=True)
    return meta


@router.post("/{project_id}/batches/import-coco")
def import_coco_dataset(project_id: str, file: UploadFile, batch_name: str = Form(...)):
    batch_id = str(uuid.uuid4())[:8]
    import datetime
    meta = {
        "id": batch_id,
        "name": batch_name,
        "created_at": datetime.datetime.now().isoformat(),
    }
    
    batches_dir = get_batches_dir(project_id)
    batch_dir = os.path.join(batches_dir, batch_id)
    images_dir = os.path.join(batch_dir, "images")
    annotations_dir = os.path.join(batch_dir, "annotations")
    
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(annotations_dir, exist_ok=True)
    
    with tempfile.TemporaryDirectory() as tmp_dir:
        zip_path = os.path.join(tmp_dir, "upload.zip")
        with open(zip_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
            
        try:
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(tmp_dir)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid ZIP file: {str(e)}")
            
        coco_files = []
        for root, dirs, files in os.walk(tmp_dir):
            for filename in files:
                if filename.endswith(".json") and not filename.startswith("meta"):
                    filepath = os.path.join(root, filename)
                    try:
                        with open(filepath, "r", encoding="utf-8") as f:
                            data = json.load(f)
                            if isinstance(data, dict) and "images" in data and "annotations" in data and "categories" in data:
                                coco_files.append((filepath, data))
                    except Exception:
                        continue
                        
        if not coco_files:
            raise HTTPException(status_code=400, detail="No valid COCO JSON annotation files found in the ZIP.")
            
        imported_images_count = 0
        
        for coco_path, coco_data in coco_files:
            coco_dir = os.path.dirname(coco_path)
            
            cat_map = {}
            for cat in coco_data.get("categories", []):
                cat_map[cat["id"]] = cat["name"]
                
            ann_map = {}
            for ann in coco_data.get("annotations", []):
                image_id = ann.get("image_id")
                ann_map.setdefault(image_id, []).append(ann)
                
            for img_info in coco_data.get("images", []):
                img_id = img_info.get("id")
                file_name = img_info.get("file_name")
                if not file_name:
                    continue
                    
                src_img_path = os.path.join(coco_dir, file_name)
                if not os.path.exists(src_img_path):
                    # Try recursively checking the temp dir
                    base_name = os.path.basename(file_name)
                    found = False
                    for r, d, fs in os.walk(tmp_dir):
                        if base_name in fs:
                            src_img_path = os.path.join(r, base_name)
                            found = True
                            break
                    if not found:
                        continue
                        
                safe_name = os.path.basename(src_img_path).replace(" ", "_")
                dest_name = f"{uuid.uuid4().hex[:8]}_{safe_name}"
                dest_path = os.path.join(images_dir, dest_name)
                
                shutil.copy(src_img_path, dest_path)
                
                anns_list = []
                img_anns = ann_map.get(img_id, [])
                for ann in img_anns:
                    cat_id = ann.get("category_id")
                    label = cat_map.get(cat_id, "default")
                    
                    bbox = ann.get("bbox")
                    seg = ann.get("segmentation")
                    
                    ann_type = "bbox"
                    mask_pts = []
                    
                    if seg and isinstance(seg, list) and len(seg) > 0:
                        poly = seg[0]
                        if isinstance(poly, list) and len(poly) >= 6:
                            ann_type = "polygon"
                            for i in range(0, len(poly), 2):
                                mask_pts.append({"x": float(poly[i]), "y": float(poly[i+1])})
                                
                    ann_item = {
                        "type": ann_type,
                        "label": label,
                        "confidence": 1.0,
                        "source": "manual"
                    }
                    if bbox:
                        ann_item["bbox"] = [float(c) for c in bbox]
                    if mask_pts:
                        ann_item["mask"] = mask_pts
                        
                    anns_list.append(ann_item)
                    
                ann_payload = {
                    "image": dest_name,
                    "annotations": anns_list
                }
                with open(os.path.join(annotations_dir, f"{dest_name}.json"), "w", encoding="utf-8") as f:
                    json.dump(ann_payload, f, indent=2)
                    
                imported_images_count += 1
                
        if imported_images_count == 0:
            raise HTTPException(status_code=400, detail="No images matching the annotations were found in the ZIP.")
            
        save_batch_meta(project_id, batch_id, meta)
        return {
            "status": "success",
            "batch_id": batch_id,
            "name": batch_name,
            "imported_images": imported_images_count
        }


@router.delete("/{project_id}/batches/{batch_id}")
def delete_batch(project_id: str, batch_id: str):
    batch_dir = os.path.join(get_batches_dir(project_id), batch_id)
    if not os.path.exists(batch_dir):
        raise HTTPException(status_code=404, detail="Batch not found")
    shutil.rmtree(batch_dir)
    return {"status": "deleted"}


# ── IMAGES IN BATCH ────────────────────────────────────────────────────

@router.get("/{project_id}/batches/{batch_id}/images")
def list_batch_images(project_id: str, batch_id: str, page: int = 1, limit: int = 10, search: str = "", status: str = "all"):
    batch_dir = os.path.join(get_batches_dir(project_id), batch_id)
    if not os.path.exists(batch_dir):
        raise HTTPException(status_code=404, detail="Batch not found")

    images_dir = os.path.join(batch_dir, "images")
    annotations_dir = os.path.join(batch_dir, "annotations")
    if not os.path.exists(images_dir):
        return {"images": [], "total": 0, "page": page, "limit": limit}

    all_files = sorted(os.listdir(images_dir))
    matching_files = []
    search_lower = search.lower().strip() if search else ""
    for name in all_files:
        if not name.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
            continue
        if search_lower and search_lower not in name.lower():
            continue
            
        if status != "all":
            ann_path = os.path.join(annotations_dir, f"{name}.json")
            has_ann = False
            if os.path.exists(ann_path):
                try:
                    with open(ann_path, "r", encoding="utf-8") as f:
                        d = json.load(f)
                        has_ann = len(d.get("annotations", [])) > 0 or d.get("null_labeled", False)
                except Exception:
                    pass
            if status == "labeled" and not has_ann:
                continue
            if status == "unlabeled" and has_ann:
                continue
                
        matching_files.append(name)

    total = len(matching_files)

    # Allow disabling limit with -1 or 0
    if limit > 0:
        start = (page - 1) * limit
        end = start + limit
        sliced_files = matching_files[start:end]
    else:
        sliced_files = matching_files

    files = []
    for name in sliced_files:
        ann_path = os.path.join(annotations_dir, f"{name}.json")
        has_ann = False
        classes = []
        if os.path.exists(ann_path):
            try:
                with open(ann_path, "r", encoding="utf-8") as f:
                    d = json.load(f)
                    anns = d.get("annotations", [])
                    has_ann = len(anns) > 0 or d.get("null_labeled", False)
                    classes = list(set(a.get("label") for a in anns if a.get("label")))
            except Exception:
                pass
        files.append({
            "filename": name,
            "url": f"/storage/projects/{project_id}/batches/{batch_id}/images/{name}",
            "annotated": has_ann,
            "classes": classes,
        })
    return {"images": files, "total": total, "page": page, "limit": limit}


@router.post("/{project_id}/batches/{batch_id}/upload")
def upload_to_batch(project_id: str, batch_id: str, files: List[UploadFile]):
    batch_dir = os.path.join(get_batches_dir(project_id), batch_id)
    if not os.path.exists(batch_dir):
        raise HTTPException(status_code=404, detail="Batch not found")

    images_dir = os.path.join(batch_dir, "images")
    os.makedirs(images_dir, exist_ok=True)

    uploaded = []
    errors = []
    for file in files:
        if not file.filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
            continue
        try:
            path, name = save_upload(file, images_dir)
            uploaded.append({"filename": name, "original_name": file.filename})
        except Exception as e:
            errors.append({"filename": file.filename, "error": str(e)})
    return {"files": uploaded, "errors": errors}


@router.delete("/{project_id}/batches/{batch_id}/images/{image_name}")
def delete_batch_image(project_id: str, batch_id: str, image_name: str):
    batch_dir = os.path.join(get_batches_dir(project_id), batch_id)
    img_path = os.path.join(batch_dir, "images", image_name)
    ann_path = os.path.join(batch_dir, "annotations", f"{image_name}.json")

    if not os.path.exists(img_path):
        raise HTTPException(status_code=404, detail="Image not found")

    os.remove(img_path)
    if os.path.exists(ann_path):
        os.remove(ann_path)
    return {"status": "deleted"}


# ── ANNOTATIONS IN BATCH ───────────────────────────────────────────────

@router.get("/{project_id}/batches/{batch_id}/annotations/{image_name}")
def get_batch_annotation(project_id: str, batch_id: str, image_name: str):
    ann_path = os.path.join(get_batches_dir(project_id), batch_id, "annotations", f"{image_name}.json")
    if os.path.exists(ann_path):
        with open(ann_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"image": image_name, "annotations": []}


@router.post("/{project_id}/batches/{batch_id}/annotations")
def save_batch_annotation(project_id: str, batch_id: str, data: dict):
    batch_dir = os.path.join(get_batches_dir(project_id), batch_id)
    if not os.path.exists(batch_dir):
        raise HTTPException(status_code=404, detail="Batch not found")
    annotations_dir = os.path.join(batch_dir, "annotations")
    os.makedirs(annotations_dir, exist_ok=True)
    image_name = data.get("image")
    if not image_name:
        raise HTTPException(status_code=400, detail="Missing 'image' key")
    with open(os.path.join(annotations_dir, f"{image_name}.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return {"status": "success"}
