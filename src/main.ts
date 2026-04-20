import "./style.css";
import { Game } from "./Game";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const cWrap = document.getElementById("c-wrap") as HTMLDivElement;
const scoreEl = document.getElementById("score")!;
const livesEl = document.getElementById("lives")!;
const layerBadge = document.getElementById("layer-badge")!;
const mirrorHint = document.getElementById("mirror-hint")!;
const mirrorWarnBar = document.getElementById("mirror-warn-bar")!;
const startScreen = document.getElementById("start-screen")!;
const btnStart = document.getElementById("btn-start")!;
const gameover = document.getElementById("gameover")!;
const goReason = document.getElementById("go-reason")!;
const finalScore = document.getElementById("final-score")!;
const btnRetry = document.getElementById("btn-retry")!;
const quickTip = document.getElementById("quick-tip")!;
const hudEl = document.getElementById("hud")!;
const sysErrOverlay = document.getElementById("system-error-overlay") as HTMLDivElement;
const sysErrDetail = document.getElementById("syserr-detail")!;
const sysErrCount = document.getElementById("syserr-count")!;
const sysErrHex = document.getElementById("syserr-hex")!;
const lifeLostBanner = document.getElementById("life-lost-banner")!;
const shatterOverlay = document.getElementById("shatter-overlay") as HTMLDivElement | null;
const pauseRow = document.getElementById("pause-row") as HTMLDivElement;
const btnPause = document.getElementById("btn-pause") as HTMLButtonElement;
const btnResume = document.getElementById("btn-resume") as HTMLButtonElement;
const jetpackHud = document.getElementById("jetpack-hud") as HTMLDivElement;
const mysteryBoxHud = document.getElementById("mystery-box-hud") as HTMLDivElement;
const extraLifeHud = document.getElementById("extra-life-hud") as HTMLDivElement;
const mysteryFlipHud = document.getElementById("mystery-flip-hud") as HTMLDivElement;

const SYS_ERR_LINES = [
  "CONTROL BUS SIGNATURE DRIFT",
  "INPUT LAYOUT CHECKSUM MISMATCH",
  "NEURAL-STEER VECTOR OUT OF SYNC",
  "MIRROR LAYER HANDSHAKE TIMEOUT",
];

const game = new Game(canvas);

let prevNearMiss = 0;
let prevLifeLostFrozen = false;

function ensureShatterShards(): void {
  const root = shatterOverlay;
  if (!root || root.dataset.built === "1") return;
  root.dataset.built = "1";
  const cols = 7;
  const rows = 5;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const shard = document.createElement("div");
      shard.className = "shatter-shard";
      shard.style.left = `${(c / cols) * 100}%`;
      shard.style.top = `${(r / rows) * 100}%`;
      shard.style.width = `${100 / cols}%`;
      shard.style.height = `${100 / rows}%`;
      const cx = (c + 0.5) / cols - 0.5;
      const cy = (r + 0.5) / rows - 0.5;
      const mag = 40 + Math.random() * 100;
      const tx = `${(cx * mag + (Math.random() - 0.5) * 36).toFixed(1)}px`;
      const ty = `${(cy * mag + (Math.random() - 0.5) * 36).toFixed(1)}px`;
      const rot = `${((Math.random() - 0.5) * 70 + cx * 25).toFixed(1)}deg`;
      shard.style.setProperty("--sj-tx", tx);
      shard.style.setProperty("--sj-ty", ty);
      shard.style.setProperty("--sj-rot", rot);
      shard.style.setProperty("--sj-delay", `${Math.random() * 0.1}s`);
      root.appendChild(shard);
    }
  }
}

function syncLifeLostShatter(frozen: boolean): void {
  document.body.classList.toggle("life-lost-frozen", frozen);
  if (!shatterOverlay) return;
  if (frozen) {
    ensureShatterShards();
    shatterOverlay.hidden = false;
    shatterOverlay.setAttribute("aria-hidden", "false");
    if (!prevLifeLostFrozen) {
      shatterOverlay.classList.remove("shatter-active");
      void shatterOverlay.offsetWidth;
      shatterOverlay.classList.add("shatter-active");
    }
  } else {
    shatterOverlay.hidden = true;
    shatterOverlay.setAttribute("aria-hidden", "true");
    shatterOverlay.classList.remove("shatter-active");
  }
  prevLifeLostFrozen = frozen;
}

cWrap.addEventListener(
  "pointerdown",
  () => {
    if (game.isRunning()) canvas.focus({ preventScroll: true });
  },
  { capture: true },
);

function wipeScreenJuice(): void {
  canvas.style.transform = "";
  document.documentElement.style.setProperty("--mirror-warn", "0");
  document.documentElement.style.setProperty("--vfx-glitch", "0");
  document.documentElement.style.setProperty("--vfx-danger", "0");
  document.documentElement.style.setProperty("--vfx-invert", "0");
  document.documentElement.style.setProperty("--near-miss", "0");
  document.body.classList.remove("mirror-warning", "mirror-flash", "layer-mirror-city");
  cWrap.classList.remove("vfx-glitching");
  scoreEl.classList.remove("near-miss-pop");
  sysErrOverlay.hidden = true;
  sysErrOverlay.setAttribute("aria-hidden", "true");
  document.documentElement.style.setProperty("--syserr-pulse", "0");
  lifeLostBanner.hidden = true;
  lifeLostBanner.textContent = "";
  livesEl.classList.remove("life-lost-pulse");
  document.body.classList.remove("life-lost-frozen");
  prevLifeLostFrozen = false;
  if (shatterOverlay) {
    shatterOverlay.hidden = true;
    shatterOverlay.setAttribute("aria-hidden", "true");
    shatterOverlay.classList.remove("shatter-active");
  }
  document.documentElement.classList.remove("mystery-screen-flip");
  jetpackHud.hidden = true;
  jetpackHud.textContent = "";
  mysteryBoxHud.hidden = true;
  mysteryBoxHud.textContent = "";
  extraLifeHud.hidden = true;
  extraLifeHud.textContent = "";
  mysteryFlipHud.hidden = true;
  mysteryFlipHud.textContent = "";
}

function livesLabel(n: number): string {
  return "♥ ".repeat(Math.max(0, n)).trimEnd() || "—";
}

function setHud(): void {
  const live = game.isRunning();
  scoreEl.textContent = String(game.getScore());
  const lives = game.getLives();
  livesEl.textContent = livesLabel(lives);
  livesEl.setAttribute("aria-label", `${lives} lives remaining`);
  const lifeLostMsg = live ? game.getLifeLostBannerText() : null;
  if (lifeLostMsg) {
    lifeLostBanner.hidden = false;
    lifeLostBanner.textContent = lifeLostMsg;
    livesEl.classList.add("life-lost-pulse");
  } else {
    lifeLostBanner.hidden = true;
    lifeLostBanner.textContent = "";
    livesEl.classList.remove("life-lost-pulse");
  }
  const mirror = game.getMirrorLayer();
  layerBadge.textContent = mirror ? "MIRROR" : "REAL";
  layerBadge.className = mirror ? "layer-mirror" : "layer-real";
  mirrorHint.textContent = live ? game.getMirrorHint() : "";

  const jetLine = live ? game.getJetpackHudLine() : "";
  jetpackHud.hidden = !live || !jetLine;
  jetpackHud.textContent = jetLine;

  const mysteryPickLine = live ? game.getMysteryPickupHudLine() : "";
  mysteryBoxHud.hidden = !live || !mysteryPickLine;
  mysteryBoxHud.textContent = mysteryPickLine;

  const extraLifeLine = live ? game.getExtraLifeHudLine() : "";
  extraLifeHud.hidden = !live || !extraLifeLine;
  extraLifeHud.textContent = extraLifeLine;

  const warn = live ? game.getMirrorWarningProgress() : 0;
  document.documentElement.style.setProperty("--mirror-warn", String(warn));
  if (warn > 0) {
    document.body.classList.add("mirror-warning");
    mirrorWarnBar.style.transform = `scaleX(${warn})`;
  } else {
    document.body.classList.remove("mirror-warning");
    mirrorWarnBar.style.transform = "scaleX(0)";
  }

  const sec = live ? game.getMirrorSecondsRemaining() : 0;
  if (live && warn > 0.02 && sec > 0) {
    sysErrOverlay.hidden = false;
    sysErrOverlay.setAttribute("aria-hidden", "false");
    const lineIdx = Math.floor(performance.now() / 200) % SYS_ERR_LINES.length;
    sysErrDetail.textContent = SYS_ERR_LINES[lineIdx]!;
    sysErrCount.textContent = `CONTROL REM LOCK · ${sec.toFixed(1)}s`;
    const hx = (Math.floor(performance.now() * 3.7) % 0xffffff).toString(16).toUpperCase().padStart(6, "0");
    sysErrHex.textContent = `0x${hx}`;
    document.documentElement.style.setProperty("--syserr-pulse", String(warn));
  } else {
    sysErrOverlay.hidden = true;
    sysErrOverlay.setAttribute("aria-hidden", "true");
    document.documentElement.style.setProperty("--syserr-pulse", "0");
  }

  document.body.classList.toggle("game-running", live);
  document.body.classList.toggle("game-paused", live && game.isUserPaused());
  document.documentElement.classList.toggle("mystery-screen-flip", live && game.isMysteryScreenFlipped());
  cWrap.setAttribute("aria-hidden", live ? "false" : "true");

  const flipSec = live ? game.getMysteryFlipSecondsRemaining() : 0;
  if (flipSec > 0.02) {
    mysteryFlipHud.hidden = false;
    mysteryFlipHud.textContent = `UPSIDE DOWN — ${flipSec.toFixed(1)}s · keep running`;
  } else {
    mysteryFlipHud.hidden = true;
    mysteryFlipHud.textContent = "";
  }

  const paused = live && game.isUserPaused();
  const lifeFrozen = live && game.isLifeLostFrozen();
  pauseRow.hidden = !live;
  btnPause.hidden = paused;
  btnResume.hidden = !paused;
  btnPause.disabled = lifeFrozen;
  btnPause.title = lifeFrozen ? "Unavailable during life-lost beat" : "Pause run";
  quickTip.hidden = !live;
  quickTip.setAttribute("aria-hidden", live ? "false" : "true");
  const nm = game.getNearMissFlash();
  document.documentElement.style.setProperty("--near-miss", nm.toFixed(4));
  hudEl.classList.toggle("near-miss-glow", live && nm > 0.04);
  if (live && nm > 0.9 && prevNearMiss <= 0.9) {
    scoreEl.classList.remove("near-miss-pop");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("near-miss-pop");
  }
  if (!live || nm < 0.05) scoreEl.classList.remove("near-miss-pop");
  prevNearMiss = nm;
}

function applyScreenVfx(): void {
  if (game.isLifeLostFrozen() || game.isUserPaused() || game.isMysteryScreenFlipped()) {
    document.documentElement.style.setProperty("--vfx-glitch", "0");
    document.documentElement.style.setProperty("--vfx-danger", "0");
    document.documentElement.style.setProperty("--vfx-invert", "0");
    canvas.style.transform = "";
    cWrap.classList.remove("vfx-glitching");
    return;
  }
  const g = game.getVfxMirrorGlitch();
  const d = game.getVfxDangerChroma();
  const inv = game.getVfxInvertWarp();
  document.documentElement.style.setProperty("--vfx-glitch", g.toFixed(4));
  document.documentElement.style.setProperty("--vfx-danger", d.toFixed(4));
  document.documentElement.style.setProperty("--vfx-invert", inv.toFixed(4));

  cWrap.classList.toggle("vfx-glitching", g > 0.04);

  const t = performance.now() * 0.001;
  const skew =
    Math.sin(t * 12.5) * 2.6 * inv + Math.sin(t * 21.3) * 0.85 * inv + Math.sin(t * 7.1) * d * 0.35;
  const rx = inv * 0.62 + d * 0.08;
  if (inv > 0.02 || d > 0.08) {
    canvas.style.transform = `perspective(1600px) rotateX(${rx}deg) skewX(${skew}deg) scale(${1 + inv * 0.006 + d * 0.004})`;
  } else {
    canvas.style.transform = "";
  }
}

function focusPlaySurface(): void {
  game.start();
  cWrap.focus({ preventScroll: true });
  canvas.focus({ preventScroll: true });
}

btnStart.addEventListener("click", () => {
  startScreen.hidden = true;
  gameover.hidden = true;
  wipeScreenJuice();
  prevNearMiss = 0;
  focusPlaySurface();
});

btnRetry.addEventListener("click", () => {
  gameover.hidden = true;
  wipeScreenJuice();
  prevNearMiss = 0;
  focusPlaySurface();
});

btnPause.addEventListener("click", () => {
  game.pause();
});

btnResume.addEventListener("click", () => {
  game.resume();
  canvas.focus({ preventScroll: true });
});

function tick(): void {
  game.update();
  game.render();
  setHud();
  syncLifeLostShatter(game.isLifeLostFrozen());
  applyScreenVfx();
  const { over, reason } = game.getGameOver();
  if (over && startScreen.hidden) {
    gameover.hidden = false;
    goReason.textContent = reason;
    finalScore.textContent = String(game.getScore());
  }
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
