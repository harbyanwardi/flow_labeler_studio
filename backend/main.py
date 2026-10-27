from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from backend.api import batches, export, datasets, projects, autolabel
import os
from backend.utils.paths import FRONTEND_DIR, STORAGE_DIR
from backend.utils.logger import setup_logging

logger = setup_logging()

app = FastAPI(title="APIFlow Labeler")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception on {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal Server Error: {str(exc)}"}
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

