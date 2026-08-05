import cv2
import numpy as np
import json
import os

def apply_augmentation(img_path: str, ann_path: str, dest_img_path: str, dest_ann_path: str, aug_type: str):
    """
    Apply a single augmentation to an image and its annotations,
    and save them to the destination paths.
    
    aug_type can be one of: "flip_h", "flip_v", "rot_90", "bright_up", "bright_dn", "sat_up", "sat_dn"
    """
    img = cv2.imread(img_path)
    if img is None:
        raise ValueError(f"Could not read image {img_path}")
        
    h, w = img.shape[:2]
    
    # Read annotations
    with open(ann_path, 'r', encoding='utf-8') as f:
        ann_data = json.load(f)
        
    annotations = ann_data.get("annotations", [])
    
    # Process image and update coordinates
    if aug_type == "flip_h":
        img = cv2.flip(img, 1)
        for a in annotations:
            if a.get("type") == "bbox" and "bbox" in a:
                bx, by, bw, bh = a["bbox"]
                a["bbox"] = [w - (bx + bw), by, bw, bh]
            elif a.get("type") == "polygon" and "mask" in a:
                for p in a["mask"]:
                    p["x"] = w - p["x"]
    elif aug_type == "flip_v":
        img = cv2.flip(img, 0)
        for a in annotations:
            if a.get("type") == "bbox" and "bbox" in a:
                bx, by, bw, bh = a["bbox"]
                a["bbox"] = [bx, h - (by + bh), bw, bh]
            elif a.get("type") == "polygon" and "mask" in a:
                for p in a["mask"]:
                    p["y"] = h - p["y"]
    elif aug_type == "rot_90":
        img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
        for a in annotations:
            if a.get("type") == "bbox" and "bbox" in a:
                bx, by, bw, bh = a["bbox"]
                # original: x, y is top-left
                # rotated 90 CW: new_x = h - (y + bh), new_y = x
                a["bbox"] = [h - (by + bh), bx, bh, bw]
            elif a.get("type") == "polygon" and "mask" in a:
                for p in a["mask"]:
                    orig_x, orig_y = p["x"], p["y"]
                    p["x"] = h - orig_y
                    p["y"] = orig_x
    elif aug_type == "bright_up":
        img = cv2.convertScaleAbs(img, alpha=1.2, beta=30)
    elif aug_type == "bright_dn":
        img = cv2.convertScaleAbs(img, alpha=0.8, beta=-30)
    elif aug_type == "sat_up":
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype("float32")
        hsv[:, :, 1] = hsv[:, :, 1] * 1.5
        hsv[:, :, 1] = np.clip(hsv[:, :, 1], 0, 255)
        img = cv2.cvtColor(hsv.astype("uint8"), cv2.COLOR_HSV2BGR)
    elif aug_type == "sat_dn":
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype("float32")
        hsv[:, :, 1] = hsv[:, :, 1] * 0.5
        img = cv2.cvtColor(hsv.astype("uint8"), cv2.COLOR_HSV2BGR)
    
    # Save image
    cv2.imwrite(dest_img_path, img)
    
    # Save annotations
    with open(dest_ann_path, 'w', encoding='utf-8') as f:
        json.dump(ann_data, f, indent=2)
