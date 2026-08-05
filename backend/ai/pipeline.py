from backend.ai.detector import detect
from backend.ai.segmenter import segment

def auto_label(image_path):
    results = []
    detections = detect(image_path)

    for det in detections:
        polygon = segment(image_path, det["bbox"])

        results.append({
            "type": "polygon",
            "label": det["label"],
            "bbox": det["bbox"],
            "mask": polygon,
            "confidence": det["confidence"],
            "source": "auto"
        })

    return results
