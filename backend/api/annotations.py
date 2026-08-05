from fastapi import APIRouter, HTTPException
import json
import os

router = APIRouter()

from backend.utils.paths import ANNOTATIONS_DIR

@router.get("/{image_name}")
def get_annotations(image_name: str):
    path = os.path.join(ANNOTATIONS_DIR, f"{image_name}.json")
    if os.path.exists(path):
        try:
            with open(path, "r") as f:
                return json.load(f)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read annotation: {str(e)}")
    return {"image": image_name, "annotations": []}

@router.post("/")
def save_annotations(data: dict):
    image_name = data.get("image")
    if not image_name:
        raise HTTPException(status_code=400, detail="Missing 'image' key in data")
    
    path = os.path.join(ANNOTATIONS_DIR, f"{image_name}.json")
    try:
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        return {"status": "success", "message": f"Annotations saved for {image_name}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save annotation: {str(e)}")

