# backend/api/datasets.py
# Full dataset + versioned collection management scoped under projects
import os, json, uuid, datetime, shutil
from fastapi import APIRouter, HTTPException

router = APIRouter()

from backend.utils.paths import PROJECTS_DIR
from backend.utils.image import apply_augmentation


def get_datasets_dir(project_id: str) -> str:
    return os.path.join(PROJECTS_DIR, project_id, "datasets")


def get_batches_dir(project_id: str) -> str:
    return os.path.join(PROJECTS_DIR, project_id, "batches")


# ── helpers ────────────────────────────────────────────────────────────

def _rj(p):
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

def _wj(p, d):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=2, ensure_ascii=False)

def _ds_dir(project_id, did):   
    return os.path.join(get_datasets_dir(project_id), did)

def _ver_dir(project_id, did, vid): 
    return os.path.join(get_datasets_dir(project_id), did, "versions", vid)

def _enrich_version(project_id: str, did: str, vid: str, vmeta: dict) -> dict:
    imgf = os.path.join(_ver_dir(project_id, did, vid), "images.json")
    vmeta["image_count"] = len(_rj(imgf)) if os.path.exists(imgf) else 0
    return vmeta

# ═══════════════════════════════════════════════════════════════════════
# DATASETS
# ═══════════════════════════════════════════════════════════════════════

@router.get("/{project_id}/datasets/list")
def list_datasets(project_id: str):
    datasets_dir = get_datasets_dir(project_id)
    if not os.path.exists(datasets_dir):
        return []
    result = []
    for did in os.listdir(datasets_dir):
        mp = os.path.join(datasets_dir, did, "meta.json")
        if not os.path.exists(mp):
            continue
        meta = _rj(mp)
        # Collect versions
        vdir = os.path.join(datasets_dir, did, "versions")
        versions = []
        if os.path.exists(vdir):
            for vid in os.listdir(vdir):
                vm = os.path.join(vdir, vid, "meta.json")
                if os.path.exists(vm):
                    versions.append(_enrich_version(project_id, did, vid, _rj(vm)))
        versions.sort(key=lambda v: v.get("version_num", 0))
        meta["versions"] = versions
        result.append(meta)
    result.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return result


@router.post("/{project_id}/datasets/create")
def create_dataset(project_id: str, body: dict):
    did  = uuid.uuid4().hex[:8]
    name = body.get("name", f"Dataset_{did}")
    meta = {
        "id": did,
        "name": name,
        "created_at": datetime.datetime.now().isoformat(),
    }
    _wj(os.path.join(_ds_dir(project_id, did), "meta.json"), meta)

    # Auto-create first version (v1 draft)
    vid   = uuid.uuid4().hex[:8]
    vmeta = {
        "id": vid, "dataset_id": did, "version_num": 1, "name": "v1",
        "created_at": datetime.datetime.now().isoformat(),
        "status": "draft", "image_count": 0, "exports": [],
    }
    vp = _ver_dir(project_id, did, vid)
    _wj(os.path.join(vp, "meta.json"), vmeta)
    _wj(os.path.join(vp, "images.json"), [])

    meta["versions"] = [vmeta]
    return meta


@router.delete("/{project_id}/datasets/{dataset_id}")
def delete_dataset(project_id: str, dataset_id: str):
    dp = _ds_dir(project_id, dataset_id)
    if not os.path.exists(dp):
        raise HTTPException(status_code=404, detail="Dataset not found")
    shutil.rmtree(dp)
    return {"status": "deleted"}

# ═══════════════════════════════════════════════════════════════════════
# VERSIONS
# ═══════════════════════════════════════════════════════════════════════

@router.post("/{project_id}/datasets/{dataset_id}/versions/create")
def create_version(project_id: str, dataset_id: str):
    dp = _ds_dir(project_id, dataset_id)
    if not os.path.exists(dp):
        raise HTTPException(status_code=404, detail="Dataset not found")

    # next version number
    vdir = os.path.join(dp, "versions")
    nums = []
    if os.path.exists(vdir):
        for vid in os.listdir(vdir):
            vm = os.path.join(vdir, vid, "meta.json")
            if os.path.exists(vm):
                nums.append(_rj(vm).get("version_num", 0))
    vnum = max(nums, default=0) + 1

    vid   = uuid.uuid4().hex[:8]
    vmeta = {
        "id": vid, "dataset_id": dataset_id,
        "version_num": vnum, "name": f"v{vnum}",
        "created_at": datetime.datetime.now().isoformat(),
        "status": "draft", "image_count": 0, "exports": [],
    }
    vp = _ver_dir(project_id, dataset_id, vid)
    _wj(os.path.join(vp, "meta.json"), vmeta)
    _wj(os.path.join(vp, "images.json"), [])
    return vmeta


@router.get("/{project_id}/datasets/{dataset_id}/versions/{version_id}")
def get_version(project_id: str, dataset_id: str, version_id: str):
    vp  = _ver_dir(project_id, dataset_id, version_id)
    mp  = os.path.join(vp, "meta.json")
    if not os.path.exists(mp):
        raise HTTPException(status_code=404, detail="Version not found")
    meta = _rj(mp)
    imgf = os.path.join(vp, "images.json")
    meta["image_count"] = len(_rj(imgf)) if os.path.exists(imgf) else 0
    return meta


@router.get("/{project_id}/datasets/{dataset_id}/versions/{version_id}/images")
def list_version_images(project_id: str, dataset_id: str, version_id: str):
    imgf = os.path.join(_ver_dir(project_id, dataset_id, version_id), "images.json")
    if not os.path.exists(imgf):
        return []
    imgs = _rj(imgf)
    batches_dir = get_batches_dir(project_id)
    for img in imgs:
        annp = os.path.join(batches_dir, img["batch_id"], "annotations", f"{img['filename']}.json")
        img["annotated"] = os.path.exists(annp)
        img["url"]       = f"/storage/projects/{project_id}/batches/{img['batch_id']}/images/{img['filename']}"
    return imgs


@router.post("/{project_id}/datasets/{dataset_id}/versions/{version_id}/add-images")
def add_images_to_version(project_id: str, dataset_id: str, version_id: str, body: dict):
    """
    body:
      batch_id  : str
      filenames : list[str]  – empty = add ALL annotated images from that batch
    """
    vp   = _ver_dir(project_id, dataset_id, version_id)
    mp   = os.path.join(vp, "meta.json")
    imgf = os.path.join(vp, "images.json")

    if not os.path.exists(vp):
        raise HTTPException(status_code=404, detail="Version not found")

    existing      = _rj(imgf) if os.path.exists(imgf) else []
    existing_keys = {(i["batch_id"], i["filename"]) for i in existing}

    batch_id  = body.get("batch_id", "")
    filenames = body.get("filenames", [])
    augmentations = body.get("augmentations", [])

    batches_dir = get_batches_dir(project_id)
    batch_img_dir = os.path.join(batches_dir, batch_id, "images")
    batch_ann_dir = os.path.join(batches_dir, batch_id, "annotations")

    added, skipped = [], []

    candidates = filenames if filenames else (
        sorted(f for f in os.listdir(batch_img_dir)
               if f.lower().endswith(('.png','.jpg','.jpeg','.webp')))
        if os.path.exists(batch_img_dir) else []
    )

    for fn in candidates:
        annp = os.path.join(batch_ann_dir, f"{fn}.json")
        imgp = os.path.join(batch_img_dir, fn)
        if not os.path.exists(annp) or not os.path.exists(imgp):
            skipped.append(fn); continue
        try:
            d = _rj(annp)
            if not d.get("annotations") and not d.get("null_labeled", False):
                skipped.append(fn); continue
        except Exception:
            skipped.append(fn); continue
            
        # 1. Add original
        if (batch_id, fn) not in existing_keys:
            existing.append({
                "id": uuid.uuid4().hex[:8],
                "batch_id": batch_id,
                "filename": fn,
            })
            existing_keys.add((batch_id, fn))
            added.append(fn)
        else:
            skipped.append(fn)
            
        # 2. Add augmentations
        for aug in augmentations:
            # We enforce .jpg for augmented outputs for simplicity
            aug_fn = f"{os.path.splitext(fn)[0]}_aug_{aug}.jpg"
            if (batch_id, aug_fn) in existing_keys:
                continue
                
            aug_imgp = os.path.join(batch_img_dir, aug_fn)
            aug_annp = os.path.join(batch_ann_dir, f"{aug_fn}.json")
            try:
                apply_augmentation(imgp, annp, aug_imgp, aug_annp, aug)
                existing.append({
                    "id": uuid.uuid4().hex[:8],
                    "batch_id": batch_id,
                    "filename": aug_fn,
                })
                existing_keys.add((batch_id, aug_fn))
                added.append(aug_fn)
            except Exception as e:
                print(f"Augmentation {aug} failed for {fn}: {e}")

    _wj(imgf, existing)

    m = _rj(mp) if os.path.exists(mp) else {}
    m["image_count"] = len(existing)
    _wj(mp, m)

    return {
        "added":   len(added),
        "skipped": len(skipped),
        "total":   len(existing),
        "added_files": added,
    }


@router.delete("/{project_id}/datasets/{dataset_id}/versions/{version_id}/images/{ref_id}")
def remove_image_from_version(project_id: str, dataset_id: str, version_id: str, ref_id: str):
    imgf = os.path.join(_ver_dir(project_id, dataset_id, version_id), "images.json")
    imgs = _rj(imgf) if os.path.exists(imgf) else []
    new_imgs = [i for i in imgs if i["id"] != ref_id]
    _wj(imgf, new_imgs)

    mp = os.path.join(_ver_dir(project_id, dataset_id, version_id), "meta.json")
    m  = _rj(mp) if os.path.exists(mp) else {}
    m["image_count"] = len(new_imgs)
    _wj(mp, m)

    return {"status": "removed", "remaining": len(new_imgs)}


@router.post("/{project_id}/datasets/{dataset_id}/versions/{version_id}/log-export")
def log_export(project_id: str, dataset_id: str, version_id: str, body: dict):
    """Called by export endpoint to record the export in version history."""
    mp = os.path.join(_ver_dir(project_id, dataset_id, version_id), "meta.json")
    if not os.path.exists(mp):
        raise HTTPException(status_code=404, detail="Version not found")
    m = _rj(mp)
    m.setdefault("exports", []).append(body)
    m["status"] = "exported"
    _wj(mp, m)
    return {"status": "logged"}
