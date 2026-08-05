# backend/api/autolabel.py
from fastapi import APIRouter, HTTPException
from backend.ai.pipeline import auto_label
import os

router = APIRouter()

from backend.utils.paths import PROJECTS_DIR


@router.post("/{project_id}/{batch_id}/{image_name}")
def auto_label_existing(project_id: str, batch_id: str, image_name: str):
    path = os.path.join(PROJECTS_DIR, project_id, "batches", batch_id, "images", image_name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Image {image_name} not found in storage")
    try:
        annotations = auto_label(path)
        return {"image": image_name, "annotations": annotations}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Auto-labeling failed: {str(e)}")
