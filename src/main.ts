import "./style.css";
import { Game } from "./Game";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const cWrap = document.getElementById("c-wrap") as HTMLDivElement;
const scoreEl = document.getElementById("score")!;
const chaseBar = document.getElementById("chase-bar")!;
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

const SYS_ERR_LINES = [
  "CONTROL BUS SIGNATURE DRIFT",
  "INPUT LAYOUT CHECKSUM MISMATCH",
  "NEURAL-STEER VECTOR OUT OF SYNC",
  "MIRROR LAYER HANDSHAKE TIMEOUT",
];

const game = new Game(canvas);

let prevNearMiss = 0;

function wipeScreenJuice(): void {
  canvas.style.transform = "";
  document.documentElement.style.setProperty("--vfx-glitch", "0");
  document.documentElement.style.setProperty("--vfx-danger", "0");
  document.documentElement.style.setProperty("--vfx-invert", "0");
  document.documentElement.style.setProperty("--near-miss", "0");
  cWrap.classList.remove("vfx-glitching");
  scoreEl.classList.remove("near-miss-pop");
  sysErrOverlay.hidden = true;
  sysErrOverlay.setAttribute("aria-hidden", "true");
  document.documentElement.style.setProperty("--syserr-pulse", "0");
}

function setHud(): void {
  scoreEl.textContent = String(game.getScore());
  chaseBar.style.width = `${Math.round(game.getChase() * 100)}%`;
  const mirror = game.getMirrorLayer();
  layerBadge.textContent = mirror ? "MIRROR" : "REAL";
  layerBadge.className = mirror ? "layer-mirror" : "layer-real";
  mirrorHint.textContent = game.getMirrorHint();

  const warn = game.getMirrorWarningProgress();
  document.documentElement.style.setProperty("--mirror-warn", String(warn));
  if (warn > 0) {
    document.body.classList.add("mirror-warning");
    mirrorWarnBar.style.transform = `scaleX(${warn})`;
  } else {
    document.body.classList.remove("mirror-warning");
    mirrorWarnBar.style.transform = "scaleX(0)";
  }

  const sec = game.getMirrorSecondsRemaining();
  if (warn > 0.02 && sec > 0) {
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

  const live = game.isRunning();
  document.body.classList.toggle("game-running", live);
  quickTip.hidden = !live;
  quickTip.setAttribute("aria-hidden", live ? "false" : "true");
  const nm = game.getNearMissFlash();
  document.documentElement.style.setProperty("--near-miss", nm.toFixed(4));
  hudEl.classList.toggle("near-miss-glow", nm > 0.04);
  if (nm > 0.9 && prevNearMiss <= 0.9) {
    scoreEl.classList.remove("near-miss-pop");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("near-miss-pop");
  }
  if (nm < 0.05) scoreEl.classList.remove("near-miss-pop");
  prevNearMiss = nm;
}

function applyScreenVfx(): void {
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

btnStart.addEventListener("click", () => {
  canvas.focus();
  startScreen.hidden = true;
  gameover.hidden = true;
  wipeScreenJuice();
  prevNearMiss = 0;
  game.start();
});

btnRetry.addEventListener("click", () => {
  gameover.hidden = true;
  wipeScreenJuice();
  prevNearMiss = 0;
  game.start();
  canvas.focus();
});

function tick(): void {
  game.update();
  game.render();
  setHud();
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
