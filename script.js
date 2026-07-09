// ===== Список видео (16 штук). Файлы лежат в корне репозитория =====
const VIDEO_COUNT = 16;
const videos = Array.from({ length: VIDEO_COUNT }, (_, i) => `video${i + 1}.mp4`);
const MAX_CELLS = 4;

// ===== Дерево раскладки =====
// leaf: { type: 'leaf', video: number|null }
// split: { type: 'split', dir: 'h'|'v', a: node, b: node }
let root = { type: "leaf", video: null };

const thumbCache = {};
let thumbsGenerated = false;

const canvas = document.getElementById("canvas");
const sheet = document.getElementById("sheet");
const sheetHandle = document.getElementById("sheetHandle");
const sheetGrid = document.getElementById("sheetGrid");
const ghost = document.getElementById("dragGhost");
const splitOverlay = document.getElementById("splitOverlay");
const splitCancelBtn = document.getElementById("splitCancel");

// ===== Вспомогательные функции по дереву =====
function countLeaves(node) {
  return node.type === "leaf" ? 1 : countLeaves(node.a) + countLeaves(node.b);
}

function splitLeaf(node, dir, existingVideo, newVideo) {
  node.type = "split";
  node.dir = dir;
  node.a = { type: "leaf", video: existingVideo };
  node.b = { type: "leaf", video: newVideo };
  delete node.video;
}

// Убирает пустой лист из дерева и "схлопывает" освободившееся место —
// сосед по разбиению (со всей своей вложенной структурой) занимает
// всё пространство родителя. Ищем родителя листа target, начиная от from.
function collapseEmptyLeaf(from, target) {
  if (from.type !== "split") return false;
  if (from.a === target) {
    replaceNodeContents(from, from.b);
    return true;
  }
  if (from.b === target) {
    replaceNodeContents(from, from.a);
    return true;
  }
  return collapseEmptyLeaf(from.a, target) || collapseEmptyLeaf(from.b, target);
}

// Переносит содержимое src в dest, сохраняя объект dest (важно, если на
// него ссылается ещё более верхний узел дерева).
function replaceNodeContents(dest, src) {
  Object.keys(dest).forEach((k) => delete dest[k]);
  Object.assign(dest, src);
}

// ===== Рендер дерева в DOM =====

// Кэш живых <video>-элементов по индексу файла. Дерево раскладки
// перестраивается с нуля при каждом изменении (сплит/схлопывание), но
// сами видео-элементы переиспользуются и просто переставляются в новые
// ячейки — поэтому воспроизведение не сбрасывается на начало при
// добавлении/удалении других видео.
const videoElCache = {};

function getOrCreateVideoEl(index) {
  let el = videoElCache[index];
  if (el) return el;

  el = document.createElement("video");
  el.src = videos[index];
  el.muted = true;
  el.loop = true;
  el.autoplay = true;
  el.playsInline = true;
  el.setAttribute("webkit-playsinline", "");
  el.play().catch(() => {});
  attachDoubleTap(el, () => openFullscreen(videos[index], el.muted));

  videoElCache[index] = el;
  return el;
}

function collectUsedVideoIndices(node, set) {
  if (node.type === "leaf") {
    if (node.video !== null) set.add(node.video);
    return;
  }
  collectUsedVideoIndices(node.a, set);
  collectUsedVideoIndices(node.b, set);
}

// Останавливает и выбрасывает из кэша видео, которых больше нет нигде
// в дереве (убраны крестиком или заменены другим видео в той же ячейке).
function cleanupUnusedVideos(usedSet) {
  Object.keys(videoElCache).forEach((key) => {
    if (usedSet.has(Number(key))) return;
    const el = videoElCache[key];
    try {
      el.pause();
    } catch (e) {}
    if (el.parentNode) el.parentNode.removeChild(el);
    delete videoElCache[key];
  });
}

function renderTree(node) {
  if (node.type === "leaf") {
    return renderLeaf(node);
  }
  const container = document.createElement("div");
  container.className = node.dir === "h" ? "split-h" : "split-v";
  container.appendChild(renderTree(node.a));
  container.appendChild(renderTree(node.b));
  return container;
}

function rerenderCanvas() {
  canvas.innerHTML = "";
  canvas.appendChild(renderTree(root));

  const used = new Set();
  collectUsedVideoIndices(root, used);
  cleanupUnusedVideos(used);
}

// ===== Плавные переходы при добавлении/удалении видео (FLIP-техника) =====
// Раскладка каждый раз перестраивается с нуля, поэтому вместо анимации
// "живого" DOM-дерева мы: 1) запоминаем экранные координаты всех видео
// ДО изменения, 2) перестраиваем DOM, 3) для видео, которые были и раньше
// (просто переехали/изменили размер) — проигрываем FLIP-переход, а для
// только что появившихся — плавное появление (fade + scale-in).
const FLIP_MS = 320;
const FADE_MS = 260;

function captureVideoRects() {
  const rects = {};
  Object.keys(videoElCache).forEach((idx) => {
    const el = videoElCache[idx];
    if (el.isConnected) rects[idx] = el.getBoundingClientRect();
  });
  return rects;
}

function flipAnimate(el, firstRect) {
  const last = el.getBoundingClientRect();
  const dx = firstRect.left - last.left;
  const dy = firstRect.top - last.top;
  const sx = firstRect.width / last.width;
  const sy = firstRect.height / last.height;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) {
    return;
  }
  el.style.transition = "none";
  el.style.transformOrigin = "top left";
  el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
  void el.offsetWidth; // форсируем reflow, чтобы стартовое состояние применилось
  requestAnimationFrame(() => {
    el.style.transition = `transform ${FLIP_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`;
    el.style.transform = "";
    const cleanup = () => {
      el.style.transition = "";
      el.style.transformOrigin = "";
      el.removeEventListener("transitionend", cleanup);
    };
    el.addEventListener("transitionend", cleanup);
  });
}

function fadeInNewVideo(el) {
  el.style.transition = "none";
  el.style.opacity = "0";
  el.style.transform = "scale(0.86)";
  void el.offsetWidth;
  requestAnimationFrame(() => {
    el.style.transition = `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`;
    el.style.opacity = "1";
    el.style.transform = "";
    const cleanup = () => {
      el.style.transition = "";
      el.style.opacity = "";
      el.removeEventListener("transitionend", cleanup);
    };
    el.addEventListener("transitionend", cleanup);
  });
}

// Перестраивает канвас и анимирует результат: preRects — координаты видео
// ДО изменения дерева (снятые через captureVideoRects() перед мутацией).
function rerenderCanvasAnimated(preRects) {
  rerenderCanvas();
  requestAnimationFrame(() => {
    const used = new Set();
    collectUsedVideoIndices(root, used);
    used.forEach((idx) => {
      const el = videoElCache[idx];
      if (!el) return;
      const pre = preRects[idx];
      if (pre) {
        flipAnimate(el, pre);
      } else {
        fadeInNewVideo(el);
      }
    });
  });
}

function renderLeaf(node) {
  const cell = document.createElement("div");
  cell.className = "grid-cell";
  cell._node = node;

  if (node.video === null) {
    cell.innerHTML = `<div class="cell-placeholder">Перетащите видео сюда</div>`;
    return cell;
  }

  cell.classList.add("filled");

  const video = getOrCreateVideoEl(node.video);

  const clearBtn = document.createElement("button");
  clearBtn.className = "cell-btn cell-clear";
  clearBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`;
  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const finish = () => {
      const preRects = captureVideoRects();
      node.video = null;
      collapseEmptyLeaf(root, node);
      rerenderCanvasAnimated(preRects);
    };
    video.style.transition = `opacity 180ms ease, transform 180ms ease`;
    video.style.opacity = "0";
    video.style.transform = "scale(0.92)";
    setTimeout(finish, 180);
  });

  const muteBtn = document.createElement("button");
  muteBtn.className = "cell-btn cell-mute";
  const iconMuted = `<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M17 8l4 8M21 8l-4 8" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;
  const iconSound = `<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16 9a4 4 0 010 6" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`;
  muteBtn.innerHTML = video.muted ? iconMuted : iconSound;
  muteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    video.muted = !video.muted;
    muteBtn.innerHTML = video.muted ? iconMuted : iconSound;
  });

  cell.appendChild(video);
  cell.appendChild(clearBtn);
  cell.appendChild(muteBtn);
  return cell;
}

rerenderCanvas();

// ===== Двойной тап (для полноэкранного режима) =====
function attachDoubleTap(el, handler) {
  let lastTime = 0;
  el.addEventListener("pointerup", (e) => {
    const now = Date.now();
    if (now - lastTime < 350) {
      handler(e);
      lastTime = 0;
    } else {
      lastTime = now;
    }
  });
}

// ===== Полноэкранный просмотр =====
const fsOverlay = document.createElement("div");
fsOverlay.className = "fullscreen-overlay";
fsOverlay.innerHTML = `
  <button class="fullscreen-close">
    <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>
  </button>
`;
document.querySelector(".app").appendChild(fsOverlay);
const fsCloseBtn = fsOverlay.querySelector(".fullscreen-close");
let fsVideoEl = null;

function openFullscreen(src, muted) {
  if (fsVideoEl) fsVideoEl.remove();
  fsVideoEl = document.createElement("video");
  fsVideoEl.src = src;
  fsVideoEl.loop = true;
  fsVideoEl.autoplay = true;
  fsVideoEl.playsInline = true;
  fsVideoEl.setAttribute("webkit-playsinline", "");
  fsVideoEl.controls = true;
  fsVideoEl.muted = muted;
  fsOverlay.insertBefore(fsVideoEl, fsCloseBtn);
  fsOverlay.classList.add("visible");
  fsVideoEl.play().catch(() => {});
}

function closeFullscreen() {
  fsOverlay.classList.remove("visible");
  if (fsVideoEl) {
    fsVideoEl.pause();
    fsVideoEl.remove();
    fsVideoEl = null;
  }
}

fsCloseBtn.addEventListener("click", closeFullscreen);

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
    else setSheetOpen(sheetOpen);
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
    handleDrop(cell, dragState.index);
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

// ===== Логика вставки видео в ячейку =====
let pendingSplit = null;

function handleDrop(cellEl, videoIndex) {
  const node = cellEl._node;
  if (!node) return;

  if (node.video === null) {
    // Пустая ячейка — просто вставляем, новое видео плавно проявляется
    const preRects = captureVideoRects();
    node.video = videoIndex;
    rerenderCanvasAnimated(preRects);
    return;
  }

  // Ячейка уже занята
  if (countLeaves(root) >= MAX_CELLS) {
    // Достигнут максимум ячеек — заменяем видео в этой же ячейке:
    // старое плавно гаснет, затем на его месте плавно проявляется новое
    const oldEl = videoElCache[node.video];
    const swap = () => {
      const preRects = captureVideoRects();
      node.video = videoIndex;
      rerenderCanvasAnimated(preRects);
    };
    if (oldEl) {
      oldEl.style.transition = "opacity 160ms ease";
      oldEl.style.opacity = "0";
      setTimeout(swap, 160);
    } else {
      swap();
    }
    return;
  }

  // Есть место для роста — спрашиваем, как разбить ячейку
  pendingSplit = { node, newVideoIndex: videoIndex };
  splitOverlay.classList.add("visible");
}

splitOverlay.querySelectorAll(".split-option").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!pendingSplit) return;
    const dir = btn.dataset.dir;
    const preRects = captureVideoRects();
    splitLeaf(pendingSplit.node, dir, pendingSplit.node.video, pendingSplit.newVideoIndex);
    pendingSplit = null;
    splitOverlay.classList.remove("visible");
    rerenderCanvasAnimated(preRects);
  });
});

splitCancelBtn.addEventListener("click", () => {
  pendingSplit = null;
  splitOverlay.classList.remove("visible");
});

// ===== Service worker (кэш только статики, не видео) =====
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
