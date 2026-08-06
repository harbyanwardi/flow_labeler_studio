"""
start_server.py — APIFlow Labeler Production Startup Script
Digunakan oleh aaPanel Python Manager (mode: python)

Script ini memastikan package dari venv project sendiri
digunakan, terlepas dari Python interpreter mana yang
dipakai oleh aaPanel Python Manager.
"""
import sys
import os

# ── 1. Paksa gunakan site-packages dari venv project ────────────────
PROJECT_DIR = '/www/wwwroot/public_html/apiflow-labeler'
VENV_SITE_PACKAGES = os.path.join(PROJECT_DIR, 'venv', 'lib', 'python3.10', 'site-packages')

if VENV_SITE_PACKAGES not in sys.path:
    sys.path.insert(0, VENV_SITE_PACKAGES)

# ── 2. Pastikan working directory adalah root project ────────────────
os.chdir(PROJECT_DIR)

# ── 3. Set PYTHONPATH agar import backend.* bisa ditemukan ──────────
if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)

# ── 4. Jalankan aplikasi via uvicorn ────────────────────────────────
import uvicorn

uvicorn.run(
    'backend.main:app',
    host='127.0.0.1',
    port=8865,
    workers=1,
    log_level='info',
)
