// Список видео — при желании поменяй пути/названия файлов
const videos = [
  "video1.mp4",
  "video2.mp4",
  "video3.mp4",
  "video4.mp4"
];

const player = document.getElementById("player");
const buttons = document.querySelectorAll(".glass-btn");
const playOverlay = document.getElementById("playOverlay");

player.loop = true;
player.muted = true; // обязательное условие автовоспроизведения на iOS

function selectVideo(index) {
  buttons.forEach((btn) => btn.classList.remove("active"));
  buttons[index].classList.add("active");

  const src = videos[index];
  if (!player.currentSrc.endsWith(src.split("/").pop())) {
    player.src = src;
    player.load();
  }

  playOverlay.classList.add("hidden");
  player.play().catch(() => {
    // На случай если автоплей всё же заблокирован — показываем кнопку play
    playOverlay.classList.remove("hidden");
  });
}

buttons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const index = parseInt(btn.dataset.video, 10);
    selectVideo(index);
  });
});

player.addEventListener("pause", () => playOverlay.classList.remove("hidden"));
player.addEventListener("play", () => playOverlay.classList.add("hidden"));

playOverlay.addEventListener("click", () => {
  player.play();
});

// Пытаемся запустить видео сразу при загрузке страницы
window.addEventListener("DOMContentLoaded", () => {
  player.play().catch(() => {
    playOverlay.classList.remove("hidden");
  });
});

// Регистрируем service worker для офлайн-работы как PWA (не обязателен, но полезен)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
