import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const LANES = [-1, 0, 1] as const;
const LANE_WIDTH = 2.15;
const CHUNK_LENGTH = 18;
const PLAYER_Z = 0;
const SPAWN_AHEAD = 82;
const DESPAWN_BEHIND = 38;
/** Never place consecutive spawns closer than this (after time + score modifiers). */
const OBSTACLE_SPACING_MIN = 12.75;
/** Extra distance between obstacles at low score; shrinks a bit each SCORE_SPEED_MILESTONE pts. */
const OBSTACLE_SPACING_BASE_START = 30;
const OBSTACLE_SPACING_BASE_END = 19;
const OBSTACLE_TIME_RAMP_S = 125;
/** Subtracted from spacing per each full SCORE_SPEED_MILESTONE points (easier early, denser later). */
const OBSTACLE_TIGHTEN_PER_SCORE_TIER = 0.55;
/** In spawn-distance space: blocks closer than this cannot occupy all three lanes (no unavoidable wall). */
const BLOCK_CLUSTER_D = 9.5;
/** Pink block height (world Y); above max jump apex so players must change lanes, not jump over. */
const BLOCK_HEIGHT = 2.88;
/** Purple slide barricade: pass only if head top stays under this Y (standing/jump still hit). */
const HIGH_BAR_CLEARANCE = 1.02;
const HIGH_BEAM_HEIGHT = 1.05;
const HIGH_POST_HEIGHT = 2.14;
/** Each time floor(score / this) increases, run speed bumps (target + max cap). */
const SCORE_SPEED_MILESTONE = 2000;
const SPEED_BONUS_PER_MILESTONE = 2.85;
const VMAX_BONUS_PER_MILESTONE = 1.55;
const MAX_SPEED_MILESTONES = 14;

/** Mirror Reality System: fixed cadence + telegraph (see `MIRROR_*`). */
const MIRROR_CYCLE_MS = 15000;
const MIRROR_WARN_MS = 1000;
const STARTING_LIVES = 3;
/** After Mirror Reality fires, obstacle hits do not cost lives (ms). */
const MIRROR_PROTOCOL_IMMUNITY_MS = 2000;
/** Non-fatal hit: freeze sim + input while the mirror-shatter beat plays (ms). */
const LIFE_LOST_FREEZE_MS = 1000;
/** After unfreezing from a life loss, obstacle hits do not cost lives (ms wall clock). */
const LIFE_LOST_HIT_IMMUNITY_MS = 2000;

const JETPACK_SCORE_TRIGGER = 4000;
/** If the first jetpack pickup is missed, a second pickup can be scheduled after this score. */
const JETPACK_RETRY_SCORE_TRIGGER = 5000;
/** After the early jetpack arc ends, one bonus pickup can be scheduled once score reaches this. */
const JETPACK_LATE_SCORE_TRIGGER = 12000;
/** Wall-clock delay after crossing `JETPACK_LATE_SCORE_TRIGGER` before the bonus jetpack spawns. */
const JETPACK_LATE_SPAWN_DELAY_MIN_MS = 2000;
const JETPACK_LATE_SPAWN_DELAY_MAX_MS = 4000;
/** Wall-clock delay (few seconds) after score crosses a gate before jetpack / mystery pickups spawn. */
const PICKUP_SPAWN_DELAY_MIN_MS = 450;
const PICKUP_SPAWN_DELAY_MAX_MS = 3200;
const JETPACK_FLY_DURATION_MS = 5000;
const JETPACK_LAND_IMMUNITY_MS = 2000;
const JETPACK_FLY_HEIGHT = 3.35;
const JETPACK_PICKUP_Z_OFFSET = 66;
/** Spawn this many seconds of travel farther ahead so the pickup is visible earlier for lane changes. */
const JETPACK_PICKUP_LEAD_TIME_S = 1.4;
const COIN_SCORE_BONUS = 100;
/** Jetpack flight only: base interval between coin spawns (ms). */
const JETPACK_COIN_SPAWN_INTERVAL_MS = 150;
const JETPACK_COIN_SPAWN_JITTER_MS = 70;

/** After this score, a mystery box spawns once per run (wall-clock delay below). */
const MYSTERY_BOX_SCORE_TRIGGER = 7000;
/** If the first mystery box is missed, a second pickup can be scheduled after this score. */
const MYSTERY_BOX_RETRY_SCORE_TRIGGER = 8000;
/** After the early mystery arc ends, one more box can spawn once score reaches this. */
const MYSTERY_BOX_LATE_SCORE_TRIGGER = 14000;
const MYSTERY_BOX_LATE_SPAWN_DELAY_MIN_MS = 2200;
const MYSTERY_BOX_LATE_SPAWN_DELAY_MAX_MS = 4800;
/** After any missed (non–14k-encore) mystery box, respawn this soon until the player collects one. */
const MYSTERY_BOX_MISS_RETRY_MIN_MS = 2000;
const MYSTERY_BOX_MISS_RETRY_MAX_MS = 4800;
const MYSTERY_BOX_PICKUP_Z_OFFSET = 78;
/** At or above this score with exactly one life left, a one-time extra-life pickup can spawn this run. */
const EXTRA_LIFE_SCORE_TRIGGER = 10000;
const EXTRA_LIFE_PICKUP_Z_OFFSET = 76;
/** Min |Δz| to nearest obstacle in-lane before we nudge pickup further ahead (worldGroup local Z). */
const PICKUP_MIN_Z_CLEARANCE = 13;
/** If no lane clears `PICKUP_MIN_Z_CLEARANCE`, shift spawn this much further ahead (more negative Z). */
const PICKUP_Z_NUDGE = 9;
/** HUD countdown starts this many ms before the extra-life pickup is scheduled to spawn. */
const EXTRA_LIFE_PRESPAWN_WARN_MS = 2000;
/** Collecting the box flips the entire view for this long (game keeps running). */
const MYSTERY_FLIP_DURATION_MS = 10000;
/** Obstacle immunity: first window right as upside-down starts; second right after view resets. */
const MYSTERY_FLIP_IMMUNITY_MS = 2000;
const MYSTERY_POST_FLIP_IMMUNITY_MS = 2000;

/** Score gate for the neon mystery door portal (once per run; wall-clock delay below). */
const MYSTERY_DOOR_SCORE_TRIGGER = 12000;
const MYSTERY_DOOR_SPAWN_DELAY_MIN_MS = 2800;
const MYSTERY_DOOR_SPAWN_DELAY_MAX_MS = 5200;
/** If the first door is missed, respawn after this wall-clock delay (ms). */
const MYSTERY_DOOR_RETRY_DELAY_MIN_MS = 7000;
const MYSTERY_DOOR_RETRY_DELAY_MAX_MS = 10000;
const MYSTERY_DOOR_PICKUP_Z_OFFSET = 88;
/** Wall-clock duration after entering the door (slow → surge → auto exit). */
const MYSTERY_DOOR_MODE_DURATION_MS = 10000;
/** First segment: run slower than normal. */
const MYSTERY_DOOR_SLOW_PHASE_MS = 3000;
/** After mode ends (auto exit), obstacle hits ignored (ms). */
const MYSTERY_DOOR_POST_IMMUNITY_MS = 2000;
/** After driving through the door, obstacle hits ignored until void ends or this elapses (ms). */
const MYSTERY_DOOR_ENTRY_IMMUNITY_MS = 2000;

export type MirrorEventType = "invert_lr" | "swap_jump_slide" | "full_shift";

type ObstacleKind = "block" | "low" | "high";

interface Obstacle {
  mesh: THREE.Group;
  lane: number;
  z: number;
  kind: ObstacleKind;
  hit: boolean;
  /** Cleared after we evaluate a tight pass for near-miss juice. */
  nearEvaluated: boolean;
}

interface RoadChunk {
  group: THREE.Group;
  zCenter: number;
}

interface JetpackPickup {
  mesh: THREE.Group;
  lane: (typeof LANES)[number];
  z: number;
}

interface FlightCoin {
  mesh: THREE.Group;
  lane: (typeof LANES)[number];
  z: number;
  collected: boolean;
}

interface MysteryBoxPickup {
  mesh: THREE.Group;
  lane: (typeof LANES)[number];
  z: number;
  /** Wall clock when spawned — despawn ignored until grace elapses so it cannot vanish same-frame. */
  spawnedAtMs: number;
}

interface ExtraLifePickup {
  mesh: THREE.Group;
  lane: (typeof LANES)[number];
  z: number;
  spawnedAtMs: number;
}

interface MysteryDoorPickup {
  mesh: THREE.Group;
  lane: (typeof LANES)[number];
  z: number;
  spawnedAtMs: number;
}

function createMysteryQuestionTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 128, 128);
    g.addColorStop(0, "#4a1a7a");
    g.addColorStop(0.5, "#2a0a52");
    g.addColorStop(1, "#1a0638");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "rgba(255, 220, 100, 0.95)";
    ctx.lineWidth = 10;
    ctx.strokeRect(14, 14, 100, 100);
    ctx.fillStyle = "#ffe566";
    ctx.font = "bold 78px system-ui,Segoe UI,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", 64, 66);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function randRange(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function laneToGridIndex(lane: number): 0 | 1 | 2 {
  if (lane === -1) return 0;
  if (lane === 0) return 1;
  return 2;
}

function gridIndexToLane(i: 0 | 1 | 2): (typeof LANES)[number] {
  return LANES[i];
}

/** Fisher–Yates shuffle in-place. */
function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
}

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  private worldGroup = new THREE.Group();
  private fogColorReal = new THREE.Color(0x060510);
  private fogColorMirror = new THREE.Color(0x140818);

  private player = new THREE.Group();
  /** Root for thief mesh + procedural parkour pose (child of `player`). */
  private thiefRig = new THREE.Group();
  private thiefTorso = new THREE.Group();
  private thiefHead = new THREE.Group();
  private thiefLegs = new THREE.Group();
  private thiefArms = new THREE.Group();
  private thiefVisor!: THREE.Mesh;
  private thiefHud = new THREE.Group();
  private thiefHolo!: THREE.Mesh;
  private thiefVisorMat!: THREE.MeshStandardMaterial;
  private prevPlayerWorldX = 0;
  private playerY = 0;
  private playerLane = 1;
  private targetLane = 1;
  private laneBlend = 0;

  private velocityZ = 18.5;
  private distance = 0;
  private aliveTime = 0;
  private score = 0;

  private jumping = false;
  private jumpVel = 0;
  private sliding = false;
  private slideTimer = 0;

  private chunks: RoadChunk[] = [];
  private obstacles: Obstacle[] = [];
  private nextObstacleAt = 26;
  /** Shuffled queue of lanes (3× each) so no lane is starved long-term. */
  private laneFairnessBag: (typeof LANES)[number][] = [];

  private invertLR = false;
  private swapJumpSlide = false;
  private mirrorLayer = false;
  private mirrorPhysicsFlip = false;
  /** Environment X-mirror (full shift); collision uses world positions. */
  private worldFlipX = false;

  private mirrorNextFireAt = 0;
  private mirrorWarningStartAt = 0;
  private mirrorAnnounceUntil = 0;
  private lastMirrorMessage = "";

  private mirrorCamRoll = 0;
  private readonly owp = new THREE.Vector3();

  private vfxMirrorGlitchUntil = 0;
  private vfxInvertWarpUntil = 0;
  private vfxStumblePulseUntil = 0;
  private trailPlates: THREE.Mesh[] = [];
  private lastTrailX = 0;

  private nearMissFlashUntil = 0;
  private lastMirrorProtocolAt = 0;
  private lastStumbleUnderMirror = false;

  private stumbleCooldown = 0;
  private lives = STARTING_LIVES;

  private touchStart: { x: number; y: number; t: number } | null = null;
  private lifeLostBannerUntil = 0;
  /** Until this time (exclusive), world sim and input are paused after losing a life. */
  private lifeLostFreezeUntil = 0;
  /** After a non-fatal life loss, until this time obstacle hits are ignored (starts after freeze). */
  private lifeLostHitImmunityUntil = 0;
  /** `performance.now()` until which obstacle hits do not cost lives (Mirror protocol grace). */
  private mirrorProtocolImmunityUntil = 0;
  /** After jetpack flight ends, brief obstacle immunity (ms wall clock). */
  private jetpackPostImmunityUntil = 0;
  /** Once per run: wall-clock time when jetpack pickup should spawn (0 = not scheduled). */
  private jetpackSpawnAtMs = 0;
  /** True after jetpack sequence finished (flew once, or both pickups missed). */
  private jetpackUsedThisRun = false;
  /** How many jetpack pickups have been placed this run (early arc 0–2, plus optional late bonus). */
  private jetpackPickupSpawnsThisRun = 0;
  /** True once the player grabs a pickup and enters flight. */
  private jetpackEnteredFlightThisRun = false;
  /** Wall-clock spawn time for the post-12k bonus jetpack (0 = not scheduled). */
  private jetpackLateSpawnAtMs = 0;
  /** True after the late jetpack was collected, flown, or missed. */
  private jetpackLateWaveDone = false;
  /** True while the late bonus pickup is on the field or its flight has not ended yet. */
  private jetpackPendingLateResolve = false;
  private jetpackPickup: JetpackPickup | null = null;
  /** While > 0 and `now <` this value, player is in jetpack flight. */
  private jetpackFlyingUntil = 0;
  private flightCoins: FlightCoin[] = [];
  private jetpackNextCoinAtMs = 0;

  private mysteryBoxSpawnAtMs = 0;
  /** True once the player has collected a mystery box (flip) this run, or after late encore miss. */
  private mysteryBoxUsedThisRun = false;
  /** Mystery pickups placed this run (increments until a box is collected). */
  private mysteryBoxPickupSpawnsThisRun = 0;
  /** True while the on-track pickup was spawned from the 14k encore (miss does not chain-retry). */
  private mysteryBoxActivePickupFromLate14k = false;
  /** True once the player collects a box and the upside-down effect starts. */
  private mysteryBoxCollectedThisRun = false;
  private mysteryBoxPickup: MysteryBoxPickup | null = null;
  /** Wall-clock spawn for the 14k+ encore mystery box (0 = not scheduled). */
  private mysteryBoxLateSpawnAtMs = 0;
  /** True after the late 14k mystery box spawned (whether collected or missed). */
  private mysteryBoxLateWaveDone = false;
  /** Until this time (exclusive), full-screen CSS flip is active. */
  private mysteryScreenFlipUntil = 0;
  /** Obstacle hits ignored for this long after mystery flip begins. */
  private mysteryFlipImmunityUntil = 0;
  /** Obstacle hits ignored for this long after upside-down ends (view “resets”). */
  private mysteryPostFlipImmunityUntil = 0;
  /** For one-shot post-flip immunity when `mysteryScreenFlipUntil` elapses. */
  private prevMysteryFlipActive = false;

  /** Once per run: wall-clock when extra-life pickup should appear (0 = not scheduled). */
  private extraLifeSpawnAtMs = 0;
  /** True after the offer is collected or missed for good this run. */
  private extraLifePickupUsedThisRun = false;
  private extraLifePickup: ExtraLifePickup | null = null;

  /** Once per run: wall-clock when mystery door spawns (0 = not scheduled). */
  private mysteryDoorSpawnAtMs = 0;
  /** True after the void run finishes (normal exit); not set on pickup misses — door retries until entered. */
  private mysteryDoorWaveComplete = false;
  /** Door pickups spawned this run (increments until the player enters the void). */
  private mysteryDoorPickupSpawnsThisRun = 0;
  private mysteryDoorPickup: MysteryDoorPickup | null = null;
  /** Exclusive end time for void run (performance.now); 0 = inactive. */
  private mysteryDoorModeUntil = 0;
  private mysteryDoorModeStartMs = 0;
  private mysteryDoorSpikeFired = false;
  /** After void run ends, obstacle hits ignored until this time. */
  private mysteryDoorPostImmunityUntil = 0;
  /** After entering the door (void starts), obstacle hits ignored until this time. */
  private mysteryDoorEntryImmunityUntil = 0;

  private running = false;
  private gameOver = false;
  private gameOverReason = "";

  /** Player-requested pause: no sim, no input; wall clocks are shifted on resume. */
  private userPaused = false;
  private pauseStartedAt = 0;

  private clock = new THREE.Clock();
  private resizeBound = () => this.onResize();
  private keyDownBound = (e: KeyboardEvent) => this.onGlobalKeyDown(e);
  /** Must match between add/removeEventListener for the capture listener. */
  private readonly keyListenerOpts: AddEventListenerOptions = { capture: true };

  private ambient: THREE.AmbientLight;
  private dirLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;

  constructor(canvas: HTMLCanvasElement) {
    canvas.tabIndex = 1;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(
      58,
      window.innerWidth / window.innerHeight,
      0.1,
      220,
    );
    this.camera.position.set(0, 3.2, 7.4);
    this.camera.lookAt(0, 1.2, -8);

    this.scene.fog = new THREE.Fog(this.fogColorReal, 26, 96);
    this.scene.background = this.fogColorReal.clone();

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.ambient = new THREE.AmbientLight(0x3a3060, 0.48);
    this.scene.add(this.ambient);

    this.dirLight = new THREE.DirectionalLight(0xa8f0ff, 1.1);
    this.dirLight.position.set(4, 18, 6);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(1024, 1024);
    this.dirLight.shadow.camera.near = 2;
    this.dirLight.shadow.camera.far = 60;
    this.dirLight.shadow.camera.left = -20;
    this.dirLight.shadow.camera.right = 20;
    this.dirLight.shadow.camera.top = 20;
    this.dirLight.shadow.camera.bottom = -20;
    this.scene.add(this.dirLight);

    this.fillLight = new THREE.DirectionalLight(0xff66c4, 0.35);
    this.fillLight.position.set(-10, 6, -4);
    this.scene.add(this.fillLight);

    this.scene.add(this.worldGroup);
    this.buildPlayer();
    this.resetSession();

    window.addEventListener("resize", this.resizeBound);
    window.addEventListener("keydown", this.keyDownBound, this.keyListenerOpts);

    canvas.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        this.touchStart = { x: t.clientX, y: t.clientY, t: performance.now() };
      },
      { passive: true },
    );
    canvas.addEventListener(
      "touchend",
      (e) => {
        if (!this.touchStart || !e.changedTouches[0]) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - this.touchStart.x;
        const dy = t.clientY - this.touchStart.y;
        const dt = performance.now() - this.touchStart.t;
        this.touchStart = null;
        if (!this.running || this.gameOver) return;
        if (this.isLifeLostFrozen() || this.userPaused) return;
        const min = 28;
        if (dt > 600) return;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > min) {
          if (dx < 0) this.queueLane(-1);
          else this.queueLane(1);
        } else if (Math.abs(dy) > min) {
          if (dy < 0) this.tryJump();
          else this.trySlide();
        }
      },
      { passive: true },
    );
  }

  start(): void {
    this.resetSession();
    this.running = true;
    this.gameOver = false;
    this.scheduleMirrorRealityCycle(performance.now());
    this.clock.getDelta();
    this.clock.getDelta();
  }

  isRunning(): boolean {
    return this.running && !this.gameOver;
  }

  isUserPaused(): boolean {
    return this.userPaused;
  }

  pause(): void {
    if (!this.isRunning() || this.userPaused) return;
    this.userPaused = true;
    this.pauseStartedAt = performance.now();
  }

  resume(): void {
    if (!this.userPaused) return;
    const slip = performance.now() - this.pauseStartedAt;
    const t0 = this.pauseStartedAt;
    this.shiftWallClockDeadlinesAfterPause(t0, slip);
    this.userPaused = false;
    this.pauseStartedAt = 0;
    this.clock.getDelta();
  }

  /** Active deadlines in the future at `t0` are pushed by `slip` so real time spent paused does not count. */
  private shiftWallClockDeadlinesAfterPause(t0: number, slip: number): void {
    const bump = (deadline: number) => deadline + slip;
    if (this.mirrorNextFireAt > t0) this.mirrorNextFireAt = bump(this.mirrorNextFireAt);
    if (this.mirrorWarningStartAt > t0) this.mirrorWarningStartAt = bump(this.mirrorWarningStartAt);
    if (this.mirrorAnnounceUntil > t0) this.mirrorAnnounceUntil = bump(this.mirrorAnnounceUntil);
    if (this.lifeLostFreezeUntil > t0) this.lifeLostFreezeUntil = bump(this.lifeLostFreezeUntil);
    if (this.lifeLostHitImmunityUntil > t0) this.lifeLostHitImmunityUntil = bump(this.lifeLostHitImmunityUntil);
    if (this.lifeLostBannerUntil > t0) this.lifeLostBannerUntil = bump(this.lifeLostBannerUntil);
    if (this.mirrorProtocolImmunityUntil > t0) this.mirrorProtocolImmunityUntil = bump(this.mirrorProtocolImmunityUntil);
    if (this.jetpackPostImmunityUntil > t0) this.jetpackPostImmunityUntil = bump(this.jetpackPostImmunityUntil);
    if (this.jetpackSpawnAtMs > t0) this.jetpackSpawnAtMs = bump(this.jetpackSpawnAtMs);
    if (this.jetpackLateSpawnAtMs > t0) this.jetpackLateSpawnAtMs = bump(this.jetpackLateSpawnAtMs);
    if (this.jetpackFlyingUntil > t0) this.jetpackFlyingUntil = bump(this.jetpackFlyingUntil);
    if (this.jetpackNextCoinAtMs > t0) this.jetpackNextCoinAtMs = bump(this.jetpackNextCoinAtMs);
    if (this.mysteryBoxSpawnAtMs > t0) this.mysteryBoxSpawnAtMs = bump(this.mysteryBoxSpawnAtMs);
    if (this.mysteryBoxLateSpawnAtMs > t0) this.mysteryBoxLateSpawnAtMs = bump(this.mysteryBoxLateSpawnAtMs);
    if (this.mysteryScreenFlipUntil > t0) this.mysteryScreenFlipUntil = bump(this.mysteryScreenFlipUntil);
    if (this.mysteryFlipImmunityUntil > t0) this.mysteryFlipImmunityUntil = bump(this.mysteryFlipImmunityUntil);
    if (this.mysteryPostFlipImmunityUntil > t0) this.mysteryPostFlipImmunityUntil = bump(this.mysteryPostFlipImmunityUntil);
    if (this.extraLifeSpawnAtMs > t0) this.extraLifeSpawnAtMs = bump(this.extraLifeSpawnAtMs);
    if (this.mysteryDoorSpawnAtMs > t0) this.mysteryDoorSpawnAtMs = bump(this.mysteryDoorSpawnAtMs);
    if (this.mysteryDoorModeUntil > t0) this.mysteryDoorModeUntil = bump(this.mysteryDoorModeUntil);
    if (this.mysteryDoorModeStartMs > t0) this.mysteryDoorModeStartMs = bump(this.mysteryDoorModeStartMs);
    if (this.mysteryDoorPostImmunityUntil > t0) this.mysteryDoorPostImmunityUntil = bump(this.mysteryDoorPostImmunityUntil);
    if (this.mysteryDoorEntryImmunityUntil > t0) this.mysteryDoorEntryImmunityUntil = bump(this.mysteryDoorEntryImmunityUntil);
    if (this.vfxMirrorGlitchUntil > t0) this.vfxMirrorGlitchUntil = bump(this.vfxMirrorGlitchUntil);
    if (this.vfxInvertWarpUntil > t0) this.vfxInvertWarpUntil = bump(this.vfxInvertWarpUntil);
    if (this.vfxStumblePulseUntil > t0) this.vfxStumblePulseUntil = bump(this.vfxStumblePulseUntil);
    if (this.nearMissFlashUntil > t0) this.nearMissFlashUntil = bump(this.nearMissFlashUntil);
  }

  getScore(): number {
    return Math.floor(this.score);
  }

  getLives(): number {
    return this.lives;
  }

  /** Non-null while a “life lost” message should show after a hit (not on final death). */
  getLifeLostBannerText(): string | null {
    if (!this.isRunning()) return null;
    if (performance.now() >= this.lifeLostBannerUntil) return null;
    const n = this.lives;
    return `LIFE LOST · ${n} ${n === 1 ? "life" : "lives"} left`;
  }

  /** True while the run is frozen after a non-fatal hit (mirror shatter, no sim / no input). */
  isLifeLostFrozen(): boolean {
    return this.running && !this.gameOver && performance.now() < this.lifeLostFreezeUntil;
  }

  getMirrorLayer(): boolean {
    return this.mirrorLayer;
  }

  /** Mirror Reality telegraph / announcements only (not jetpack or mystery box). */
  getMirrorHint(): string {
    if (!this.isRunning()) return "";
    if (this.userPaused) return "";
    const now = performance.now();
    const w = this.getMirrorWarningProgress();
    if (w > 0 && this.mirrorNextFireAt > 0) {
      const sec = Math.max(0, (this.mirrorNextFireAt - now) / 1000);
      return `MIRROR REALITY — ${sec.toFixed(1)}s`;
    }
    if (now < this.mirrorAnnounceUntil) return this.lastMirrorMessage;
    return "";
  }

  /** Jetpack-only HUD (flight timer, pickup cue). Shown separately from mystery box. */
  getJetpackHudLine(): string {
    if (!this.isRunning()) return "";
    if (this.userPaused) return "";
    if (this.isJetpackFlying()) {
      const s = Math.max(0, (this.jetpackFlyingUntil - performance.now()) / 1000);
      return `Jetpack: ${s.toFixed(1)}s left · lane coins +${COIN_SCORE_BONUS}`;
    }
    if (this.jetpackPickup) return "Jetpack pickup ahead";
    return "";
  }

  /** Mystery box pickup cue only (upside-down countdown uses `#mystery-flip-hud`). */
  getMysteryPickupHudLine(): string {
    if (!this.isRunning()) return "";
    if (this.userPaused) return "";
    if (this.mysteryBoxPickup) return "Mystery box ahead";
    return "";
  }

  /** Extra-life pickup cue (score ≥10k, one life only, once per run). */
  getExtraLifeHudLine(): string {
    if (!this.isRunning()) return "";
    if (this.userPaused) return "";
    if (this.extraLifePickup) return "Extra life ahead — stay in your lane";
    if (this.extraLifePickupUsedThisRun || this.extraLifeSpawnAtMs === 0) return "";
    const now = performance.now();
    const tSpawn = this.extraLifeSpawnAtMs;
    const warnStart = tSpawn - EXTRA_LIFE_PRESPAWN_WARN_MS;
    if (now < warnStart) return "";
    if (now < tSpawn) {
      const s = Math.max(0, (tSpawn - now) / 1000);
      return `Extra life in ${s.toFixed(1)}s — stay ready`;
    }
    return "Extra life incoming…";
  }

  /** Mystery door portal + void-run countdown (12k+ gate). */
  getMysteryDoorHudLine(): string {
    if (!this.isRunning()) return "";
    if (this.userPaused) return "";
    if (this.mysteryDoorPickup) {
      return this.mysteryDoorPickupSpawnsThisRun >= 2
        ? "Mystery door — another try · run through it"
        : "Mystery door ahead — run through it";
    }
    const now = performance.now();
    if (this.isMysteryDoorMode()) {
      const s = Math.max(0, (this.mysteryDoorModeUntil - now) / 1000);
      const phase = now - this.mysteryDoorModeStartMs < MYSTERY_DOOR_SLOW_PHASE_MS ? "slow" : "surge";
      return phase === "slow"
        ? `VOID RUN — ${s.toFixed(1)}s left · slow pull`
        : `VOID RUN — ${s.toFixed(1)}s left · SURGE (auto exit)`;
    }
    if (
      !this.mysteryDoorWaveComplete &&
      this.mysteryDoorSpawnAtMs > 0 &&
      this.mysteryDoorPickupSpawnsThisRun >= 1
    ) {
      if (now < this.mysteryDoorSpawnAtMs) {
        const s = Math.max(0, (this.mysteryDoorSpawnAtMs - now) / 1000);
        return `Mystery door again in ${s.toFixed(1)}s`;
      }
      return "Mystery door incoming…";
    }
    return "";
  }

  /** True during the 10s void experience after passing the mystery door. */
  isMysteryDoorMode(): boolean {
    if (!this.isRunning()) return false;
    const now = performance.now();
    return this.mysteryDoorModeUntil > 0 && now < this.mysteryDoorModeUntil;
  }

  private isJetpackFlying(): boolean {
    return this.jetpackFlyingUntil > 0 && performance.now() < this.jetpackFlyingUntil;
  }

  /** Full 180° screen flip from mystery box (HUD + canvas); gameplay continues. */
  isMysteryScreenFlipped(): boolean {
    return this.isRunning() && performance.now() < this.mysteryScreenFlipUntil;
  }

  /** Seconds left for upside-down effect; 0 if inactive. */
  getMysteryFlipSecondsRemaining(): number {
    if (!this.isRunning()) return 0;
    const now = performance.now();
    if (now >= this.mysteryScreenFlipUntil) return 0;
    return (this.mysteryScreenFlipUntil - now) / 1000;
  }

  getGameOver(): { over: boolean; reason: string } {
    return { over: this.gameOver, reason: this.gameOverReason };
  }

  dispose(): void {
    window.removeEventListener("resize", this.resizeBound);
    window.removeEventListener("keydown", this.keyDownBound, this.keyListenerOpts);
    this.renderer.dispose();
  }

  private resetSession(): void {
    this.userPaused = false;
    this.pauseStartedAt = 0;
    this.velocityZ = 18.5;
    this.distance = 0;
    this.aliveTime = 0;
    this.score = 0;
    this.playerLane = 1;
    this.targetLane = 1;
    this.laneBlend = 0;
    this.playerY = 0;
    this.jumping = false;
    this.jumpVel = 0;
    this.sliding = false;
    this.slideTimer = 0;
    this.invertLR = false;
    this.swapJumpSlide = false;
    this.mirrorLayer = false;
    this.mirrorPhysicsFlip = false;
    this.worldFlipX = false;
    this.worldGroup.scale.set(1, 1, 1);
    this.worldGroup.position.set(0, 0, 0);
    this.mirrorCamRoll = 0;
    this.mirrorNextFireAt = 0;
    this.mirrorWarningStartAt = 0;
    this.stumbleCooldown = 0;
    this.lives = STARTING_LIVES;
    this.lifeLostBannerUntil = 0;
    this.lifeLostFreezeUntil = 0;
    this.lifeLostHitImmunityUntil = 0;
    this.mirrorProtocolImmunityUntil = 0;
    this.jetpackPostImmunityUntil = 0;
    this.jetpackSpawnAtMs = 0;
    this.jetpackLateSpawnAtMs = 0;
    this.jetpackLateWaveDone = false;
    this.jetpackPendingLateResolve = false;
    this.jetpackUsedThisRun = false;
    this.jetpackPickupSpawnsThisRun = 0;
    this.jetpackEnteredFlightThisRun = false;
    if (this.jetpackPickup) {
      this.worldGroup.remove(this.jetpackPickup.mesh);
      this.jetpackPickup = null;
    }
    this.jetpackFlyingUntil = 0;
    this.clearFlightCoins();
    this.jetpackNextCoinAtMs = 0;
    this.mysteryBoxSpawnAtMs = 0;
    this.mysteryBoxLateSpawnAtMs = 0;
    this.mysteryBoxLateWaveDone = false;
    this.mysteryBoxActivePickupFromLate14k = false;
    this.mysteryBoxUsedThisRun = false;
    this.mysteryBoxPickupSpawnsThisRun = 0;
    this.mysteryBoxCollectedThisRun = false;
    if (this.mysteryBoxPickup) {
      this.worldGroup.remove(this.mysteryBoxPickup.mesh);
      this.mysteryBoxPickup = null;
    }
    this.mysteryScreenFlipUntil = 0;
    this.mysteryFlipImmunityUntil = 0;
    this.mysteryPostFlipImmunityUntil = 0;
    this.prevMysteryFlipActive = false;
    this.extraLifeSpawnAtMs = 0;
    this.extraLifePickupUsedThisRun = false;
    if (this.extraLifePickup) {
      this.worldGroup.remove(this.extraLifePickup.mesh);
      this.extraLifePickup = null;
    }
    this.mysteryDoorSpawnAtMs = 0;
    this.mysteryDoorWaveComplete = false;
    this.mysteryDoorPickupSpawnsThisRun = 0;
    this.mysteryDoorModeUntil = 0;
    this.mysteryDoorModeStartMs = 0;
    this.mysteryDoorSpikeFired = false;
    this.mysteryDoorPostImmunityUntil = 0;
    this.mysteryDoorEntryImmunityUntil = 0;
    if (this.mysteryDoorPickup) {
      this.worldGroup.remove(this.mysteryDoorPickup.mesh);
      this.mysteryDoorPickup = null;
    }
    document.body.classList.remove("rift-door-mode");
    this.prevPlayerWorldX = LANES[this.playerLane] * LANE_WIDTH;
    this.thiefRig.rotation.set(0, 0, 0);
    this.thiefRig.position.y = 0;
    this.vfxMirrorGlitchUntil = 0;
    this.vfxInvertWarpUntil = 0;
    this.vfxStumblePulseUntil = 0;
    this.nearMissFlashUntil = 0;
    this.lastStumbleUnderMirror = false;
    this.lastTrailX = LANES[this.playerLane] * LANE_WIDTH;

    for (const o of this.obstacles) this.worldGroup.remove(o.mesh);
    this.obstacles.length = 0;
    for (const c of this.chunks) this.worldGroup.remove(c.group);
    this.chunks.length = 0;
    this.nextObstacleAt = 26;
    this.laneFairnessBag.length = 0;
    this.seedWorld();
    this.applyVisualLayer(false);
  }

  private scheduleMirrorRealityCycle(fromTime: number): void {
    this.mirrorNextFireAt = fromTime + MIRROR_CYCLE_MS;
    this.mirrorWarningStartAt = this.mirrorNextFireAt - MIRROR_WARN_MS;
  }

  private announce(msg: string, ms = 2200): void {
    this.lastMirrorMessage = msg;
    this.mirrorAnnounceUntil = performance.now() + ms;
  }

  /** 0 = none, 0–1 = last-second telegraph (rises over the warning window). */
  getMirrorWarningProgress(): number {
    if (!this.running || this.gameOver || this.userPaused) return 0;
    const now = performance.now();
    if (now < this.mirrorWarningStartAt || now >= this.mirrorNextFireAt) return 0;
    return THREE.MathUtils.clamp((now - this.mirrorWarningStartAt) / MIRROR_WARN_MS, 0, 1);
  }

  /** Seconds until Mirror Reality fires; 0 outside the 1s warning window. */
  getMirrorSecondsRemaining(): number {
    if (!this.running || this.gameOver || this.userPaused) return 0;
    const now = performance.now();
    if (now < this.mirrorWarningStartAt || now >= this.mirrorNextFireAt) return 0;
    return Math.max(0, (this.mirrorNextFireAt - now) / 1000);
  }

  /** 0–1: mirror flip glitch transition (decaying). */
  getVfxMirrorGlitch(): number {
    if (!this.isRunning()) return 0;
    const now = performance.now();
    if (now >= this.vfxMirrorGlitchUntil) return 0;
    return THREE.MathUtils.clamp((this.vfxMirrorGlitchUntil - now) / 720, 0, 1);
  }

  /** 0–1: chromatic / danger pulse (mirror telegraph, stumble). */
  getVfxDangerChroma(): number {
    if (!this.isRunning()) return 0;
    const now = performance.now();
    const warn = this.getMirrorWarningProgress();
    const stumble =
      now < this.vfxStumblePulseUntil
        ? THREE.MathUtils.clamp((this.vfxStumblePulseUntil - now) / 400, 0, 1)
        : 0;
    const g = this.getVfxMirrorGlitch();
    return THREE.MathUtils.clamp(warn * 0.72 + stumble * 0.95 + g * 0.28, 0, 1);
  }

  /** 0–1: screen warp while horizontal invert “beds in”. */
  getVfxInvertWarp(): number {
    if (!this.isRunning()) return 0;
    const now = performance.now();
    if (now >= this.vfxInvertWarpUntil) return 0;
    return THREE.MathUtils.clamp((this.vfxInvertWarpUntil - now) / 920, 0, 1);
  }

  /** 0–1 flash after a tight near-miss (HUD / score pop). */
  getNearMissFlash(): number {
    if (!this.isRunning()) return 0;
    const now = performance.now();
    if (now >= this.nearMissFlashUntil) return 0;
    return THREE.MathUtils.clamp((this.nearMissFlashUntil - now) / 240, 0, 1);
  }

  private bumpMirrorCamera(kick: number): void {
    this.mirrorCamRoll += kick;
    this.mirrorCamRoll = THREE.MathUtils.clamp(this.mirrorCamRoll, -0.18, 0.18);
  }

  /** `controlHint` is prepended when full shift is bundled with a steer or jump/slide flip. */
  private applyFullMirrorShift(controlHint = ""): void {
    this.worldFlipX = !this.worldFlipX;
    this.worldGroup.scale.x = this.worldFlipX ? -1 : 1;

    this.mirrorLayer = !this.mirrorLayer;
    this.mirrorPhysicsFlip = !this.mirrorPhysicsFlip;
    this.applyVisualLayer(this.mirrorLayer);

    for (const o of this.obstacles) {
      if (o.lane === 0) continue;
      if (Math.random() < 0.48) {
        o.lane = (-o.lane) as (typeof LANES)[number];
        o.mesh.position.x = o.lane * LANE_WIDTH;
      }
    }

    this.bumpMirrorCamera(Math.random() < 0.5 ? 0.12 : -0.12);
    const core = this.mirrorLayer
      ? "FULL SHIFT: Mirror plane — track and hazards slipped"
      : "FULL SHIFT: Real plane stabilized";
    this.announce(controlHint ? `${controlHint} · ${core}` : core, 2800);
  }

  private executeMirrorReality(): void {
    this.lastMirrorProtocolAt = performance.now();
    this.vfxMirrorGlitchUntil = performance.now() + 720;
    document.body.classList.add("mirror-flash");
    window.setTimeout(() => document.body.classList.remove("mirror-flash"), 220);

    const pick = Math.floor(Math.random() * 3);
    if (pick === 0) {
      this.invertLR = !this.invertLR;
      this.vfxInvertWarpUntil = performance.now() + 920;
      this.bumpMirrorCamera(this.invertLR ? 0.04 : -0.035);
      this.announce(
        this.invertLR ? "HORIZONTAL INVERT: Steer mapping flipped" : "HORIZONTAL: Steer mapping restored",
        2400,
      );
    } else if (pick === 1) {
      this.swapJumpSlide = !this.swapJumpSlide;
      this.bumpMirrorCamera(this.swapJumpSlide ? -0.045 : 0.04);
      this.announce(
        this.swapJumpSlide ? "VERTICAL SWAP: Jump / Slide remapped" : "VERTICAL: Jump / Slide restored",
        2400,
      );
    } else {
      let hint = "";
      if (Math.random() < 0.5) {
        this.invertLR = !this.invertLR;
        this.vfxInvertWarpUntil = performance.now() + 920;
        this.bumpMirrorCamera(this.invertLR ? 0.04 : -0.035);
        hint = this.invertLR ? "Steer inverted" : "Steer restored";
      } else {
        this.swapJumpSlide = !this.swapJumpSlide;
        this.bumpMirrorCamera(this.swapJumpSlide ? -0.045 : 0.04);
        hint = this.swapJumpSlide ? "Jump / slide remapped" : "Jump / slide restored";
      }
      this.applyFullMirrorShift(hint);
    }

    this.mirrorProtocolImmunityUntil = performance.now() + MIRROR_PROTOCOL_IMMUNITY_MS;
    this.scheduleMirrorRealityCycle(performance.now());
  }

  private tickMirrorRealitySystem(now: number): void {
    if (now >= this.mirrorNextFireAt) {
      this.executeMirrorReality();
    }
  }

  private applyVisualLayer(mirror: boolean): void {
    const now = performance.now();
    if (this.mysteryDoorModeUntil > 0 && now < this.mysteryDoorModeUntil) {
      return;
    }

    document.body.classList.toggle("layer-mirror-city", mirror);

    const bg = mirror ? this.fogColorMirror : this.fogColorReal;
    this.scene.background = bg.clone();
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(bg);
      this.scene.fog.near = mirror ? 18 : 24;
      this.scene.fog.far = mirror ? 72 : 92;
    }
    const primary = mirror ? 0xff2aa1 : 0x00e8ff;
    const glassEm = mirror ? 0x401830 : 0x002838;

    this.ambient.intensity = mirror ? 0.58 : 0.46;
    this.dirLight.intensity = mirror ? 0.95 : 1.05;
    this.fillLight.intensity = mirror ? 0.52 : 0.32;

    this.worldGroup.traverse((obj) => {
      if (obj instanceof THREE.Group && obj.userData.towerCluster) {
        const tc = obj.userData.towerCluster as { base: number; d: number };
        obj.position.x = mirror ? tc.base + tc.d : tc.base;
      }
      if (!(obj instanceof THREE.Mesh) || Array.isArray(obj.material)) return;
      const mat = obj.material;
      if (obj.userData.neon && mat instanceof THREE.MeshStandardMaterial) {
        mat.emissive.setHex(primary);
        mat.color.setHex(mirror ? 0x1a0a18 : 0x0a1220);
      }
      if (obj.userData.cityGlass && mat instanceof THREE.MeshPhysicalMaterial) {
        mat.emissive.setHex(glassEm);
        mat.emissiveIntensity = mirror ? 0.35 : 0.12;
        mat.roughness = mirror ? 0.14 : 0.07;
        mat.metalness = mirror ? 0.35 : 0.22;
        mat.envMapIntensity = mirror ? 0.75 : 1.15;
      }
      if (obj.userData.groundWet && mat instanceof THREE.MeshPhysicalMaterial) {
        mat.roughness = mirror ? 0.05 : 0.12;
        mat.metalness = mirror ? 0.97 : 0.9;
        mat.clearcoatRoughness = mirror ? 0.04 : 0.09;
      }
      if (obj.userData.holoAd && mat instanceof THREE.MeshStandardMaterial) {
        mat.opacity = mirror ? 0.88 : 0.52;
        mat.emissiveIntensity = mirror ? 1.35 : 0.72;
        mat.depthWrite = !mirror;
      }
    });
    this.dirLight.color.setHex(mirror ? 0xff9de0 : 0xa8f0ff);
    this.fillLight.color.setHex(mirror ? 0x66fff8 : 0xff66c4);
    this.dirLight.position.set(mirror ? -6 : 4, 18, mirror ? -4 : 6);
    this.fillLight.position.set(mirror ? 8 : -10, 6, mirror ? 4 : -4);
  }

  private buildPlayer(): void {
    const suit = new THREE.MeshStandardMaterial({
      color: 0x06080e,
      metalness: 0.88,
      roughness: 0.3,
      emissive: 0x020306,
      emissiveIntensity: 0.12,
    });
    const suitSoft = suit.clone();
    suitSoft.roughness = 0.42;
    suitSoft.metalness = 0.65;

    const trimCyan = new THREE.MeshStandardMaterial({
      color: 0x001018,
      emissive: 0x00c8dc,
      emissiveIntensity: 0.9,
      metalness: 0.55,
      roughness: 0.28,
    });
    const trimViolet = new THREE.MeshStandardMaterial({
      color: 0x100818,
      emissive: 0x9b30ff,
      emissiveIntensity: 0.55,
      metalness: 0.5,
      roughness: 0.32,
    });

    this.thiefRig.name = "ThiefRig";

    const pelvis = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.18, 0.17),
      suit,
    );
    pelvis.position.set(0, 0.44, 0);
    pelvis.castShadow = true;
    this.thiefRig.add(pelvis);

    const chest = new THREE.Mesh(
      new THREE.BoxGeometry(0.33, 0.4, 0.17),
      suit,
    );
    chest.position.set(0, 0.12, 0);
    chest.castShadow = true;
    this.thiefTorso.add(chest);

    const spineStrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.36, 0.03),
      trimCyan,
    );
    spineStrip.position.set(0, 0.12, -0.1);
    this.thiefTorso.add(spineStrip);

    const ribLineL = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.02, 0.02),
      trimCyan,
    );
    ribLineL.position.set(-0.1, 0.22, 0.09);
    const ribLineR = ribLineL.clone();
    ribLineR.position.x = 0.1;
    this.thiefTorso.add(ribLineL, ribLineR);

    this.thiefTorso.position.set(0, 0.74, 0);
    this.thiefRig.add(this.thiefTorso);

    const thighGeo = new THREE.BoxGeometry(0.13, 0.22, 0.12);
    const thighL = new THREE.Mesh(thighGeo, suit);
    thighL.position.set(-0.1, 0.28, 0);
    thighL.castShadow = true;
    const thighR = new THREE.Mesh(thighGeo, suit);
    thighR.position.set(0.1, 0.28, 0);
    thighR.castShadow = true;
    const calfGeo = new THREE.BoxGeometry(0.1, 0.22, 0.1);
    const calfL = new THREE.Mesh(calfGeo, suitSoft);
    calfL.position.set(-0.1, 0.1, 0.02);
    calfL.castShadow = true;
    const calfR = new THREE.Mesh(calfGeo, suitSoft);
    calfR.position.set(0.1, 0.1, 0.02);
    calfR.castShadow = true;
    this.thiefLegs.add(thighL, thighR, calfL, calfR);
    this.thiefLegs.position.set(0, 0.36, 0);
    this.thiefRig.add(this.thiefLegs);

    const upperArmGeo = new THREE.CylinderGeometry(0.055, 0.05, 0.28, 8);
    const upperArmL = new THREE.Mesh(upperArmGeo, suit);
    upperArmL.rotation.z = Math.PI / 2;
    upperArmL.rotation.x = -0.35;
    upperArmL.position.set(-0.22, 0.62, 0.06);
    upperArmL.castShadow = true;
    const upperArmR = new THREE.Mesh(upperArmGeo, suit);
    upperArmR.rotation.z = Math.PI / 2;
    upperArmR.rotation.x = -0.25;
    upperArmR.rotation.y = -0.12;
    upperArmR.position.set(0.2, 0.6, 0.05);
    upperArmR.castShadow = true;
    const foreGeo = new THREE.CylinderGeometry(0.045, 0.04, 0.26, 8);
    const foreL = new THREE.Mesh(foreGeo, suitSoft);
    foreL.rotation.z = Math.PI / 2;
    foreL.rotation.x = -0.55;
    foreL.position.set(-0.32, 0.48, 0.12);
    foreL.castShadow = true;
    const foreR = new THREE.Mesh(foreGeo, suitSoft);
    foreR.rotation.z = Math.PI / 2;
    foreR.rotation.x = -0.45;
    foreR.position.set(0.34, 0.5, 0.1);
    foreR.castShadow = true;
    this.thiefArms.add(upperArmL, upperArmR, foreL, foreR);
    this.thiefRig.add(this.thiefArms);

    const hoodGeo = new THREE.SphereGeometry(0.29, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.48);
    const hoodMat = suit.clone();
    hoodMat.side = THREE.DoubleSide;
    const hoodMesh = new THREE.Mesh(hoodGeo, hoodMat);
    hoodMesh.position.set(0, 0.18, -0.06);
    hoodMesh.rotation.x = -0.22;
    hoodMesh.castShadow = true;
    this.thiefHead.add(hoodMesh);

    const maskMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.11, 0.14),
      suit,
    );
    maskMesh.position.set(0, -0.02, 0.16);
    maskMesh.castShadow = true;
    this.thiefHead.add(maskMesh);

    const eyeSlitL = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.02, 0.02),
      trimCyan,
    );
    eyeSlitL.position.set(-0.07, -0.02, 0.22);
    const eyeSlitR = eyeSlitL.clone();
    eyeSlitR.position.x = 0.07;
    this.thiefHead.add(eyeSlitL, eyeSlitR);

    this.thiefVisorMat = new THREE.MeshStandardMaterial({
      color: 0x02060a,
      emissive: 0x00e0f0,
      emissiveIntensity: 0.72,
      metalness: 0.92,
      roughness: 0.12,
      transparent: true,
      opacity: 0.92,
    });
    this.thiefVisor = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.048, 0.22),
      this.thiefVisorMat,
    );
    this.thiefVisor.position.set(0, 0.06, 0.14);
    this.thiefHead.add(this.thiefVisor);

    const hudMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0x00fff6,
      emissiveIntensity: 0.55,
      metalness: 0.4,
      roughness: 0.35,
    });
    const hudBar1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.008, 0.01), hudMat);
    hudBar1.position.set(-0.06, 0.02, 0.12);
    const hudBar2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.008, 0.01), hudMat);
    hudBar2.position.set(0.08, -0.01, 0.12);
    const hudBracket = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.01), trimViolet);
    hudBracket.position.set(0.14, 0.01, 0.11);
    this.thiefHud.add(hudBar1, hudBar2, hudBracket);
    this.thiefHead.add(this.thiefHud);

    this.thiefHead.position.set(0, 1.22, 0);
    this.thiefRig.add(this.thiefHead);

    const packCore = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.32, 0.12),
      suit,
    );
    packCore.position.set(0, 0, 0);
    packCore.castShadow = true;
    const packStrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.28, 0.02),
      trimViolet,
    );
    packStrip.position.set(0.1, 0, 0.07);
    const packCyan = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.02, 0.02),
      trimCyan,
    );
    packCyan.position.set(0, 0.12, 0.07);
    const packGroup = new THREE.Group();
    packGroup.add(packCore, packStrip, packCyan);
    packGroup.position.set(0, 0.82, -0.2);
    packGroup.rotation.x = 0.08;
    this.thiefRig.add(packGroup);

    const grappleGroup = new THREE.Group();
    grappleGroup.position.set(0.16, 0.42, 0.06);
    const coil = new THREE.Mesh(
      new THREE.TorusGeometry(0.055, 0.018, 8, 16, Math.PI * 1.35),
      suitSoft,
    );
    coil.rotation.x = Math.PI / 2;
    const hook = new THREE.Mesh(
      new THREE.ConeGeometry(0.035, 0.1, 6),
      trimCyan,
    );
    hook.rotation.x = Math.PI / 2 + 0.4;
    hook.position.set(0.06, -0.06, 0.04);
    grappleGroup.add(coil, hook);
    this.thiefRig.add(grappleGroup);

    const holoMat = new THREE.MeshStandardMaterial({
      color: 0x0a0618,
      emissive: 0xa020ff,
      emissiveIntensity: 0.45,
      metalness: 0.3,
      roughness: 0.25,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });
    this.thiefHolo = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), holoMat);
    this.thiefHolo.position.set(0.36, 0.58, 0.1);
    this.thiefRig.add(this.thiefHolo);

    const belt = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.05, 0.16),
      suit,
    );
    belt.position.set(0, 0.52, 0);
    belt.castShadow = true;
    this.thiefRig.add(belt);

    this.player.add(this.thiefRig);

    const trailGroup = new THREE.Group();
    trailGroup.name = "ReflectionTrail";
    for (let i = 0; i < 14; i++) {
      const geo = new THREE.PlaneGeometry(0.92, 0.62);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00fff6,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const plate = new THREE.Mesh(geo, mat);
      plate.rotation.x = -Math.PI / 2;
      plate.position.set(0, 0.016, -0.06 - i * 0.14);
      plate.renderOrder = -4;
      trailGroup.add(plate);
      this.trailPlates.push(plate);
    }
    this.player.add(trailGroup);

    this.player.position.set(0, 0, PLAYER_Z);
    this.scene.add(this.player);
  }

  private updateThiefAvatar(dt: number): void {
    const sim =
      this.running && !this.gameOver && performance.now() >= this.lifeLostFreezeUntil;
    const px = this.player.position.x;
    const lateralVel = sim ? (px - this.prevPlayerWorldX) / Math.max(dt, 1e-4) : 0;
    this.prevPlayerWorldX = px;

    const speedN = THREE.MathUtils.clamp((this.velocityZ - 10) / 29, 0, 1);
    const laneSlide = sim
      ? THREE.MathUtils.clamp(
          Math.abs(px - this.lastTrailX) / (LANE_WIDTH * 0.45) + Math.min(1.2, Math.abs(lateralVel) * 0.03),
          0,
          1.65,
        )
      : 0;
    this.lastTrailX = px;
    const timeBase = sim ? this.aliveTime : performance.now() * 0.0025;
    for (let i = 0; i < this.trailPlates.length; i++) {
      const m = this.trailPlates[i];
      const mat = m.material as THREE.MeshBasicMaterial;
      const wave = Math.sin(timeBase * 11 + i * 0.55) * 0.5 + 0.5;
      let targetOp = sim
        ? wave * (0.035 + speedN * 0.28) * (1 - i * 0.045) + laneSlide * (0.14 - i * 0.006)
        : 0;
      targetOp = THREE.MathUtils.clamp(targetOp, 0, 0.62);
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOp, Math.min(1, dt * 16));
      mat.color.setHex(i % 2 === 0 ? 0x00fff4 : 0xff4ad8);
      m.position.x = Math.sin(timeBase * 5 + i * 0.65) * 0.05 * speedN;
      m.position.z = -0.05 - i * 0.135;
      const sc = 0.82 + speedN * 0.28 - i * 0.018 + laneSlide * 0.12;
      m.scale.set(sc, sc, 1);
    }

    const sprintLean = THREE.MathUtils.lerp(0.11, 0.24, speedN);

    let targetRx = sprintLean;
    if (this.sliding) targetRx += 0.18;
    if (this.jumping) {
      const h = THREE.MathUtils.clamp(this.playerY / 1.12, 0, 1);
      targetRx += Math.sin(h * Math.PI) * 0.14;
    }

    const targetRz = THREE.MathUtils.clamp(-lateralVel * 0.0042, -0.085, 0.085);

    if (this.isJetpackFlying()) {
      targetRx += 0.38;
    }

    this.thiefRig.rotation.x = THREE.MathUtils.lerp(this.thiefRig.rotation.x, targetRx, Math.min(1, dt * 11));
    this.thiefRig.rotation.z = THREE.MathUtils.lerp(this.thiefRig.rotation.z, targetRz, Math.min(1, dt * 9));

    const gait = sim ? Math.sin(this.aliveTime * 13.5) : Math.sin(performance.now() * 0.0035);
    const bobAmp = sim ? 0.035 * speedN : 0.012;
    this.thiefRig.position.y = gait * bobAmp;

    const tuck = this.sliding ? 1 : 0;
    this.thiefTorso.scale.set(
      THREE.MathUtils.lerp(1, 0.94, tuck),
      THREE.MathUtils.lerp(1, 0.64, tuck),
      THREE.MathUtils.lerp(1, 0.92, tuck),
    );
    this.thiefTorso.position.y = THREE.MathUtils.lerp(0.74, 0.56, tuck);

    this.thiefHead.position.y = THREE.MathUtils.lerp(1.22, 0.92, tuck);

    const legDrive = sim ? 0.05 + speedN * 0.09 : 0.06;
    this.thiefLegs.rotation.x = THREE.MathUtils.lerp(legDrive, 0.2, tuck);

    const swing = sim ? Math.sin(this.aliveTime * 14) * 0.065 : 0;
    this.thiefArms.rotation.x = swing + tuck * 0.12;

    const pulseT = sim ? this.aliveTime : performance.now() * 0.002;
    const holoMat = this.thiefHolo.material as THREE.MeshStandardMaterial;
    holoMat.emissiveIntensity = 0.38 + 0.32 * Math.sin(pulseT * 6.8);

    this.thiefVisorMat.emissiveIntensity = 0.62 + 0.07 * Math.sin(pulseT * 2.1);
    this.thiefHud.rotation.y = Math.sin(pulseT * 2.8) * 0.035;
    this.thiefHolo.rotation.y += dt * 1.15;
    this.thiefHolo.rotation.x = Math.sin(pulseT * 4) * 0.12;
  }

  /** Glass + neon stack; `towerCluster` shifts slightly in mirror layer. */
  private addGlassSkyscraper(
    parent: THREE.Group,
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    seed: number,
  ): void {
    const tower = new THREE.Group();
    tower.position.set(x, 0, z);
    const distort = ((seed % 17) / 17 - 0.5) * 0.55;
    tower.userData.towerCluster = { base: x, d: distort };

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x081420,
      metalness: 0.22,
      roughness: 0.06,
      envMapIntensity: 1.2,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      transmission: 0.06,
      thickness: 0.35,
      transparent: true,
      opacity: 0.96,
      emissive: 0x001828,
      emissiveIntensity: 0.1,
    });

    const core = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glassMat);
    core.position.y = h * 0.5;
    core.castShadow = true;
    core.receiveShadow = true;
    core.userData.cityGlass = true;
    tower.add(core);

    const stripCount = 3 + (seed % 4);
    for (let i = 0; i < stripCount; i++) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.02, 0.04, d * 1.02),
        new THREE.MeshStandardMaterial({
          color: 0x000810,
          emissive: 0x00d8ff,
          emissiveIntensity: 0.55,
          metalness: 0.6,
          roughness: 0.25,
        }),
      );
      strip.position.y = 1.2 + (i / stripCount) * (h - 2);
      strip.userData.neon = true;
      tower.add(strip);
    }

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w * 1.08, 0.18, d * 1.08),
      new THREE.MeshStandardMaterial({
        color: 0x050a10,
        emissive: 0x00fff6,
        emissiveIntensity: 0.35,
        metalness: 0.75,
        roughness: 0.35,
      }),
    );
    roof.position.y = h + 0.09;
    roof.userData.neon = true;
    tower.add(roof);

    parent.add(tower);
  }

  private addHoloBillboard(parent: THREE.Group, side: -1 | 1, z: number, seed: number): void {
    const w = 1.8 + (seed % 5) * 0.15;
    const h = 1.1 + (seed % 4) * 0.12;
    const geo = new THREE.PlaneGeometry(w, h);
    const hue = seed % 3;
    const em = hue === 0 ? 0x00ffee : hue === 1 ? 0xff00aa : 0xaa66ff;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: em,
      emissiveIntensity: 0.78,
      metalness: 0.2,
      roughness: 0.35,
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
      depthWrite: true,
    });
    const board = new THREE.Mesh(geo, mat);
    const x = side * (LANE_WIDTH * 2.85 + w * 0.5);
    board.position.set(x, 1.35 + (seed % 7) * 0.08, z);
    board.rotation.y = side < 0 ? Math.PI * 0.15 : -Math.PI * 0.15;
    board.userData.holoAd = true;
    parent.add(board);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.04),
      new THREE.MeshStandardMaterial({
        color: 0x020208,
        emissive: 0x446688,
        emissiveIntensity: 0.25,
        metalness: 0.85,
        roughness: 0.2,
      }),
    );
    frame.position.copy(board.position);
    frame.rotation.copy(board.rotation);
    frame.translateZ(-0.03 * side);
    parent.add(frame);
  }

  private addNeonSign(parent: THREE.Group, x: number, z: number, w: number, seed: number): void {
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.28, 0.06),
      new THREE.MeshStandardMaterial({
        color: 0x020308,
        emissive: seed % 2 ? 0xff0088 : 0x00ffcc,
        emissiveIntensity: 0.95,
        metalness: 0.5,
        roughness: 0.28,
      }),
    );
    back.position.set(x, 2.4 + (seed % 5) * 0.15, z);
    back.rotation.y = x < 0 ? 0.12 : -0.12;
    back.userData.neon = true;
    parent.add(back);
  }

  private createChunk(zCenter: number): RoadChunk {
    const group = new THREE.Group();
    group.position.z = zCenter;
    const seed = (Math.abs(Math.floor(zCenter * 7919)) % 100003) + 7;

    const wetRoad = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH * 3.65, 0.34, CHUNK_LENGTH),
      new THREE.MeshPhysicalMaterial({
        color: 0x030406,
        metalness: 0.9,
        roughness: 0.11,
        clearcoat: 1,
        clearcoatRoughness: 0.07,
        emissive: 0x020306,
        emissiveIntensity: 0.06,
      }),
    );
    wetRoad.receiveShadow = true;
    wetRoad.position.y = -0.19;
    wetRoad.userData.groundWet = true;
    group.add(wetRoad);

    const puddle = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE_WIDTH * 3.25, CHUNK_LENGTH * 0.92),
      new THREE.MeshPhysicalMaterial({
        color: 0x000000,
        metalness: 1,
        roughness: 0.04,
        transparent: true,
        opacity: 0.28,
        emissive: 0x001018,
        emissiveIntensity: 0.2,
      }),
    );
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.y = 0.008;
    puddle.userData.groundWet = true;
    group.add(puddle);

    const grid = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE_WIDTH * 3.15, CHUNK_LENGTH * 0.96, 1, 1),
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.18,
        emissive: 0x00ffff,
        emissiveIntensity: 0.42,
      }),
    );
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = 0.014;
    grid.userData.trackNeonGrid = true;
    group.add(grid);

    for (const lane of LANES) {
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.022, CHUNK_LENGTH * 0.99),
        new THREE.MeshStandardMaterial({
          emissive: 0x00fff6,
          emissiveIntensity: 1.05,
          color: 0x000810,
        }),
      );
      line.position.set(lane * LANE_WIDTH, 0.022, 0);
      line.userData.neon = true;
      group.add(line);
    }

    const sideZ = CHUNK_LENGTH * 0.42;
    this.addGlassSkyscraper(
      group,
      -LANE_WIDTH * 2.25,
      -sideZ * 0.25,
      1.15 + (seed % 5) * 0.08,
      1.0 + (seed % 4) * 0.1,
      9 + (seed % 11),
      seed,
    );
    this.addGlassSkyscraper(
      group,
      LANE_WIDTH * 2.28,
      sideZ * 0.18,
      1.35 + (seed % 6) * 0.1,
      1.15,
      11 + ((seed * 3) % 13),
      seed + 1,
    );
    this.addGlassSkyscraper(
      group,
      -LANE_WIDTH * 2.55,
      sideZ * 0.42,
      0.85,
      0.75,
      6 + (seed % 8),
      seed + 3,
    );
    this.addGlassSkyscraper(
      group,
      LANE_WIDTH * 2.5,
      -sideZ * 0.38,
      1.0,
      0.9,
      8 + ((seed * 7) % 9),
      seed + 5,
    );

    this.addHoloBillboard(group, -1, -CHUNK_LENGTH * 0.25, seed);
    this.addHoloBillboard(group, 1, CHUNK_LENGTH * 0.22, seed + 2);
    if (seed % 3 === 0) {
      this.addHoloBillboard(group, -1, CHUNK_LENGTH * 0.08, seed + 9);
    }

    this.addNeonSign(group, -LANE_WIDTH * 2.4, -sideZ * 0.12, 1.6, seed);
    this.addNeonSign(group, LANE_WIDTH * 2.35, sideZ * 0.28, 1.4, seed + 4);

    this.worldGroup.add(group);
    return { group, zCenter };
  }

  private seedWorld(): void {
    let z = -CHUNK_LENGTH;
    for (let i = 0; i < 10; i++) {
      this.chunks.push(this.createChunk(z));
      z -= CHUNK_LENGTH;
    }
  }

  private ensureChunks(): void {
    const front = this.chunks[this.chunks.length - 1]?.zCenter ?? 0;
    if (front > -this.distance - SPAWN_AHEAD) {
      const z = front - CHUNK_LENGTH;
      this.chunks.push(this.createChunk(z));
    }
    while (
      this.chunks.length &&
      this.chunks[0].zCenter > -this.distance + DESPAWN_BEHIND
    ) {
      const c = this.chunks.shift()!;
      this.worldGroup.remove(c.group);
    }
  }

  /** Next spawn lane: each of −1/0/1 appears equally often across a bag cycle. */
  private takeFairSpawnLane(): (typeof LANES)[number] {
    if (this.laneFairnessBag.length === 0) {
      const bag: (typeof LANES)[number][] = [...LANES, ...LANES, ...LANES];
      shuffleInPlace(bag);
      this.laneFairnessBag = bag;
    }
    return this.laneFairnessBag.pop()!;
  }

  /** When a spawn is forced onto `lane`, drop one matching entry so totals stay balanced. */
  private consumeLaneFromFairnessBag(lane: (typeof LANES)[number]): void {
    const idx = this.laneFairnessBag.indexOf(lane);
    if (idx !== -1) this.laneFairnessBag.splice(idx, 1);
  }

  /** Smallest |obstacle.z − pickupZ| in the same lane (large = open stretch at that Z). */
  private minObstacleZGapForLane(lane: (typeof LANES)[number], pickupZ: number): number {
    let minAbs = 1e9;
    for (const o of this.obstacles) {
      if (o.lane !== lane) continue;
      const dz = Math.abs(o.z - pickupZ);
      if (dz < minAbs) minAbs = dz;
    }
    return minAbs > 1e8 ? 999 : minAbs;
  }

  /**
   * Picks the clearest lane at `pickupZ` (tie → preferred index). If every lane is tight on Z,
   * nudges the spawn farther ahead and retries so pickups are not parked behind obstacles.
   */
  private resolvePickupLaneAndZ(
    preferredLaneIdx: 0 | 1 | 2,
    pickupZ: number,
  ): { lane: (typeof LANES)[number]; z: number } {
    let z = pickupZ;
    for (let nudge = 0; nudge < 4; nudge++) {
      let bestIdx: 0 | 1 | 2 = preferredLaneIdx;
      let bestScore = -1;
      for (let idx = 0; idx < 3; idx++) {
        const lane = LANES[idx]!;
        const gap = this.minObstacleZGapForLane(lane, z);
        const bias = idx === preferredLaneIdx ? 0.25 : 0;
        const score = gap + bias;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = idx as 0 | 1 | 2;
        }
      }
      const clearest = this.minObstacleZGapForLane(LANES[bestIdx]!, z);
      if (clearest >= PICKUP_MIN_Z_CLEARANCE || nudge === 3) {
        return { lane: LANES[bestIdx]!, z };
      }
      z -= PICKUP_Z_NUDGE;
    }
    return { lane: LANES[preferredLaneIdx]!, z: pickupZ };
  }

  private spawnObstacle(): void {
    const z = -SPAWN_AHEAD - this.distance;
    const dNew = this.distance;
    const roll = Math.random();
    let kind: ObstacleKind;
    if (roll < 0.38) kind = "block";
    else if (roll < 0.69) kind = "low";
    else kind = "high";

    const blockLanesInCluster = new Set<0 | 1 | 2>();
    for (const o of this.obstacles) {
      if (o.kind !== "block") continue;
      const dO = -o.z - SPAWN_AHEAD;
      if (Math.abs(dO - dNew) > BLOCK_CLUSTER_D) continue;
      blockLanesInCluster.add(laneToGridIndex(o.lane));
    }

    let lanePick = this.takeFairSpawnLane();
    if (kind === "block" && blockLanesInCluster.size === 2) {
      const free = ([0, 1, 2] as const).find((i) => !blockLanesInCluster.has(i))!;
      const must = gridIndexToLane(free);
      if (lanePick !== must) {
        const ins = Math.floor(Math.random() * (this.laneFairnessBag.length + 1));
        this.laneFairnessBag.splice(ins, 0, lanePick);
        lanePick = must;
        this.consumeLaneFromFairnessBag(must);
      }
    }

    if (kind === "block") {
      if (blockLanesInCluster.size >= 3) {
        kind = Math.random() < 0.55 ? "low" : "high";
      }
    }

    const group = new THREE.Group();
    group.position.z = z;

    if (kind === "block") {
      const core = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, BLOCK_HEIGHT, 1.1),
        new THREE.MeshStandardMaterial({
          color: 0x120818,
          emissive: 0xff0066,
          emissiveIntensity: 0.95,
          metalness: 0.4,
          roughness: 0.35,
        }),
      );
      core.position.y = BLOCK_HEIGHT * 0.5;
      core.castShadow = true;
      group.add(core);
    } else if (kind === "low") {
      const ramp = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.45, 1.4),
        new THREE.MeshStandardMaterial({
          color: 0x061018,
          emissive: 0x00ffcc,
          emissiveIntensity: 0.88,
        }),
      );
      ramp.position.y = 0.25;
      ramp.castShadow = true;
      group.add(ramp);
    } else {
      const beamCy = HIGH_BAR_CLEARANCE + 0.07 + HIGH_BEAM_HEIGHT * 0.5;
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, HIGH_BEAM_HEIGHT, 0.6),
        new THREE.MeshStandardMaterial({
          color: 0x10061a,
          emissive: 0xaa66ff,
          emissiveIntensity: 0.92,
        }),
      );
      beam.position.y = beamCy;
      beam.castShadow = true;
      group.add(beam);
      const postL = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.1, HIGH_POST_HEIGHT, 8),
        new THREE.MeshStandardMaterial({ color: 0x0a0a12, metalness: 0.8, roughness: 0.3 }),
      );
      postL.position.set(-1.15, HIGH_POST_HEIGHT * 0.5, 0);
      const postR = postL.clone();
      postR.position.x = 1.15;
      group.add(postL, postR);
    }

    group.position.x = lanePick * LANE_WIDTH;
    this.worldGroup.add(group);
    this.obstacles.push({ mesh: group, lane: lanePick, z, kind, hit: false, nearEvaluated: false });
  }

  /** Twin vertical tanks, cyan tips, stepped nozzles, red flames — cartoon icon style. */
  private buildCartoonJetpackPickupMesh(): THREE.Group {
    const root = new THREE.Group();

    const grey = new THREE.MeshStandardMaterial({
      color: 0xc8ced8,
      metalness: 0.08,
      roughness: 0.82,
    });
    const nozzleGrey = new THREE.MeshStandardMaterial({
      color: 0x9aa0aa,
      metalness: 0.15,
      roughness: 0.72,
    });
    const cyan = new THREE.MeshStandardMaterial({
      color: 0x1ee8f5,
      emissive: 0x0a8090,
      emissiveIntensity: 0.5,
      metalness: 0.2,
      roughness: 0.42,
    });
    const bracketMat = new THREE.MeshStandardMaterial({
      color: 0x3a404a,
      metalness: 0.35,
      roughness: 0.58,
    });
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xff3344,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const flameCoreMat = new THREE.MeshBasicMaterial({
      color: 0xffcc66,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const capR = 0.086;
    const capLen = 0.32;
    const cy = 0.26;
    const totalH = capLen + 2 * capR;

    const addTank = (side: -1 | 1) => {
      const x0 = side * 0.148;

      const tank = new THREE.Mesh(new THREE.CapsuleGeometry(capR, capLen, 4, 12), grey);
      tank.position.set(x0, cy, 0);
      tank.castShadow = true;
      root.add(tank);

      const topY = cy + totalH * 0.5;
      const tipH = 0.078;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(capR * 1.02, tipH, 10), cyan);
      tip.position.set(x0, topY + tipH * 0.5 - 0.008, 0);
      root.add(tip);

      const bottomY = cy - totalH * 0.5;
      const steps: [number, number][] = [
        [0.082, 0.038],
        [0.064, 0.034],
        [0.048, 0.03],
      ];
      let y = bottomY - steps[0]![1] * 0.5;
      for (const [rad, h] of steps) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, h, 12), nozzleGrey);
        ring.position.set(x0, y - h * 0.5, 0);
        ring.castShadow = true;
        root.add(ring);
        y -= h;
      }

      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.14, 8, 1, true), flameMat);
      flame.rotation.x = Math.PI;
      flame.position.set(x0, y - 0.09, 0);
      root.add(flame);

      const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 6, 1, true), flameCoreMat);
      flameCore.rotation.x = Math.PI;
      flameCore.position.set(x0, y - 0.085, 0.01);
      root.add(flameCore);

      const semi = new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.026, 8, 16, Math.PI), bracketMat);
      semi.position.set(x0 + side * 0.108, cy, 0);
      semi.rotation.set(0, Math.PI / 2, side * 0.15);
      root.add(semi);
    };

    addTank(-1);
    addTank(1);

    root.userData.flameMeshes = root.children.filter((c: THREE.Object3D) => {
      const m = c as THREE.Mesh;
      return m.material === flameMat || m.material === flameCoreMat;
    }) as THREE.Mesh[];
    root.userData.flameMat = flameMat;
    root.userData.flameCoreMat = flameCoreMat;

    return root;
  }

  private spawnJetpackPickup(fromLateScoreGate = false): void {
    const v = THREE.MathUtils.clamp(this.velocityZ, 16, 52);
    const leadZ = JETPACK_PICKUP_Z_OFFSET + v * JETPACK_PICKUP_LEAD_TIME_S;
    const pickupZ = -leadZ - this.distance;
    const prefIdx =
      this.jetpackPickupSpawnsThisRun >= 1
        ? (THREE.MathUtils.clamp(this.targetLane, 0, 2) as 0 | 1 | 2)
        : (Math.floor(Math.random() * 3) as 0 | 1 | 2);
    const { lane, z } = this.resolvePickupLaneAndZ(prefIdx, pickupZ);
    const g = this.buildCartoonJetpackPickupMesh();
    g.scale.setScalar(1.42);
    const bobBaseY = 1.34;
    g.position.set(lane * LANE_WIDTH, bobBaseY, z);

    g.userData.jetpackPickup = true;
    g.userData.bobBaseY = bobBaseY;
    g.userData.phase = Math.random() * Math.PI * 2;

    this.worldGroup.add(g);
    this.jetpackPickup = { mesh: g, lane, z };
    this.jetpackPickupSpawnsThisRun += 1;
    if (fromLateScoreGate) this.jetpackPendingLateResolve = true;
    const n = this.jetpackPickupSpawnsThisRun;
    this.announce(
      fromLateScoreGate
        ? "JETPACK — 12k+ bonus · drive through it"
        : n >= 2
          ? "JETPACK — second chance · drive through it"
          : "JETPACK READY — drive through it",
      fromLateScoreGate ? 2800 : 2400,
    );
  }

  private checkJetpackPickup(): void {
    if (!this.jetpackPickup || this.isJetpackFlying()) return;
    this.worldGroup.updateMatrixWorld(true);
    this.jetpackPickup.mesh.getWorldPosition(this.owp);
    const oz = this.owp.z;
    const ox = this.owp.x;
    if (Math.abs(oz - PLAYER_Z) > 1.55) return;
    if (Math.abs(ox - this.player.position.x) > 1.42) return;
    this.worldGroup.remove(this.jetpackPickup.mesh);
    this.jetpackPickup = null;
    this.jetpackEnteredFlightThisRun = true;
    const now = performance.now();
    this.jetpackFlyingUntil = now + JETPACK_FLY_DURATION_MS;
    this.jetpackNextCoinAtMs = now + 120;
    this.announce("JETPACK LIVE — 5s · lane into coins", 2200);
  }

  private updateJetpackPickupDespawn(now: number): void {
    if (!this.jetpackPickup || this.isJetpackFlying()) return;
    this.jetpackPickup.mesh.getWorldPosition(this.owp);
    const wz = this.owp.z;
    if (wz > DESPAWN_BEHIND + 12) {
      this.worldGroup.remove(this.jetpackPickup.mesh);
      this.jetpackPickup = null;
      if (this.jetpackPendingLateResolve) {
        this.jetpackPendingLateResolve = false;
        this.jetpackLateWaveDone = true;
      }
      if (this.jetpackEnteredFlightThisRun || this.jetpackPickupSpawnsThisRun >= 2) {
        this.jetpackUsedThisRun = true;
      }
    }
  }

  private spawnMysteryBoxPickup(fromLate14k = false): void {
    this.mysteryBoxActivePickupFromLate14k = fromLate14k;
    /** After the first random spawn, place the box in the lane the player is steering toward so it stays in their path. */
    const laneTowardPlayer = this.mysteryBoxPickupSpawnsThisRun >= 1;
    const laneIdx = laneTowardPlayer
      ? (THREE.MathUtils.clamp(this.targetLane, 0, 2) as 0 | 1 | 2)
      : ((Math.floor(Math.random() * 3) as 0 | 1 | 2));
    const pickupZ = -MYSTERY_BOX_PICKUP_Z_OFFSET - this.distance;
    const { lane, z } = this.resolvePickupLaneAndZ(laneIdx, pickupZ);
    const g = new THREE.Group();
    g.scale.setScalar(1.22);
    const bobY = 1.24;
    g.position.set(lane * LANE_WIDTH, bobY, z);

    const qTex = createMysteryQuestionTexture();
    const sideMat = new THREE.MeshStandardMaterial({
      color: 0x3d1a6e,
      emissive: 0x220844,
      emissiveIntensity: 0.52,
      metalness: 0.55,
      roughness: 0.38,
    });
    const faceMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: qTex,
      metalness: 0.25,
      roughness: 0.35,
      emissive: 0xaa66ff,
      emissiveIntensity: 0.26,
      emissiveMap: qTex,
    });
    const mats: THREE.MeshStandardMaterial[] = [
      sideMat,
      sideMat,
      sideMat,
      sideMat,
      faceMat,
      sideMat,
    ];
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), mats);
    box.castShadow = true;
    g.add(box);

    g.userData.mysteryBoxPickup = true;
    g.userData.bobY = bobY;
    g.userData.phase = Math.random() * Math.PI * 2;
    g.userData.questionTex = qTex;

    this.worldGroup.add(g);
    this.mysteryBoxPickup = { mesh: g, lane, z, spawnedAtMs: performance.now() };
    this.mysteryBoxPickupSpawnsThisRun += 1;
    const n = this.mysteryBoxPickupSpawnsThisRun;
    const msg = fromLate14k
      ? "MYSTERY BOX — 14k+ encore · drive through if you dare"
      : n >= 4
        ? "MYSTERY BOX — another chance · grab the flip"
        : n >= 3
          ? "MYSTERY BOX — in your lane · last chance"
          : n >= 2
            ? "MYSTERY BOX — second chance · in your lane"
            : "MYSTERY BOX — drive through it if you dare";
    this.announce(msg, fromLate14k || n >= 2 ? 3000 : 2600);
    if (fromLate14k) this.mysteryBoxLateWaveDone = true;
  }

  private checkMysteryBoxPickup(): void {
    if (!this.mysteryBoxPickup) return;
    if (this.isJetpackFlying()) return;
    this.worldGroup.updateMatrixWorld(true);
    this.mysteryBoxPickup.mesh.getWorldPosition(this.owp);
    const oz = this.owp.z;
    const ox = this.owp.x;
    if (Math.abs(oz - PLAYER_Z) > 1.55) return;
    if (Math.abs(ox - this.player.position.x) > 1.42) return;
    if (this.playerY > 1.68) return;
    this.mysteryBoxActivePickupFromLate14k = false;
    this.worldGroup.remove(this.mysteryBoxPickup.mesh);
    this.mysteryBoxPickup = null;
    const now = performance.now();
    this.mysteryScreenFlipUntil = now + MYSTERY_FLIP_DURATION_MS;
    this.mysteryFlipImmunityUntil = now + MYSTERY_FLIP_IMMUNITY_MS;
    this.mysteryBoxCollectedThisRun = true;
    this.mysteryBoxUsedThisRun = true;
    this.announce(
      "MYSTERY — UPSIDE DOWN 10s · 2s obstacle immunity now, 2s again when view resets · controls unchanged",
      5400,
    );
  }

  private updateMysteryBoxPickupDespawn(): void {
    if (!this.mysteryBoxPickup) return;
    if (performance.now() - this.mysteryBoxPickup.spawnedAtMs < 650) return;
    this.worldGroup.updateMatrixWorld(true);
    this.mysteryBoxPickup.mesh.getWorldPosition(this.owp);
    const wz = this.owp.z;
    if (wz > DESPAWN_BEHIND + 12) {
      const fromLate = this.mysteryBoxActivePickupFromLate14k;
      this.mysteryBoxActivePickupFromLate14k = false;
      this.worldGroup.remove(this.mysteryBoxPickup.mesh);
      this.mysteryBoxPickup = null;
      const now = performance.now();
      if (this.mysteryBoxCollectedThisRun) {
        this.mysteryBoxUsedThisRun = true;
      } else if (!fromLate) {
        this.mysteryBoxSpawnAtMs = now + randRange(MYSTERY_BOX_MISS_RETRY_MIN_MS, MYSTERY_BOX_MISS_RETRY_MAX_MS);
      }
    }
  }

  /** Tall neon portal frame + glow plane (drive-through pickup). */
  private buildMysteryDoorPickupMesh(): THREE.Group {
    const root = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x0a0618,
      emissive: 0x00ffd0,
      emissiveIntensity: 1.1,
      metalness: 0.65,
      roughness: 0.22,
    });
    const postW = 0.22;
    const postH = 2.35;
    const postGeo = new THREE.BoxGeometry(postW, postH, postW);
    const postL = new THREE.Mesh(postGeo, frameMat);
    postL.position.set(-1.05, postH * 0.5 + 0.05, 0);
    postL.castShadow = true;
    const postR = postL.clone();
    postR.position.x = 1.05;
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.2, 0.24), frameMat);
    lintel.position.set(0, postH + 0.15, 0);
    lintel.castShadow = true;
    root.add(postL, postR, lintel);

    const portalMat = new THREE.MeshBasicMaterial({
      color: 0xaa66ff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 2.05), portalMat);
    portal.position.set(0, postH * 0.52 + 0.06, 0.02);
    root.add(portal);
    root.userData.portalMat = portalMat;
    root.userData.mysteryDoorPickup = true;
    return root;
  }

  private spawnMysteryDoorPickup(): void {
    const laneIdx = THREE.MathUtils.clamp(this.targetLane, 0, 2) as 0 | 1 | 2;
    const pickupZ = -MYSTERY_DOOR_PICKUP_Z_OFFSET - this.distance;
    const { lane, z } = this.resolvePickupLaneAndZ(laneIdx, pickupZ);
    const g = this.buildMysteryDoorPickupMesh();
    g.scale.setScalar(1.15);
    const bobY = 0.05;
    g.position.set(lane * LANE_WIDTH, bobY, z);
    g.userData.bobY = bobY;
    g.userData.phase = Math.random() * Math.PI * 2;
    this.worldGroup.add(g);
    this.mysteryDoorPickup = { mesh: g, lane, z, spawnedAtMs: performance.now() };
    this.mysteryDoorPickupSpawnsThisRun += 1;
    const n = this.mysteryDoorPickupSpawnsThisRun;
    const msg =
      n >= 4
        ? "MYSTERY DOOR — another portal · run through"
        : n >= 2
          ? "MYSTERY DOOR — second chance · run through"
          : "MYSTERY DOOR — run through the neon gate";
    this.announce(msg, n >= 2 ? 3200 : 3000);
  }

  private checkMysteryDoorPickup(): void {
    if (!this.mysteryDoorPickup) return;
    if (this.isJetpackFlying()) return;
    this.worldGroup.updateMatrixWorld(true);
    this.mysteryDoorPickup.mesh.getWorldPosition(this.owp);
    const oz = this.owp.z;
    const ox = this.owp.x;
    if (Math.abs(oz - PLAYER_Z) > 1.75) return;
    if (Math.abs(ox - this.player.position.x) > 1.55) return;
    if (this.playerY > 2.35) return;
    this.worldGroup.remove(this.mysteryDoorPickup.mesh);
    this.mysteryDoorPickup = null;
    const now = performance.now();
    this.mysteryDoorModeStartMs = now;
    this.mysteryDoorModeUntil = now + MYSTERY_DOOR_MODE_DURATION_MS;
    this.mysteryDoorSpikeFired = false;
    this.mysteryDoorEntryImmunityUntil = now + MYSTERY_DOOR_ENTRY_IMMUNITY_MS;
    document.body.classList.add("rift-door-mode");
    this.applyRiftDoorWorldVisuals();
    this.announce("VOID TUNNEL · slow… then SURGE · auto exit in 10s · 2s hazard immunity", 4200);
  }

  private updateMysteryDoorPickupDespawn(now: number): void {
    if (!this.mysteryDoorPickup) return;
    if (now - this.mysteryDoorPickup.spawnedAtMs < 650) return;
    this.worldGroup.updateMatrixWorld(true);
    this.mysteryDoorPickup.mesh.getWorldPosition(this.owp);
    const wz = this.owp.z;
    if (wz > DESPAWN_BEHIND + 12) {
      this.worldGroup.remove(this.mysteryDoorPickup.mesh);
      this.mysteryDoorPickup = null;
      if (!this.mysteryDoorWaveComplete) {
        this.mysteryDoorSpawnAtMs = now + randRange(MYSTERY_DOOR_RETRY_DELAY_MIN_MS, MYSTERY_DOOR_RETRY_DELAY_MAX_MS);
        this.announce("MYSTERY DOOR MISSED · another portal in 7–10s", 2800);
      }
    }
  }

  private applyRiftDoorWorldVisuals(): void {
    const deep = new THREE.Color(0x040a14);
    const fogTint = new THREE.Color(0x061222);
    this.scene.background.copy(deep);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(fogTint);
      this.scene.fog.near = 16;
      this.scene.fog.far = 78;
    }
    this.ambient.intensity = 0.38;
    this.dirLight.intensity = 0.92;
    this.fillLight.intensity = 0.62;
    this.dirLight.color.setHex(0x7dfff8);
    this.fillLight.color.setHex(0xff7adb);

    const neonEmissive = 0x00fff4;
    this.worldGroup.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || Array.isArray(obj.material)) return;
      const mat = obj.material;
      if (obj.userData.neon && mat instanceof THREE.MeshStandardMaterial) {
        mat.emissive.setHex(neonEmissive);
        mat.emissiveIntensity = 2.08;
        mat.color.setHex(0x000510);
      }
      if (obj.userData.trackNeonGrid && mat instanceof THREE.MeshStandardMaterial) {
        mat.emissive.setHex(0x00ffff);
        mat.emissiveIntensity = 0.95;
        mat.opacity = 0.34;
      }
      if (obj.userData.cityGlass && mat instanceof THREE.MeshPhysicalMaterial) {
        mat.emissive.setHex(0x003848);
        mat.emissiveIntensity = 0.42;
        mat.envMapIntensity = 1.38;
      }
      if (obj.userData.groundWet && mat instanceof THREE.MeshPhysicalMaterial) {
        mat.color.setHex(0x061a24);
        mat.emissive.setHex(0x042028);
        mat.emissiveIntensity = 0.22;
        mat.roughness = 0.09;
      }
      if (obj.userData.holoAd && mat instanceof THREE.MeshStandardMaterial) {
        mat.emissiveIntensity = 1.12;
        mat.opacity = 0.68;
      }
    });
  }

  private exitMysteryDoorMode(now: number): void {
    this.mysteryDoorModeUntil = 0;
    this.mysteryDoorModeStartMs = 0;
    this.mysteryDoorSpikeFired = false;
    this.mysteryDoorEntryImmunityUntil = 0;
    this.mysteryDoorSpawnAtMs = 0;
    this.mysteryDoorWaveComplete = true;
    document.body.classList.remove("rift-door-mode");
    this.applyVisualLayer(this.mirrorLayer);
    this.mysteryDoorPostImmunityUntil = now + MYSTERY_DOOR_POST_IMMUNITY_MS;
    this.announce("EXIT SEALED · back to normal · 2s immunity", 3200);
  }

  private spawnExtraLifePickup(): void {
    if (this.lives !== 1) {
      this.extraLifeSpawnAtMs = 0;
      this.extraLifePickupUsedThisRun = true;
      return;
    }
    const laneIdx = THREE.MathUtils.clamp(this.targetLane, 0, 2) as 0 | 1 | 2;
    const pickupZ = -EXTRA_LIFE_PICKUP_Z_OFFSET - this.distance;
    const { lane, z } = this.resolvePickupLaneAndZ(laneIdx, pickupZ);
    const g = new THREE.Group();
    g.scale.setScalar(1.45);
    const bobY = 1.32;
    g.position.set(lane * LANE_WIDTH, bobY, z);

    const heartMat = new THREE.MeshPhysicalMaterial({
      color: 0xff3355,
      emissive: 0xff0022,
      emissiveIntensity: 0.72,
      metalness: 0.35,
      roughness: 0.22,
      clearcoat: 0.85,
      clearcoatRoughness: 0.12,
    });
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 14), heartMat);
    lobe.position.set(-0.09, 0.11, 0);
    const lobeR = lobe.clone();
    lobeR.position.x = 0.09;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.18, 12), heartMat);
    tip.rotation.z = Math.PI;
    tip.position.set(0, -0.055, 0);
    g.add(lobe, lobeR, tip);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffccd0,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.028, 10, 44), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.02;
    g.add(ring);
    g.userData.extraLifePickup = true;
    g.userData.bobY = bobY;
    g.userData.phase = Math.random() * Math.PI * 2;
    g.userData.ringMat = ringMat;

    this.worldGroup.add(g);
    this.extraLifePickup = { mesh: g, lane, z, spawnedAtMs: performance.now() };
    this.announce("EXTRA LIFE — one pickup in your lane · drive through it", 3200);
  }

  private checkExtraLifePickup(): void {
    if (!this.extraLifePickup || this.isJetpackFlying()) return;
    this.worldGroup.updateMatrixWorld(true);
    this.extraLifePickup.mesh.getWorldPosition(this.owp);
    const oz = this.owp.z;
    const ox = this.owp.x;
    if (Math.abs(oz - PLAYER_Z) > 1.55) return;
    if (Math.abs(ox - this.player.position.x) > 1.42) return;
    this.worldGroup.remove(this.extraLifePickup.mesh);
    this.extraLifePickup = null;
    this.extraLifePickupUsedThisRun = true;
    this.extraLifeSpawnAtMs = 0;
    this.lives = Math.min(STARTING_LIVES, this.lives + 1);
    this.nearMissFlashUntil = performance.now() + 160;
    this.announce("EXTRA LIFE — you earned another chance", 2600);
  }

  private updateExtraLifePickupDespawn(): void {
    if (!this.extraLifePickup) return;
    if (performance.now() - this.extraLifePickup.spawnedAtMs < 650) return;
    this.worldGroup.updateMatrixWorld(true);
    this.extraLifePickup.mesh.getWorldPosition(this.owp);
    const wz = this.owp.z;
    if (wz > DESPAWN_BEHIND + 12) {
      this.worldGroup.remove(this.extraLifePickup.mesh);
      this.extraLifePickup = null;
      this.extraLifePickupUsedThisRun = true;
      this.extraLifeSpawnAtMs = 0;
    }
  }

  /** `zOffset` shifts spawn along track (e.g. paired bonus coin slightly closer). */
  private spawnFlightCoin(zOffset = 0): void {
    const lane = LANES[Math.floor(Math.random() * 3)]!;
    const z = -SPAWN_AHEAD * 0.52 - this.distance + zOffset;
    const g = new THREE.Group();
    const floatBase = JETPACK_FLY_HEIGHT - 0.55 + Math.random() * 0.35;
    g.position.set(lane * LANE_WIDTH, floatBase, z);

    const floatPh = Math.random() * Math.PI * 2;
    const spin = 2.1 + Math.random() * 1.8;
    g.userData.flightCoin = true;
    g.userData.floatBase = floatBase;
    g.userData.floatPh = floatPh;
    g.userData.spin = spin;

    /** Thin cylinder along forward Z: round face toward the chase camera, not a flat ground disc. */
    const thickness = 0.05;
    const radius = 0.19;
    const faceMat = new THREE.MeshPhysicalMaterial({
      color: 0xffe8b8,
      emissive: 0xffcc44,
      emissiveIntensity: 0.32,
      metalness: 1,
      roughness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      iridescence: 0.28,
      iridescenceIOR: 1.33,
      iridescenceThicknessRange: [90, 280],
    });
    g.userData.ringMat = faceMat;

    const coin = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, thickness, 32), faceMat);
    coin.rotation.x = Math.PI / 2;
    coin.castShadow = true;
    g.add(coin);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(radius + 0.006, 0.022, 8, 32),
      new THREE.MeshStandardMaterial({
        color: 0xfff2cc,
        emissive: 0xffee88,
        emissiveIntensity: 0.38,
        metalness: 0.95,
        roughness: 0.15,
      }),
    );
    rim.rotation.x = Math.PI / 2;
    g.add(rim);

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffeeaa,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const glowRing = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.08, 0.03, 8, 36), glowMat);
    glowRing.rotation.x = Math.PI / 2;
    g.add(glowRing);
    g.userData.glowRing = glowRing;
    g.userData.glowMat = glowMat;

    this.worldGroup.add(g);
    this.flightCoins.push({ mesh: g, lane, z, collected: false });
  }

  /** Idle motion for jetpack pickup, flight coins, and mystery box pickup. */
  private animatePickups(dt: number, aliveT: number): void {
    if (this.jetpackPickup) {
      const g = this.jetpackPickup.mesh;
      const ph = (g.userData.phase as number) ?? 0;
      const t = aliveT * 2.35 + ph;
      g.rotation.y += dt * 1.25;
      g.rotation.x = Math.sin(t * 0.65) * 0.065;
      const bb = (g.userData.bobBaseY as number) ?? 1.02;
      g.position.y = bb + Math.sin(t) * 0.1;

      const flames = g.userData.flameMeshes as THREE.Mesh[] | undefined;
      const flameMat = g.userData.flameMat as THREE.MeshBasicMaterial | undefined;
      const flameCoreMat = g.userData.flameCoreMat as THREE.MeshBasicMaterial | undefined;
      const fp = aliveT * 22 + ph;
      if (flames) {
        for (const fl of flames) {
          const core = fl.material === flameCoreMat;
          const sy = core ? 0.86 + Math.sin(fp * 1.15) * 0.22 : 0.9 + Math.sin(fp) * 0.2;
          fl.scale.set(1, sy, 1);
        }
      }
      if (flameMat) flameMat.opacity = 0.78 + Math.sin(fp * 0.88) * 0.14;
      if (flameCoreMat) flameCoreMat.opacity = 0.42 + Math.sin(fp * 1.05) * 0.12;
    }

    if (this.mysteryBoxPickup) {
      const mg = this.mysteryBoxPickup.mesh;
      const ph = (mg.userData.phase as number) ?? 0;
      const bobBase = (mg.userData.bobY as number) ?? 0.98;
      mg.rotation.y += dt * 1.65;
      mg.rotation.x = Math.sin(aliveT * 2.2 + ph) * 0.12;
      mg.position.y = bobBase + Math.sin(aliveT * 3.4 + ph) * 0.09;
    }

    if (this.extraLifePickup) {
      const eg = this.extraLifePickup.mesh;
      const ph = (eg.userData.phase as number) ?? 0;
      const bobBase = (eg.userData.bobY as number) ?? 1.05;
      eg.rotation.y += dt * 1.9;
      eg.rotation.z = Math.sin(aliveT * 2.4 + ph) * 0.1;
      eg.position.y = bobBase + Math.sin(aliveT * 3.2 + ph) * 0.1;
      const rm = eg.userData.ringMat as THREE.MeshBasicMaterial | undefined;
      if (rm) rm.opacity = 0.22 + Math.sin(aliveT * 5 + ph) * 0.14;
    }

    if (this.mysteryDoorPickup) {
      const dg = this.mysteryDoorPickup.mesh;
      const ph = (dg.userData.phase as number) ?? 0;
      const bobBase = (dg.userData.bobY as number) ?? 0.05;
      dg.rotation.y += dt * 0.9;
      dg.position.y = bobBase + Math.sin(aliveT * 2.8 + ph) * 0.06;
      const pm = dg.userData.portalMat as THREE.MeshBasicMaterial | undefined;
      if (pm) pm.opacity = 0.38 + Math.sin(aliveT * 6 + ph) * 0.18;
    }

    for (const fc of this.flightCoins) {
      if (fc.collected) continue;
      const cg = fc.mesh;
      const floatPh = (cg.userData.floatPh as number) ?? 0;
      const spin = (cg.userData.spin as number) ?? 2.5;
      const floatBase = (cg.userData.floatBase as number) ?? cg.position.y;
      cg.rotation.y += dt * spin;
      cg.rotation.z = Math.sin(aliveT * 2.5 + floatPh) * 0.14;
      cg.position.y = floatBase + Math.sin(aliveT * 3.05 + floatPh) * 0.075;

      const ringMat = cg.userData.ringMat as THREE.MeshPhysicalMaterial | undefined;
      if (ringMat) {
        ringMat.emissiveIntensity = 0.22 + Math.sin(aliveT * 4.8 + floatPh) * 0.2;
      }
      const glowMat = cg.userData.glowMat as THREE.MeshBasicMaterial | undefined;
      if (glowMat) {
        glowMat.opacity = 0.16 + Math.sin(aliveT * 5.5 + floatPh) * 0.12;
      }
    }
  }

  private updateFlightCoinsCollect(): void {
    if (!this.isJetpackFlying()) return;
    const px = this.player.position.x;
    const pz = PLAYER_Z;
    this.worldGroup.updateMatrixWorld(true);
    const keep: FlightCoin[] = [];
    for (const c of this.flightCoins) {
      if (c.collected) continue;
      c.mesh.getWorldPosition(this.owp);
      const oz = this.owp.z;
      const ox = this.owp.x;
      if (oz > DESPAWN_BEHIND + 6) {
        this.worldGroup.remove(c.mesh);
        continue;
      }
      if (Math.abs(oz - pz) < 1.15 && Math.abs(ox - px) < 0.95) {
        c.collected = true;
        this.worldGroup.remove(c.mesh);
        this.score += COIN_SCORE_BONUS;
        this.nearMissFlashUntil = performance.now() + 120;
        continue;
      }
      keep.push(c);
    }
    this.flightCoins = keep;
  }

  private clearFlightCoins(): void {
    for (const c of this.flightCoins) {
      if (!c.collected) this.worldGroup.remove(c.mesh);
    }
    this.flightCoins.length = 0;
  }

  private queueLane(dir: -1 | 1): void {
    let d = dir;
    if (this.invertLR) d = (-d) as -1 | 1;
    const next = THREE.MathUtils.clamp(this.targetLane + d, 0, 2);
    this.targetLane = next;
  }

  private tryJump(): void {
    if (this.isJetpackFlying()) return;
    if (this.sliding || this.jumping) return;
    const doJump = this.swapJumpSlide ? false : true;
    const doSlide = this.swapJumpSlide ? true : false;
    if (doJump) {
      this.jumping = true;
      this.jumpVel = 12;
    } else {
      this.sliding = true;
      this.slideTimer = 0.55;
    }
  }

  private trySlide(): void {
    if (this.isJetpackFlying()) return;
    if (this.jumping) return;
    const doSlide = this.swapJumpSlide ? false : true;
    const doJump = this.swapJumpSlide ? true : false;
    if (doSlide) {
      this.sliding = true;
      this.slideTimer = 0.55;
    } else {
      if (this.sliding) return;
      this.jumping = true;
      this.jumpVel = 12;
    }
  }

  private stumble(): void {
    if (this.stumbleCooldown > 0) return;
    this.stumbleCooldown = 0.32;
    this.velocityZ *= 0.82;
    this.vfxStumblePulseUntil = performance.now() + 420;
    this.lastStumbleUnderMirror = this.invertLR || this.swapJumpSlide || this.mirrorLayer;
  }

  /** Mirror / HUD beat after losing a life but staying in the run (obstacle hit). */
  private scheduleLifeLostRecoverBeat(): void {
    const now = performance.now();
    const pad = LIFE_LOST_FREEZE_MS;
    this.lifeLostFreezeUntil = now + pad;
    this.lifeLostBannerUntil = now + Math.max(2200, pad + 700);
    this.mirrorNextFireAt += pad;
    this.mirrorWarningStartAt += pad;
    if (this.mirrorAnnounceUntil > now) {
      this.mirrorAnnounceUntil += pad;
    }
  }

  private triggerNearMiss(): void {
    this.score += 38;
    this.nearMissFlashUntil = performance.now() + 260;
    this.bumpMirrorCamera(0.028);
  }

  /** When obstacle passes behind player, reward razor-thin clears. */
  private scanNearMissPasses(): void {
    if (this.isJetpackFlying()) return;
    const px = this.player.position.x;
    const pz = PLAYER_Z;
    const charY = this.playerY;
    const headTop = charY + (this.sliding ? 0.78 : 1.58);
    const clearH = this.mirrorPhysicsFlip ? 0.58 : 0.74;

    for (const o of this.obstacles) {
      if (o.hit || o.nearEvaluated) continue;
      o.mesh.getWorldPosition(this.owp);
      const oz = this.owp.z;
      if (oz < pz + 0.48) continue;
      o.nearEvaluated = true;
      const ox = this.owp.x;
      const laneIdx = o.lane === -1 ? 0 : o.lane === 0 ? 1 : 2;
      let tight = false;
      if (o.kind === "block") {
        tight =
          this.playerLane !== laneIdx &&
          Math.abs(ox - px) < 2.45 &&
          Math.abs(ox - px) > 1.02;
      } else if (o.kind === "low") {
        tight = Math.abs(ox - px) < 1.22 && charY >= clearH - 0.1 && charY <= clearH + 0.12;
      } else {
        tight =
          Math.abs(ox - px) < 1.32 &&
          headTop <= HIGH_BAR_CLEARANCE + 0.12 &&
          headTop >= HIGH_BAR_CLEARANCE - 0.28;
      }
      if (tight) this.triggerNearMiss();
    }
  }

  private checkCollisions(): void {
    if (this.isJetpackFlying()) return;
    const px = this.player.position.x;
    const pz = PLAYER_Z;
    const charY = this.playerY;

    this.worldGroup.updateMatrixWorld(true);
    for (const o of this.obstacles) {
      o.mesh.getWorldPosition(this.owp);
      const oz = this.owp.z;
      if (Math.abs(oz - pz) > 1.35) continue;
      const ox = this.owp.x;
      if (Math.abs(ox - px) > 1.35) continue;

      if (o.kind === "block") {
        const headTop = charY + (this.sliding ? 0.78 : 1.58);
        if (charY < BLOCK_HEIGHT && headTop > 0) {
          this.collideFail(o);
        }
      } else if (o.kind === "low") {
        const clearH = this.mirrorPhysicsFlip ? 0.58 : 0.74;
        if (charY < clearH) this.collideFail(o);
      } else {
        const headTop = charY + (this.sliding ? 0.78 : 1.58);
        if (headTop > HIGH_BAR_CLEARANCE) this.collideFail(o);
      }
    }
  }

  private collideFail(o: Obstacle): void {
    if (o.hit) return;
    o.hit = true;
    const nowHit = performance.now();
    if (
      nowHit < this.mirrorProtocolImmunityUntil ||
      nowHit < this.jetpackPostImmunityUntil ||
      nowHit < this.mysteryFlipImmunityUntil ||
      nowHit < this.mysteryPostFlipImmunityUntil ||
      nowHit < this.lifeLostHitImmunityUntil ||
      nowHit < this.mysteryDoorPostImmunityUntil ||
      nowHit < this.mysteryDoorEntryImmunityUntil
    ) {
      return;
    }
    this.lives -= 1;
    this.stumble();
    if (this.lives > 0) {
      this.scheduleLifeLostRecoverBeat();
      this.lifeLostHitImmunityUntil = this.lifeLostFreezeUntil + LIFE_LOST_HIT_IMMUNITY_MS;
    }
    if (this.lives <= 0) {
      this.endGame(
        "Out of lives — each obstacle hit costs one. You get three; use lanes, jump, and slide to stay clean.",
      );
    }
  }

  /**
   * Arrow keys + WASD on `window` capture so keys are seen before embedded UI / bubbling.
   * Arrows skip strict Ctrl/Alt checks (those blocked browser/OS combos only for letters).
   */
  private onGlobalKeyDown(e: KeyboardEvent): void {
    if (!this.running || this.gameOver) return;
    const code = e.code;
    if (code === "Escape") {
      e.preventDefault();
      if (this.userPaused) this.resume();
      else if (!this.isLifeLostFrozen()) this.pause();
      return;
    }
    if (this.isLifeLostFrozen() || this.userPaused) return;

    const key = e.key;
    const kc = (e as KeyboardEvent & { keyCode?: number }).keyCode ?? 0;
    const left = code === "ArrowLeft" || key === "ArrowLeft" || kc === 37;
    const right = code === "ArrowRight" || key === "ArrowRight" || kc === 39;
    const up = code === "ArrowUp" || key === "ArrowUp" || kc === 38;
    const down = code === "ArrowDown" || key === "ArrowDown" || kc === 40;
    const arrow = left || right || up || down;

    if (e.metaKey) return;
    if (arrow && e.altKey) return;
    if (!arrow && (e.altKey || e.ctrlKey)) return;

    const a = code === "KeyA";
    const d = code === "KeyD";
    const w = code === "KeyW";
    const s = code === "KeyS";
    const space = code === "Space";

    if (!(left || right || up || down || a || d || w || s || space)) return;
    e.preventDefault();
    if (left || a) this.queueLane(-1);
    else if (right || d) this.queueLane(1);
    else if (up || w || space) this.tryJump();
    else if (down || s) this.trySlide();
  }

  update(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const nowWall = performance.now();
    if (this.running && !this.gameOver && this.mysteryDoorModeUntil > 0 && nowWall >= this.mysteryDoorModeUntil) {
      this.exitMysteryDoorMode(nowWall);
    }
    const lifeFrozen =
      this.running && !this.gameOver && performance.now() < this.lifeLostFreezeUntil;
    const simFrozen = lifeFrozen || this.userPaused;

    if (this.running && !this.gameOver && !simFrozen) {
      const nowTick = performance.now();
      if (this.jetpackFlyingUntil !== 0 && nowTick >= this.jetpackFlyingUntil) {
        this.jetpackPostImmunityUntil = nowTick + JETPACK_LAND_IMMUNITY_MS;
        this.jetpackFlyingUntil = 0;
        this.clearFlightCoins();
        this.jetpackUsedThisRun = true;
        if (this.jetpackPendingLateResolve) {
          this.jetpackPendingLateResolve = false;
          this.jetpackLateWaveDone = true;
        }
        this.announce("JETPACK OFF · 2s immunity", 2000);
      }

      this.tickMirrorRealitySystem(nowTick);

      const diffRamp = 1 + this.aliveTime * 0.02;
      const scoreMilestones = Math.min(
        MAX_SPEED_MILESTONES,
        Math.floor(this.score / SCORE_SPEED_MILESTONE),
      );
      const scoreSpeedBoost = scoreMilestones * SPEED_BONUS_PER_MILESTONE;
      let vmax = 50 + scoreMilestones * VMAX_BONUS_PER_MILESTONE;
      let targetV = 19.5 + this.aliveTime * 0.95 * diffRamp + scoreSpeedBoost;
      let vMin = 14;
      let accel = 1.85;
      if (this.mysteryDoorModeUntil > 0 && nowTick < this.mysteryDoorModeUntil) {
        const e = nowTick - this.mysteryDoorModeStartMs;
        if (e < MYSTERY_DOOR_SLOW_PHASE_MS) {
          targetV *= 0.48;
          vmax *= 0.78;
          vMin *= 0.82;
          accel = 1.15;
        } else {
          if (!this.mysteryDoorSpikeFired) {
            this.mysteryDoorSpikeFired = true;
            this.velocityZ = THREE.MathUtils.clamp(this.velocityZ * 1.48, 22, vmax * 1.22);
            this.announce("VOID SURGE", 1600);
          }
          targetV *= 1.38;
          vmax *= 1.2;
          accel = 2.35;
        }
      }
      this.velocityZ += (targetV - this.velocityZ) * Math.min(1, dt * accel);
      this.velocityZ = THREE.MathUtils.clamp(this.velocityZ, vMin, vmax);

      this.distance += this.velocityZ * dt;
      this.aliveTime += dt;
      this.worldGroup.position.z = this.distance;
      if (this.mirrorLayer) {
        this.worldGroup.position.x = Math.sin(this.aliveTime * 2.08) * 0.12;
      } else {
        this.worldGroup.position.x = THREE.MathUtils.lerp(this.worldGroup.position.x, 0, Math.min(1, dt * 6));
      }

      if (this.stumbleCooldown > 0) this.stumbleCooldown -= dt;

      if (this.playerLane !== this.targetLane) {
        this.laneBlend += dt * 10;
        if (this.laneBlend >= 1) {
          this.laneBlend = 0;
          this.playerLane += this.targetLane > this.playerLane ? 1 : -1;
        }
      } else {
        this.laneBlend = 0;
      }

      const fromX = LANES[this.playerLane] * LANE_WIDTH;
      const toX = LANES[this.targetLane] * LANE_WIDTH;
      const t = this.playerLane === this.targetLane ? 0 : this.laneBlend;
      this.player.position.x = THREE.MathUtils.lerp(fromX, toX, t);

      if (this.isJetpackFlying()) {
        const tgt = JETPACK_FLY_HEIGHT + Math.sin(this.aliveTime * 11) * 0.12;
        this.playerY = THREE.MathUtils.lerp(this.playerY, tgt, Math.min(1, dt * 2.6));
        this.jumping = false;
        this.sliding = false;
        this.slideTimer = 0;
        this.jumpVel = 0;
      } else if (this.jumping) {
        this.jumpVel += -28 * dt;
        this.playerY += this.jumpVel * dt;
        if (this.playerY <= 0) {
          this.playerY = 0;
          this.jumping = false;
          this.jumpVel = 0;
        }
      } else {
        this.playerY += (0 - this.playerY) * Math.min(1, dt * 17);
      }

      if (this.sliding) {
        this.slideTimer -= dt;
        if (this.slideTimer <= 0) this.sliding = false;
      }

      this.player.position.y = this.playerY;

      this.ensureChunks();

      const scoreTiers = Math.min(MAX_SPEED_MILESTONES, Math.floor(this.score / SCORE_SPEED_MILESTONE));
      const timeT = Math.min(1, this.aliveTime / OBSTACLE_TIME_RAMP_S);
      const baseSpacing =
        THREE.MathUtils.lerp(OBSTACLE_SPACING_BASE_START, OBSTACLE_SPACING_BASE_END, timeT) +
        randRange(-0.65, 1.35);
      const spacing = Math.max(
        OBSTACLE_SPACING_MIN,
        baseSpacing - scoreTiers * OBSTACLE_TIGHTEN_PER_SCORE_TIER,
      );
      if (this.distance >= this.nextObstacleAt) {
        this.spawnObstacle();
        this.nextObstacleAt += spacing;
      }

      this.obstacles = this.obstacles.filter((o) => {
        const wz = o.mesh.position.z + this.worldGroup.position.z;
        if (wz > DESPAWN_BEHIND) {
          this.worldGroup.remove(o.mesh);
          return false;
        }
        return true;
      });

      this.checkCollisions();
      this.scanNearMissPasses();

      this.score += this.velocityZ * dt * 1.22 + dt * 26;

      if (!this.jetpackUsedThisRun && this.jetpackSpawnAtMs === 0 && !this.jetpackPickup && this.jetpackFlyingUntil === 0) {
        if (this.jetpackPickupSpawnsThisRun === 0 && this.score >= JETPACK_SCORE_TRIGGER) {
          this.jetpackSpawnAtMs = nowTick + randRange(PICKUP_SPAWN_DELAY_MIN_MS, PICKUP_SPAWN_DELAY_MAX_MS);
        } else if (
          this.jetpackPickupSpawnsThisRun === 1 &&
          !this.jetpackEnteredFlightThisRun &&
          this.score >= JETPACK_RETRY_SCORE_TRIGGER
        ) {
          this.jetpackSpawnAtMs = nowTick + randRange(PICKUP_SPAWN_DELAY_MIN_MS, PICKUP_SPAWN_DELAY_MAX_MS);
        }
      }
      if (
        this.jetpackUsedThisRun &&
        !this.jetpackLateWaveDone &&
        this.jetpackLateSpawnAtMs === 0 &&
        !this.jetpackPickup &&
        this.jetpackFlyingUntil === 0 &&
        this.score >= JETPACK_LATE_SCORE_TRIGGER
      ) {
        this.jetpackLateSpawnAtMs =
          nowTick + randRange(JETPACK_LATE_SPAWN_DELAY_MIN_MS, JETPACK_LATE_SPAWN_DELAY_MAX_MS);
      }
      if (!this.mysteryBoxUsedThisRun && this.mysteryBoxSpawnAtMs === 0 && !this.mysteryBoxPickup && !this.isJetpackFlying()) {
        if (this.mysteryBoxPickupSpawnsThisRun === 0 && this.score >= MYSTERY_BOX_SCORE_TRIGGER) {
          this.mysteryBoxSpawnAtMs = nowTick + randRange(PICKUP_SPAWN_DELAY_MIN_MS, PICKUP_SPAWN_DELAY_MAX_MS);
        } else if (
          this.mysteryBoxPickupSpawnsThisRun === 1 &&
          !this.mysteryBoxCollectedThisRun &&
          this.score >= MYSTERY_BOX_RETRY_SCORE_TRIGGER
        ) {
          this.mysteryBoxSpawnAtMs = nowTick + randRange(PICKUP_SPAWN_DELAY_MIN_MS, PICKUP_SPAWN_DELAY_MAX_MS);
        } else if (
          this.mysteryBoxPickupSpawnsThisRun === 2 &&
          !this.mysteryBoxCollectedThisRun &&
          this.score >= MYSTERY_BOX_RETRY_SCORE_TRIGGER
        ) {
          this.mysteryBoxSpawnAtMs = nowTick + randRange(PICKUP_SPAWN_DELAY_MIN_MS, PICKUP_SPAWN_DELAY_MAX_MS);
        }
      }
      if (
        !this.mysteryBoxLateWaveDone &&
        this.mysteryBoxLateSpawnAtMs === 0 &&
        !this.mysteryBoxPickup &&
        !this.isJetpackFlying() &&
        this.score >= MYSTERY_BOX_LATE_SCORE_TRIGGER &&
        this.mysteryBoxUsedThisRun
      ) {
        this.mysteryBoxLateSpawnAtMs =
          nowTick + randRange(MYSTERY_BOX_LATE_SPAWN_DELAY_MIN_MS, MYSTERY_BOX_LATE_SPAWN_DELAY_MAX_MS);
      }
      if (
        !this.mysteryBoxUsedThisRun &&
        this.mysteryBoxSpawnAtMs > 0 &&
        nowTick >= this.mysteryBoxSpawnAtMs &&
        !this.mysteryBoxPickup &&
        !this.isJetpackFlying()
      ) {
        this.spawnMysteryBoxPickup(false);
      }
      if (this.mysteryBoxLateSpawnAtMs > 0 && nowTick >= this.mysteryBoxLateSpawnAtMs && !this.mysteryBoxPickup) {
        if (this.isJetpackFlying()) {
          this.mysteryBoxLateSpawnAtMs = nowTick + 400;
        } else {
          this.mysteryBoxLateSpawnAtMs = 0;
          this.spawnMysteryBoxPickup(true);
        }
      }
      if (
        !this.jetpackUsedThisRun &&
        this.jetpackSpawnAtMs > 0 &&
        nowTick >= this.jetpackSpawnAtMs &&
        !this.jetpackPickup &&
        this.jetpackFlyingUntil === 0
      ) {
        this.spawnJetpackPickup(false);
      }
      if (
        this.jetpackLateSpawnAtMs > 0 &&
        nowTick >= this.jetpackLateSpawnAtMs &&
        !this.jetpackPickup &&
        this.jetpackFlyingUntil === 0
      ) {
        this.jetpackLateSpawnAtMs = 0;
        this.spawnJetpackPickup(true);
      }
      if (
        !this.extraLifePickupUsedThisRun &&
        this.extraLifeSpawnAtMs === 0 &&
        !this.extraLifePickup &&
        this.score >= EXTRA_LIFE_SCORE_TRIGGER &&
        this.lives === 1
      ) {
        this.extraLifeSpawnAtMs = nowTick + randRange(PICKUP_SPAWN_DELAY_MIN_MS, PICKUP_SPAWN_DELAY_MAX_MS);
      }
      if (
        !this.extraLifePickupUsedThisRun &&
        this.extraLifeSpawnAtMs > 0 &&
        nowTick >= this.extraLifeSpawnAtMs &&
        !this.extraLifePickup &&
        !this.isJetpackFlying()
      ) {
        this.spawnExtraLifePickup();
      }
      if (
        !this.mysteryDoorWaveComplete &&
        !this.isMysteryDoorMode() &&
        this.mysteryDoorSpawnAtMs === 0 &&
        !this.mysteryDoorPickup &&
        !this.isJetpackFlying() &&
        this.score >= MYSTERY_DOOR_SCORE_TRIGGER
      ) {
        this.mysteryDoorSpawnAtMs =
          nowTick + randRange(MYSTERY_DOOR_SPAWN_DELAY_MIN_MS, MYSTERY_DOOR_SPAWN_DELAY_MAX_MS);
      }
      if (
        !this.mysteryDoorWaveComplete &&
        this.mysteryDoorSpawnAtMs > 0 &&
        nowTick >= this.mysteryDoorSpawnAtMs &&
        !this.mysteryDoorPickup &&
        !this.isJetpackFlying()
      ) {
        this.mysteryDoorSpawnAtMs = 0;
        this.spawnMysteryDoorPickup();
      }
      if (this.jetpackPickup || this.flightCoins.length > 0 || this.mysteryBoxPickup || this.extraLifePickup || this.mysteryDoorPickup) {
        this.animatePickups(dt, this.aliveTime);
      }
      if (this.jetpackPickup) {
        this.checkJetpackPickup();
        this.updateJetpackPickupDespawn(nowTick);
      }
      if (this.mysteryBoxPickup) {
        this.checkMysteryBoxPickup();
        this.updateMysteryBoxPickupDespawn();
      }
      if (this.extraLifePickup) {
        this.checkExtraLifePickup();
        this.updateExtraLifePickupDespawn();
      }
      if (this.mysteryDoorPickup) {
        this.checkMysteryDoorPickup();
        this.updateMysteryDoorPickupDespawn(nowTick);
      }
      if (this.isJetpackFlying()) {
        if (nowTick >= this.jetpackNextCoinAtMs) {
          this.jetpackNextCoinAtMs =
            nowTick + JETPACK_COIN_SPAWN_INTERVAL_MS + Math.random() * JETPACK_COIN_SPAWN_JITTER_MS;
          this.spawnFlightCoin();
          if (Math.random() < 0.42) this.spawnFlightCoin(-1.15);
        }
        this.updateFlightCoinsCollect();
      }
    }

    const simDt = simFrozen ? 0 : dt;
    this.updateThiefAvatar(simDt);

    const warnP = this.getMirrorWarningProgress();
    this.mirrorCamRoll = THREE.MathUtils.lerp(this.mirrorCamRoll, 0, Math.min(1, simDt * 3.8));
    const warnOsc = warnP * 0.055 * Math.sin(this.aliveTime * 36 + warnP * 6.28);

    const t = this.running ? this.aliveTime : performance.now() * 0.0004;
    const bob = Math.sin(t * 6) * 0.04;
    this.camera.position.x = THREE.MathUtils.lerp(
      this.camera.position.x,
      this.player.position.x * 0.28,
      simDt * 3,
    );
    this.camera.position.y = 3.2 + bob + (this.isJetpackFlying() ? 0.5 : 0);
    this.camera.lookAt(
      this.player.position.x * 0.15,
      1.1 + this.playerY * 0.08,
      this.player.position.z - 10,
    );
    this.camera.rotateZ(this.mirrorCamRoll + warnOsc);

    if (this.running && !this.gameOver) {
      const nw = performance.now();
      const flipOn = nw < this.mysteryScreenFlipUntil;
      if (this.prevMysteryFlipActive && !flipOn) {
        this.mysteryPostFlipImmunityUntil = nw + MYSTERY_POST_FLIP_IMMUNITY_MS;
      }
      this.prevMysteryFlipActive = flipOn;
    } else if (!this.running) {
      this.prevMysteryFlipActive = false;
    }

    if (this.running && !this.gameOver && this.isMysteryDoorMode()) {
      this.applyRiftDoorWorldVisuals();
    }
  }

  private endGame(reason: string): void {
    this.gameOver = true;
    this.running = false;
    this.userPaused = false;
    this.pauseStartedAt = 0;
    this.gameOverReason = reason;

    this.jetpackFlyingUntil = 0;
    this.jetpackPostImmunityUntil = 0;
    this.jetpackSpawnAtMs = 0;
    this.jetpackLateSpawnAtMs = 0;
    this.jetpackLateWaveDone = false;
    this.jetpackPendingLateResolve = false;
    if (this.jetpackPickup) {
      this.worldGroup.remove(this.jetpackPickup.mesh);
      this.jetpackPickup = null;
    }
    this.clearFlightCoins();
    this.mysteryBoxSpawnAtMs = 0;
    this.mysteryBoxLateSpawnAtMs = 0;
    this.mysteryBoxLateWaveDone = false;
    if (this.mysteryBoxPickup) {
      this.worldGroup.remove(this.mysteryBoxPickup.mesh);
      this.mysteryBoxPickup = null;
    }
    this.extraLifeSpawnAtMs = 0;
    if (this.extraLifePickup) {
      this.worldGroup.remove(this.extraLifePickup.mesh);
      this.extraLifePickup = null;
    }
    this.mysteryDoorSpawnAtMs = 0;
    this.mysteryDoorWaveComplete = false;
    this.mysteryDoorPickupSpawnsThisRun = 0;
    this.mysteryDoorModeUntil = 0;
    this.mysteryDoorModeStartMs = 0;
    this.mysteryDoorSpikeFired = false;
    this.mysteryDoorPostImmunityUntil = 0;
    this.mysteryDoorEntryImmunityUntil = 0;
    if (this.mysteryDoorPickup) {
      this.worldGroup.remove(this.mysteryDoorPickup.mesh);
      this.mysteryDoorPickup = null;
    }
    this.mysteryScreenFlipUntil = 0;
    this.mysteryFlipImmunityUntil = 0;
    this.mysteryPostFlipImmunityUntil = 0;
    this.prevMysteryFlipActive = false;

    document.body.classList.remove("mirror-warning", "mirror-flash", "rift-door-mode");
    this.mirrorAnnounceUntil = 0;
    this.vfxMirrorGlitchUntil = 0;
    this.vfxInvertWarpUntil = 0;
    this.vfxStumblePulseUntil = 0;
    this.nearMissFlashUntil = 0;
    this.lifeLostBannerUntil = 0;
    this.lifeLostFreezeUntil = 0;
    this.lifeLostHitImmunityUntil = 0;
    this.mirrorProtocolImmunityUntil = 0;
    this.mirrorCamRoll = 0;
    this.mirrorLayer = false;
    this.mirrorPhysicsFlip = false;
    this.worldFlipX = false;
    this.worldGroup.scale.set(1, 1, 1);
    this.applyVisualLayer(false);
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
