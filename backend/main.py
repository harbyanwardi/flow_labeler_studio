from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from backend.api import batches, export, datasets, projects, autolabel
import os
from backend.utils.paths import FRONTEND_DIR, STORAGE_DIR

app = FastAPI(title="APIFlow Labeler")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Routers
app.include_router(projects.router,  prefix="/projects")
app.include_router(batches.router,   prefix="/batches")
app.include_router(datasets.router,  prefix="/datasets")
app.include_router(export.router,    prefix="/export")
app.include_router(autolabel.router, prefix="/autolabel")

# Static: backend storage (images from batches)
app.mount("/storage", StaticFiles(directory=STORAGE_DIR), name="storage")

# Static: frontend files
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/")
def root():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

