import { ACESFilmicToneMapping, MathUtils, PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { disposeTree, type Shared } from './gl.ts';
import { LabelLayer } from './labels.ts';
import type { StudioModel, StudioPerson } from './model.ts';
import { ease, NOW, PAL } from './palette.ts';
import { Atlas, createMedals, type Medals, sizeFactor } from './portraits.ts';
import { BUILD, type SceneDef, type SceneKey } from './scenes/index.ts';
import type { SceneCtx } from './scenes/types.ts';

// The 3D studio engine: plain three.js, mounted into a container by the React view.
// Owns the renderer, camera, post-processing, the shared portrait billboards, the seven
// scenes (built lazily, morphing between them), labels, picking, the time loop and the
// adaptive quality. dispose() frees every GPU resource and listener it created.

export type Quality = 0 | 1 | 2;

export interface StudioState {
  scene: SceneKey;
  year: number;
  playing: boolean;
  follow: boolean;
  spin: boolean;
  quality: Quality;
  fps: number;
  calls: number;
  /** The frame rate stayed very low even at the lowest quality. */
  weak: boolean;
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
  private quality: { level: Quality; since: number; up: number; weakSince: number; weak: boolean } = {
    level: 2,
    since: 0,
    up: 0,
    weakSince: 0,
    weak: false,
  };
  private hiArr: ArrayLike<number> = new Float32Array(0);
  private morph: { t0: number; d: number } | null = null;
  private fly: { t0: number; d: number; fc: Vector3; tc: Vector3; ft: Vector3; tt: Vector3 } | null = null;
  private enter: { t0: number; d: number } | null = null;
  private raf = 0;
  private hoverRaf = 0;
  private spinTimer = 0;
  private down: { x: number; y: number } | null = null;
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
    this.controls.maxDistance = 900;
    this.controls.minDistance = 6;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.autoRotate = this.spin;
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
      name: (p) => this.text.name(p),
      years: (p) => this.text.years(p),
    });
    this.tip = document.createElement('div');
    this.tip.className = 'glass';
    this.tip.style.cssText =
      'position:absolute;left:0;top:0;z-index:3;pointer-events:none;display:flex;gap:10px;align-items:center;max-width:260px;padding:8px 10px;border-radius:14px;box-shadow:0 10px 30px rgb(0 0 0 / 0.18);';
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
        this.renderer.toneMappingExposure = e;
      },
      effYear: () => this.effYear(),
      focusId: () => this.hourCentre,
    };

    this.atlas = new Atlas(this.M);
    this.atlas.loadPhotos();
    this.medals = createMedals(this.M, this.U, this.atlas);
    this.scene.add(this.medals.mesh);
    this.U.uMinYear.value = this.M.minYear;

    this.bindPointer();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(o.container);
    this.resize();
    void document.fonts?.ready.then(() => {
      if (!this.disposed) this.labels.reset();
    });

    this.setScene(this.cur, true);
    this.applyHighlight();
    // Opening: the family grows from the first year to the chosen one.
    if (o.reduced) this.U.uEnter.value = 1;
    else {
      this.U.uEnter.value = 0;
      this.enter = { t0: performance.now() + 300, d: 3200 };
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
    if (lost) this.o.onSelect(null);
  }

  setScene(key: SceneKey, instant = false, keepCamera = false) {
    if (key === 'hour') {
      const centre = this.sel ?? this.hourCentre;
      if (this.SC.hour && this.SC.hour.centre !== centre) this.drop('hour');
      this.hourCentre = centre;
    }
    if (key === 'river' && this.SC.river && this.SC.river.dir !== (this.lang === 'ar' ? -1 : 1)) this.drop('river');
    const next = this.ensure(key);
    const { from, to, birth } = this.medals;
    const fromArr = from.array as Float32Array;
    if (!instant && this.SC[this.cur]) fromArr.set(this.currentPositions());
    else fromArr.set(next.pos);
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
    if (!keepCamera) this.flyTo(next.view.cam, next.view.target, instant ? 0 : 1700);
    this.o.onState({ scene: key });
  }

  /** Second click on the Hourglass button: back to the founder. */
  recentreHourglass() {
    this.hourCentre = this.M.root.id;
    if (this.sel) this.o.onSelect(null);
    this.sel = null;
    this.setScene('hour');
  }

  select(id: string | null, fly = true) {
    const next = id && this.M.byId.has(id) ? id : null;
    if (next === this.sel) return;
    this.sel = next;
    // The hourglass recentres on whoever is picked.
    if (this.cur === 'hour' && next && this.SC.hour?.centre !== next) {
      this.setScene('hour');
      return;
    }
    this.applyHighlight();
    if (next && fly) this.flyToPerson(this.M.get(next).idx);
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

  setSpin(on: boolean) {
    this.spin = on;
    this.controls.autoRotate = on;
    this.o.onState({ spin: on });
  }

  fit() {
    const v = this.SC[this.cur]?.view;
    if (v) this.flyTo(v.cam, v.target, 1200);
  }

  setLang(lang: string, text: StudioText) {
    this.text = text;
    if (lang === this.lang) {
      this.labels.reset();
      return;
    }
    this.lang = lang;
    this.labels.reset();
    for (const s of Object.values(this.SC)) s.relang?.();
    // The Time River's direction follows the language.
    if (this.cur === 'river') this.setScene('river');
    else if (this.SC.river) this.drop('river');
  }

  setDark(dark: boolean) {
    if (dark === this.dark) return;
    this.dark = dark;
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

  private flyTo(camIn: Vector3, target: Vector3, d = 1200) {
    // Narrow (portrait) stages need the camera further back.
    const k = Math.max(1, 1.45 / this.camera.aspect) ** 0.85;
    const cam = target.clone().add(camIn.clone().sub(target).multiplyScalar(k));
    if (!d || this.o.reduced) {
      this.fly = null;
      this.camera.position.copy(cam);
      this.controls.target.copy(target);
      return;
    }
    this.fly = {
      t0: performance.now(),
      d,
      fc: this.camera.position.clone(),
      tc: cam.clone(),
      ft: this.controls.target.clone(),
      tt: target.clone(),
    };
  }

  private flyToPerson(i: number, d = 1300) {
    const cur = this.SC[this.cur];
    if (!cur) return;
    const p = this.personPos(i, new Vector3());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.y < 0.15) dir.y = 0.3;
    dir.normalize();
    this.flyTo(p.clone().addScaledVector(dir, cur.follow), p, d);
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
      this.down = { x: e.clientX, y: e.clientY };
      this.stopSpin();
    };
    const onUp = (e: PointerEvent) => {
      const d = this.down;
      this.down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      const i = this.pick(e.clientX, e.clientY);
      const id = i == null ? null : (this.M.people[i]?.id ?? null);
      this.o.onSelect(id);
    };
    const onMove = (e: PointerEvent) => {
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
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerleave', onLeave);
    c.addEventListener('pointercancel', onCancel);
    this.cleanups.push(() => {
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerleave', onLeave);
      c.removeEventListener('pointercancel', onCancel);
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
    img.style.cssText = 'width:40px;height:40px;border-radius:50%;flex:none;';
    const box = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = this.text.name(p);
    b.style.cssText = 'display:block;font-size:14px;font-weight:600;color:var(--ft-foreground);';
    const s = document.createElement('span');
    s.style.cssText = 'font-size:11.5px;color:var(--ft-muted-foreground);';
    const yrs = this.text.years(p);
    if (yrs) {
      const bdi = document.createElement('bdi');
      bdi.dir = 'ltr';
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

  private stopSpin() {
    this.controls.autoRotate = false;
    clearTimeout(this.spinTimer);
    if (this.spin)
      this.spinTimer = window.setTimeout(() => {
        this.controls.autoRotate = this.spin;
      }, 6000);
  }

  // ---------- quality & loop ----------

  private applyQuality() {
    const lv = this.quality.level;
    const pr = lv === 2 ? Math.min(devicePixelRatio, 2) : lv === 1 ? 1 : 0.85;
    this.renderer.setPixelRatio(pr);
    this.bloom.enabled = lv > 0;
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
    this.camera.updateProjectionMatrix();
  }

  private readonly frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const U = this.U;
    U.uTime.value += dt;
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
      const k = Math.min(1, Math.max(0, (now - this.enter.t0) / this.enter.d));
      U.uEnter.value = ease(k);
      if (k >= 1) this.enter = null;
    }
    if (this.fly) {
      const k = Math.min(1, (now - this.fly.t0) / this.fly.d);
      const e = ease(k);
      this.camera.position.lerpVectors(this.fly.fc, this.fly.tc, e);
      this.controls.target.lerpVectors(this.fly.ft, this.fly.tt, e);
      if (k >= 1) this.fly = null;
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
        const p = this.personPos(born.idx, new Vector3());
        const cam = this.camera.position;
        this.fly = {
          t0: now,
          d: 1100,
          fc: cam.clone(),
          tc: cam.clone().lerp(
            p.clone().add(
              cam
                .clone()
                .sub(this.controls.target)
                .normalize()
                .multiplyScalar(cur.follow * 1.6),
            ),
            0.5,
          ),
          ft: this.controls.target.clone(),
          tt: this.controls.target.clone().lerp(p, 0.6),
        };
      }
    }
    cur?.update?.();
    this.controls.update();
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
      this.o.onState({ fps: Math.round(this.fpsAvg), calls: info.render.calls });
    }
  };
}
