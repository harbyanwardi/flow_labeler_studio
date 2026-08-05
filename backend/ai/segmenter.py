import cv2
import numpy as np
from pathlib import Path

# ── Lazy SAM import ──────────────────────────────────────────────────
# segment_anything is optional — if not installed, auto-label is disabled
_sam_available = False
_predictor = None

BASE_DIR = Path(__file__).resolve().parents[1]
SAM_PATH = BASE_DIR / "models" / "sam_vit_b.pth"


def _load_sam():
    """Load SAM model on first use. Returns False if unavailable."""
    global _sam_available, _predictor
    if _predictor is not None:
        return True
    try:
        import torch
        from segment_anything import sam_model_registry, SamPredictor

        if not SAM_PATH.exists():
            raise FileNotFoundError(f"SAM model not found at {SAM_PATH}")

        sam = sam_model_registry["vit_b"](checkpoint=str(SAM_PATH))
        sam.to("cuda" if torch.cuda.is_available() else "cpu")
        _predictor = SamPredictor(sam)
        _sam_available = True
        return True
    except Exception as e:
        print(f"[segmenter] SAM unavailable: {e}")
        _sam_available = False
        return False


def segment(image_path: str, bbox: list) -> list:
    """
    Segment an object within bbox using SAM.
    Returns polygon points, or empty list if SAM unavailable.
    """
    if not _load_sam():
        return []

    img = cv2.imread(image_path)
    if img is None:
        return []
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    _predictor.set_image(img)

    x, y, w, h = bbox
    box = np.array([x, y, x + w, y + h])

    masks, _, _ = _predictor.predict(
        box=box[None, :],
        multimask_output=False,
    )

    mask = masks[0].astype("uint8")
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return []

    return [{"x": int(p[0][0]), "y": int(p[0][1])} for p in contours[0]]
