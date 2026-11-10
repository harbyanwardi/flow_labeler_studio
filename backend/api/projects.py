# backend/api/projects.py
import os
import json
import uuid
import datetime
import shutil
from fastapi import APIRouter, HTTPException

router = APIRouter()

from backend.utils.paths import PROJECTS_DIR


def get_project_meta(project_id: str) -> dict:
    meta_path = os.path.join(PROJECTS_DIR, project_id, "meta.json")
    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_project_meta(project_id: str, meta: dict):
    project_dir = os.path.join(PROJECTS_DIR, project_id)
    os.makedirs(project_dir, exist_ok=True)
    with open(os.path.join(project_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)


def add_project_tags(project_id: str, new_tags: list):
    meta = get_project_meta(project_id)
    current = set(meta.get("tags", []))
    for t in new_tags:
        t_clean = str(t).strip()
        if t_clean:
            current.add(t_clean)
    meta["tags"] = sorted(list(current))
    save_project_meta(project_id, meta)



@router.get("/list")
def list_projects():
    projects = []
    if not os.path.exists(PROJECTS_DIR):
        return []
    for pid in os.listdir(PROJECTS_DIR):
        project_dir = os.path.join(PROJECTS_DIR, pid)
        if not os.path.isdir(project_dir):
            continue
        meta = get_project_meta(pid)
        
        # Calculate some stats for the project
        batches_dir = os.path.join(project_dir, "batches")
        num_batches = 0
        total_images = 0
        if os.path.exists(batches_dir):
            for bid in os.listdir(batches_dir):
                if os.path.isdir(os.path.join(batches_dir, bid)):
                    num_batches += 1
                    img_dir = os.path.join(batches_dir, bid, "images")
                    if os.path.exists(img_dir):
                        total_images += len([f for f in os.listdir(img_dir) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))])
                        
        projects.append({
            "id": pid,
            "name": meta.get("name", pid),
            "created_at": meta.get("created_at", ""),
            "num_batches": num_batches,
            "total_images": total_images
        })
    projects.sort(key=lambda x: x["created_at"], reverse=True)
    return projects


@router.post("/create")
def create_project(body: dict):
    project_id = str(uuid.uuid4())[:8]
    name = body.get("name", f"Project {project_id}")
    meta = {
        "id": project_id,
        "name": name,
        "created_at": datetime.datetime.now().isoformat(),
    }
    save_project_meta(project_id, meta)
    
    # Pre-create subdirectories
    os.makedirs(os.path.join(PROJECTS_DIR, project_id, "batches"), exist_ok=True)
    os.makedirs(os.path.join(PROJECTS_DIR, project_id, "datasets"), exist_ok=True)
    return meta


@router.delete("/{project_id}")
def delete_project(project_id: str):
    project_dir = os.path.join(PROJECTS_DIR, project_id)
    if not os.path.exists(project_dir):
        raise HTTPException(status_code=404, detail="Project not found")
    shutil.rmtree(project_dir)
    return {"status": "deleted"}


@router.get("/{project_id}/tags")
def get_project_tags(project_id: str):
    tags = set()
    # 1. From project meta
    meta = get_project_meta(project_id)
    for t in meta.get("tags", []):
        t_clean = str(t).strip()
        if t_clean:
            tags.add(t_clean)

    # 2. Scan batch annotations for any tags saved on images
    batches_dir = os.path.join(PROJECTS_DIR, project_id, "batches")
    if os.path.exists(batches_dir):
        for bid in os.listdir(batches_dir):
            ann_dir = os.path.join(batches_dir, bid, "annotations")
            if os.path.isdir(ann_dir):
                for f in os.listdir(ann_dir):
                    if f.endswith(".json"):
                        try:
                            with open(os.path.join(ann_dir, f), "r", encoding="utf-8") as jf:
                                d = json.load(jf)
                                for t in d.get("tags", []):
                                    t_clean = str(t).strip()
                                    if t_clean:
                                        tags.add(t_clean)
                        except Exception:
                            pass
    return sorted(list(tags))


@router.post("/{project_id}/tags")
def create_project_tag(project_id: str, body: dict):
    tag = str(body.get("tag", "")).strip()
    if not tag:
        raise HTTPException(status_code=400, detail="Tag cannot be empty")
    add_project_tags(project_id, [tag])
    return {"status": "success", "tag": tag}

