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
