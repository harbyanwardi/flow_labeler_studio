// frontend/canvas.js — APIFlow Labeler
// ────────────────────────────────────────────────────────────────────
"use strict";

const BASE_PATH = window.location.pathname.endsWith('/') 
  ? window.location.pathname.slice(0, -1) 
  : window.location.pathname;
const API = window.location.origin + BASE_PATH;

// ── canvas DOM ──────────────────────────────────────────────────────
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const canvasWrap = document.getElementById("canvasWrap");

if (!canvasWrap) {
  console.error(
    '[canvas.js] Could not find an element with id="canvasWrap". ' +
    "Check that your HTML has <div id=\"canvasWrap\">...</div> wrapping the <canvas>, " +
    "and that this script tag has `defer` or is placed at the end of <body> " +
    "so the DOM exists before canvas.js runs."
  );
}

// ── drawing runtime ─────────────────────────────────────────────────
let imgObj = null;
let mousePos = { x: 0, y: 0 };
let isRightDrag = false;
let isSpaceDown = false;
let dragSX = 0, dragSY = 0;
let previewBBox = null;

// ── export context (which dataset+version is being exported) ─────────
let exportCtx = { datasetId: null, versionId: null };

// ── add-to-dataset context ───────────────────────────────────────────
let addToDsCtx = { selectedDatasetId: null, selectedVersionId: null };

// ════════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════════
function loadProjectClasses() {
  if (!state.projectId) return;
  const savedClasses = localStorage.getItem("apiflow_classes_" + state.projectId);
  const savedColors = localStorage.getItem("apiflow_colors_" + state.projectId);
  if (savedClasses) {
    state.classes = JSON.parse(savedClasses);
  } else {
    state.classes = ["defect", "crack", "scratch", "burn"];
  }
  if (savedColors) {
    state.classColors = JSON.parse(savedColors);
  } else {
    state.classColors = {
      defect:  "#ef4444",
      crack:   "#3b82f6",
      scratch: "#10b981",
      burn:    "#f59e0b",
    };
  }
}

window.addEventListener("load", () => {
  const savedId = localStorage.getItem("apiflow_project_id");
  const savedName = localStorage.getItem("apiflow_project_name");

  if (savedId && savedName) {
    state.projectId = savedId;
    state.projectName = savedName;
    loadProjectClasses();
    showScreen("home");
    fetchHome();
  } else {
    showScreen("projects");
    fetchProjects();
  }
  renderTopbar();

  // drag-drop upload
  const dz = document.getElementById("dropZone");
  if (dz) {
    dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag-over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
    dz.addEventListener("drop", e => {
      e.preventDefault(); dz.classList.remove("drag-over");
      if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
    });
  } else {
    console.warn('[canvas.js] #dropZone not found — drag-and-drop upload disabled.');
  }

  const fileInputEl = document.getElementById("fileInput");
  if (fileInputEl) fileInputEl.addEventListener("change", e => e.target.files.length && uploadFiles(e.target.files));

  const folderInputEl = document.getElementById("folderInput");
  if (folderInputEl) folderInputEl.addEventListener("change", e => e.target.files.length && uploadFiles(e.target.files));

  // close modals on backdrop click
  document.querySelectorAll(".modal-backdrop").forEach(bd =>
    bd.addEventListener("click", e => { if (e.target === bd) bd.classList.remove("open"); })
  );
});

// keyboard shortcuts (annotate screen only)
window.addEventListener("keydown", e => {
  if (state.view !== "annotate") return;
  const tag = document.activeElement.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  switch (e.key) {
    case "b": case "B": setMode("bbox"); break;
    case "p": case "P": setMode("polygon"); break;
    case "h": case "H": setMode("pan"); break;
    case "r": case "R": resetView(); break;
    case "ArrowLeft": navPrev(); break;
    case "ArrowRight": navNext(); break;
    case "Delete": case "Backspace": deleteSelected(); break;
    case "Escape": cancelDraw(); break;
    case " ":
      e.preventDefault();
      isSpaceDown = true;
      if (canvasWrap) canvasWrap.classList.add("pan-cursor");
      break;
  }
});
window.addEventListener("keyup", e => {
  if (e.key === " ") {
    isSpaceDown = false;
    if (state.mode !== "pan" && canvasWrap) canvasWrap.classList.remove("pan-cursor");
  }
});

// ════════════════════════════════════════════════════════════════════
// TOPBAR
// ════════════════════════════════════════════════════════════════════
function renderTopbar() {
  const crumb = document.getElementById("topbarBreadcrumb");
  const acts = document.getElementById("topbarActions");
  if (!crumb || !acts) return;

  if (state.view === "projects") {
    crumb.innerHTML = `<span class="topbar-crumb topbar-crumb-active">Projects</span>`;
    acts.innerHTML = "";
    return;
  }

  if (state.view === "home") {
    crumb.innerHTML = `
      <span class="topbar-crumb" style="cursor:pointer;" onclick="goProjectSelect()">Projects</span>
      <span class="topbar-crumb-sep">›</span>
      <span class="topbar-crumb topbar-crumb-active">${escHtml(state.projectName)}</span>`;
    acts.innerHTML = "";
    return;
  }

  if (state.view === "annotate") {
    const batch = state.batches.find(b => b.id === state.activeBatchId) || {};
    crumb.innerHTML = `
      <span class="topbar-crumb" style="cursor:pointer;" onclick="goProjectSelect()">Projects</span>
      <span class="topbar-crumb-sep">›</span>
      <span class="topbar-crumb" style="cursor:pointer;" onclick="goHome()">${escHtml(state.projectName)}</span>
      <span class="topbar-crumb-sep">›</span>
      <span class="topbar-crumb topbar-crumb-active">${escHtml(batch.name || "Batch")}</span>`;
    acts.innerHTML = `
      <button class="btn btn-outline" onclick="markUnlabeledAsNull()">✓ Mark Unlabeled as Null</button>
      <button class="btn btn-success" id="autoLabelBtn" onclick="triggerAutoLabel()">✦ AI Auto Label</button>
      <button class="btn btn-primary" onclick="openAddToDatasetModal()">+ Add to Dataset</button>`;
    return;
  }

  if (state.view === "version") {
    const ds = state.datasets.find(d => d.id === state.activeDatasetId) || {};
    const ver = (ds.versions || []).find(v => v.id === state.activeVersionId) || {};
    crumb.innerHTML = `
      <span class="topbar-crumb" style="cursor:pointer;" onclick="goProjectSelect()">Projects</span>
      <span class="topbar-crumb-sep">›</span>
      <span class="topbar-crumb" style="cursor:pointer;" onclick="goHome()">${escHtml(state.projectName)}</span>
      <span class="topbar-crumb-sep">›</span>
      <span class="topbar-crumb">${escHtml(ds.name || "Dataset")}</span>
      <span class="topbar-crumb-sep">›</span>
      <span class="topbar-crumb topbar-crumb-active">${escHtml(ver.name || "Version")}</span>`;
    acts.innerHTML = `
      <button class="btn btn-amber" onclick="openExportModal()">⬇ Export Version</button>`;
    return;
  }
}

// ════════════════════════════════════════════════════════════════════
// SCREEN SWITCHING
// ════════════════════════════════════════════════════════════════════
function showScreen(name) {
  // Hide all screens first
  const screens = [
    { id: "projectsScreen", type: "flex" },
    { id: "homeScreen",     type: "flex" },
    { id: "annotateScreen", type: "flex" },
    { id: "versionScreen",  type: "flex" },
  ];
  screens.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (el) { el.style.display = "none"; el.classList.remove("active"); }
  });

  // Show target screen
  const target = screens.find(s =>
    (name === "projects" && s.id === "projectsScreen") ||
    (name === "home"     && s.id === "homeScreen")     ||
    (name === "annotate" && s.id === "annotateScreen") ||
    (name === "version"  && s.id === "versionScreen")
  );
  if (target) {
    const el = document.getElementById(target.id);
    if (el) { el.style.display = target.type; el.classList.add("active"); }
  }

  state.view = name;
  renderTopbar();
}

function goHome() {
  if (state.view === "annotate" && state.currentImageIndex !== -1) saveAnnotations(false);
  showScreen("home");
  fetchHome();
}

// ════════════════════════════════════════════════════════════════════
// PROJECTS CRUD & NAVIGATION
// ════════════════════════════════════════════════════════════════════
function openNewProjectModal() {
  const inp = document.getElementById("newProjectName");
  if (inp) inp.value = "";
  openModal("newProjectModal");
}

async function createProject() {
  const inp = document.getElementById("newProjectName");
  const name = inp ? inp.value.trim() : "";
  if (!name) { alert("Enter a project name."); return; }
  const r = await fetch(`${API}/projects/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) {
    alert("Failed to create project");
    return;
  }
  const project = await r.json();
  closeModal("newProjectModal");
  await fetchProjects();
}

async function deleteProject(id) {
  if (!confirm("Delete this project and all its batches/datasets? This cannot be undone.")) return;
  const r = await fetch(`${API}/projects/${id}`, { method: "DELETE" });
  if (r.ok) {
    if (state.projectId === id) {
      state.projectId = null;
      state.projectName = "";
      localStorage.removeItem("apiflow_project_id");
      localStorage.removeItem("apiflow_project_name");
    }
    fetchProjects();
  } else {
    alert("Failed to delete project");
  }
}

async function fetchProjects() {
  const grid = document.getElementById("projectsGrid");
  if (grid) {
    grid.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <div class="loading-text">Loading projects...</div>
      </div>`;
  }
  try {
    const r = await fetch(`${API}/projects/list`);
    state.projects = await r.json();
  } catch {
    state.projects = [];
  }
  renderProjectsGrid();
}

function renderProjectsGrid() {
  const grid = document.getElementById("projectsGrid");
  if (!grid) return;
  grid.innerHTML = "";

  if (!state.projects.length) {
    grid.innerHTML = `
      <div class="projects-empty">
        <div class="projects-empty-icon">🗂️</div>
        <div class="projects-empty-title">No projects yet</div>
        <div class="projects-empty-sub">Create your first project to start uploading images and annotating datasets.</div>
      </div>`;
    // still show the "New Project" card after empty state
  }

  state.projects.forEach(p => {
    const date = p.created_at ? new Date(p.created_at).toLocaleDateString() : "";
    const card = document.createElement("div");
    card.className = "project-card";
    card.onclick = () => selectProject(p.id, p.name);
    card.innerHTML = `
      <div class="project-card-top">
        <div class="project-icon">🗂️</div>
        <div class="project-card-actions" onclick="event.stopPropagation()">
          <button class="btn btn-icon btn-ghost" title="Delete project" onclick="deleteProject('${p.id}')">🗑</button>
        </div>
      </div>
      <div>
        <div class="project-card-name">${escHtml(p.name)}</div>
        <div class="project-card-date">Created ${date}</div>
      </div>
      <div class="project-divider"></div>
      <div class="project-stats">
        <div class="project-stat">
          <span class="project-stat-val">${p.num_batches}</span>
          <span class="project-stat-lbl">Batches</span>
        </div>
        <div class="project-stat">
          <span class="project-stat-val" style="color:var(--green)">${p.total_images}</span>
          <span class="project-stat-lbl">Images</span>
        </div>
      </div>`;
    grid.appendChild(card);
  });

  // "+ New Project" card
  const add = document.createElement("div");
  add.className = "project-card project-card-new";
  add.onclick = openNewProjectModal;
  add.innerHTML = `
    <div class="new-icon">＋</div>
    <div class="project-card-new-label">New Project</div>
    <div class="project-card-new-sub">Create a new workspace</div>`;
  grid.appendChild(add);
}


function selectProject(id, name) {
  state.projectId = id;
  state.projectName = name;
  localStorage.setItem("apiflow_project_id", id);
  localStorage.setItem("apiflow_project_name", name);
  loadProjectClasses();
  showScreen("home");
  fetchHome();
}

function goProjectSelect() {
  if (state.view === "annotate" && state.currentImageIndex !== -1) saveAnnotations(false);
  state.projectId = null;
  state.projectName = "";
  localStorage.removeItem("apiflow_project_id");
  localStorage.removeItem("apiflow_project_name");
  showScreen("projects");
  fetchProjects();
}

// ════════════════════════════════════════════════════════════════════
// HOME DATA
// ════════════════════════════════════════════════════════════════════
async function fetchHome() {
  if (!state.projectId) return;
  const grid = document.getElementById("batchesGrid");
  const el = document.getElementById("datasetAccordions");
  if (grid) {
    grid.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <div class="loading-text">Loading batches...</div>
      </div>`;
  }
  if (el) {
    el.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <div class="loading-text">Loading datasets & versions...</div>
      </div>`;
  }
  try {
    const [br, dr] = await Promise.all([
      fetch(`${API}/batches/${state.projectId}/batches/list`),
      fetch(`${API}/datasets/${state.projectId}/datasets/list`),
    ]);
    state.batches = await br.json();
    state.datasets = await dr.json();
  } catch {
    state.batches = []; state.datasets = [];
  }
  renderBatchGrid();
  renderDatasetAccordions();
}

// ── Batch Grid ───────────────────────────────────────────────────────
function renderBatchGrid() {
  const grid = document.getElementById("batchesGrid");
  if (!grid) return;
  grid.innerHTML = "";

  state.batches.forEach(b => {
    const pct = b.total_images > 0
      ? Math.round(b.labeled_images / b.total_images * 100) : 0;
    const date = b.created_at ? new Date(b.created_at).toLocaleDateString() : "";
    const card = document.createElement("div");
    card.className = "batch-card";
    card.onclick = () => openBatch(b.id);
    card.innerHTML = `
      <div class="batch-card-top">
        <div class="batch-icon">📦</div>
        <div class="batch-card-actions" onclick="event.stopPropagation()">
          <button class="btn btn-icon btn-ghost" title="Delete batch" onclick="deleteBatch('${b.id}')">🗑</button>
        </div>
      </div>
      <div>
        <div class="batch-card-name">${escHtml(b.name)}</div>
        <div class="batch-card-date">${date}</div>
      </div>
      <div class="batch-stats">
        <div class="batch-stat"><span class="batch-stat-val">${b.total_images}</span><span class="batch-stat-lbl">Images</span></div>
        <div class="batch-stat"><span class="batch-stat-val" style="color:var(--green)">${b.labeled_images}</span><span class="batch-stat-lbl">Labeled</span></div>
      </div>
      <div>
        <div class="batch-progress-bar"><div class="batch-progress-fill" style="width:${pct}%"></div></div>
        <div style="font-size:10px;color:var(--text-3);margin-top:3px;">${pct}% annotated</div>
      </div>`;
    grid.appendChild(card);
  });

  // "+ New Batch" card
  const add = document.createElement("div");
  add.className = "batch-card batch-card-new";
  add.onclick = openNewBatchModal;
  add.innerHTML = `<div class="new-icon">＋</div><div style="font-size:13px;font-weight:600;">New Batch</div><div style="font-size:11px;">Upload a new image set</div>`;
  grid.appendChild(add);
}

// ── Dataset Accordions ───────────────────────────────────────────────
function renderDatasetAccordions() {
  const el = document.getElementById("datasetAccordions");
  if (!el) return;
  el.innerHTML = "";

  if (!state.datasets.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div>No datasets yet.<br>Create one to start collecting images.</div>`;
    return;
  }

  state.datasets.forEach(ds => {
    const acc = document.createElement("div");
    acc.className = "dataset-accordion";
    acc.id = `ds-acc-${ds.id}`;

    const vcount = (ds.versions || []).length;
    const hdr = document.createElement("div");
    hdr.className = "dataset-accordion-header";
    hdr.innerHTML = `
      <div class="dataset-acc-left">
        <span class="dataset-acc-icon">🗂️</span>
        <div>
          <div class="dataset-acc-name">${escHtml(ds.name)}</div>
          <div class="dataset-acc-meta">${vcount} version${vcount !== 1 ? "s" : ""}</div>
        </div>
      </div>
      <div class="dataset-acc-right">
        <button class="btn btn-icon btn-ghost btn-sm" title="Delete dataset" onclick="event.stopPropagation();deleteDataset('${ds.id}')">🗑</button>
        <span class="chevron" id="chev-${ds.id}">›</span>
      </div>`;
    hdr.onclick = () => toggleAccordion(ds.id);

    const body = document.createElement("div");
    body.className = "dataset-accordion-body";
    body.id = `ds-body-${ds.id}`;

    (ds.versions || []).forEach(ver => {
      const imgCount = ver.image_count || 0;
      const expCount = (ver.exports || []).length;
      const statusCls = ver.status === "exported" ? "exported" : "draft";
      const row = document.createElement("div");
      row.className = "version-row";
      row.onclick = () => openVersionView(ds.id, ver.id);
      row.innerHTML = `
        <div class="version-row-left">
          <span class="version-badge ${statusCls}">${escHtml(ver.name)}</span>
          <span class="version-img-count">${imgCount} img${imgCount !== 1 ? "s" : ""}</span>
          ${expCount > 0 ? `<span style="font-size:10px;color:var(--green);">✓ ${expCount} export${expCount > 1 ? "s" : ""}</span>` : ""}
        </div>
        <div class="version-row-actions" onclick="event.stopPropagation()">
          <button class="btn btn-icon btn-ghost btn-sm" title="Export this version" onclick="quickExportVersion('${ds.id}','${ver.id}')">⬇</button>
        </div>`;
      body.appendChild(row);
    });

    // "+ New Version" button
    const newVerBtn = document.createElement("button");
    newVerBtn.className = "new-version-btn";
    newVerBtn.innerHTML = `<span>＋</span> New Version`;
    newVerBtn.onclick = (e) => { e.stopPropagation(); createVersion(ds.id); };
    body.appendChild(newVerBtn);

    acc.appendChild(hdr);
    acc.appendChild(body);
    el.appendChild(acc);
  });
}

function toggleAccordion(dsId) {
  const body = document.getElementById(`ds-body-${dsId}`);
  const chev = document.getElementById(`chev-${dsId}`);
  if (!body || !chev) return;
  const open = body.classList.contains("open");
  body.classList.toggle("open", !open);
  chev.classList.toggle("open", !open);
}

// ════════════════════════════════════════════════════════════════════
// BATCH CRUD
// ════════════════════════════════════════════════════════════════════
function openNewBatchModal() {
  const inp = document.getElementById("newBatchName");
  if (inp) inp.value = "";
  openModal("newBatchModal");
}
async function createBatch() {
  const inp = document.getElementById("newBatchName");
  const name = inp ? inp.value.trim() : "";
  if (!name) { alert("Enter a batch name."); return; }
  const r = await fetch(`${API}/batches/${state.projectId}/batches/create`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const batch = await r.json();
  closeModal("newBatchModal");
  await fetchHome();
  openBatch(batch.id);
}
async function deleteBatch(id) {
  if (!confirm("Delete this batch and all its images?")) return;
  await fetch(`${API}/batches/${state.projectId}/batches/${id}`, { method: "DELETE" });
  fetchHome();
}

function openBatch(batchId) {
  state.activeBatchId = batchId;
  state.images = [];
  state.currentImageIndex = -1;
  state.currentPage = 1;
  state.annotations = [];
  imgObj = null;
  const searchEl = document.getElementById("imgSearch");
  if (searchEl) searchEl.value = "";
  showScreen("annotate");
  setMode("bbox");
  updateClassSelect();
  renderClassList();
  fetchBatchImages();
}

// ════════════════════════════════════════════════════════════════════
// DATASET CRUD
// ════════════════════════════════════════════════════════════════════
function openNewDatasetModal() {
  const inp = document.getElementById("newDatasetName");
  if (inp) inp.value = "";
  openModal("newDatasetModal");
}
async function createDataset() {
  const inp = document.getElementById("newDatasetName");
  const name = inp ? inp.value.trim() : "";
  if (!name) { alert("Enter a dataset name."); return; }
  await fetch(`${API}/datasets/${state.projectId}/datasets/create`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  closeModal("newDatasetModal");
  await fetchHome();
  // if called from inside add-to-dataset modal, refresh its list too
  renderAddToDsDatasetList();
}
async function deleteDataset(id) {
  if (!confirm("Delete this dataset and all its versions?")) return;
  await fetch(`${API}/datasets/${state.projectId}/datasets/${id}`, { method: "DELETE" });
  fetchHome();
}
async function createVersion(datasetId) {
  await fetch(`${API}/datasets/${state.projectId}/datasets/${datasetId}/versions/create`, { method: "POST" });
  fetchHome();
}

// ════════════════════════════════════════════════════════════════════
// VERSION VIEW
// ════════════════════════════════════════════════════════════════════
async function openVersionView(datasetId, versionId) {
  state.activeDatasetId = datasetId;
  state.activeVersionId = versionId;
  showScreen("version");
  await refreshVersionView();
}

async function refreshVersionView() {
  const dsId = state.activeDatasetId;
  const verId = state.activeVersionId;

  // reload datasets to get fresh meta
  await fetchHome();

  const ds = state.datasets.find(d => d.id === dsId) || {};
  const ver = (ds.versions || []).find(v => v.id === verId) || {};

  // update header
  const titleEl = document.getElementById("versionTitle");
  const subtitleEl = document.getElementById("versionSubtitle");
  if (titleEl) titleEl.textContent = `${ds.name || "Dataset"} — ${ver.name || "Version"}`;
  if (subtitleEl) subtitleEl.textContent =
    `Created ${ver.created_at ? new Date(ver.created_at).toLocaleDateString() : "—"} · Status: ${ver.status || "draft"}`;

  // stats
  const exports = ver.exports || [];
  const statImages = document.getElementById("vstatImages");
  const statExports = document.getElementById("vstatExports");
  const statStatus = document.getElementById("vstatStatus");
  if (statImages) statImages.textContent = ver.image_count || 0;
  if (statExports) statExports.textContent = exports.length;
  if (statStatus) {
    statStatus.textContent = ver.status === "exported" ? "Exported ✓" : "Draft";
    statStatus.style.color = ver.status === "exported" ? "var(--green)" : "var(--amber)";
  }

  // load images
  const imgRes = await fetch(`${API}/datasets/${state.projectId}/datasets/${dsId}/versions/${verId}/images`);
  state.versionImages = await imgRes.json();
  state.versionMeta = ver;

  renderVersionImgGrid();
  renderExportLog(exports);
  renderTopbar();
}

function renderVersionImgGrid() {
  const grid = document.getElementById("versionImgGrid");
  if (!grid) return;
  grid.innerHTML = "";

  if (!state.versionImages.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">🖼️</div>No images added yet.<br>Go to a batch and click "Add to Dataset".</div>`;
    return;
  }

  state.versionImages.forEach(img => {
    const card = document.createElement("div");
    card.className = "version-img-card";
    const batchName = getBatchName(img.batch_id);
    card.innerHTML = `
      <img class="version-img-thumb" src="${API}${img.url}" alt="${escHtml(img.filename)}" loading="lazy">
      <div class="version-img-info">
        <div class="version-img-filename">${escHtml(img.filename)}</div>
        <div class="version-img-src">📦 ${escHtml(batchName)}</div>
      </div>
      <button class="version-img-rm" title="Remove from version" onclick="removeVersionImage('${img.id}')">✕</button>`;
    grid.appendChild(card);
  });
}

function renderExportLog(exports) {
  const el = document.getElementById("exportLogList");
  if (!el) return;
  el.innerHTML = "";
  if (!exports || !exports.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div>No exports yet.</div>`;
    return;
  }
  [...exports].reverse().forEach(ex => {
    const date = ex.exported_at ? new Date(ex.exported_at).toLocaleString() : "—";
    const fmtLabel = { yolov11_detect: "YOLOv11 Detect", yolov11_segment: "YOLOv11 Segment", coco: "COCO JSON" }[ex.format] || ex.format;
    const item = document.createElement("div");
    item.className = "export-log-item";
    item.innerHTML = `
      <div class="export-log-format">${fmtLabel}</div>
      <div class="export-log-date">${date}</div>
      <div class="export-log-splits">
        <span class="export-split-pill pill-train">Train ${ex.train_count || 0}</span>
        <span class="export-split-pill pill-valid">Val ${ex.valid_count || 0}</span>
        <span class="export-split-pill pill-test">Test ${ex.test_count || 0}</span>
      </div>
      <div class="export-log-imgs">${ex.image_count} images total</div>`;
    el.appendChild(item);
  });
}

async function removeVersionImage(refId) {
  if (!confirm("Remove this image from the version?")) return;
  await fetch(`${API}/datasets/${state.projectId}/datasets/${state.activeDatasetId}/versions/${state.activeVersionId}/images/${refId}`, { method: "DELETE" });
  refreshVersionView();
}

function getBatchName(batchId) {
  const b = state.batches.find(b => b.id === batchId);
  return b ? b.name : batchId;
}

// ════════════════════════════════════════════════════════════════════
// ADD TO DATASET MODAL
// ════════════════════════════════════════════════════════════════════
function openAddToDatasetModal() {
  if (state.currentImageIndex !== -1) saveAnnotations(false);
  addToDsCtx = { selectedDatasetId: null, selectedVersionId: null };
  renderAddToDsDatasetList();
  renderAddImgList();
  const summary = document.getElementById("addImgSummary");
  if (summary) summary.textContent = "";
  openModal("addToDatasetModal");
}

function renderAddToDsDatasetList() {
  const el = document.getElementById("addToDsDatasetList");
  if (!el) return;
  el.innerHTML = "";

  if (!state.datasets.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--text-3);padding:8px 0;">No datasets yet. Create one below.</div>`;
    return;
  }

  state.datasets.forEach(ds => {
    const draftVersions = (ds.versions || []).filter(v => true); // show all versions
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "border:1px solid var(--border);border-radius:8px;overflow:hidden;";

    const dsRow = document.createElement("div");
    dsRow.style.cssText = "padding:8px 12px;background:var(--bg-2);font-size:12px;font-weight:600;color:var(--text-2);";
    dsRow.textContent = `🗂 ${ds.name}`;
    wrapper.appendChild(dsRow);

    draftVersions.forEach(ver => {
      const row = document.createElement("div");
      const isSelected = addToDsCtx.selectedDatasetId === ds.id && addToDsCtx.selectedVersionId === ver.id;
      row.className = `dataset-select-card${isSelected ? " selected" : ""}`;
      row.style.cssText = "border-radius:0;border-left:none;border-right:none;border-top:none;";
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px;background:rgba(59,130,246,.12);color:var(--accent-hi);">${escHtml(ver.name)}</span>
          <span style="font-size:11px;color:var(--text-3);">${ver.image_count || 0} images · ${ver.status}</span>
        </div>
        ${isSelected ? '<span style="color:var(--accent);font-size:14px;">✓</span>' : ""}`;
      row.onclick = () => {
        addToDsCtx.selectedDatasetId = ds.id;
        addToDsCtx.selectedVersionId = ver.id;
        renderAddToDsDatasetList();
      };
      wrapper.appendChild(row);
    });
    el.appendChild(wrapper);
  });
}

function renderAddImgList() {
  const el = document.getElementById("addImgList");
  if (!el) return;
  el.innerHTML = "";
  const annotated = state.images.filter(i => i.annotated);

  if (!annotated.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--text-3);padding:8px 0;">No annotated images in this batch.</div>`;
    return;
  }

  annotated.forEach(img => {
    const row = document.createElement("label");
    row.className = "add-img-row";
    row.innerHTML = `
      <input type="checkbox" class="add-img-checkbox" value="${escHtml(img.filename)}" checked>
      <img class="add-img-thumb" src="${API}${img.url}" alt="${escHtml(img.filename)}">
      <span class="add-img-name">${escHtml(img.filename)}</span>
      <span class="add-img-has-ann">● labeled</span>`;
    el.appendChild(row);
  });

  updateAddImgSummary();
  el.addEventListener("change", updateAddImgSummary);
}

function updateAddImgSummary() {
  const checked = document.querySelectorAll(".add-img-checkbox:checked").length;
  const el = document.getElementById("addImgSummary");
  if (!el) return;
  el.textContent = checked > 0
    ? `${checked} image${checked !== 1 ? "s" : ""} will be added to the selected version.`
    : "No images selected.";
}

function toggleSelectAllAddImages(checked) {
  document.querySelectorAll(".add-img-checkbox").forEach(cb => cb.checked = checked);
  updateAddImgSummary();
}

async function confirmAddToDataset() {
  const { selectedDatasetId, selectedVersionId } = addToDsCtx;
  if (!selectedDatasetId || !selectedVersionId) {
    alert("Please select a dataset version."); return;
  }
  const checked = Array.from(document.querySelectorAll(".add-img-checkbox:checked")).map(cb => cb.value);
  if (!checked.length) { alert("Select at least one image."); return; }

  const augChecked = Array.from(document.querySelectorAll(".aug-checkbox:checked")).map(cb => cb.value);

  const btn = document.getElementById("confirmAddToDatasetBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Adding…`; }

  try {
    const r = await fetch(`${API}/datasets/${state.projectId}/datasets/${selectedDatasetId}/versions/${selectedVersionId}/add-images`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batch_id: state.activeBatchId, filenames: checked, augmentations: augChecked }),
    });
    const result = await r.json();
    closeModal("addToDatasetModal");
    await fetchHome();
    alert(`✅ Added ${result.added} images (${result.skipped} skipped — already in version or not annotated).`);
  } catch (e) {
    alert("Failed to add images: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = "Add to Dataset"; }
  }
}

// ════════════════════════════════════════════════════════════════════
// EXPORT MODAL
// ════════════════════════════════════════════════════════════════════
// frontend/canvas.js (partial view around export modals)
function openExportModal() {
  exportCtx.datasetId = state.activeDatasetId;
  exportCtx.versionId = state.activeVersionId;
  _fillExportInfo();
  openModal("exportModal");
}

function quickExportVersion(dsId, verId) {
  exportCtx.datasetId = dsId;
  exportCtx.versionId = verId;
  state.activeDatasetId = dsId;
  state.activeVersionId = verId;
  _fillExportInfo();
  openModal("exportModal");
}

function _fillExportInfo() {
  const ds = state.datasets.find(d => d.id === exportCtx.datasetId) || {};
  const ver = (ds.versions || []).find(v => v.id === exportCtx.versionId) || {};
  const imgCount = ver.image_count || 0;
  const infoEl = document.getElementById("exportVersionInfo");
  if (infoEl) infoEl.innerHTML = `
    <strong style="color:var(--text-1);">${escHtml(ds.name || "?")} — ${escHtml(ver.name || "?")}</strong><br>
    ${imgCount} image${imgCount !== 1 ? "s" : ""} will be exported.<br>
    <span style="color:var(--text-3);">Images will be randomly shuffled and split into train/valid/test folders.</span>`;
}

function onSplitChange() {
  const trainEl = document.getElementById("sliderTrain");
  const valEl = document.getElementById("sliderVal");
  const testEl = document.getElementById("sliderTest");
  if (!trainEl || !valEl || !testEl) return;
  const tr = +trainEl.value;
  const va = +valEl.value;
  const te = +testEl.value;
  const valTrainEl = document.getElementById("valTrain");
  const valValEl = document.getElementById("valVal");
  const valTestEl = document.getElementById("valTest");
  if (valTrainEl) valTrainEl.textContent = tr + "%";
  if (valValEl) valValEl.textContent = va + "%";
  if (valTestEl) valTestEl.textContent = te + "%";
  const total = tr + va + te;
  const hint = document.getElementById("splitHint");
  if (hint) {
    hint.textContent = `Total: ${total}%` + (total === 100 ? " ✓" : " ← must equal 100%");
    hint.style.color = total === 100 ? "var(--green)" : "var(--amber)";
  }
}

async function doExport() {
  const { datasetId, versionId } = exportCtx;
  if (!datasetId || !versionId) { alert("No version selected."); return; }

  const trainPct = +document.getElementById("sliderTrain").value;
  const valPct = +document.getElementById("sliderVal").value;
  const testPct = +document.getElementById("sliderTest").value;
  if (trainPct + valPct + testPct !== 100) { alert("Split must total 100%."); return; }

  const btn = document.getElementById("exportDownloadBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Generating…`; }

  try {
    const res = await fetch(`${API}/export/download`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: state.projectId,
        dataset_id: datasetId,
        version_id: versionId,
        format: document.getElementById("exportFormat").value,
        train_pct: trainPct, val_pct: valPct, test_pct: testPct,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Unknown error" }));
      throw new Error(err.detail);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `apiflow_export.zip`;
    a.click(); URL.revokeObjectURL(url);

    closeModal("exportModal");

    // refresh version view if we're on it
    if (state.view === "version") refreshVersionView();
    else fetchHome();
  } catch (e) {
    alert(`Export failed: ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = "⬇ Generate & Download"; }
  }
}

// ════════════════════════════════════════════════════════════════════
// BATCH IMAGE OPERATIONS
// ════════════════════════════════════════════════════════════════════
let searchTimeout = null;
function handleSearchInput() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    state.currentPage = 1;
    fetchBatchImages(0);
  }, 300);
}

async function changePage(dir) {
  const maxPage = Math.ceil(state.totalImages / state.limit) || 1;
  let newPage = state.currentPage + dir;
  if (newPage < 1) newPage = 1;
  if (newPage > maxPage) newPage = maxPage;
  if (newPage !== state.currentPage) {
    state.currentPage = newPage;
    await fetchBatchImages(0);
  }
}

async function fetchBatchImages(targetIndexAfterLoad = null) {
  if (!state.activeBatchId) return;

  // Save current annotations before the image list changes
  if (state.currentImageIndex !== -1) {
    await saveAnnotations(false);
    state.currentImageIndex = -1;
  }

  const el = document.getElementById("imageListContainer");
  if (el) {
    el.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <div class="loading-text">Loading images...</div>
      </div>`;
  }
  
  const searchEl = document.getElementById("imgSearch");
  const query = searchEl ? searchEl.value.trim() : "";
  const filterEl = document.getElementById("imgStatusFilter");
  const filterStatus = filterEl ? filterEl.value : "all";
  
  try {
    const r = await fetch(`${API}/batches/${state.projectId}/batches/${state.activeBatchId}/images?page=${state.currentPage}&limit=${state.limit}&search=${encodeURIComponent(query)}&status=${filterStatus}`);
    const data = await r.json();
    state.images = data.images || [];
    state.totalImages = data.total || 0;
    
    // Register any classes loaded from the image summaries
    state.images.forEach(img => {
      (img.classes || []).forEach(c => {
        if (!state.classes.includes(c)) {
          addClass(c);
        }
      });
    });
  } catch (e) {
    console.error(e);
    state.images = [];
    state.totalImages = 0;
  }
  
  const pagEl = document.getElementById("paginationControls");
  const infoEl = document.getElementById("pageInfo");
  if (pagEl && infoEl) {
    if (state.totalImages > state.limit) {
      pagEl.style.display = "flex";
      const maxPage = Math.ceil(state.totalImages / state.limit) || 1;
      infoEl.textContent = `${state.currentPage}/${maxPage}`;
    } else {
      pagEl.style.display = "none";
    }
  }

  renderImageList();
  
  if (state.images.length > 0) {
    if (targetIndexAfterLoad === null) {
      if (state.currentImageIndex === -1) {
        loadImage(0);
      } else {
        const exists = state.images.some((_, i) => i === state.currentImageIndex);
        if (!exists) loadImage(0);
      }
    } else if (targetIndexAfterLoad === -1) {
      loadImage(state.images.length - 1);
    } else {
      loadImage(targetIndexAfterLoad);
    }
  } else {
    state.currentImageIndex = -1;
    imgObj = null;
    state.annotations = [];
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    const counter = document.getElementById("imgCounter");
    if (counter) counter.textContent = "0 / 0";
  }
}

async function uploadFiles(fileList) {
  const fd = new FormData();
  let n = 0;
  for (const f of fileList) {
    if (/\.(jpe?g|png|webp)$/i.test(f.name) || f.type.startsWith("image/")) {
      fd.append("files", f); n++;
    }
  }
  if (!n) { alert("No valid image files found."); return; }
  try {
    const r = await fetch(`${API}/batches/${state.projectId}/batches/${state.activeBatchId}/upload`, { method: "POST", body: fd });
    const rs = await r.json();
    await fetchBatchImages();
    if (rs.files && rs.files.length) {
      const idx = state.images.findIndex(i => i.filename === rs.files[0].filename);
      if (idx !== -1) loadImage(idx);
    }
  } catch { alert("Upload failed. Is the server running?"); }
}

async function deleteImage(filename) {
  if (!confirm(`Delete "${filename}" and its annotations?`)) return;
  await fetch(`${API}/batches/${state.projectId}/batches/${state.activeBatchId}/images/${encodeURIComponent(filename)}`, { method: "DELETE" });
  
  const idx = state.images.findIndex(i => i.filename === filename);
  let nextIdx = idx;
  if (nextIdx >= state.images.length - 1) {
    nextIdx = state.images.length - 2;
  }
  if (nextIdx < 0) nextIdx = 0;
  
  await fetchBatchImages(nextIdx);
}
function renderImageList() {
  const el = document.getElementById("imageListContainer");
  if (!el) return;
  el.innerHTML = "";

  const filtered = state.images;
  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🖼️</div>No images.</div>`;
    return;
  }

  filtered.forEach((img, idx) => {
    const active = idx === state.currentImageIndex;
    const row = document.createElement("div");
    row.className = `img-item${active ? " active" : ""}`;
    row.onclick = () => loadImage(idx);

    const thumb = document.createElement("img");
    thumb.className = "img-thumb";
    thumb.src = `${API}${img.url}`; thumb.alt = img.filename;

    const det = document.createElement("div");
    det.className = "img-details";
    const nm = document.createElement("span");
    nm.className = "img-name"; nm.textContent = img.filename;
    const meta = document.createElement("div");
    meta.className = "img-meta";
    const st = document.createElement("span");
    st.className = `badge ${img.annotated ? "badge-labeled" : "badge-unlabeled"}`;
    st.textContent = img.annotated ? "Labeled" : "Unlabeled";
    meta.appendChild(st);
    (img.classes || []).forEach(c => {
      const cb = document.createElement("span");
      cb.className = "badge badge-class"; cb.textContent = c; meta.appendChild(cb);
    });
    det.appendChild(nm); det.appendChild(meta);

    const del = document.createElement("button");
    del.className = "img-del-btn"; del.title = "Delete";
    del.innerHTML = "✕";
    del.onclick = e => { e.stopPropagation(); deleteImage(img.filename); };

    row.appendChild(thumb); row.appendChild(det); row.appendChild(del);
    el.appendChild(row);
  });
}

async function loadImage(idx) {
  if (idx < 0 || idx >= state.images.length) return;
  if (state.currentImageIndex !== -1) await saveAnnotations(false);

  state.currentImageIndex = idx;
  const img = state.images[idx];
  
  // Clear previous canvas state to prevent cross-contamination during loading
  state.annotations = [];
  imgObj = null;
  state.nullLabeled = false;
  state.tempPoints = []; 
  state.selected = null;
  if (typeof ctx !== "undefined" && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);

  renderImageList();
  const counter = document.getElementById("imgCounter");
  const dimInfo = document.getElementById("imgDimInfo");
  if (counter) counter.textContent = `${idx + 1} / ${state.images.length}`;
  if (dimInfo) dimInfo.textContent = "Loading…";

  try {
    const r = await fetch(`${API}/batches/${state.projectId}/batches/${state.activeBatchId}/annotations/${encodeURIComponent(img.filename)}`);
    const d = await r.json();
    state.annotations = d.annotations || [];
    state.nullLabeled = d.null_labeled || false;
    
    // Register any loaded annotation classes
    state.annotations.forEach(ann => {
      if (ann.label && !state.classes.includes(ann.label)) {
        addClass(ann.label);
      }
    });
  } catch { 
    state.annotations = []; 
    state.nullLabeled = false;
  }

  updateNullLabelButton();

  const el = new Image();
  el.onload = () => {
    imgObj = el;
    fitImage();
    if (dimInfo) dimInfo.textContent = `${el.naturalWidth}×${el.naturalHeight} · ${img.filename}`;
    renderClassList(); renderAnnotationList(); draw();
  };
  el.src = `${API}${img.url}`;
}

async function saveAnnotations(notify = false) {
  if (state.currentImageIndex === -1 || !state.activeBatchId) return;
  const img = state.images[state.currentImageIndex];
  
  // Send save payload to backend
  await fetch(`${API}/batches/${state.projectId}/batches/${state.activeBatchId}/annotations`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      image: img.filename, 
      annotations: state.annotations,
      null_labeled: state.nullLabeled || false
    }),
  });
  
  // Update local image state status
  state.images[state.currentImageIndex].annotated = (state.annotations.length > 0 || state.nullLabeled);
  state.images[state.currentImageIndex].null_labeled = state.nullLabeled || false;
  state.images[state.currentImageIndex].classes = [...new Set(state.annotations.map(a => a.label).filter(Boolean))];
  
  renderImageList();
}

function toggleNullLabel() {
  if (state.currentImageIndex === -1) return;
  
  if (!state.nullLabeled) {
    // Turning ON Null Labeling: Clear any annotations first
    if (state.annotations.length > 0) {
      if (!confirm("This will clear existing annotations on this image. Proceed?")) {
        return;
      }
      state.annotations = [];
      state.selected = null;
      state.tempPoints = [];
    }
    state.nullLabeled = true;
  } else {
    // Turning OFF Null Labeling
    state.nullLabeled = false;
  }
  
  updateNullLabelButton();
  draw();
  renderAnnotationList();
  renderClassList();
  saveAnnotations(false);
}

function updateNullLabelButton() {
  const btn = document.getElementById("btnNullLabel");
  if (!btn) return;
  if (state.nullLabeled) {
    btn.style.background = "var(--green)";
    btn.style.color = "#fff";
    btn.style.borderColor = "var(--green)";
    btn.textContent = "✓ Null Labeled";
  } else {
    btn.style.background = "transparent";
    btn.style.color = "var(--text-2)";
    btn.style.borderColor = "var(--border-hi)";
    btn.textContent = "✓ Null Label";
  }
}


async function navPrev() {
  if (state.images.length === 0) return;
  let i = state.currentImageIndex - 1;
  if (i < 0) {
    if (state.currentPage > 1) {
      state.currentPage--;
      await fetchBatchImages(-1);
    } else {
      const maxPage = Math.ceil(state.totalImages / state.limit) || 1;
      state.currentPage = maxPage;
      await fetchBatchImages(-1);
    }
  } else {
    loadImage(i);
  }
}
async function navNext() {
  if (state.images.length === 0) return;
  let i = state.currentImageIndex + 1;
  if (i >= state.images.length) {
    const maxPage = Math.ceil(state.totalImages / state.limit) || 1;
    if (state.currentPage < maxPage) {
      state.currentPage++;
      await fetchBatchImages(0);
    } else {
      state.currentPage = 1;
      await fetchBatchImages(0);
    }
  } else {
    loadImage(i);
  }
}

// ════════════════════════════════════════════════════════════════════
// BULK ACTIONS
// ════════════════════════════════════════════════════════════════════
async function markUnlabeledAsNull() {
  if (!state.activeBatchId) return;
  if (!confirm("This will mark all currently unlabeled images in this batch as Null Labeled (No defects). Proceed?")) return;
  
  if (state.currentImageIndex !== -1) {
    await saveAnnotations(false);
  }
  
  const btn = document.querySelector("button[onclick='markUnlabeledAsNull()']");
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Processing…`; }
  
  try {
    const r = await fetch(`${API}/batches/${state.projectId}/batches/${state.activeBatchId}/mark-unlabeled-null`, {
      method: "POST"
    });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`Backend failed (${r.status}): ${errText}`);
    }
    const result = await r.json();
    alert(`✅ Successfully marked ${result.marked_count} images as null labeled.`);
    
    state.currentImageIndex = -1; 
    await fetchBatchImages(0);
  } catch (e) {
    alert("Failed to mark images: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = "✓ Mark Unlabeled as Null"; }
  }
}

// ════════════════════════════════════════════════════════════════════
// AI AUTO-LABEL
// ════════════════════════════════════════════════════════════════════
async function triggerAutoLabel() {
  if (state.currentImageIndex === -1) { alert("Load an image first."); return; }
  const img = state.images[state.currentImageIndex];
  const btn = document.getElementById("autoLabelBtn");
  if (!btn) return;
  btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Labeling…`;
  try {
    const r = await fetch(`${API}/autolabel/${state.projectId}/${state.activeBatchId}/${encodeURIComponent(img.filename)}`, { method: "POST" });
    if (!r.ok) throw new Error("Backend failed");
    const d = await r.json();
    d.annotations.forEach(p => {
      let label = state.currentClass;
      if (typeof p.label === "number") {
        label = state.classes[p.label] || `class_${p.label}`;
        if (!state.classes.includes(label)) addClass(label);
      } else if (p.label) { label = p.label; }
      state.annotations.push({ type: p.type || "polygon", label, bbox: p.bbox, mask: p.mask, confidence: p.confidence || 0.9, source: "auto" });
    });
    updateClassSelect(); renderClassList(); renderAnnotationList(); draw();
    await saveAnnotations();
  } catch { alert("AI Auto-Label failed. Check model files and server."); }
  finally { btn.disabled = false; btn.innerHTML = "✦ AI Auto Label"; }
}

// ════════════════════════════════════════════════════════════════════
// CLASS MANAGEMENT
// ════════════════════════════════════════════════════════════════════
function setCurrentClass(cls) { state.currentClass = cls; renderClassList(); }
function updateClassSelect() {
  const sel = document.getElementById("classSelect");
  if (!sel) return;
  sel.innerHTML = "";
  state.classes.forEach(c => {
    const o = document.createElement("option");
    o.value = c; o.textContent = c; o.selected = c === state.currentClass;
    sel.appendChild(o);
  });
}
function handleAddClass() {
  const inp = document.getElementById("newClassInput");
  if (!inp) return;
  const added = addClass(inp.value);
  if (added) { inp.value = ""; setCurrentClass(added); updateClassSelect(); renderClassList(); }
  else if (inp.value.trim()) alert("Class already exists.");
}
function renderClassList() {
  const el = document.getElementById("classListEl");
  if (!el) return;
  el.innerHTML = "";
  const counts = {};
  state.classes.forEach(c => counts[c] = 0);
  state.annotations.forEach(a => { if (a.label && counts[a.label] !== undefined) counts[a.label]++; });
  state.classes.forEach(cls => {
    const color = state.classColors[cls] || "#3b82f6";
    const active = cls === state.currentClass;
    const it = document.createElement("div");
    it.className = `class-item${active ? " active" : ""}`;
    it.onclick = () => { setCurrentClass(cls); updateClassSelect(); };
    it.innerHTML = `
      <div class="class-item-left">
        <span class="color-dot" style="background:${color}"></span>
        <span class="class-name">${escHtml(cls)}</span>
      </div>
      <span class="badge badge-class">${counts[cls] || 0}</span>`;
    el.appendChild(it);
  });
}

// ════════════════════════════════════════════════════════════════════
// ANNOTATION LIST
// ════════════════════════════════════════════════════════════════════
function renderAnnotationList() {
  const el = document.getElementById("annListEl");
  if (!el) return;
  el.innerHTML = "";
  if (!state.annotations.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">✏️</div>No labels yet.</div>`;
    return;
  }
  state.annotations.forEach((ann, i) => {
    const sel = i === state.selected;
    const it = document.createElement("div");
    it.className = `ann-item${sel ? " active" : ""}`;
    it.onclick = (e) => {
      // Prevent selecting when clicking the delete button
      if (e.target.classList.contains("ann-del")) return;
      state.selected = sel ? null : i; 
      draw(); 
      renderAnnotationList(); 
    };
    const color = state.classColors[ann.label] || "#3b82f6";
    it.innerHTML = `
      <div class="ann-item-left">
        <span class="color-dot" style="background:${color}"></span>
        <span style="font-size:12px;font-weight:600;">${escHtml(ann.label)}</span>
        <span class="ann-badge ${ann.type === "bbox" ? "ab-bbox" : "ab-poly"}">${ann.type}</span>
        <span class="ann-badge ${ann.source === "auto" ? "ab-auto" : "ab-manual"}">${ann.source || "manual"}</span>
      </div>
      <button class="ann-del" title="Delete">✕</button>`;
    
    // Explicitly add event listener to avoid capture/bubble indexing issues
    it.querySelector(".ann-del").addEventListener("click", (e) => {
      e.stopPropagation();
      state.annotations.splice(i, 1); 
      state.selected = null;
      draw(); 
      renderAnnotationList(); 
      renderClassList(); 
      saveAnnotations(false);
    });
    el.appendChild(it);
  });
}

// ════════════════════════════════════════════════════════════════════
// CANVAS TOOLS
// ════════════════════════════════════════════════════════════════════
function setMode(mode) {
  state.mode = mode;
  ["bbox", "polygon", "pan"].forEach(m => {
    const el = document.getElementById(`tool${m[0].toUpperCase() + m.slice(1)}`);
    if (el) el.classList.toggle("active", mode === m);
  });
  if (canvasWrap) canvasWrap.classList.toggle("pan-cursor", mode === "pan");
  cancelDraw();
}
function clearAllAnnotations() {
  if (!state.annotations.length) return;
  if (!confirm("Delete ALL annotations on this image?")) return;
  state.annotations = []; state.selected = null; state.tempPoints = [];
  draw(); renderAnnotationList(); renderClassList(); saveAnnotations(false);
}
function deleteSelected() {
  if (state.selected === null) return;
  state.annotations.splice(state.selected, 1); state.selected = null;
  draw(); renderAnnotationList(); renderClassList(); saveAnnotations(false);
}
function cancelDraw() {
  state.tempPoints = []; previewBBox = null; state.isDrawing = false;
  if (imgObj) draw();
}

// ════════════════════════════════════════════════════════════════════
// CANVAS EVENTS
// ════════════════════════════════════════════════════════════════════
canvas.addEventListener("mousedown", e => {
  if (e.button === 2 || isSpaceDown || state.mode === "pan") {
    isRightDrag = true;
    dragSX = e.clientX - view.offsetX;
    dragSY = e.clientY - view.offsetY;
    if (canvasWrap) canvasWrap.classList.add("grab-cursor");
    return;
  }
  if (e.button === 0 && state.mode === "bbox") {
    state.isDrawing = true; state.boxStart = getImgPos(e);
  }
});
canvas.addEventListener("mousemove", e => {
  mousePos = getImgPos(e);
  if (isRightDrag) {
    view.offsetX = e.clientX - dragSX; view.offsetY = e.clientY - dragSY; draw(); return;
  }
  if (state.mode === "bbox" && state.isDrawing && state.boxStart) {
    const p = mousePos;
    previewBBox = [Math.min(state.boxStart.x, p.x), Math.min(state.boxStart.y, p.y),
    Math.abs(p.x - state.boxStart.x), Math.abs(p.y - state.boxStart.y)];
    draw();
  } else if (state.mode === "polygon" && state.tempPoints.length) { draw(); }
});
canvas.addEventListener("mouseup", e => {
  if (isRightDrag) {
    isRightDrag = false;
    if (canvasWrap) canvasWrap.classList.remove("grab-cursor");
    return;
  }
  if (e.button === 0 && state.mode === "bbox" && state.isDrawing) {
    const p = getImgPos(e);
    const x = Math.min(state.boxStart.x, p.x), y = Math.min(state.boxStart.y, p.y);
    const w = Math.abs(p.x - state.boxStart.x), h = Math.abs(p.y - state.boxStart.y);
    if (w > 4 && h > 4) {
      // If image was null labeled, auto toggle off when drawing starts
      if (state.nullLabeled) {
        state.nullLabeled = false;
        updateNullLabelButton();
      }
      state.annotations.push({ type: "bbox", label: state.currentClass, bbox: [x, y, w, h], confidence: 1.0, source: "manual" });
      renderAnnotationList(); renderClassList(); saveAnnotations(false);
    }
    state.isDrawing = false; state.boxStart = null; previewBBox = null; draw();
  }
});
canvas.addEventListener("click", e => {
  if (e.button !== 0 || isSpaceDown || state.mode === "pan") return;
  const p = getImgPos(e);
  
  if (state.selected !== null && state.selected >= 0 && state.selected < state.annotations.length) {
    const selAnn = state.annotations[state.selected];
    if (selAnn && selAnn._delBtn) {
      const dx = p.x - selAnn._delBtn.x;
      const dy = p.y - selAnn._delBtn.y;
      if (Math.sqrt(dx*dx + dy*dy) <= selAnn._delBtn.r + (5 / view.scale)) {
        deleteSelected();
        return;
      }
    }
  }

  if (state.mode === "polygon") { state.tempPoints.push(p); draw(); return; }
  if (state.mode === "bbox" && !state.isDrawing) {
    let found = -1;
    for (let i = state.annotations.length - 1; i >= 0; i--) {
      const a = state.annotations[i];
      if (a._labelRect && ptInBBox(p, a._labelRect)) { found = i; break; }
      if (a.type === "bbox" && ptInBBox(p, a.bbox)) { found = i; break; }
      if (a.type === "polygon" && ptInPoly(p, a.mask)) { found = i; break; }
    }
    state.selected = found === state.selected ? null : found;
    draw(); renderAnnotationList();
  }
});
canvas.addEventListener("dblclick", e => {
  if (state.mode !== "polygon" || state.tempPoints.length < 3) return;
  if (state.nullLabeled) {
    state.nullLabeled = false;
    updateNullLabelButton();
  }
  state.annotations.push({ type: "polygon", label: state.currentClass, mask: [...state.tempPoints], confidence: 1.0, source: "manual" });
  state.tempPoints = [];
  renderAnnotationList(); renderClassList(); draw(); saveAnnotations(false);
});
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  view.offsetX = e.offsetX - f * (e.offsetX - view.offsetX);
  view.offsetY = e.offsetY - f * (e.offsetY - view.offsetY);
  view.scale = Math.max(0.05, Math.min(view.scale * f, 30));
  draw();
}, { passive: false });
canvas.addEventListener("contextmenu", e => e.preventDefault());

// ════════════════════════════════════════════════════════════════════
// CANVAS RENDER
// ════════════════════════════════════════════════════════════════════
function fitImage() {
  if (!imgObj) return;
  const cw = (canvasWrap && canvasWrap.clientWidth) || 800;
  const ch = (canvasWrap && canvasWrap.clientHeight) || 600;
  canvas.width = cw; 
  canvas.height = ch;
  const s = Math.min((cw - 40) / imgObj.naturalWidth, (ch - 40) / imgObj.naturalHeight, 1);
  view.scale = s;
  view.offsetX = (cw - imgObj.naturalWidth * s) / 2;
  view.offsetY = (ch - imgObj.naturalHeight * s) / 2;
}
function resetView() { fitImage(); draw(); }

function draw() {
  if (!imgObj) return;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
  ctx.save(); ctx.translate(view.offsetX, view.offsetY); ctx.scale(view.scale, view.scale);
  ctx.drawImage(imgObj, 0, 0);
  state.annotations.forEach((a, i) => drawAnnotation(a, i === state.selected));
  if (previewBBox) {
    const col = state.classColors[state.currentClass] || "#3b82f6";
    ctx.strokeStyle = col; ctx.lineWidth = 2.5 / view.scale; ctx.setLineDash([5 / view.scale, 4 / view.scale]);
    ctx.strokeRect(...previewBBox); ctx.setLineDash([]);
  }
  if (state.mode === "polygon" && state.tempPoints.length) {
    const col = state.classColors[state.currentClass] || "#3b82f6";
    ctx.strokeStyle = col; ctx.lineWidth = 2.5 / view.scale; ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(state.tempPoints[0].x, state.tempPoints[0].y);
    state.tempPoints.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(mousePos.x, mousePos.y); ctx.stroke();
    state.tempPoints.forEach(p => {
      ctx.fillStyle = "#fff"; ctx.strokeStyle = col; ctx.lineWidth = 1.8 / view.scale;
      ctx.beginPath(); ctx.arc(p.x, p.y, 5 / view.scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
  }
  ctx.restore();
}

function drawAnnotation(ann, sel) {
  const col = state.classColors[ann.label] || "#3b82f6";
  const s = view.scale || 1;
  ctx.strokeStyle = col;
  ctx.lineWidth = (sel ? 6.0 : 3.5) / s;
  ctx.setLineDash([]);

  if (ann.type === "bbox" && ann.bbox) {
    ctx.strokeRect(...ann.bbox);
    const tag = ann.label + (ann.confidence < 1 ? ` ${(ann.confidence * 100).toFixed(0)}%` : "");
    ctx.font = `bold ${13 / s}px Inter,sans-serif`;
    const tw = ctx.measureText(tag).width;
    
    // background rect for label text
    const rectHeight = 18 / s;
    const paddingX = 8 / s;
    const lx = ann.bbox[0];
    const ly = ann.bbox[1] - rectHeight;
    const lw = tw + paddingX;
    
    ctx.fillStyle = col;
    ctx.fillRect(lx, ly, lw, rectHeight);
    
    // draw text
    ctx.fillStyle = "#fff";
    ctx.fillText(tag, lx + 4 / s, ann.bbox[1] - 5 / s);
    
    ann._labelRect = [lx, ly, lw, rectHeight];
  }
  if (ann.type === "polygon" && ann.mask && ann.mask.length > 1) {
    ctx.beginPath();
    ctx.moveTo(ann.mask[0].x, ann.mask[0].y);
    ann.mask.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath(); ctx.stroke();
    ctx.fillStyle = hexAlpha(col, sel ? 0.28 : 0.12); ctx.fill();
    
    const cx = ann.mask.reduce((sum, p) => sum + p.x, 0) / ann.mask.length;
    const cy = ann.mask.reduce((sum, p) => sum + p.y, 0) / ann.mask.length;
    
    ctx.font = `bold ${11 / s}px Inter,sans-serif`;
    const tw = ctx.measureText(ann.label).width;
    const rectHeight = 16 / s;
    const rectWidth = tw + 8 / s;
    const lx = cx - rectWidth / 2;
    const ly = cy - rectHeight / 2;
    ctx.fillStyle = col;
    ctx.fillRect(lx, ly, rectWidth, rectHeight);
    
    ctx.fillStyle = "#fff";
    ctx.fillText(ann.label, cx - tw / 2, cy + 4 / s);
    
    ann._labelRect = [lx, ly, rectWidth, rectHeight];
    if (sel) ann.mask.forEach(p => {
      ctx.fillStyle = "#fff"; ctx.strokeStyle = col; ctx.lineWidth = 1.5 / s;
      ctx.beginPath(); ctx.arc(p.x, p.y, 4.5 / s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
  }

  // Draw Delete Button when selected
  if (sel) {
    const delRadius = 10 / s;
    let delX, delY;
    if (ann.type === "bbox" && ann.bbox) {
      delX = ann.bbox[0] + ann.bbox[2];
      delY = ann.bbox[1];
    } else if (ann.type === "polygon" && ann.mask && ann.mask.length > 0) {
      let maxX = -Infinity, minY = Infinity;
      ann.mask.forEach(p => {
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
      });
      delX = maxX; delY = minY;
    }
    if (delX !== undefined && delY !== undefined) {
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(delX, delY, delRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5 / s;
      ctx.stroke();
      
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${12 / s}px Inter,sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✕", delX, delY + 1 / s);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
      
      ann._delBtn = {x: delX, y: delY, r: delRadius};
    }
  } else {
    ann._delBtn = null;
  }
}

// ════════════════════════════════════════════════════════════════════
// MODAL HELPERS
// ════════════════════════════════════════════════════════════════════
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("open");
  else console.warn(`[canvas.js] Modal #${id} not found.`);
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("open");
}

// ════════════════════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════════════════════
function getImgPos(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.round((e.clientX - r.left - view.offsetX) / view.scale),
    y: Math.round((e.clientY - r.top - view.offsetY) / view.scale),
  };
}
function ptInBBox(p, bbox) { const [bx, by, bw, bh] = bbox; return p.x >= bx && p.x <= bx + bw && p.y >= by && p.y <= by + bh; }
function ptInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function hexAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function triggerFileUpload() { const el = document.getElementById("fileInput"); if (el) el.click(); }
function triggerFolderUpload() { const el = document.getElementById("folderInput"); if (el) el.click(); }

// ════════════════════════════════════════════════════════════════════
// IMPORT DATASET
// ════════════════════════════════════════════════════════════════════
function openImportModalHome() {
  const nameEl = document.getElementById("importBatchName");
  const fileEl = document.getElementById("importZipFile");
  if (nameEl) nameEl.value = "";
  if (fileEl) fileEl.value = "";
  openModal("importDatasetModal");
}

async function doImportDataset() {
  const nameInput = document.getElementById("importBatchName");
  const fileInput = document.getElementById("importZipFile");
  const name = nameInput ? nameInput.value.trim() : "";
  if (!name) { alert("Please enter a batch/dataset name."); return; }
  if (!fileInput || !fileInput.files.length) { alert("Please select a ZIP file to upload."); return; }

  const file = fileInput.files[0];
  const btn = document.getElementById("confirmImportDatasetBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Importing…`; }

  const fd = new FormData();
  fd.append("file", file);
  fd.append("batch_name", name);

  try {
    const res = await fetch(`${API}/batches/${state.projectId}/batches/import-coco`, {
      method: "POST",
      body: fd
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Import failed" }));
      throw new Error(err.detail);
    }
    const result = await res.json();
    closeModal("importDatasetModal");
    alert(`Successfully imported "${result.name}" with ${result.imported_images} annotated images!`);
    await fetchHome();
    openBatch(result.batch_id);
  } catch (e) {
    alert("Import failed: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = "Import"; }
  }
}