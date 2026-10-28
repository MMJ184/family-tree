import {
  ACESFilmicToneMapping,
  MathUtils,
  Matrix4,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { setDragMode } from '#/lib/orbit.ts';
import { disposeTree, type Shared } from './gl.ts';
import { LabelLayer, type LabelMode } from './labels.ts';
import type { StudioModel, StudioPerson } from './model.ts';
import { ease, NOW, PAL } from './palette.ts';
import { Atlas, createMedals, type Medals, sizeFactor } from './portraits.ts';
import { BUILD, type SceneDef, type SceneKey } from './scenes/index.ts';
import type { SceneCtx } from './scenes/types.ts';

// The 3D studio engine: plain three.js, mounted into a container by the React view.
// Owns the renderer, camera, post-processing, the shared portrait billboards, the
// scenes (built lazily, morphing between them), labels, picking, the time loop and the
// adaptive quality. dispose() frees every GPU resource and listener it created.

export type Quality = 0 | 1 | 2;
export type { LabelMode };
/** Camera presets for setView(): the scene's own angle, straight down, level from the front, level from the side. */
export type ViewPreset = 'default' | 'top' | 'front' | 'side';

/**
 * Fallbacks for when the page layout cannot be measured (see measure()): the scene rail (ui/SceneRail.tsx,
 * a 14rem column plus its inset) on the start side from the md breakpoint up...
 */
const RAIL_MEDIA = '(min-width: 48rem)';
const RAIL_WIDTH = 236;
/** ...and below it, a strip of scene buttons above the timeline. */
const RAIL_STRIP = 52;
/** The tree route's person panel (22rem plus its inset) covers the end side while someone is selected. */
const PANEL_WIDTH = 364;
/** Route chrome over the stage: the view switcher and person search on top, the studio timeline at the bottom. */
const TOP_INSET = 60;
const BOTTOM_INSET = 72;
/** Selection framing keeps the current view direction while it is within this angle of the scene's own view. */
const KEEP_DIR = MathUtils.degToRad(60);
/** World radius of a portrait disc per unit of size (portraits.ts: a quad of 2.3 × size, disc of radius 1). */
const DISC = 1.15;
/** The selected person's portrait is drawn this much larger. */
const SEL_GROW = 1.3;
/** Height of a two-line name pill in px (labels.ts), before the scene's labelScale. */
const PILL_H = 36;
/** Double-click on the empty stage zooms in by this factor towards the point. */
const DBL_ZOOM = 1.6;
const ORIGIN = new Vector3();
/** Insets used before anything could be measured (route layout: toolbar on top, timeline at the bottom). */
const FALLBACK: Readonly<Insets> = { l: 0, r: 0, t: TOP_INSET, b: BOTTOM_INSET };
/**
 * Development only: when a hot reload last replaced modules. A view re-created right after it skips the opening
 * growth, so screenshots taken after an edit show the family, not its first years.
 */
const hotData = import.meta.hot?.data as { reloadAt?: number } | undefined;
import.meta.hot?.on('vite:beforeUpdate', () => {
  if (hotData) hotData.reloadAt = performance.now();
});
/** Floating UI that does not count as covering the stage (see measure()). */
const TRANSIENT = '[role="dialog"],[role="menu"],[role="listbox"],[role="tooltip"],[role="status"]';

export interface StudioState {
  scene: SceneKey;
  year: number;
  playing: boolean;
  follow: boolean;
  spin: boolean;
  /** One-finger / left-button drag moves the scene instead of turning it. */
  pan: boolean;
  quality: Quality;
  fps: number;
  calls: number;
  /** The frame rate stayed very low even at the lowest quality. */
  weak: boolean;
  /** Camera zoom, 0 = furthest allowed to 1 = closest allowed (log scale, same mapping as setZoom). */
  zoom: number;
  labels: LabelMode;
  /** The scene rail is open over the stage's start side. */
  rail: boolean;
}

export interface StudioText {
  name(p: StudioPerson): string;
  years(p: StudioPerson): string;
  /** Tooltip line under the name: generation or "married in". */
  role(p: StudioPerson): string;
}

export interface StudioOptions {
  container: HTMLElement;
  model: StudioModel;
  lang: string;
  dark: boolean;
  year: number;
  /** Earliest year on the timeline (play restarts here). */
  minYear: number;
  scene: SceneKey;
  selectedId: string | null;
  reduced: boolean;
  text: StudioText;
  onSelect(id: string | null): void;
  onState(patch: Partial<StudioState>): void;
}

export type GlSupport = 'ok' | 'none' | 'weak';

/** A camera move, interpolated around the target: target linearly, view direction along the sphere, distance in log space. */
interface Flight {
  t0: number;
  d: number;
  ft: Vector3;
  tt: Vector3;
  /** Unit view direction (target to camera) at the end. */
  td: Vector3;
  /**
   * The view direction turns as azimuth about world up (the short way round) and polar angle, like an orbit, so
   * a large swing goes round the scene rather than over the top of it.
   */
  fa: number;
  da: number;
  fp: number;
  tp: number;
  fr: number;
  tr: number;
  /** Long moves pull back by this fraction mid-flight, so both ends stay in view. */
  arc: number;
  /** It replaced a running move: start at speed instead of from rest. */
  out: boolean;
}

/** Stage px covered by floating UI on each physical side (left, right, top, bottom). */
interface Insets {
  l: number;
  r: number;
  t: number;
  b: number;
}

/** Layout box of an element relative to an ancestor, from offsets (ignores transforms such as slide-in animations). */
function layoutBox(el: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  let e: HTMLElement | null = el;
  while (e && e !== root) {
    x += e.offsetLeft;
    y += e.offsetTop;
    e = e.offsetParent as HTMLElement | null;
  }
  return e === root ? { x, y, w: el.offsetWidth, h: el.offsetHeight } : null;
}

/** Cuts a covered box off the free area from whichever side loses the least more of it (given the cuts so far). */
function cutAway(ins: Insets, x: number, y: number, w: number, h: number, W: number, H: number) {
  if (x + w <= ins.l || x >= W - ins.r || y + h <= ins.t || y >= H - ins.b) return;
  const fw = W - ins.l - ins.r;
  const fh = H - ins.t - ins.b;
  const opts: Array<[number, keyof Insets, number]> = [
    [(x + w - ins.l) * fh, 'l', x + w],
    [(W - x - ins.r) * fh, 'r', W - x],
    [(y + h - ins.t) * fw, 't', y + h],
    [(H - y - ins.b) * fw, 'b', H - y],
  ];
  opts.sort((a, b) => a[0] - b[0]);
  const [, side, v] = opts[0] as [number, keyof Insets, number];
  ins[side] = Math.max(ins[side], v);
}

/** Tangents of the free area's half-angles around the view axis (horizontal both ways, up, down). */
interface Tans {
  h: number;
  u: number;
  d: number;
}

/** Checks for WebGL2 and a hardware GPU without keeping a context alive. */
export function probeWebGL(): GlSupport {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'none';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)) return 'weak';
    const nav = navigator as Navigator & { deviceMemory?: number };
    if ((nav.hardwareConcurrency ?? 8) <= 2 && (nav.deviceMemory ?? 8) <= 2) return 'weak';
    return 'ok';
  } catch {
    return 'none';
  }
}

const easeOut = (x: number) => 1 - (1 - x) ** 3;

export class Studio {
  private readonly o: StudioOptions;
  private M: StudioModel;
  private minYear: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly tip: HTMLDivElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(42, 1, 0.5, 3000);
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloom: UnrealBloomPass;
  private readonly output: OutputPass;
  private readonly U: Shared = {
    uYear: { value: NOW },
    uTime: { value: 0 },
    uEnter: { value: 1 },
    uMinYear: { value: 1900 },
  };
  private atlas: Atlas;
  private medals: Medals;
  private readonly labels: LabelLayer;
  private readonly SC: Partial<Record<SceneKey, SceneDef>> = {};
  private readonly ctx: SceneCtx;
  private readonly ro: ResizeObserver;
  private readonly cleanups: Array<() => void> = [];

  private lang: string;
  private dark: boolean;
  private text: StudioText;
  private cur: SceneKey;
  private sel: string | null;
  private hover: string | null = null;
  private hourCentre: string;
  private year: number;
  private playing = false;
  private follow = true;
  private spin: boolean;
  /** Auto-spin waits a few seconds after the user handles the camera. */
  private spinHold = false;
  private railOpen = true;
  /** Measured floating UI over the stage: without and with the person panel (see measure()). */
  private cov: { base: Insets; full: Insets } | null = null;
  /**
   * What the engine last framed (the selected lineage or the whole scene) and the free area it used. While
   * the user has not moved the camera since, a change of the free area (late layout, resize, rail) re-frames.
   */
  private framed: { what: 'lineage' | 'scene' | 'all'; key: string; dir: Vector3 } | null = null;
  /**
   * The direction the engine last framed from (a preset when `preset`). It outlives deselection, zooming and
   * auto-spin, so picking someone frames the same way every time, and is dropped only when the user turns the
   * camera (see frameDir).
   */
  private aim: { dir: Vector3; preset: boolean } | null = null;
  /** View direction when the pointer went down (a drag that turns the camera drops `aim`). */
  private readonly downDir = new Vector3();
  private labelMode: LabelMode = 'all';
  private quality: { level: Quality; since: number; up: number; weakSince: number; weak: boolean } = {
    level: 2,
    since: 0,
    up: 0,
    weakSince: 0,
    weak: false,
  };
  private hiArr: ArrayLike<number> = new Float32Array(0);
  private morph: { t0: number; d: number } | null = null;
  /** Current horizontal projection shift in px (see shiftTarget). */
  private viewShift = 0;
  /** Portrait positions to morph from when the open scene is rebuilt in place (language change). */
  private relayoutFrom: Float32Array | null = null;
  private fly: Flight | null = null;
  /** Eased zoom (buttons): camera distance from / to, in log space. */
  private zoomAnim: { t0: number; d: number; from: number; to: number } | null = null;
  /** The current scene's zoom limits (camera to target distance) and the portraits' extent (clip planes). */
  private readonly lim = { min: 6, max: 900, extent: 200 };
  private zoomSent = { v: -1, at: 0 };
  /** Opening growth: uEnter eases from `from` to 1 (the family grows from its first year to the chosen one). */
  private enter: { t0: number; d: number; from: number } | null = null;
  private raf = 0;
  private hoverRaf = 0;
  private spinTimer = 0;
  private down: { x: number; y: number; took: boolean } | null = null;
  private last = performance.now();
  private labelT = 0;
  private hudT = 0;
  private playAcc = 0;
  private lastFollow = 0;
  private lastHook = Number.NaN;
  private fpsAvg = 60;
  private disposed = false;
  private readonly v1 = new Vector3();
  private readonly v2 = new Vector3();
  private readonly v3 = new Vector3();
  private readonly v4 = new Vector3();
  private readonly t1 = new Vector3();
  private readonly c1 = new Vector3();
  private readonly m4 = new Matrix4();
  private readonly vView = new Vector3();

  constructor(o: StudioOptions) {
    this.o = o;
    this.M = o.model;
    this.minYear = o.minYear;
    this.lang = o.lang;
    this.dark = o.dark;
    this.text = o.text;
    this.cur = o.scene;
    this.sel = o.selectedId && o.model.byId.has(o.selectedId) ? o.selectedId : null;
    this.hourCentre = this.sel ?? o.model.root.id;
    this.year = o.year;
    this.spin = !o.reduced;

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText =
      'position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;outline:none;';
    o.container.appendChild(this.canvas);
    try {
      this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      this.canvas.remove();
      throw e;
    }
    if (!this.renderer.capabilities.isWebGL2) {
      this.renderer.dispose();
      this.canvas.remove();
      throw new Error('WebGL2 unavailable');
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera.position.set(60, 46, 90);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    // The wheel zooms towards the pointer. The orbit target stays on the view axis, which the projection
    // offset (setShift) puts in the middle of the free area, so this agrees with what is on screen.
    this.controls.zoomToCursor = true;
    this.controls.zoomSpeed = 1.3;
    this.controls.maxDistance = this.lim.max;
    this.controls.minDistance = this.lim.min;
    this.controls.autoRotateSpeed = 0.35;
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.9, 0.55, 0.9);
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this.labels = new LabelLayer(o.container, {
      people: () => this.M.people,
      camera: this.camera,
      size: () => ({ w: o.container.clientWidth, h: o.container.clientHeight }),
      current: () => this.SC[this.cur],
      personPos: (i, out) => this.personPos(i, out),
      effYear: () => this.effYear(),
      appearAt: (i) => this.appearAt(i),
      hi: (i) => this.hiArr[i] ?? 0,
      selected: () => this.sel,
      hovered: () => this.hover,
      mode: () => this.labelMode,
      name: (p) => this.text.name(p),
      years: (p) => this.text.years(p),
    });
    this.tip = document.createElement('div');
    this.tip.style.cssText = [
      'position:absolute;left:0;top:0;z-index:3;pointer-events:none;display:flex;gap:10px;align-items:center',
      'max-width:280px;padding-block:7px;padding-inline:7px 14px;border-radius:999px',
      'background:var(--ft-popover);color:var(--ft-popover-foreground);border:1px solid var(--ft-border)',
      'box-shadow:0 1px 2px rgb(0 0 0 / 0.16),0 12px 32px rgb(0 0 0 / 0.22)',
    ].join(';');
    this.tip.hidden = true;
    o.container.appendChild(this.tip);

    this.ctx = {
      M: this.M,
      U: this.U,
      big: this.M.n > 100,
      pal: () => (this.dark ? PAL.dark : PAL.light),
      dark: () => this.dark,
      rtl: () => this.lang === 'ar',
      lang: () => this.lang,
      look: (b, e) => {
        this.bloom.strength = b;
        // No bloom (light theme): skip the pass instead of running it for nothing.
        this.bloom.enabled = b > 0.001 && this.quality.level > 0;
        this.renderer.toneMappingExposure = e;
      },
      effYear: () => this.effYear(),
      focusId: () => this.hourCentre,
    };

    this.atlas = new Atlas(this.M);
    this.atlas.loadPhotos();
    this.medals = createMedals(this.M, this.U, this.atlas);
    this.syncMedalTheme();
    this.scene.add(this.medals.mesh);
    this.U.uMinYear.value = this.M.minYear;

    this.bindPointer();
    this.syncSpin();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(o.container);
    this.resize();
    void document.fonts?.ready.then(() => {
      if (!this.disposed) this.labels.reset();
    });

    this.setScene(this.cur, true);
    this.applyHighlight();
    // Opening: the family grows from its first year to the chosen one. Not when someone is already picked (a link
    // to a person: their lineage shows at once), nor when a hot reload re-creates the view during development.
    const reloaded = hotData?.reloadAt !== undefined && performance.now() - hotData.reloadAt < 4000;
    if (o.reduced || this.sel || reloaded) this.U.uEnter.value = 1;
    else {
      this.U.uEnter.value = 0;
      this.enter = { t0: performance.now() + 300, d: 3200, from: 0 };
    }
    this.U.uYear.value = this.year;
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------- public API ----------

  /**
   * Swaps in new family data (after an edit or refetch) without recreating the renderer:
   * the scenes, portrait atlas and billboards are rebuilt, while the current scene, camera,
   * year, language and theme are kept.
   */
  loadData(model: StudioModel, minYear: number) {
    if (this.disposed) return;
    this.minYear = minYear;
    if (model === this.M) return;
    this.M = model;
    this.ctx.M = model;
    this.ctx.big = model.n > 100;
    for (const key of Object.keys(this.SC) as SceneKey[]) this.drop(key);
    this.scene.remove(this.medals.mesh);
    this.medals.geo.dispose();
    this.medals.mat.dispose();
    this.atlas.dispose();
    this.atlas = new Atlas(model);
    this.atlas.loadPhotos();
    this.medals = createMedals(model, this.U, this.atlas);
    this.syncMedalTheme();
    this.scene.add(this.medals.mesh);
    this.U.uMinYear.value = model.minYear;
    this.hover = null;
    this.tip.hidden = true;
    this.lastHook = Number.NaN;
    const lost = this.sel !== null && !model.byId.has(this.sel);
    if (lost) this.sel = null;
    if (!model.byId.has(this.hourCentre)) this.hourCentre = this.sel ?? model.root.id;
    this.labels.reset();
    this.setScene(this.cur, true, true);
    if (this.year < minYear) this.setYear(minYear);
    if (lost) {
      this.syncSpin();
      this.o.onSelect(null);
    } else if (this.sel && this.framed) this.frameSelection();
  }

  setScene(key: SceneKey, instant = false, keepCamera = false) {
    if (key === 'hour') {
      const centre = this.sel ?? this.hourCentre;
      if (this.SC.hour && this.SC.hour.centre !== centre) this.drop('hour');
      this.hourCentre = centre;
    }
    const next = this.ensure(key);
    const { from, to, birth } = this.medals;
    const fromArr = from.array as Float32Array;
    if (!instant && this.relayoutFrom) fromArr.set(this.relayoutFrom);
    else if (!instant && this.SC[this.cur]) fromArr.set(this.currentPositions());
    else fromArr.set(next.pos);
    this.relayoutFrom = null;
    (to.array as Float32Array).set(next.pos);
    from.needsUpdate = true;
    to.needsUpdate = true;
    const u = this.medals.uni;
    u.uMorph.value = instant || this.o.reduced ? 1 : 0;
    u.uLift.value = next.lift;
    this.morph = instant || this.o.reduced ? null : { t0: performance.now(), d: 1500 };
    for (const s of Object.values(this.SC)) s.group.visible = s === next;
    this.cur = key;
    u.uStyle.value = next.style;
    const ab = birth.array as Float32Array;
    this.M.people.forEach((p, i) => {
      ab[i] = next.appear ? (next.appear[i] ?? p.born) : p.born;
    });
    birth.needsUpdate = true;
    u.uScale.value = next.size;
    next.tint();
    next.yearHook?.(this.effYear());
    this.applyHighlight();
    this.setLimits(next);
    if (!keepCamera) {
      // With someone selected, the new scene opens on their lineage (from the scene's own angle).
      if (this.sel) this.frameLineage(instant ? 0 : 1700, 'scene');
      else this.frameScene(instant ? 0 : 1700);
    }
    this.o.onState({ scene: key });
  }

  /** Second click on the Hourglass button: back to the founder. */
  recentreHourglass() {
    this.hourCentre = this.M.root.id;
    if (this.sel) this.o.onSelect(null);
    this.sel = null;
    this.syncSpin();
    this.setScene('hour');
  }

  select(id: string | null, fly = true) {
    const next = id && this.M.byId.has(id) ? id : null;
    if (next === this.sel) return;
    this.sel = next;
    if (!next) this.framed = null;
    // Picked while the opening growth still runs: finish it now, so the whole lineage shows.
    if (next && this.enter) this.enter = { t0: performance.now(), d: 600, from: this.U.uEnter.value };
    this.measure();
    this.syncSpin();
    // The hourglass recentres on whoever is picked (setScene then frames their lineage).
    if (this.cur === 'hour' && next && this.SC.hour?.centre !== next) {
      this.setScene('hour');
      return;
    }
    this.applyHighlight();
    this.labels.update();
    if (next && fly) this.frameSelection();
  }

  setYear(y: number) {
    this.year = Math.max(this.minYear, Math.min(NOW, Math.round(y)));
    this.o.onState({ year: this.year });
  }

  togglePlay() {
    this.playing = !this.playing;
    if (this.playing && this.year >= NOW) this.setYear(this.minYear);
    this.o.onState({ playing: this.playing });
  }

  setPlaying(on: boolean) {
    if (on !== this.playing) this.togglePlay();
  }

  setFollow(on: boolean) {
    this.follow = on;
    this.o.onState({ follow: on });
  }

  /** Auto-spin preference. It pauses while someone is selected (their framed lineage stays put) and after handling. */
  setSpin(on: boolean) {
    this.spin = on;
    this.syncSpin();
    this.o.onState({ spin: on });
  }

  setPan(on: boolean) {
    setDragMode(this.controls, on);
    this.o.onState({ pan: on });
  }

  /** Alias of frameAll(). */
  fit() {
    this.frameAll();
  }

  /** Fits the whole scene: the scene's own view, pulled back until every visible person is in the free area. */
  frameAll() {
    this.frameScene(1200);
  }

  /** Flies to the whole scene from the scene's own angle (see sceneView). */
  private frameScene(d: number) {
    const cur = this.SC[this.cur];
    if (!cur) return;
    const dir = this.sceneDir(cur, this.vView);
    if (!this.stageReady()) return this.pending('scene', dir);
    this.sceneView(cur, this.t1, this.c1);
    if (this.flyCam(this.t1, this.c1, d)) this.setFramed('scene', this.sceneDir(cur, this.v1));
  }

  /** Flies to everyone shown, seen along `dir` (view presets while nobody is selected). */
  private frameEveryone(dir: Vector3, d: number) {
    const cur = this.SC[this.cur];
    if (!cur) return;
    const look = this.v4.copy(dir).normalize();
    if (!this.stageReady()) return this.pending('all', look);
    let dist = this.fitPeople(cur, this.visibleIdx(), look, this.labelMode !== 'off', this.t1);
    if (!(dist > 0)) return;
    dist = MathUtils.clamp(dist, this.lim.min, this.lim.max);
    this.c1.copy(this.t1).addScaledVector(look, dist);
    if (this.flyCam(this.t1, this.c1, d)) this.setFramed('all', look);
  }

  /** Remembers what the engine framed, from which direction and in which free area (see refit()). */
  private setFramed(what: 'lineage' | 'scene' | 'all', dir: Vector3) {
    this.framed = { what, key: this.coverKey(), dir: dir.clone() };
    this.aim = { dir: dir.clone(), preset: false };
  }

  /** The stage is not laid out yet: frame as soon as it is (refit() sees the key change). */
  private pending(what: 'lineage' | 'scene' | 'all', dir: Vector3) {
    this.framed = { what, key: '', dir: dir.clone() };
  }

  private stageReady() {
    return this.o.container.clientWidth > 0 && this.o.container.clientHeight > 0;
  }

  /** The free area changed (late layout, resize, rail, full screen) while the engine still owns the camera: frame again. */
  private refit() {
    const F = this.framed;
    if (!F || F.key === this.coverKey()) return;
    if (F.what === 'lineage') this.frameLineage(700, F.dir);
    else if (F.what === 'all') this.frameEveryone(F.dir, 700);
    else this.frameScene(700);
    // Nothing to frame any more (the selection went away): leave the camera to the user.
    if (this.framed === F) this.framed = null;
  }

  /** The free area, rounded, as framing saw it. */
  private coverKey() {
    const i = this.insets();
    const q = (v: number) => Math.round(v / 8);
    return `${q(i.l)},${q(i.r)},${q(i.t)},${q(i.b)},${q(this.o.container.clientWidth)},${q(this.o.container.clientHeight)}`;
  }

  /**
   * Frames the selected person's lineage (ancestors, descendants, spouses: the highlighted set) in the free
   * area of the stage. Does nothing without a selection.
   */
  frameSelection() {
    this.frameLineage(1300, 'keep');
  }

  /**
   * Flies to the selected lineage, looking from the scene's own angle ('scene', a new scene), from the current
   * angle within limits ('keep', see frameDir) or along a given direction (view presets, re-framing).
   */
  private frameLineage(d: number, from: 'scene' | 'keep' | Vector3) {
    const cur = this.SC[this.cur];
    if (!this.sel || !cur || !this.M.byId.has(this.sel)) return;
    const idx = this.frameIdx(cur, this.sel);
    const dir =
      from instanceof Vector3 ? this.v4.copy(from).normalize() : this.frameDir(cur, this.v4, from === 'scene');
    if (!this.stageReady()) return this.pending('lineage', dir);
    let dist = this.fitPeople(cur, idx, dir, this.labelMode !== 'off', this.t1);
    if (!(dist > 0)) return;
    // Never closer than the scene's close-up distance: a lone person or a couple is not pushed into the lens.
    dist = Math.max(dist, cur.follow);
    dist = MathUtils.clamp(dist, this.lim.min, this.lim.max);
    this.c1.copy(this.t1).addScaledVector(dir, dist);
    if (this.flyCam(this.t1, this.c1, d)) this.setFramed('lineage', dir);
  }

  /** Zooms by a factor (< 1 closer, > 1 further), eased over ~300 ms and clamped to the scene's limits. */
  zoomBy(factor: number) {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    this.framed = null;
    const F = this.fly;
    if (F) {
      // Mid-flight: carry on from here to the same place, landing closer or further.
      const left = Math.max(350, F.d - (performance.now() - F.t0));
      const tr = MathUtils.clamp(F.tr * factor, this.lim.min, this.lim.max);
      this.t1.copy(F.tt);
      this.c1.copy(F.tt).addScaledVector(F.td, tr);
      this.flyCam(this.t1, this.c1, left);
      return;
    }
    const d0 = this.distance();
    const base = this.zoomAnim ? this.zoomAnim.to : d0;
    // Outside the limits (the stage shrank): never move the wrong way.
    const to = MathUtils.clamp(base * factor, Math.min(this.lim.min, d0), Math.max(this.lim.max, d0));
    if (this.o.reduced) {
      this.zoomAnim = null;
      this.setDistance(to);
      return;
    }
    this.zoomAnim = { t0: performance.now(), d: 300, from: d0, to };
  }

  /** Sets the zoom at once (slider): t = 0 is the furthest allowed distance, 1 the closest, on a log scale. */
  setZoom(t: number) {
    if (!Number.isFinite(t)) return;
    const z = MathUtils.clamp(t, 0, 1);
    this.framed = null;
    this.fly = null;
    this.zoomAnim = null;
    this.setDistance(Math.exp(MathUtils.lerp(Math.log(this.lim.max), Math.log(this.lim.min), z)));
    this.zoomSent = { v: z, at: performance.now() };
    this.o.onState({ zoom: z });
  }

  /**
   * Looks from a preset angle (the scene's own, straight down, level from the front or from the side) and
   * frames the selected lineage, or everyone shown, from there. Auto-spin pauses, as after handling.
   */
  setView(v: ViewPreset) {
    const cur = this.SC[this.cur];
    if (!cur) return;
    const def = this.sceneDir(cur, this.v1);
    const flat = this.v2.set(def.x, 0, def.z);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
    flat.normalize();
    const dir = this.vView;
    if (v === 'top') dir.set(flat.x * 0.002, 1, flat.z * 0.002).normalize();
    else if (v === 'front') dir.copy(flat);
    // Arabic scenes are mirrored, so the side view comes from the other side.
    else if (v === 'side') dir.set(flat.z, 0, -flat.x).multiplyScalar(this.lang === 'ar' ? -1 : 1);
    else dir.copy(def);
    this.stopSpin();
    if (this.sel) this.frameLineage(900, dir);
    else if (v === 'default') this.frameScene(900);
    else this.frameEveryone(dir, 900);
    // A chosen angle sticks: the next person picked is framed from it too.
    if (this.aim && v !== 'default') this.aim.preset = true;
  }

  /** Whether the scene rail covers the stage's start side (the framing keeps people clear of it). */
  setRail(open: boolean) {
    this.railOpen = open;
    // The new free area changes the zoom-out limit and re-frames whatever the engine framed last (see refit()).
    this.measure();
    const cur = this.SC[this.cur];
    if (cur) this.setLimits(cur);
    this.refit();
    this.o.onState({ rail: open });
  }

  /** Name pill density: everyone who fits, the selected lineage only, or only hover and selection. */
  setLabels(mode: LabelMode) {
    this.labelMode = mode;
    this.labels.update();
    this.o.onState({ labels: mode });
  }

  setLang(lang: string, text: StudioText) {
    this.text = text;
    if (lang === this.lang) {
      this.labels.reset();
      return;
    }
    this.lang = lang;
    this.labels.reset();
    this.framed = null;
    this.measure();
    this.applyViewOffset();
    // Scenes read the reading direction when they are built (Arabic mirrors them), so rebuild
    // the open scene with the portraits gliding to their new places, and drop the cached ones.
    this.relayoutFrom = this.currentPositions();
    for (const key of Object.keys(this.SC) as SceneKey[]) this.drop(key);
    this.setScene(this.cur);
  }

  setDark(dark: boolean) {
    if (dark === this.dark) return;
    this.dark = dark;
    this.syncMedalTheme();
    this.labels.reset();
    const active = this.SC[this.cur];
    for (const s of Object.values(this.SC)) if (s !== active) s.tint();
    active?.tint();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.hoverRaf);
    clearTimeout(this.spinTimer);
    this.ro.disconnect();
    for (const c of this.cleanups) c();
    this.controls.dispose();
    for (const key of Object.keys(this.SC) as SceneKey[]) this.drop(key);
    this.scene.remove(this.medals.mesh);
    this.medals.geo.dispose();
    this.medals.mat.dispose();
    this.atlas.dispose();
    this.bloom.dispose();
    this.output.dispose();
    this.renderPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.labels.dispose();
    this.tip.remove();
  }

  // ---------- scenes ----------

  private ensure(key: SceneKey): SceneDef {
    let s = this.SC[key];
    if (!s) {
      s = BUILD[key](this.ctx);
      s.group.visible = false;
      this.scene.add(s.group);
      this.SC[key] = s;
    }
    return s;
  }

  private drop(key: SceneKey) {
    const s = this.SC[key];
    if (!s) return;
    this.scene.remove(s.group);
    disposeTree(s.group);
    delete this.SC[key];
  }

  /** The portrait shader's theme switch (portraits.ts), set when the material has one. */
  private syncMedalTheme() {
    const u = (this.medals.uni as unknown as Record<string, { value: number } | undefined>).uDark;
    if (u) u.value = this.dark ? 1 : 0;
  }

  private effYear() {
    return MathUtils.lerp(this.M.minYear - 3, this.U.uYear.value, this.U.uEnter.value);
  }

  private appearAt(i: number) {
    return (this.medals.birth.array as Float32Array)[i] ?? 0;
  }

  /** Current interpolated position of one person (mirrors the shader so labels and picking line up). */
  private personPos(i: number, out: Vector3) {
    const m = ease(this.medals.uni.uMorph.value);
    const { from, to } = this.medals;
    out.set(
      MathUtils.lerp(from.getX(i), to.getX(i), m),
      MathUtils.lerp(from.getY(i), to.getY(i), m) + Math.sin(m * Math.PI) * this.medals.uni.uLift.value,
      MathUtils.lerp(from.getZ(i), to.getZ(i), m),
    );
    out.y += Math.sin(this.U.uTime.value * 0.8 + (this.M.people[i]?.born ?? 0) * 1.7) * 0.12;
    return out;
  }

  private currentPositions() {
    const out = new Float32Array(this.M.n * 3);
    for (let i = 0; i < this.M.n; i++) {
      this.personPos(i, this.v1);
      out[i * 3] = this.v1.x;
      out[i * 3 + 1] = this.v1.y;
      out[i * 3 + 2] = this.v1.z;
    }
    return out;
  }

  // ---------- camera ----------

  private distance() {
    return this.camera.position.distanceTo(this.controls.target);
  }

  /** Moves the camera along its view line to a distance from the target. */
  private setDistance(d: number) {
    const off = this.v1.copy(this.camera.position).sub(this.controls.target);
    const len = off.length();
    if (len < 1e-6) off.set(0, 0, 1);
    else off.divideScalar(len);
    this.camera.position.copy(this.controls.target).addScaledVector(off, d);
  }

  /**
   * Starts a camera flight to a target and camera position, or jumps there (d = 0 or reduced motion).
   * Flights turn around the target, so the view never cuts through the scene, and ease the distance in
   * log space, so zooming far in or out feels even.
   */
  private flyCam(target: Vector3, cam: Vector3, d: number): boolean {
    // A scene being edited can hand over unusable numbers: keep the camera where it is.
    if (!Number.isFinite(target.x + target.y + target.z + cam.x + cam.y + cam.z)) return false;
    const moving = this.fly !== null || this.zoomAnim !== null;
    this.zoomAnim = null;
    // Leftover drag inertia would carry the camera on after it lands.
    const oc = this.controls as unknown as {
      _sphericalDelta?: { set(r: number, p: number, t: number): unknown };
      _panOffset?: Vector3;
    };
    oc._sphericalDelta?.set(0, 0, 0);
    oc._panOffset?.set(0, 0, 0);
    if (!d || this.o.reduced) {
      this.fly = null;
      this.controls.target.copy(target);
      this.camera.position.copy(cam);
      return true;
    }
    const td = this.v2.copy(cam).sub(target);
    const tr = Math.max(td.length(), 1e-3);
    td.divideScalar(tr);
    const F0 = this.fly;
    // Same destination as the running flight (a double-click after the click): let it finish.
    if (F0 && F0.tt.distanceTo(target) < tr * 1e-3 && Math.abs(F0.tr - tr) < tr * 1e-3 && F0.td.dot(td) > 0.99999)
      return true;
    // People slide away from under the pointer: drop the hover card until the pointer moves again.
    this.tip.hidden = true;
    const fd = this.v3.copy(this.camera.position).sub(this.controls.target);
    const fr = Math.max(fd.length(), 1e-3);
    fd.divideScalar(fr);
    const fa = Math.atan2(fd.x, fd.z);
    let da = Math.atan2(td.x, td.z) - fa;
    if (da > Math.PI) da -= Math.PI * 2;
    else if (da < -Math.PI) da += Math.PI * 2;
    const travel = this.controls.target.distanceTo(target);
    this.fly = {
      t0: performance.now(),
      d,
      ft: this.controls.target.clone(),
      tt: target.clone(),
      td: td.clone(),
      fa,
      da,
      fp: Math.acos(MathUtils.clamp(fd.y, -1, 1)),
      tp: Math.acos(MathUtils.clamp(td.y, -1, 1)),
      fr,
      tr,
      arc: Math.min(0.45, (0.5 * travel) / (fr + tr)),
      out: moving,
    };
    return true;
  }

  /** The user took the camera (drag, pinch, wheel): stop flights and eased zooms where they are. */
  private userTook() {
    this.framed = null;
    this.fly = null;
    this.zoomAnim = null;
    // OrbitControls applies a wheel step inside its own handler, right after this: the limits must hold already.
    this.applyLimits(this.distance());
    this.stopSpin();
  }

  /**
   * Stage px covered by floating UI, with or without the person panel (shown while someone is selected).
   * Measured from the DOM by measure(); the constants describe the route's layout if that is not possible.
   */
  private insets(panel = this.sel !== null): Insets {
    if (!this.cov) this.measure();
    const c = this.cov;
    return c ? (panel ? c.full : c.base) : FALLBACK;
  }

  /**
   * Measures the floating UI over the stage: every `.glass` panel of the route (view switcher, search, scene
   * rail, timeline, studio toolbars; not popovers) is cut off the free area from the side where that costs the
   * least area;
   * the person panel (`aside`) is cut from its side when at least 200 px stay free beside it. Layout offsets
   * are used, so panels sliding in are measured where they land. Refreshed on selection, resize, language,
   * rail changes and twice a second.
   */
  private measure() {
    const stage = this.o.container;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    if (!W || !H) return;
    const rtl = this.lang === 'ar';
    const md = matchMedia(RAIL_MEDIA).matches;
    const fs = document.fullscreenElement;
    const base: Insets = { l: 0, r: 0, t: 0, b: 0 };
    let panel: { side: 'l' | 'r'; v: number } | null = null;
    let found = false;
    // The route's root: the nearest ancestor that also holds the view switcher (and the person panel). In full
    // screen it is the full-screen element itself (fixed, so the offset chain ends there).
    let root = fs instanceof HTMLElement && fs.contains(stage) ? fs : stage.parentElement;
    if (root !== fs) while (root?.parentElement && !root.querySelector('[role="tablist"]')) root = root.parentElement;
    const sb = root ? layoutBox(stage, root) : null;
    const boxes: Array<[number, number, number, number]> = [];
    if (root && sb) {
      for (const el of root.querySelectorAll<HTMLElement>('.glass, aside')) {
        // Popovers, menus and the search list come and go: they do not move the scene. In full screen only
        // what is inside the full-screen element shows.
        if (stage.contains(el) || el.contains(stage) || el.closest(TRANSIENT) || (fs && !fs.contains(el))) continue;
        const isPanel = el.tagName === 'ASIDE';
        if (!isPanel && el.closest('aside')) continue;
        const b = layoutBox(el, root);
        if (!b || b.w < 2 || b.h < 2 || getComputedStyle(el).visibility === 'hidden') continue;
        const x = Math.max(0, b.x - sb.x);
        const y = Math.max(0, b.y - sb.y);
        const w = Math.min(W, b.x - sb.x + b.w) - x;
        const h = Math.min(H, b.y - sb.y + b.h) - y;
        if (w <= 0 || h <= 0) continue;
        if (isPanel) {
          panel = x + w / 2 > W / 2 ? { side: 'r', v: W - x } : { side: 'l', v: x + w };
          continue;
        }
        found = true;
        boxes.push([x, y, w, h]);
      }
    }
    // Large panels first: small ones then cut from whichever side is already partly given up.
    boxes.sort((a, b) => b[2] * b[3] - a[2] * a[3]);
    for (const [x, y, w, h] of boxes) cutAway(base, x, y, w, h, W, H);
    // Covers that would leave less than a third of the stage are not chrome around it: use the route's layout.
    if (W - base.l - base.r < W / 3 || H - base.t - base.b < H / 3) found = false;
    if (!found) {
      // The route's layout: scene rail on the start side (md and up) or above the timeline, toolbar on top.
      const rail = this.railOpen && md && W > RAIL_WIDTH * 2 ? RAIL_WIDTH : 0;
      base.l = rtl ? 0 : rail;
      base.r = rtl ? rail : 0;
      base.t = TOP_INSET;
      base.b = BOTTOM_INSET + (this.railOpen && !md ? RAIL_STRIP : 0);
    }
    // The person panel covers the end side; when it is not in the page yet, assume the route's layout.
    const p = panel ?? (md && !fs ? { side: rtl ? ('l' as const) : ('r' as const), v: PANEL_WIDTH } : null);
    const full = { ...base };
    if (p && W - base.l - base.r - (p.v - base[p.side]) >= 200) full[p.side] = Math.max(base[p.side], p.v);
    this.cov = { base, full };
  }

  /**
   * Half-angle tangents of the free area around the view axis. The projection offset centres the axis
   * horizontally in the free area; vertically it stays mid-stage. `roomy` leaves space for name pills.
   */
  private tans(cur: SceneDef, roomy: boolean, panel = this.sel !== null): Tans {
    const w = this.o.container.clientWidth;
    const h = this.o.container.clientHeight;
    // Not laid out yet: the plain field of view.
    if (!w || !h) return { h: 0.38, u: 0.38, d: 0.38 };
    const f = this.focal();
    const ins = this.insets(panel);
    const ls = cur.labelScale ?? 1;
    const pad = roomy ? 22 : 8;
    const pill = roomy ? PILL_H * ls + 4 : 0;
    const half = (w - ins.l - ins.r) / 2 - pad;
    const up = h / 2 - ins.t - pad - (cur.labelUp ? pill : 0);
    const down = h / 2 - ins.b - pad - (cur.labelUp ? 0 : pill);
    return { h: Math.max(30, half) / f, u: Math.max(30, up) / f, d: Math.max(30, down) / f };
  }

  /** Focal length in stage px (vertical field of view). */
  private focal() {
    return this.o.container.clientHeight / 2 / Math.tan(MathUtils.degToRad(this.camera.fov / 2));
  }

  /** World radius of one portrait disc in the current scene (the selected one is drawn larger), plus its bob. */
  private discRadius(cur: SceneDef, i: number) {
    const p = this.M.people[i];
    if (!p) return 0;
    return cur.size * sizeFactor(p) * DISC * (p.id === this.sel ? SEL_GROW : 1) + 0.15 + (cur.framePad ?? 0);
  }

  /** Camera basis (right, up, back) for a view direction, exactly as camera.lookAt will build it. */
  private basis(dir: Vector3, R: Vector3, Up: Vector3, B: Vector3) {
    this.m4.lookAt(dir, ORIGIN, this.camera.up);
    R.setFromMatrixColumn(this.m4, 0);
    Up.setFromMatrixColumn(this.m4, 1);
    B.setFromMatrixColumn(this.m4, 2);
  }

  /**
   * Fits people into the free stage area, looking along `dir` (unit, target to camera). Exact for the
   * view-facing portrait discs: each disc must lie inside the four side planes of the free area's frustum.
   * In the camera basis (x right, y up, w back) a disc at (x, y, w) with radius r fits the right side when
   * x + r - cx <= tanR * (cw - w), so the right and left sides fix cx and how far back (cw) the camera must
   * be, and so do top and bottom for cy; the camera takes the further of the two and stays centred on the
   * other axis. The target sits on the view axis at the middle of the group's depth. With `roomy`, name
   * pills wider than their portrait widen that person's disc sideways (two refinement passes, as the
   * widening depends on the depth the person lands at).
   * Writes the target and returns the camera distance (camera = target + dir * distance), or -1.
   */
  private fitPeople(cur: SceneDef, idx: readonly number[], dir: Vector3, roomy: boolean, target: Vector3): number {
    const t = this.tans(cur, roomy);
    const R = this.v1;
    const Up = this.v2;
    const B = this.v3;
    this.basis(dir, R, Up, B);
    const to = this.medals.to;
    const n = idx.length;
    const X = new Float64Array(n);
    const Y = new Float64Array(n);
    const Wb = new Float64Array(n);
    const rV = new Float64Array(n);
    const rH = new Float64Array(n);
    const pill = new Float64Array(n);
    const ls = cur.labelScale ?? 1;
    let m = 0;
    for (const i of idx) {
      const p = this.M.people[i];
      const r = this.discRadius(cur, i);
      if (!p || !r) continue;
      const px = to.getX(i);
      const py = to.getY(i);
      const pz = to.getZ(i);
      X[m] = px * R.x + py * R.y + pz * R.z;
      Y[m] = px * Up.x + py * Up.y + pz * Up.z;
      Wb[m] = px * B.x + py * B.y + pz * B.z;
      rV[m] = r;
      rH[m] = r;
      pill[m] = roomy ? (this.labels.pillSize(p).w * ls) / 2 + 4 : 0;
      m++;
    }
    const f = this.focal();
    if (!m || !(f > 0)) return -1;
    const solve = () => {
      let a = Number.NEGATIVE_INFINITY;
      let b = a;
      let c = a;
      let e = a;
      let wMin = Number.POSITIVE_INFINITY;
      let wMax = Number.NEGATIVE_INFINITY;
      for (let k = 0; k < m; k++) {
        const x = X[k] as number;
        const y = Y[k] as number;
        const w = Wb[k] as number;
        a = Math.max(a, x + (rH[k] as number) + t.h * w);
        b = Math.max(b, -x + (rH[k] as number) + t.h * w);
        c = Math.max(c, y + (rV[k] as number) + t.u * w);
        e = Math.max(e, -y + (rV[k] as number) + t.d * w);
        wMin = Math.min(wMin, w);
        wMax = Math.max(wMax, w);
      }
      const cw = Math.max((a + b) / (2 * t.h), (c + e) / (t.u + t.d));
      return { cw, cx: (a - b) / 2, cy: (c - t.u * cw + (t.d * cw - e)) / 2, tw: (wMin + wMax) / 2 };
    };
    let sol = solve();
    if (roomy) {
      for (let pass = 0; pass < 3; pass++) {
        for (let k = 0; k < m; k++) {
          const z = Math.max(1e-3, sol.cw - (Wb[k] as number));
          const extra = (pill[k] as number) - ((rV[k] as number) * f) / z;
          rH[k] = (rV[k] as number) + (Math.max(0, extra) * z) / f;
        }
        sol = solve();
      }
    }
    const dist = sol.cw - sol.tw;
    if (!Number.isFinite(dist + sol.cx + sol.cy + sol.tw)) return -1;
    target.set(0, 0, 0).addScaledVector(R, sol.cx).addScaledVector(Up, sol.cy).addScaledVector(B, sol.tw);
    return dist;
  }

  /** Distance a camera looking at `target` along `dir` needs for people `idx` to fit the free area. */
  private distanceToFit(cur: SceneDef, idx: readonly number[], target: Vector3, dir: Vector3, roomy: boolean) {
    const t = this.tans(cur, roomy);
    const R = this.v1;
    const Up = this.v2;
    const B = this.v3;
    this.basis(dir, R, Up, B);
    const to = this.medals.to;
    let need = 0;
    for (const i of idx) {
      const r = this.discRadius(cur, i);
      if (!r) continue;
      const px = to.getX(i) - target.x;
      const py = to.getY(i) - target.y;
      const pz = to.getZ(i) - target.z;
      const x = px * R.x + py * R.y + pz * R.z;
      const y = px * Up.x + py * Up.y + pz * Up.z;
      const w = px * B.x + py * B.y + pz * B.z;
      need = Math.max(need, (Math.abs(x) + r) / t.h + w, (y + r) / t.u + w, (r - y) / t.d + w);
    }
    return need;
  }

  /** People shown at the year the scene is heading to (the opening animation and year easing settle there). */
  private visibleIdx(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.M.n; i++) if (this.shown(i) && this.placed(i)) out.push(i);
    return out;
  }

  /**
   * The portrait is drawn at the year the scene is heading to (the shader fades it in over the first year after
   * the birth). The selected person counts only when shown too: framing an unborn portrait shows empty space.
   */
  private shown(i: number) {
    return this.appearAt(i) <= this.year - 0.5;
  }

  /** The person has a usable final position in the current scene (a scene being edited can leave NaN). */
  private placed(i: number) {
    const to = this.medals.to;
    return Number.isFinite(to.getX(i)) && Number.isFinite(to.getY(i)) && Number.isFinite(to.getZ(i));
  }

  /** The scene's own view direction (target to camera), or a plain three-quarter view if it gives none. */
  private sceneDir(cur: SceneDef, out: Vector3) {
    out.copy(cur.view.cam).sub(cur.view.target);
    const len = out.length();
    return Number.isFinite(len) && len > 1e-6 ? out.divideScalar(len) : out.set(0, 0.45, 1).normalize();
  }

  /**
   * Who a selection frames: the highlighted lineage, and in a scene laid out around the selected person (the
   * Hourglass, `centre`) also the brothers and sisters with their spouses that it seats round the waist.
   */
  private frameIdx(cur: SceneDef, id: string): number[] {
    const idx = this.lineageIdx(id);
    if (cur.centre !== id) return idx;
    const have = new Set(idx);
    for (const pid of this.M.get(id).parents)
      for (const sib of this.M.get(pid).children) {
        if (sib === id) continue;
        for (const q of [sib, ...this.M.get(sib).spouses.map((sp) => sp.id)]) {
          const o = this.M.byId.get(q);
          if (o && !have.has(o.idx) && this.shown(o.idx) && this.placed(o.idx)) {
            have.add(o.idx);
            idx.push(o.idx);
          }
        }
      }
    return idx;
  }

  /** The highlighted lineage shown at the current year (the selected person too, when shown). */
  private lineageIdx(id: string): number[] {
    const out: number[] = [];
    for (const pid of this.lineageOf(id).keys()) {
      const p = this.M.byId.get(pid);
      if (p && this.shown(p.idx) && this.placed(p.idx)) out.push(p.idx);
    }
    return out;
  }

  /**
   * View direction for framing a selection: the current one (or the running flight's) while it is within
   * about 60 degrees of the scene's own view, else the scene's own; always from the side the scene is
   * viewed from (under a canopy, or the far face of a disk).
   */
  private frameDir(cur: SceneDef, out: Vector3, sceneAngle = false) {
    const def = this.sceneDir(cur, this.c1);
    if (sceneAngle) return out.copy(def);
    // The angle the engine last framed from (auto-spin drift does not count, so picking someone frames the same
    // way every time; a chosen preset is kept as it is), unless the user turned the camera since; else a running
    // flight's or the current one.
    const A = this.aim;
    if (A?.preset) return out.copy(A.dir);
    if (A) out.copy(A.dir);
    else if (this.fly) out.copy(this.fly.td);
    else out.copy(this.camera.position).sub(this.controls.target);
    if (out.lengthSq() < 1e-8) out.copy(def);
    out.normalize();
    if (out.angleTo(def) > KEEP_DIR) out.copy(def);
    const up = cur.view.cam.y < cur.view.target.y ? -1 : 1;
    if (out.y * up < Math.min(0.15, def.y * up)) {
      out.y = up * MathUtils.clamp(def.y * up, 0.05, 0.3);
      out.normalize();
    }
    return out;
  }

  /** The scene's own view, pulled back on narrow stages and until every visible person fits the free area. */
  private sceneView(cur: SceneDef, target: Vector3, cam: Vector3) {
    // Narrow (portrait) stages need the camera further back; on wide stages only the area beside the scene rail counts.
    const k = Math.max(1, 1.45 / this.freeAspect()) ** 0.85;
    const vis = this.visibleIdx();
    target.copy(cur.view.target);
    if (!Number.isFinite(target.x + target.y + target.z)) {
      // No usable target: the middle of the people shown.
      target.set(0, 0, 0);
      const to = this.medals.to;
      for (const i of vis) target.x += to.getX(i) / vis.length;
      for (const i of vis) target.y += to.getY(i) / vis.length;
      for (const i of vis) target.z += to.getZ(i) / vis.length;
    }
    const raw = cur.view.cam.distanceTo(cur.view.target) * k;
    const dir = this.sceneDir(cur, this.v4);
    let dist = Number.isFinite(raw) ? raw : 0;
    dist = Math.max(dist, this.distanceToFit(cur, vis, target, dir, false), this.lim.min);
    cam.copy(target).addScaledVector(dir, Math.min(dist, this.lim.max));
  }

  /**
   * Zoom limits for a scene, from its extent: out to a little over twice the distance that shows the
   * whole family, in until one portrait fills about three quarters of the stage height.
   */
  private setLimits(cur: SceneDef) {
    const pos = cur.pos;
    const n = Math.floor(pos.length / 3);
    const ok = (i: number) =>
      Number.isFinite(pos[i * 3] ?? Number.NaN) &&
      Number.isFinite(pos[i * 3 + 1] ?? Number.NaN) &&
      Number.isFinite(pos[i * 3 + 2] ?? Number.NaN);
    const c = this.v1.set(0, 0, 0);
    let m = 0;
    for (let i = 0; i < n; i++) {
      if (!ok(i)) continue;
      c.x += pos[i * 3] as number;
      c.y += pos[i * 3 + 1] as number;
      c.z += pos[i * 3 + 2] as number;
      m++;
    }
    if (!m) return;
    c.divideScalar(m);
    let r2 = 0;
    for (let i = 0; i < n; i++) {
      if (!ok(i)) continue;
      const dx = (pos[i * 3] as number) - c.x;
      const dy = (pos[i * 3 + 1] as number) - c.y;
      const dz = (pos[i * 3 + 2] as number) - c.z;
      r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
    }
    const radius = Math.sqrt(r2) + cur.size * 1.6;
    const t = this.tans(cur, false, false);
    const fitAll = radius / Math.sin(Math.atan(Math.min(t.h, t.u, t.d)));
    const k = Math.max(1, 1.45 / this.freeAspect()) ** 0.85;
    const raw = cur.view.cam.distanceTo(cur.view.target) * k;
    const max = Math.max(Number.isFinite(raw) ? raw : 0, fitAll) * 2.4;
    const min = MathUtils.clamp(cur.size * 4, 1.5, Math.min(cur.follow * 0.5, max / 20));
    if (!Number.isFinite(max) || !Number.isFinite(min) || !(max > min)) return;
    this.lim.min = min;
    this.lim.max = max;
    this.lim.extent = radius + c.length();
  }

  /** OrbitControls clamps its distance every update: relax the limits while flying and never snap the camera. */
  private applyLimits(d: number) {
    const c = this.controls;
    if (this.fly) {
      c.minDistance = 0;
      c.maxDistance = Number.POSITIVE_INFINITY;
    } else {
      c.minDistance = Math.min(this.lim.min, d);
      c.maxDistance = Math.max(this.lim.max, d);
    }
  }

  /** Near and far planes that follow the zoom: no clipping close up, enough depth precision far out. */
  private clipPlanes(d: number) {
    const near = MathUtils.clamp(d * 0.005, 0.05, 10);
    const far = Math.max(3000, (d + this.lim.extent) * 2.5);
    const cam = this.camera;
    if (Math.abs(near - cam.near) > cam.near * 0.1 || Math.abs(far - cam.far) > cam.far * 0.1) {
      cam.near = near;
      cam.far = far;
      cam.updateProjectionMatrix();
    }
  }

  private zoomT(d: number) {
    const lo = Math.log(this.lim.min);
    const hi = Math.log(this.lim.max);
    return hi > lo ? MathUtils.clamp((hi - Math.log(d)) / (hi - lo), 0, 1) : 0;
  }

  /** Reports the zoom at most ten times a second while it changes; the last value always goes out. */
  private pushZoom(now: number, d: number) {
    const z = Math.round(this.zoomT(d) * 1000) / 1000;
    if (z === this.zoomSent.v || now - this.zoomSent.at < 100) return;
    this.zoomSent = { v: z, at: now };
    this.o.onState({ zoom: z });
  }

  /** Zooms towards a point on screen: scales the view about the point under the pointer at the target's depth. */
  private zoomAt(clientX: number, clientY: number, factor: number) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cam = this.camera.position;
    const tgt = this.controls.target;
    const ray = this.v1
      .set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5)
      .unproject(this.camera)
      .sub(cam)
      .normalize();
    const fwd = this.v2.copy(tgt).sub(cam);
    const d = fwd.length();
    if (d < 1e-6) return;
    fwd.divideScalar(d);
    const cos = ray.dot(fwd);
    const point = this.v3.copy(cam).addScaledVector(ray, cos > 0.05 ? d / cos : d);
    const k = MathUtils.clamp(d * factor, this.lim.min, this.lim.max) / d;
    this.t1.copy(tgt).sub(point).multiplyScalar(k).add(point);
    this.c1.copy(cam).sub(point).multiplyScalar(k).add(point);
    this.flyCam(this.t1, this.c1, 420);
    this.framed = null;
  }

  // ---------- selection & lineage ----------

  private lineageOf(id: string) {
    const set = new Map<string, number>([[id, 2]]);
    const up = (x: string) => {
      for (const pid of this.M.get(x).parents)
        if (!set.has(pid)) {
          set.set(pid, 1);
          up(pid);
        }
    };
    const down = (x: string) => {
      for (const k of this.M.get(x).children) {
        if (set.has(k)) continue;
        set.set(k, 1);
        down(k);
      }
    };
    up(id);
    down(id);
    for (const s of this.M.get(id).spouses) if (!set.has(s.id)) set.set(s.id, 1);
    return set;
  }

  private applyHighlight() {
    const set = this.sel ? this.lineageOf(this.sel) : null;
    const a = this.medals.hi;
    const arr = a.array as Float32Array;
    this.hiArr = arr;
    this.M.people.forEach((p, i) => {
      arr[i] = set ? set.get(p.id) || 0 : 0;
    });
    a.needsUpdate = true;
    const focus = this.sel ? 1 : 0;
    this.medals.uni.uFocus.value = focus;
    for (const sc of Object.values(this.SC)) {
      for (const u of sc.focus) u.value = focus;
      for (const { geo, perPerson } of sc.hiTargets) {
        const keys = geo.userData.keys as string[];
        const attr = geo.getAttribute('aHi');
        const out = attr.array as Float32Array;
        for (let k = 0; k < keys.length; k++) {
          const id = keys[k];
          let v = 0;
          if (set && id && set.has(id)) {
            if (perPerson) v = 1;
            else {
              const p = this.M.get(id);
              v = p.mi
                ? p.anchor && set.get(p.anchor)
                  ? 1
                  : 0
                : (p.parent && set.has(p.parent)) || set.get(id) === 2
                  ? 1
                  : 0;
              if (p === this.M.root) v = 1;
            }
          }
          out[k] = v;
        }
        attr.needsUpdate = true;
      }
    }
  }

  // ---------- picking & pointer ----------

  private pick(cx: number, cy: number): number | null {
    const r = this.canvas.getBoundingClientRect();
    const x = cx - r.left;
    const y = cy - r.top;
    const yr = this.effYear();
    const cur = this.SC[this.cur];
    if (!cur) return null;
    const f = r.height / (2 * Math.tan(MathUtils.degToRad(this.camera.fov / 2)));
    let best: number | null = null;
    let bd = Number.POSITIVE_INFINITY;
    const ndc = this.v2;
    this.M.people.forEach((p, i) => {
      if (this.appearAt(i) > yr) return;
      this.personPos(i, ndc);
      const dist = ndc.distanceTo(this.camera.position);
      ndc.project(this.camera);
      if (ndc.z > 1) return;
      const sx = (ndc.x * 0.5 + 0.5) * r.width;
      const sy = (-ndc.y * 0.5 + 0.5) * r.height;
      const rad = (cur.size * sizeFactor(p) * 2.3 * 0.5 * 0.7 * f) / dist + 3;
      const d = Math.hypot(sx - x, sy - y);
      if (d < rad && dist < bd) {
        bd = dist;
        best = i;
      }
    });
    return best;
  }

  private bindPointer() {
    const c = this.canvas;
    const onDown = (e: PointerEvent) => {
      this.down = { x: e.clientX, y: e.clientY, took: false };
      this.downDir.copy(this.camera.position).sub(this.controls.target).normalize();
      this.stopSpin();
    };
    const onUp = (e: PointerEvent) => {
      const d = this.down;
      this.down = null;
      // The user turned the camera: frame later selections from their angle (within limits, see frameDir).
      if (
        d?.took &&
        this.v1.copy(this.camera.position).sub(this.controls.target).normalize().angleTo(this.downDir) > 0.02
      )
        this.aim = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      const i = this.pick(e.clientX, e.clientY);
      const id = i == null ? null : (this.M.people[i]?.id ?? null);
      this.o.onSelect(id);
    };
    const onMove = (e: PointerEvent) => {
      // A real drag takes the camera: running flights stop and the engine stops re-framing on its own.
      const d = this.down;
      if (d && !d.took && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) {
        d.took = true;
        this.userTook();
      }
      if (this.hoverRaf) return;
      const { clientX, clientY } = e;
      this.hoverRaf = requestAnimationFrame(() => {
        this.hoverRaf = 0;
        if (this.down || this.disposed) return;
        const i = this.pick(clientX, clientY);
        const r = this.o.container.getBoundingClientRect();
        this.hover = i == null ? null : (this.M.people[i]?.id ?? null);
        c.style.cursor = i == null ? '' : 'pointer';
        this.showTip(i, clientX - r.left, clientY - r.top);
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(this.hoverRaf);
      this.hoverRaf = 0;
      this.hover = null;
      this.tip.hidden = true;
    };
    const onCancel = () => {
      this.down = null;
    };
    const onWheel = () => this.userTook();
    // Double-click a portrait: select it and frame its lineage. Double-click the stage: zoom in there.
    const onDbl = (e: MouseEvent) => {
      const i = this.pick(e.clientX, e.clientY);
      const id = i == null ? null : (this.M.people[i]?.id ?? null);
      if (!id) this.zoomAt(e.clientX, e.clientY, 1 / DBL_ZOOM);
      else if (id === this.sel) this.frameSelection();
      else this.o.onSelect(id);
    };
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerleave', onLeave);
    c.addEventListener('pointercancel', onCancel);
    // Capture phase: runs before OrbitControls' own wheel handler, so a flight ends before the zoom step is applied.
    c.addEventListener('wheel', onWheel, { passive: true, capture: true });
    c.addEventListener('dblclick', onDbl);
    this.cleanups.push(() => {
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerleave', onLeave);
      c.removeEventListener('pointercancel', onCancel);
      c.removeEventListener('wheel', onWheel, { capture: true });
      c.removeEventListener('dblclick', onDbl);
    });
  }

  private showTip(i: number | null, x: number, y: number) {
    const p = i == null ? undefined : this.M.people[i];
    if (!p) {
      this.tip.hidden = true;
      return;
    }
    const img = document.createElement('img');
    img.src = this.atlas.thumb(p);
    img.alt = '';
    // The portrait keeps its family-colour rim, like the medal on the stage.
    img.style.cssText = `width:40px;height:40px;border-radius:50%;flex:none;box-shadow:0 0 0 2px var(--ft-popover),0 0 0 3.5px ${p.color};`;
    const box = document.createElement('div');
    box.style.cssText = 'display:grid;gap:1px;min-width:0;';
    const b = document.createElement('b');
    b.textContent = this.text.name(p);
    b.style.cssText =
      'display:block;font-size:14px;line-height:1.25;font-weight:600;color:var(--ft-popover-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const s = document.createElement('span');
    s.style.cssText = 'font-size:11.5px;line-height:1.3;color:var(--ft-muted-foreground);';
    const yrs = this.text.years(p);
    if (yrs) {
      const bdi = document.createElement('bdi');
      bdi.dir = 'ltr';
      bdi.style.fontVariantNumeric = 'tabular-nums';
      bdi.textContent = yrs;
      s.append(bdi, ' · ');
    }
    s.append(this.text.role(p));
    box.append(b, s);
    this.tip.replaceChildren(img, box);
    this.tip.hidden = false;
    const w = this.o.container.clientWidth;
    const tw = this.tip.offsetWidth;
    const th = this.tip.offsetHeight;
    // Screen-space placement next to the pointer (physical pixels, not layout direction).
    const left = Math.max(8, Math.min(x + 16, w - tw - 8));
    this.tip.style.transform = `translate(${left}px, ${Math.max(8, y - th - 12)}px)`;
  }

  /** Auto-spin runs when wanted, nobody is selected and the camera was not handled in the last few seconds. */
  private syncSpin() {
    this.controls.autoRotate = this.spin && !this.spinHold && this.sel === null;
  }

  private stopSpin() {
    this.spinHold = true;
    this.syncSpin();
    clearTimeout(this.spinTimer);
    this.spinTimer = window.setTimeout(() => {
      this.spinHold = false;
      this.syncSpin();
    }, 6000);
  }

  // ---------- quality & loop ----------

  private applyQuality() {
    const lv = this.quality.level;
    const pr = lv === 2 ? Math.min(devicePixelRatio, 2) : lv === 1 ? 1 : 0.85;
    this.renderer.setPixelRatio(pr);
    this.bloom.enabled = lv > 0 && this.bloom.strength > 0.001;
    this.resize();
    this.o.onState({ quality: lv });
  }

  private checkQuality(fps: number, now: number) {
    const q = this.quality;
    if (fps < (q.level === 2 ? 42 : 30) && q.level > 0) {
      if (!q.since) q.since = now;
      if (now - q.since > 2500) {
        q.level = (q.level - 1) as Quality;
        q.since = 0;
        this.applyQuality();
      }
    } else q.since = 0;
    if (fps > 57 && q.level < 2) {
      if (!q.up) q.up = now;
      if (now - q.up > 6000) {
        q.level = (q.level + 1) as Quality;
        q.up = 0;
        this.applyQuality();
      }
    } else q.up = 0;
    // Even the lowest quality cannot keep up: suggest the 2D tree (spec: fall back to 2D on weak devices).
    if (q.level === 0 && fps < 18 && !q.weak) {
      if (!q.weakSince) q.weakSince = now;
      if (now - q.weakSince > 5000) {
        q.weak = true;
        this.o.onState({ weak: true });
      }
    } else q.weakSince = 0;
  }

  private resize() {
    const w = this.o.container.clientWidth;
    const h = this.o.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.measure();
    this.applyViewOffset();
    const cur = this.SC[this.cur];
    if (cur) this.setLimits(cur);
    this.refit();
  }

  /** Aspect ratio of the stage area not covered by the scene rail (the person panel does not count here). */
  private freeAspect() {
    const h = this.o.container.clientHeight;
    const i = this.insets(false);
    return h ? (this.o.container.clientWidth - i.l - i.r) / h : this.camera.aspect;
  }

  /**
   * Where the projection centre should sit, in px to the right of the stage's middle: the middle of the free
   * area, between the scene rail and (while someone is selected) the person panel. Picking and labels use the
   * same matrix, so they stay aligned.
   */
  private shiftTarget() {
    const i = this.insets();
    return (i.l - i.r) / 2;
  }

  /** Jumps to the target shift (resize, language); frame() eases towards it after a selection. */
  private applyViewOffset() {
    this.viewShift = this.shiftTarget();
    this.setShift(this.viewShift);
  }

  private setShift(shift: number) {
    const w = this.o.container.clientWidth;
    const h = this.o.container.clientHeight;
    if (!w || !h) return;
    if (Math.abs(shift) > 0.5) this.camera.setViewOffset(w, h, -shift, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private readonly frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const U = this.U;
    U.uTime.value += dt;
    const shift = this.shiftTarget();
    if (Math.abs(shift - this.viewShift) > 0.5) {
      this.viewShift += (shift - this.viewShift) * Math.min(1, dt * (this.o.reduced ? 60 : 5));
      this.setShift(this.viewShift);
    }
    if (this.playing) {
      this.playAcc += dt;
      const step = this.M.n > 100 ? 0.09 : 0.14;
      while (this.playAcc > step) {
        this.playAcc -= step;
        if (this.year >= NOW) {
          this.playing = false;
          this.o.onState({ playing: false });
          break;
        }
        this.setYear(this.year + 1);
      }
    }
    U.uYear.value += (this.year - U.uYear.value) * (1 - Math.exp(-dt * (this.playing ? 5 : 3.5)));
    if (Math.abs(this.year - U.uYear.value) < 0.002) U.uYear.value = this.year;
    if (this.morph) {
      const k = Math.min(1, (now - this.morph.t0) / this.morph.d);
      this.medals.uni.uMorph.value = k;
      if (k >= 1) this.morph = null;
    }
    if (this.enter) {
      const E = this.enter;
      const k = Math.min(1, Math.max(0, (now - E.t0) / E.d));
      U.uEnter.value = E.from + (1 - E.from) * ease(k);
      if (k >= 1) this.enter = null;
    }
    const F = this.fly;
    if (F) {
      const k = Math.min(1, (now - F.t0) / F.d);
      const e = F.out ? easeOut(k) : ease(k);
      this.controls.target.lerpVectors(F.ft, F.tt, e);
      const az = F.fa + F.da * e;
      const po = F.fp + (F.tp - F.fp) * e;
      const dir = this.v1.set(Math.sin(po) * Math.sin(az), Math.cos(po), Math.sin(po) * Math.cos(az));
      const r = Math.exp(MathUtils.lerp(Math.log(F.fr), Math.log(F.tr), e)) * (1 + F.arc * Math.sin(Math.PI * e));
      this.camera.position.copy(this.controls.target).addScaledVector(dir, r);
      if (k >= 1) this.fly = null;
    }
    const Z = this.zoomAnim;
    if (Z) {
      const k = Math.min(1, (now - Z.t0) / Z.d);
      this.setDistance(Math.exp(MathUtils.lerp(Math.log(Z.from), Math.log(Z.to), easeOut(k))));
      if (k >= 1) this.zoomAnim = null;
    }
    const cur = this.SC[this.cur];
    const hookKey = Math.floor(this.effYear() * 4);
    if (cur?.yearHook && hookKey !== this.lastHook) {
      this.lastHook = hookKey;
      cur.yearHook(this.effYear());
    }
    if (cur && this.playing && this.follow && !this.o.reduced && now - this.lastFollow > 900 && !this.fly) {
      const y = Math.round(this.year);
      const born = this.M.people.find((p) => p.born === y && !p.mi);
      if (born) {
        this.lastFollow = now;
        const p = this.personPos(born.idx, this.v4);
        const cam = this.camera.position;
        const dir = this.v1.copy(cam).sub(this.controls.target).normalize();
        this.c1.copy(cam).lerp(this.v2.copy(p).addScaledVector(dir, cur.follow * 1.6), 0.5);
        this.t1.copy(this.controls.target).lerp(p, 0.6);
        this.flyCam(this.t1, this.c1, 1100);
        this.framed = null;
      }
    }
    cur?.update?.();
    this.applyLimits(this.distance());
    this.controls.update();
    const dist = this.distance();
    this.clipPlanes(dist);
    this.pushZoom(now, dist);
    // Labels project with the camera as it is drawn this frame (not last frame's matrices).
    this.camera.updateMatrixWorld();
    this.labelT += dt;
    if (this.labelT > 0.12) {
      this.labelT = 0;
      this.labels.update();
    }
    this.labels.place();
    const info = this.renderer.info;
    info.reset();
    info.autoReset = false;
    this.composer.render();
    info.autoReset = true;
    this.fpsAvg += (1 / Math.max(dt, 1e-3) - this.fpsAvg) * 0.05;
    this.checkQuality(this.fpsAvg, now);
    this.hudT += dt;
    if (this.hudT > 0.5) {
      this.hudT = 0;
      this.measure();
      this.refit();
      this.o.onState({ fps: Math.round(this.fpsAvg), calls: info.render.calls });
    }
  };
}
