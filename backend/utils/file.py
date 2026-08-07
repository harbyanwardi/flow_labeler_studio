# backend/utils/file.py

import os
import uuid


import shutil

def save_upload(file, folder):
    """Save an uploaded file, using UUID prefix to avoid collisions."""
    os.makedirs(folder, exist_ok=True)
    ext = os.path.splitext(file.filename)[1]
    # Keep original name but prepend short uuid to avoid collisions
    safe_name = file.filename.replace(" ", "_")
    filename = f"{uuid.uuid4().hex[:8]}_{safe_name}"
    path = os.path.join(folder, filename)

    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    return path, filename
