import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const LANES = [-1, 0, 1] as const;
const LANE_WIDTH = 2.15;
const CHUNK_LENGTH = 18;
const PLAYER_Z = 0;
const SPAWN_AHEAD = 82;
const DESPAWN_BEHIND = 38;
/** Minimum advance of `nextObstacleAt` so hazards never stack tighter than reaction + lane move time. */
const MIN_OBSTACLE_STEP = 9.75;
/** In spawn-distance space: blocks closer than this cannot occupy all three lanes (no unavoidable wall). */
const BLOCK_CLUSTER_D = 9.5;
/** Each time floor(score / this) increases, run speed bumps (target + max cap). */
const SCORE_SPEED_MILESTONE = 2000;
const SPEED_BONUS_PER_MILESTONE = 2.35;
const VMAX_BONUS_PER_MILESTONE = 1.35;
const MAX_SPEED_MILESTONES = 14;

/** Mirror Reality System: fixed cadence + telegraph (see `MIRROR_*`). */
const MIRROR_CYCLE_MS = 15000;
const MIRROR_WARN_MS = 1000;
const STARTING_LIVES = 3;

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

  private velocityZ = 14;
  private distance = 0;
  private aliveTime = 0;
  private score = 0;

  private jumping = false;
  private jumpVel = 0;
  private sliding = false;
  private slideTimer = 0;

  private chunks: RoadChunk[] = [];
  private obstacles: Obstacle[] = [];
  private nextObstacleAt = 18;

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

  private chase = 0;
  private stumbleCooldown = 0;
  private lives = STARTING_LIVES;

  private touchStart: { x: number; y: number; t: number } | null = null;
  private lifeLostBannerUntil = 0;

  private running = false;
  private gameOver = false;
  private gameOverReason = "";

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

  getChase(): number {
    return this.chase;
  }

  getMirrorLayer(): boolean {
    return this.mirrorLayer;
  }

  getMirrorHint(): string {
    if (!this.isRunning()) return "";
    const now = performance.now();
    const w = this.getMirrorWarningProgress();
    if (w > 0 && this.mirrorNextFireAt > 0) {
      const sec = Math.max(0, (this.mirrorNextFireAt - now) / 1000);
      return `MIRROR REALITY — ${sec.toFixed(1)}s`;
    }
    if (now < this.mirrorAnnounceUntil) return this.lastMirrorMessage;
    return "";
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
    this.velocityZ = 14;
    this.distance = 0;
    this.aliveTime = 0;
    this.score = 0;
    this.chase = 0;
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
    this.nextObstacleAt = 18;
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
    if (!this.running || this.gameOver) return 0;
    const now = performance.now();
    if (now < this.mirrorWarningStartAt || now >= this.mirrorNextFireAt) return 0;
    return THREE.MathUtils.clamp((now - this.mirrorWarningStartAt) / MIRROR_WARN_MS, 0, 1);
  }

  /** Seconds until Mirror Reality fires; 0 outside the 1s warning window. */
  getMirrorSecondsRemaining(): number {
    if (!this.running || this.gameOver) return 0;
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

  /** 0–1: chromatic / danger pulse (chase, telegraph, stumble). */
  getVfxDangerChroma(): number {
    if (!this.isRunning()) return 0;
    const now = performance.now();
    const chaseN = Math.pow(Math.max(0, (this.chase - 0.4) / 0.6), 1.25);
    const warn = this.getMirrorWarningProgress();
    const stumble =
      now < this.vfxStumblePulseUntil
        ? THREE.MathUtils.clamp((this.vfxStumblePulseUntil - now) / 400, 0, 1)
        : 0;
    const g = this.getVfxMirrorGlitch();
    return THREE.MathUtils.clamp(chaseN * 0.82 + warn * 0.58 + stumble * 0.95 + g * 0.22, 0, 1);
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

  private applyFullMirrorShift(): void {
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
    this.announce(
      this.mirrorLayer
        ? "FULL SHIFT: Mirror plane — track and hazards slipped"
        : "FULL SHIFT: Real plane stabilized",
      2800,
    );
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
      this.applyFullMirrorShift();
    }

    this.scheduleMirrorRealityCycle(performance.now());
  }

  private tickMirrorRealitySystem(now: number): void {
    if (now >= this.mirrorNextFireAt) {
      this.executeMirrorReality();
    }
  }

  private applyVisualLayer(mirror: boolean): void {
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
      if (obj instanceof THREE.Group && obj.userData.bridgeCluster) {
        const bc = obj.userData.bridgeCluster as { base: number; d: number; baseRy: number; dRy: number };
        obj.position.x = mirror ? bc.base + bc.d : bc.base;
        obj.rotation.y = mirror ? bc.baseRy + bc.dRy : bc.baseRy;
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
    const sim = this.running && !this.gameOver;
    const px = this.player.position.x;
    const lateralVel = sim ? (px - this.prevPlayerWorldX) / Math.max(dt, 1e-4) : 0;
    this.prevPlayerWorldX = px;

    const speedN = THREE.MathUtils.clamp((this.velocityZ - 10) / 26, 0, 1);
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

  private addElevatedHighway(parent: THREE.Group, seed: number): void {
    const deckW = LANE_WIDTH * 4.4;
    const deckD = CHUNK_LENGTH * 0.82;
    const deckMat = new THREE.MeshStandardMaterial({
      color: 0x060810,
      metalness: 0.88,
      roughness: 0.32,
      emissive: 0x081018,
      emissiveIntensity: 0.18,
    });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(deckW, 0.14, deckD), deckMat);
    deck.position.set(0, 4.35 + (seed % 3) * 0.06, 0);
    deck.castShadow = true;
    deck.receiveShadow = true;
    parent.add(deck);

    const railMat = new THREE.MeshStandardMaterial({
      color: 0x010204,
      emissive: 0x00f5ff,
      emissiveIntensity: 0.65,
      metalness: 0.7,
      roughness: 0.22,
    });
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, deckD * 0.98), railMat);
      rail.position.set(sx * deckW * 0.48, deck.position.y + 0.16, 0);
      rail.userData.neon = true;
      parent.add(rail);
    }

    for (let i = -1; i <= 1; i += 2) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.2, deck.position.y - 0.1, 8),
        deckMat,
      );
      col.position.set(i * deckW * 0.42, (deck.position.y - 0.1) * 0.5, deckD * 0.38);
      col.castShadow = true;
      parent.add(col);
      const col2 = col.clone();
      col2.position.z = -deckD * 0.38;
      parent.add(col2);
    }
  }

  private addBridgeSpan(parent: THREE.Group, _zCenter: number, seed: number): void {
    if (seed % 2 === 0) return;
    const bridge = new THREE.Group();
    const spanLocalZ = ((seed % 5) - 2) * 2.2;
    bridge.position.set(0, 0, spanLocalZ);
    const skew = ((seed % 11) / 11 - 0.5) * 0.08;
    bridge.userData.bridgeCluster = { base: 0, d: skew * 4, baseRy: 0, dRy: skew };

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH * 3.9, 0.12, 2.8),
      new THREE.MeshStandardMaterial({
        color: 0x070a12,
        metalness: 0.8,
        roughness: 0.28,
        emissive: 0x12081a,
        emissiveIntensity: 0.22,
      }),
    );
    deck.position.y = 2.05;
    deck.receiveShadow = true;
    deck.castShadow = true;
    bridge.add(deck);

    const cableMat = new THREE.MeshStandardMaterial({
      color: 0x111822,
      emissive: 0x66ffff,
      emissiveIntensity: 0.45,
      metalness: 0.6,
      roughness: 0.25,
    });
    for (const sx of [-1, 1]) {
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 2.3, 0.35),
        new THREE.MeshPhysicalMaterial({
          color: 0x050810,
          metalness: 0.75,
          roughness: 0.22,
          clearcoat: 0.6,
          emissive: 0x020408,
          emissiveIntensity: 0.08,
        }),
      );
      tower.position.set(sx * LANE_WIDTH * 2.25, 1.15, 0);
      tower.castShadow = true;
      bridge.add(tower);

      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.2, 6), cableMat);
      cable.rotation.z = Math.PI / 2;
      cable.position.set(sx * LANE_WIDTH * 1.1, 2.35, 0);
      cable.userData.neon = true;
      bridge.add(cable);
    }
    parent.add(bridge);
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

    this.addElevatedHighway(group, seed);
    this.addBridgeSpan(group, zCenter, seed);

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

  private spawnObstacle(): void {
    const z = -SPAWN_AHEAD - this.distance;
    const dNew = this.distance;
    const roll = Math.random();
    let kind: ObstacleKind;
    if (roll < 0.38) kind = "block";
    else if (roll < 0.69) kind = "low";
    else kind = "high";

    let lanePick = LANES[Math.floor(Math.random() * 3)];

    const blockLanesInCluster = new Set<0 | 1 | 2>();
    for (const o of this.obstacles) {
      if (o.kind !== "block") continue;
      const dO = -o.z - SPAWN_AHEAD;
      if (Math.abs(dO - dNew) > BLOCK_CLUSTER_D) continue;
      blockLanesInCluster.add(laneToGridIndex(o.lane));
    }

    if (kind === "block") {
      if (blockLanesInCluster.size >= 3) {
        kind = Math.random() < 0.55 ? "low" : "high";
      } else if (blockLanesInCluster.size === 2) {
        const free = ([0, 1, 2] as const).find((i) => !blockLanesInCluster.has(i))!;
        lanePick = gridIndexToLane(free);
      }
    }

    const group = new THREE.Group();
    group.position.z = z;

    if (kind === "block") {
      const core = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 1.6, 1.1),
        new THREE.MeshStandardMaterial({
          color: 0x120818,
          emissive: 0xff0066,
          emissiveIntensity: 0.95,
          metalness: 0.4,
          roughness: 0.35,
        }),
      );
      core.position.y = 0.8;
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
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, 0.35, 0.6),
        new THREE.MeshStandardMaterial({
          color: 0x10061a,
          emissive: 0xaa66ff,
          emissiveIntensity: 0.92,
        }),
      );
      beam.position.y = 1.35;
      beam.castShadow = true;
      group.add(beam);
      const postL = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.1, 1.35, 8),
        new THREE.MeshStandardMaterial({ color: 0x0a0a12, metalness: 0.8, roughness: 0.3 }),
      );
      postL.position.set(-1.15, 0.65, 0);
      const postR = postL.clone();
      postR.position.x = 1.15;
      group.add(postL, postR);
    }

    group.position.x = lanePick * LANE_WIDTH;
    this.worldGroup.add(group);
    this.obstacles.push({ mesh: group, lane: lanePick, z, kind, hit: false, nearEvaluated: false });
  }

  private queueLane(dir: -1 | 1): void {
    let d = dir;
    if (this.invertLR) d = (-d) as -1 | 1;
    const next = THREE.MathUtils.clamp(this.targetLane + d, 0, 2);
    this.targetLane = next;
  }

  private tryJump(): void {
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
    this.chase = Math.min(1, this.chase + 0.14);
    this.velocityZ *= 0.82;
    this.vfxStumblePulseUntil = performance.now() + 420;
    this.lastStumbleUnderMirror = this.invertLR || this.swapJumpSlide || this.mirrorLayer;
  }

  private triggerNearMiss(): void {
    this.score += 38;
    this.nearMissFlashUntil = performance.now() + 260;
    this.chase = Math.max(0, this.chase - 0.042);
    this.bumpMirrorCamera(0.028);
  }

  /** When obstacle passes behind player, reward razor-thin clears. */
  private scanNearMissPasses(): void {
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
          Math.abs(ox - px) < 1.32 && headTop <= 1.16 && headTop >= 0.88;
      }
      if (tight) this.triggerNearMiss();
    }
  }

  private checkCollisions(): void {
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
        this.collideFail(o);
      } else if (o.kind === "low") {
        const clearH = this.mirrorPhysicsFlip ? 0.58 : 0.74;
        if (charY < clearH) this.collideFail(o);
      } else {
        const headTop = charY + (this.sliding ? 0.78 : 1.58);
        if (headTop > 1.08) this.collideFail(o);
      }
    }
  }

  private collideFail(o: Obstacle): void {
    if (o.hit) return;
    o.hit = true;
    this.lives -= 1;
    this.stumble();
    if (this.lives > 0) {
      this.lifeLostBannerUntil = performance.now() + 2800;
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
    if (this.running && !this.gameOver) {
      this.tickMirrorRealitySystem(performance.now());

      const diffRamp = 1 + this.aliveTime * 0.02;
      const scoreMilestones = Math.min(
        MAX_SPEED_MILESTONES,
        Math.floor(this.score / SCORE_SPEED_MILESTONE),
      );
      const scoreSpeedBoost = scoreMilestones * SPEED_BONUS_PER_MILESTONE;
      const vmax = 42 + scoreMilestones * VMAX_BONUS_PER_MILESTONE;
      const targetV = 14.6 + this.aliveTime * 0.72 * diffRamp + scoreSpeedBoost;
      this.velocityZ += (targetV - this.velocityZ) * Math.min(1, dt * 1.55);
      this.velocityZ = THREE.MathUtils.clamp(this.velocityZ, 10.5, vmax);

      this.distance += this.velocityZ * dt;
      this.aliveTime += dt;
      this.worldGroup.position.z = this.distance;
      if (this.mirrorLayer) {
        this.worldGroup.position.x = Math.sin(this.aliveTime * 2.08) * 0.12;
      } else {
        this.worldGroup.position.x = THREE.MathUtils.lerp(this.worldGroup.position.x, 0, Math.min(1, dt * 6));
      }

      this.chase += dt * (0.045 + this.aliveTime * 0.0009);
      this.chase -= dt * 0.028;
      this.chase = THREE.MathUtils.clamp(this.chase, 0, 1);

      if (this.chase >= 1) {
        this.endGame("CHASE");
      } else {
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

        if (this.jumping) {
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

        const spacing = Math.max(
          MIN_OBSTACLE_STEP,
          THREE.MathUtils.lerp(11.2, 4.85, Math.min(1, this.aliveTime / 88)) + randRange(-1.2, 2.2),
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
      }
    }

    this.updateThiefAvatar(dt);

    const warnP = this.getMirrorWarningProgress();
    this.mirrorCamRoll = THREE.MathUtils.lerp(this.mirrorCamRoll, 0, Math.min(1, dt * 3.8));
    const warnOsc = warnP * 0.055 * Math.sin(this.aliveTime * 36 + warnP * 6.28);

    const t = this.running ? this.aliveTime : performance.now() * 0.0004;
    const bob = Math.sin(t * 6) * 0.04;
    this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, this.player.position.x * 0.28, dt * 3);
    this.camera.position.y = 3.2 + bob + (this.chase > 0.65 ? this.chase * 0.35 : 0);
    this.camera.lookAt(
      this.player.position.x * 0.15,
      1.1 + this.playerY * 0.08,
      this.player.position.z - 10,
    );
    this.camera.rotateZ(this.mirrorCamRoll + warnOsc);
  }

  private endGame(reason: string): void {
    this.gameOver = true;
    this.running = false;
    if (reason === "CHASE") {
      const mirrorChaos = this.invertLR || this.swapJumpSlide || this.mirrorLayer;
      const protocolFresh = performance.now() - this.lastMirrorProtocolAt < 6500;
      const parts: string[] = [];
      if (this.invertLR) parts.push("strafe was inverted");
      if (this.swapJumpSlide) parts.push("jump and slide were swapped");
      if (this.mirrorLayer) parts.push("mirror layer was live");
      if (mirrorChaos || protocolFresh || this.lastStumbleUnderMirror) {
        const explain =
          parts.length > 0
            ? `${parts.join(" · ")} — `
            : protocolFresh
              ? "a Mirror protocol had just fired — "
              : this.lastStumbleUnderMirror
                ? "you were still paying off a hit under mirror rules — "
                : "";
        this.gameOverReason = `Mirror Enforcement caught you. ${explain}You read the old control map — the mirror read you first.`;
      } else {
        this.gameOverReason =
          "Mirror Enforcement caught you — the gap closed clean; next run, steal more distance early.";
      }
    } else {
      this.gameOverReason = reason;
    }

    document.body.classList.remove("mirror-warning", "mirror-flash");
    this.mirrorAnnounceUntil = 0;
    this.vfxMirrorGlitchUntil = 0;
    this.vfxInvertWarpUntil = 0;
    this.vfxStumblePulseUntil = 0;
    this.nearMissFlashUntil = 0;
    this.lifeLostBannerUntil = 0;
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
