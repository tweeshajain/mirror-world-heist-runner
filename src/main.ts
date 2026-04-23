import "./style.css";
import { Game, MIRROR_SYSERR_AXIS_SWAP_SCORE } from "./Game";
import { saveRunAndGetLeaderboardSummary } from "./leaderboard";
import { resolveSupabaseClient } from "./supabase";

const PLAYER_NAME_STORAGE = "mirror-heist-display-name";

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
const sysErrFoot = document.getElementById("syserr-foot")!;
const lifeLostBanner = document.getElementById("life-lost-banner")!;
const shatterOverlay = document.getElementById("shatter-overlay") as HTMLDivElement | null;
const pauseRow = document.getElementById("pause-row") as HTMLDivElement;
const btnPause = document.getElementById("btn-pause") as HTMLButtonElement;
const btnResume = document.getElementById("btn-resume") as HTMLButtonElement;
const jetpackHud = document.getElementById("jetpack-hud") as HTMLDivElement;
const mysteryBoxHud = document.getElementById("mystery-box-hud") as HTMLDivElement;
const extraLifeHud = document.getElementById("extra-life-hud") as HTMLDivElement;
const mysteryDoorHud = document.getElementById("mystery-door-hud") as HTMLDivElement;
const floatRealmHud = document.getElementById("float-realm-hud") as HTMLDivElement;
const bottleBoostHud = document.getElementById("bottle-boost-hud") as HTMLDivElement;
const btnBottleBoost = document.getElementById("btn-bottle-boost") as HTMLButtonElement;
const bottleBoostInvCount = document.getElementById("bottle-boost-inv-count") as HTMLSpanElement;
const mysteryFlipHud = document.getElementById("mystery-flip-hud") as HTMLDivElement;
const playerNameInput = document.getElementById("player-name") as HTMLInputElement;
const leaderboardStatus = document.getElementById("leaderboard-status") as HTMLParagraphElement;
const yourRank = document.getElementById("your-rank") as HTMLParagraphElement;
const top5List = document.getElementById("top5-list") as HTMLOListElement;
const top5Heading = document.getElementById("top5-heading") as HTMLParagraphElement;
const leaderboardErr = document.getElementById("leaderboard-err") as HTMLParagraphElement;
const leaderboardSetupHint = document.getElementById("leaderboard-setup-hint") as HTMLParagraphElement;

const SYS_ERR_LINES = [
  "CONTROL BUS SIGNATURE DRIFT",
  "INPUT LAYOUT CHECKSUM MISMATCH",
  "NEURAL-STEER VECTOR OUT OF SYNC",
  "MIRROR LAYER HANDSHAKE TIMEOUT",
];

const game = new Game(canvas);

btnBottleBoost.addEventListener("click", () => {
  if (!game.isRunning()) return;
  game.activateBottleBoost();
});

let prevNearMiss = 0;
let prevLifeLostFrozen = false;
/** Bumped when a new run starts so late leaderboard responses do not paint over a fresh game. */
let leaderboardSession = 0;
let gameOverLeaderboardRequested = false;

function persistPlayerName(): void {
  const v = playerNameInput.value.trim().slice(0, 24) || "Runner";
  playerNameInput.value = v;
  localStorage.setItem(PLAYER_NAME_STORAGE, v);
}

function loadPlayerName(): void {
  const s = localStorage.getItem(PLAYER_NAME_STORAGE);
  playerNameInput.value = s && s.trim() ? s.trim().slice(0, 24) : "Runner";
}

function getDisplayName(): string {
  return playerNameInput.value.trim().slice(0, 24) || "Runner";
}

loadPlayerName();
playerNameInput.addEventListener("change", persistPlayerName);
playerNameInput.addEventListener("blur", persistPlayerName);

async function populateGameOverLeaderboard(score: number, session: number): Promise<void> {
  leaderboardErr.hidden = true;
  leaderboardErr.textContent = "";
  yourRank.hidden = true;
  top5Heading.hidden = true;
  top5List.hidden = true;
  top5List.innerHTML = "";
  leaderboardSetupHint.hidden = true;
  leaderboardSetupHint.textContent = "";

  const client = await resolveSupabaseClient();
  if (session !== leaderboardSession) return;

  if (!client) {
    leaderboardStatus.hidden = false;
    leaderboardStatus.textContent =
      "We could not load the online leaderboard, so your rank and top scores are unavailable.";
    leaderboardSetupHint.hidden = false;
    leaderboardSetupHint.textContent = import.meta.env.DEV
      ? "Fix: put URL + key in .env.local and restart npm run dev, OR copy public/supabase-config.example.json to public/supabase-config.json with your real values. Open the browser devtools console for details."
      : "If you are playing a downloaded or hosted build, the game needs Supabase settings at build time, or a supabase-config.json file next to the site.";
    return;
  }

  leaderboardStatus.hidden = false;
  leaderboardStatus.textContent = "Saving score and loading ranks…";

  const res = await saveRunAndGetLeaderboardSummary(getDisplayName(), score);
  if (session !== leaderboardSession) return;

  if (!res.ok) {
    leaderboardStatus.textContent = "";
    leaderboardErr.hidden = false;
    leaderboardErr.textContent = res.message;
    return;
  }

  leaderboardStatus.textContent = "";
  yourRank.hidden = false;
  yourRank.textContent = `Your rank: #${res.rank.toLocaleString()}`;
  top5Heading.hidden = false;
  top5List.hidden = false;
  for (const row of res.top5) {
    const li = document.createElement("li");
    li.textContent = `${row.player_name} — ${row.score.toLocaleString()}`;
    top5List.appendChild(li);
  }
  if (res.top5.length === 0) {
    const li = document.createElement("li");
    li.textContent = "(No scores in the table yet)";
    top5List.appendChild(li);
  }
}

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
  document.body.classList.remove(
    "mirror-warning",
    "mirror-flash",
    "layer-mirror-city",
    "rift-door-mode",
    "float-realm-mode",
    "bottle-boost-active",
  );
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
  mysteryDoorHud.hidden = true;
  mysteryDoorHud.textContent = "";
  floatRealmHud.hidden = true;
  floatRealmHud.textContent = "";
  bottleBoostHud.hidden = true;
  bottleBoostHud.textContent = "";
  btnBottleBoost.hidden = true;
  btnBottleBoost.disabled = true;
  bottleBoostInvCount.textContent = "0";
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

  const mysteryDoorLine = live ? game.getMysteryDoorHudLine() : "";
  mysteryDoorHud.hidden = !live || !mysteryDoorLine;
  mysteryDoorHud.textContent = mysteryDoorLine;

  const floatRealmLine = live ? game.getFloatRealmHudLine() : "";
  floatRealmHud.hidden = !live || !floatRealmLine;
  floatRealmHud.textContent = floatRealmLine;

  const bottleBoostLine = live ? game.getBottleBoostHudLine() : "";
  bottleBoostHud.hidden = !live || !bottleBoostLine;
  bottleBoostHud.textContent = bottleBoostLine;

  const bottleInv = live ? game.getBottleBoostInventory() : 0;
  btnBottleBoost.hidden = !live || bottleInv <= 0;
  bottleBoostInvCount.textContent = String(bottleInv);
  const canBottle = live && game.canActivateBottleBoost();
  btnBottleBoost.disabled = !live || !canBottle;
  btnBottleBoost.title = canBottle
    ? "Tap or Enter for 4s super speed + immunity"
    : live && bottleInv > 0
      ? "Unavailable during pause, life-lost beat, or jetpack flight"
      : "";
  btnBottleBoost.setAttribute(
    "aria-label",
    bottleInv > 0
      ? canBottle
        ? `Boost bottle: ${bottleInv} banked. Tap or Enter to activate.`
        : `Boost bottle: ${bottleInv} banked. Currently unavailable.`
      : "Boost bottle",
  );

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
    const axisSys = game.getScore() >= MIRROR_SYSERR_AXIS_SWAP_SCORE;
    const lineIdx = Math.floor(performance.now() / 200) % SYS_ERR_LINES.length;
    sysErrDetail.textContent = SYS_ERR_LINES[lineIdx]!;
    sysErrCount.textContent = `CONTROL REM LOCK · ${sec.toFixed(1)}s`;
    const hx = (Math.floor(performance.now() * 3.7) % 0xffffff).toString(16).toUpperCase().padStart(6, "0");
    sysErrHex.textContent = `0x${hx}`;
    document.documentElement.style.setProperty("--syserr-pulse", String(warn));
    sysErrFoot.textContent = axisSys
      ? "↑↓ = LANES · ←→ = JUMP / SLIDE — DO NOT TRUST MUSCLE MEMORY · AWAIT REM"
      : "DO NOT TRUST MUSCLE MEMORY · AWAIT REM";
  } else {
    sysErrOverlay.hidden = true;
    sysErrOverlay.setAttribute("aria-hidden", "true");
    document.documentElement.style.setProperty("--syserr-pulse", "0");
  }

  document.body.classList.toggle("game-running", live);
  document.body.classList.toggle("game-paused", live && game.isUserPaused());
  document.body.classList.toggle("rift-door-mode", live && game.isMysteryDoorMode());
  document.body.classList.toggle("float-realm-mode", live && game.isFloatRealmMode());
  document.body.classList.toggle("bottle-boost-active", live && game.isBottleBoostActive());
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
  leaderboardSession += 1;
  gameOverLeaderboardRequested = false;
  persistPlayerName();
  game.start();
  cWrap.focus({ preventScroll: true });
  canvas.focus({ preventScroll: true });
}

btnStart.addEventListener("click", () => {
  persistPlayerName();
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
    if (!gameOverLeaderboardRequested) {
      gameOverLeaderboardRequested = true;
      const session = leaderboardSession;
      void populateGameOverLeaderboard(game.getScore(), session);
    }
  } else if (!over) {
    gameOverLeaderboardRequested = false;
  }
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
