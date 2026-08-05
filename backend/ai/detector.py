from pathlib import Path
import cv2

# ── Lazy YOLO import ─────────────────────────────────────────────────
_model = None
_model_available = False

BASE_DIR = Path(__file__).resolve().parents[1]
MODEL_PATH = BASE_DIR / "models" / "best.pt"


def _load_model():
    """Load YOLO model on first use. Returns False if unavailable."""
    global _model, _model_available
    if _model is not None:
        return True
    try:
        from ultralytics import YOLO
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"YOLO model not found at {MODEL_PATH}")
        _model = YOLO(str(MODEL_PATH))
        _model_available = True
        return True
    except Exception as e:
        print(f"[detector] YOLO unavailable: {e}")
        _model_available = False
        return False


def detect(image_path: str, conf: float = 0.25) -> list:
    """
    Detect objects in image using YOLO.
    Returns list of detections, or empty list if model unavailable.
    """
    if not _load_model():
        return []

    img = cv2.imread(image_path)
    if img is None:
        return []

    result = _model(img)[0]
    detections = []
    for box in result.boxes:
        if box.conf < conf:
            continue
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        detections.append({
            "bbox": [x1, y1, x2 - x1, y2 - y1],
            "label": int(box.cls),
            "confidence": float(box.conf),
        })
    return detections
