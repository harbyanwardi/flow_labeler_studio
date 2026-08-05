from fastapi import APIRouter, UploadFile, HTTPException
from typing import List
from backend.utils.file import save_upload
import os
import json

router = APIRouter()

from backend.utils.paths import IMAGES_DIR, ANNOTATIONS_DIR

@router.post("/upload")
def upload_image(file: UploadFile):
    os.makedirs(IMAGES_DIR, exist_ok=True)
    try:
        path, name = save_upload(file, IMAGES_DIR)
        return {"filename": name, "path": path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload image: {str(e)}")

@router.post("/upload-bulk")
def upload_bulk(files: List[UploadFile]):
    os.makedirs(IMAGES_DIR, exist_ok=True)
    uploaded = []
    errors = []
    for file in files:
        if not file.filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
            continue
        try:
            path, name = save_upload(file, IMAGES_DIR)
            uploaded.append({
                "filename": name,
                "original_name": file.filename,
                "path": path
            })
        except Exception as e:
            errors.append({"filename": file.filename, "error": str(e)})
            
    return {"files": uploaded, "errors": errors}

@router.get("/list")
def list_images():
    if not os.path.exists(IMAGES_DIR):
        return []
    
    files = []
    try:
        for name in os.listdir(IMAGES_DIR):
            if name.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                annotation_path = os.path.join(ANNOTATIONS_DIR, f"{name}.json")
                has_annotation = os.path.exists(annotation_path)
                
                classes = []
                if has_annotation:
                    try:
                        with open(annotation_path, "r") as f:
                            data = json.load(f)
                            classes = list(set([ann.get("label") for ann in data.get("annotations", []) if ann.get("label")]))
                    except Exception:
                        pass
                
                files.append({
                    "filename": name,
                    "url": f"/storage/images/{name}",
                    "annotated": has_annotation,
                    "classes": classes
                })
        
        files.sort(key=lambda x: x["filename"])
        return files
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list images: {str(e)}")

