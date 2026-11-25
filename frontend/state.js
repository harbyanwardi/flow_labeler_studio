// frontend/state.js

const state = {
  // ── SCREENS ───────────────────────────────────────────────────────
  // 'projects'    → select or create project
  // 'home'        → batch list + dataset list of active project
  // 'annotate'    → canvas annotation (inside a batch)
  // 'version'     → dataset version image viewer + export log
  view: "projects",

  // ── PROJECT STATE ─────────────────────────────────────────────────
  projects: [],
  projectId: null,
  projectName: "",

  // ── BATCH STATE ───────────────────────────────────────────────────
  batches: [],
  activeBatchId: null,

  // ── IMAGE STATE (inside active batch) ─────────────────────────────
  images: [],
  currentImageIndex: -1,
  currentPage: 1,
  limit: 10,
  totalImages: 0,
  totalBatchImages: 0,
  batchTagCounts: {},


  // ── ANNOTATION ────────────────────────────────────────────────────
  annotations: [],
  tempPoints: [],
  selected: null,
  currentImageTags: [],
  projectTags: [],


  // ── DRAWING ───────────────────────────────────────────────────────
  mode: "bbox",       // 'bbox' | 'polygon' | 'pan'
  isDrawing: false,
  boxStart: null,

  // ── CLASSES ───────────────────────────────────────────────────────
  classes: ["defect", "crack", "scratch", "burn"],
  classColors: {
    defect:  "#ef4444",
    crack:   "#3b82f6",
    scratch: "#10b981",
    burn:    "#f59e0b",
  },
  currentClass: "defect",

  // ── DATASETS ──────────────────────────────────────────────────────
  datasets: [],           // full list from server

  // ── ACTIVE VERSION VIEW ───────────────────────────────────────────
  activeDatasetId:    null,
  activeVersionId:    null,
  versionImages:      [],   // image refs in current page of version
  versionMeta:        null, // version meta (includes exports log)
  versionCurrentPage: 1,
  versionLimit:       24,
  versionTotalImages: 0,
  versionSearch:      "",
  versionTagFilter:   "",
  versionTagCounts:   {},
};

const view = { scale: 1, offsetX: 0, offsetY: 0 };

// ── CLASS HELPERS ──────────────────────────────────────────────────

function getRandomColor() {
  const palette = [
    "#f97316","#a855f7","#06b6d4","#84cc16",
    "#ec4899","#14b8a6","#f43f5e","#8b5cf6",
    "#0ea5e9","#d946ef","#22c55e","#eab308",
  ];
  return palette[Math.floor(Math.random() * palette.length)];
}

function addClass(className) {
  const cleaned = className.trim().toLowerCase();
  if (cleaned && !state.classes.includes(cleaned)) {
    state.classes.push(cleaned);
    state.classColors[cleaned] = getRandomColor();
    if (state.projectId) {
      localStorage.setItem("apiflow_classes_" + state.projectId, JSON.stringify(state.classes));
      localStorage.setItem("apiflow_colors_" + state.projectId, JSON.stringify(state.classColors));
    }
    return cleaned;
  }
  return null;
}
