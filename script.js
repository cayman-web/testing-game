// ===== Список видео (16 штук). Названия файлов лежат в корне репозитория =====
const VIDEO_COUNT = 16;
const videos = Array.from({ length: VIDEO_COUNT }, (_, i) => `video${i + 1}.mp4`);

// ===== Состояние =====
const cellAssignments = {}; // { cellIndex: videoIndex }
const thumbCache = {}; // { videoIndex: dataURL | null }
let thumbsGenerated = false;

const canvas = document.getElementById("canvas");
const templateBar = document.getElementById("templateBar");
const sheet = document.getElementById("sheet");
const sheetHandle = document.getElementById("sheetHandle");
const sheetGrid = document.getElementById("sheetGrid");
const ghost = document.getElementById("dragGhost");

// ===== Переключение шаблонов раскладки =====
templateBar.querySelectorAll(".template-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    templateBar.querySelectorAll(".template-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    canvas.className = "canvas layout-" + btn.dataset.template;
  });
});

// ===== Генерация превью (первый кадр видео) через canvas =====
function generateThumbnail(index) {
  return new Promise((resolve) => {
    const src = videos[index];
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = src;

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    v.addEventListener("loadeddata", () => {
      try {
        v.currentTime = Math.min(0.15, (v.duration || 1) / 2);
      } catch (e) {
        finish(null);
      }
    });

    v.addEventListener("seeked", () => {
      try {
        const c = document.createElement("canvas");
        c.width = v.videoWidth || 200;
        c.height = v.videoHeight || 200;
        const ctx = c.getContext("2d");
        ctx.drawImage(v, 0, 0, c.width, c.height);
        finish(c.toDataURL("image/jpeg", 0.7));
      } catch (e) {
        finish(null);
      }
    });

    v.addEventListener("error", () => finish(null));

    // Таймаут на случай, если видео не отвечает
    setTimeout(() => finish(null), 6000);
  });
}

async function generateAllThumbnails() {
  thumbsGenerated = true;
  for (let i = 0; i < VIDEO_COUNT; i++) {
    const dataUrl = await generateThumbnail(i);
    thumbCache[i] = dataUrl;
    updateThumbEl(i, dataUrl);
  }
}

function updateThumbEl(index, dataUrl) {
  const el = sheetGrid.querySelector(`[data-index="${index}"]`);
  if (!el) return;
  const loading = el.querySelector(".thumb-loading");
  if (dataUrl) {
    el.style.backgroundImage = `url(${dataUrl})`;
    if (loading) loading.remove();
  } else if (loading) {
    loading.textContent = String(index + 1);
  }
}

// ===== Построение списка превью в шторке =====
function buildSheetGrid() {
  sheetGrid.innerHTML = "";
  for (let i = 0; i < VIDEO_COUNT; i++) {
    const thumb = document.createElement("div");
    thumb.className = "sheet-thumb";
    thumb.dataset.index = String(i);
    thumb.innerHTML = `
      <div class="thumb-loading">…</div>
      <div class="thumb-label">${i + 1}</div>
    `;
    thumb.addEventListener("pointerdown", (e) => onThumbPointerDown(e, i));
    sheetGrid.appendChild(thumb);
  }
}
buildSheetGrid();

// ===== Шторка снизу: открытие/закрытие тапом и свайпом =====
let sheetOpen = false;
function setSheetOpen(open) {
  sheetOpen = open;
  sheet.classList.toggle("open", open);
  if (open && !thumbsGenerated) generateAllThumbnails();
}

sheetHandle.addEventListener("click", () => setSheetOpen(!sheetOpen));

let dragStartY = null;
let sheetDragging = false;

sheetHandle.addEventListener("touchstart", (e) => {
  dragStartY = e.touches[0].clientY;
  sheetDragging = true;
  sheet.classList.add("dragging");
}, { passive: true });

sheetHandle.addEventListener("touchmove", (e) => {
  if (!sheetDragging || dragStartY === null) return;
  const dy = e.touches[0].clientY - dragStartY;
  const base = sheetOpen ? 0 : window.innerHeight - 34;
  let next = base + dy;
  next = Math.max(0, Math.min(window.innerHeight - 34, next));
  sheet.style.transform = `translateY(${next}px)`;
}, { passive: true });

sheetHandle.addEventListener("touchend", (e) => {
  sheet.classList.remove("dragging");
  sheet.style.transform = "";
  if (dragStartY !== null) {
    const dy = (e.changedTouches[0].clientY - dragStartY);
    if (!sheetOpen && dy < -25) setSheetOpen(true);
    else if (sheetOpen && dy > 25) setSheetOpen(false);
    else setSheetOpen(sheetOpen); // вернуть в прежнее состояние
  }
  dragStartY = null;
  sheetDragging = false;
});

// ===== Перетаскивание превью в ячейку (Pointer Events) =====
let dragState = null;

function onThumbPointerDown(e, index) {
  e.preventDefault();
  const thumb = e.currentTarget;
  const rect = thumb.getBoundingClientRect();

  dragState = { index, sourceEl: thumb };
  thumb.classList.add("dragging-source");

  ghost.style.backgroundImage = thumb.style.backgroundImage;
  ghost.style.width = rect.width + "px";
  ghost.style.height = rect.height + "px";
  positionGhost(e.clientX, e.clientY, rect.width, rect.height);
  ghost.classList.add("visible");

  document.addEventListener("pointermove", onDragPointerMove);
  document.addEventListener("pointerup", onDragPointerUp);
}

function positionGhost(x, y, w, h) {
  ghost.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px) scale(1.08)`;
}

let lastHoverCell = null;

function onDragPointerMove(e) {
  if (!dragState) return;
  const rect = ghost.getBoundingClientRect();
  positionGhost(e.clientX, e.clientY, rect.width, rect.height);

  const cell = getCellUnder(e.clientX, e.clientY);
  if (cell !== lastHoverCell) {
    if (lastHoverCell) lastHoverCell.classList.remove("drag-over");
    if (cell) cell.classList.add("drag-over");
    lastHoverCell = cell;
  }
}

function onDragPointerUp(e) {
  if (!dragState) return;
  const cell = getCellUnder(e.clientX, e.clientY);
  if (cell) {
    assignVideoToCell(cell, dragState.index);
  }
  cleanupDrag();
}

function cleanupDrag() {
  if (dragState && dragState.sourceEl) {
    dragState.sourceEl.classList.remove("dragging-source");
  }
  if (lastHoverCell) {
    lastHoverCell.classList.remove("drag-over");
    lastHoverCell = null;
  }
  ghost.classList.remove("visible");
  ghost.style.transform = "translate(-9999px, -9999px) scale(1.08)";
  dragState = null;
  document.removeEventListener("pointermove", onDragPointerMove);
  document.removeEventListener("pointerup", onDragPointerUp);
}

function getCellUnder(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  return el.closest(".grid-cell");
}

// ===== Назначение видео в ячейку =====
function assignVideoToCell(cell, videoIndex) {
  const cellIndex = cell.dataset.cell;
  cellAssignments[cellIndex] = videoIndex;
  renderCell(cell, videoIndex);
}

function clearCell(cell) {
  const cellIndex = cell.dataset.cell;
  delete cellAssignments[cellIndex];
  cell.classList.remove("filled");
  cell.innerHTML = `<div class="cell-placeholder">Перетащите видео сюда</div>`;
}

function renderCell(cell, videoIndex) {
  cell.classList.add("filled");
  cell.innerHTML = "";

  const video = document.createElement("video");
  video.src = videos[videoIndex];
  video.muted = true;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("webkit-playsinline", "");
  video.play().catch(() => {});

  const clearBtn = document.createElement("button");
  clearBtn.className = "cell-btn cell-clear";
  clearBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`;
  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    clearCell(cell);
  });

  const muteBtn = document.createElement("button");
  muteBtn.className = "cell-btn cell-mute";
  const iconMuted = `<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M17 8l4 8M21 8l-4 8" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;
  const iconSound = `<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16 9a4 4 0 010 6" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`;
  muteBtn.innerHTML = iconMuted;
  muteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    video.muted = !video.muted;
    muteBtn.innerHTML = video.muted ? iconMuted : iconSound;
  });

  cell.appendChild(video);
  cell.appendChild(clearBtn);
  cell.appendChild(muteBtn);
}

// ===== Service worker (кэш только статики, не видео) =====
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
