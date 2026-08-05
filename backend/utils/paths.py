# backend/utils/paths.py

import os
import sys

# Detect PyInstaller frozen state
if getattr(sys, 'frozen', False):
    # Running in a PyInstaller bundle
    BUNDLE_DIR = sys._MEIPASS
    APP_DIR = os.path.dirname(sys.executable)
else:
    # Running from source
    BUNDLE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    APP_DIR = BUNDLE_DIR

# Frontend static files directory (bundled with application)
FRONTEND_DIR = os.path.join(BUNDLE_DIR, "frontend")

# User data directories (persistent next to executable or repo root)
STORAGE_DIR = os.path.join(APP_DIR, "backend", "storage")
PROJECTS_DIR = os.path.join(STORAGE_DIR, "projects")
IMAGES_DIR = os.path.join(STORAGE_DIR, "images")
ANNOTATIONS_DIR = os.path.join(STORAGE_DIR, "annotations")
EXPORTS_DIR = os.path.join(APP_DIR, "datasets", "exports")

# Ensure required persistent storage directories exist
for directory in [STORAGE_DIR, PROJECTS_DIR, IMAGES_DIR, ANNOTATIONS_DIR, EXPORTS_DIR]:
    os.makedirs(directory, exist_ok=True)
