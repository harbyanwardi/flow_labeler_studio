# -*- mode: python ; coding: utf-8 -*-

import sys
import os

block_cipher = None

# Datas to bundle with executable
datas = [
    ('frontend', 'frontend'),
]

# Hidden imports required by FastAPI, Uvicorn, PyTorch, Ultralytics, SAM, WebView
hiddenimports = [
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'fastapi',
    'pydantic',
    'starlette',
    'engineio.async_drivers.asgi',
    'webview',
    'cv2',
    'numpy',
    'torch',
    'torchvision',
    'ultralytics',
    'segment_anything',
    'backend.main',
    'backend.utils.paths',
    'backend.utils.file',
    'backend.api.projects',
    'backend.api.batches',
    'backend.api.datasets',
    'backend.api.export',
    'backend.api.autolabel',
    'backend.api.images',
    'backend.api.annotations',
]

a = Analysis(
    ['run_desktop.py'],
    pathex=['.'],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='APIFlowLabeler',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='APIFlowLabeler',
)
