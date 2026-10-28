import { Frustum, Matrix4, type PerspectiveCamera, Vector3 } from 'three';
import type { StudioPerson } from './model.ts';
import { sizeFactor } from './portraits.ts';
import type { SceneDef } from './scenes/types.ts';

// Labels: crisp HTML pills (sprite labels get greyed by ACES tone mapping). A small pool is
// given to the nearest people, skipping any pill that would overlap one already placed.
// The pills are neutral glass in both themes. While someone is selected, their pill carries the
// teal primary ring, their lineage stays crisp and everyone else fades back.

/** Name pill density: everyone who fits, only the selected lineage (plus hover), or only hover and selection. */
export type LabelMode = 'all' | 'branch' | 'off';

export interface LabelHost {
  /** Read on every use: the engine swaps in new data in place. */
  people(): StudioPerson[];
  camera: PerspectiveCamera;
  size(): { w: number; h: number };
  current(): SceneDef | undefined;
  personPos(i: number, out: Vector3): Vector3;
  effYear(): number;
  appearAt(i: number): number;
  /** 2 for the selected person, 1 for their lineage, 0 otherwise. */
  hi(i: number): number;
  selected(): string | null;
  hovered(): string | null;
  mode(): LabelMode;
  name(p: StudioPerson): string;
  years(p: StudioPerson): string;
}

/** How a pill is drawn: no selection, the selected person, their lineage, under the pointer, faded back. */
type Look = 'plain' | 'sel' | 'line' | 'hover' | 'dim';

interface Pill {
  el: HTMLDivElement;
  name: HTMLElement;
  yrs: HTMLElement;
  i: number;
  key: string;
  w: number;
  h: number;
  on: boolean;
  look: Look | '';
}

const POOL = 48;
const FONT = 'Manrope, "IBM Plex Sans Arabic", ui-sans-serif, system-ui, sans-serif';
const NAME_FONT = '600 12px Manrope, "IBM Plex Sans Arabic", sans-serif';
const YEAR_FONT = '500 10.5px Manrope, "IBM Plex Sans Arabic", sans-serif';
const LIFT = '0 1px 2px rgb(0 0 0 / 0.16), 0 3px 10px rgb(0 0 0 / 0.12)';

/** Background, border, shadow, opacity and stacking per look. Theme tokens keep both themes in contrast. */
const LOOKS: Record<Look, [bg: string, border: string, shadow: string, opacity: string, z: string]> = {
  plain: ['var(--ft-glass)', 'var(--ft-border)', LIFT, '1', '1'],
  sel: [
    'var(--ft-popover)',
    'var(--ft-primary)',
    '0 0 0 3px color-mix(in srgb, var(--ft-primary) 30%, transparent), 0 4px 16px rgb(0 0 0 / 0.3)',
    '1',
    '4',
  ],
  line: ['var(--ft-popover)', 'color-mix(in srgb, var(--ft-primary) 45%, var(--ft-border))', LIFT, '1', '3'],
  hover: ['var(--ft-popover)', 'color-mix(in srgb, var(--ft-foreground) 40%, transparent)', LIFT, '1', '5'],
  dim: ['var(--ft-glass)', 'transparent', 'none', '0.34', '0'],
};

export class LabelLayer {
  readonly root: HTMLDivElement;
  private readonly pills: Pill[] = [];
  private readonly measure = document.createElement('canvas').getContext('2d');
  private readonly sizes = new Map<string, { w: number; h: number }>();
  private readonly frustum = new Frustum();
  private readonly pm = new Matrix4();
  private readonly tmp = new Vector3();
  private readonly sv = new Vector3();
  private stamp = '';

  constructor(
    parent: HTMLElement,
    private readonly host: LabelHost,
  ) {
    this.root = document.createElement('div');
    this.root.setAttribute('aria-hidden', 'true');
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:1;';
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      // Positions are projected screen pixels, so the pill is placed with a physical transform from the top-left.
      el.style.cssText = [
        'position:absolute;left:0;top:0;transform-origin:0 0;display:grid;justify-items:center;padding:2px 9px 3px',
        'border-radius:9px;white-space:nowrap;border:1px solid var(--ft-border)',
        'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)',
        'transition:opacity .25s ease,border-color .25s ease,box-shadow .25s ease;will-change:transform',
      ].join(';');
      el.hidden = true;
      const name = document.createElement('b');
      name.style.cssText = `font:600 12px/1.25 ${FONT};color:var(--ft-foreground);`;
      const yrs = document.createElement('span');
      yrs.className = 'ltr-isolate';
      yrs.style.cssText = `font:500 10.5px/1.2 ${FONT};color:var(--ft-muted-foreground);font-variant-numeric:tabular-nums;`;
      el.append(name, yrs);
      this.root.appendChild(el);
      this.pills.push({ el, name, yrs, i: -1, key: '', w: 0, h: 0, on: false, look: '' });
    }
    parent.appendChild(this.root);
  }

  /** Forget cached text and sizes (language, theme or font change). */
  reset() {
    this.sizes.clear();
    this.stamp = String(Math.random());
    for (const L of this.pills) {
      L.i = -1;
      L.on = false;
      L.look = '';
      L.el.hidden = true;
    }
  }

  /** Px size of a person's name pill before the scene's labelScale (the engine keeps room for it when framing). */
  pillSize(p: StudioPerson) {
    return this.labelSize(p);
  }

  private labelSize(p: StudioPerson) {
    const k = `${p.id}|${this.host.name(p)}`;
    const hit = this.sizes.get(k);
    if (hit) return hit;
    let a = 80;
    let b = 40;
    if (this.measure) {
      this.measure.font = NAME_FONT;
      a = this.measure.measureText(this.host.name(p)).width;
      this.measure.font = YEAR_FONT;
      b = this.measure.measureText(this.host.years(p)).width;
    }
    const v = { w: Math.ceil(Math.max(a, b) + 20), h: this.host.years(p) ? 33 : 20 };
    this.sizes.set(k, v);
    return v;
  }

  private screenOf(i: number, cur: SceneDef, L: { w: number; h: number }) {
    const p = this.host.people()[i];
    if (!p) return null;
    const sz = cur.size * sizeFactor(p);
    this.host.personPos(i, this.sv);
    this.sv.y += cur.labelUp ? sz * 1.2 : -sz * 1.15;
    this.sv.project(this.host.camera);
    if (this.sv.z > 1) return null;
    const { w, h } = this.host.size();
    return { x: (this.sv.x * 0.5 + 0.5) * w - L.w / 2, y: (-this.sv.y * 0.5 + 0.5) * h - (cur.labelUp ? L.h : 0) };
  }

  /**
   * Choose who gets a label, nearest first with the selection, its lineage and the hovered person ahead.
   * 'branch' keeps only the lineage and the hovered person while someone is selected (like 'all' otherwise);
   * 'off' keeps only the hovered and the selected person.
   */
  update() {
    const cur = this.host.current();
    if (!cur) return;
    const { camera } = this.host;
    this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    const yr = this.host.effYear();
    const sel = this.host.selected();
    const hov = this.host.hovered();
    const mode = this.host.mode();
    const cand: Array<[number, number]> = [];
    this.host.people().forEach((p, i) => {
      if (this.host.appearAt(i) > yr) return;
      const hi = this.host.hi(i);
      const pri = sel === p.id || hov === p.id;
      if (!pri && (mode === 'off' || (mode === 'branch' && sel && hi < 0.5))) return;
      this.host.personPos(i, this.tmp);
      // NaN passes the frustum test (every comparison is false): a scene being edited must not pin a pill top-left.
      if (!Number.isFinite(this.tmp.x + this.tmp.y + this.tmp.z) || !this.frustum.containsPoint(this.tmp)) return;
      let d = this.tmp.distanceTo(camera.position);
      if (sel) d *= hi > 1.5 ? 0.01 : hi > 0.5 ? 0.4 : 3;
      if (hov === p.id) d *= 0.01;
      cand.push([d, i]);
    });
    cand.sort((a, b) => a[0] - b[0]);
    const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
    const limit = this.host.people().length > 100 ? 30 : POOL;
    const ls = cur.labelScale ?? 1;
    let used = 0;
    for (const [, i] of cand) {
      if (used >= limit) break;
      const L = this.pills[used];
      const p = this.host.people()[i];
      if (!L || !p) break;
      const base = this.labelSize(p);
      const size = { w: base.w * ls, h: base.h * ls };
      const sc = this.screenOf(i, cur, size);
      if (!sc) continue;
      const pri = sel === p.id || hov === p.id;
      if (
        !pri &&
        boxes.some(
          (o) => sc.x < o.x + o.w + 4 && sc.x + size.w + 4 > o.x && sc.y < o.y + o.h + 2 && sc.y + size.h + 2 > o.y,
        )
      )
        continue;
      boxes.push({ x: sc.x, y: sc.y, w: size.w, h: size.h });
      const key = `${p.id}|${this.stamp}`;
      if (L.i !== i || L.key !== key) {
        L.name.textContent = this.host.name(p);
        const yrs = this.host.years(p);
        L.yrs.textContent = yrs;
        L.yrs.hidden = !yrs;
        L.i = i;
        L.key = key;
      }
      L.w = size.w;
      L.h = size.h;
      const hi = this.host.hi(i);
      this.setLook(L, sel === p.id ? 'sel' : hov === p.id ? 'hover' : !sel ? 'plain' : hi > 0.5 ? 'line' : 'dim');
      L.el.hidden = false;
      used++;
    }
    this.pills.forEach((L, k) => {
      L.on = k < used;
      if (!L.on) L.el.hidden = true;
    });
  }

  private setLook(L: Pill, look: Look) {
    if (L.look === look) return;
    L.look = look;
    const [bg, border, shadow, opacity, z] = LOOKS[look];
    const s = L.el.style;
    s.background = bg;
    s.borderColor = border;
    s.boxShadow = shadow;
    s.opacity = opacity;
    s.zIndex = z;
  }

  /** Every frame: keep assigned pills glued to their person. */
  place() {
    const cur = this.host.current();
    if (!cur) return;
    const ls = cur.labelScale ?? 1;
    for (const L of this.pills) {
      if (!L.on || L.i < 0) continue;
      const sc = this.screenOf(L.i, cur, L);
      if (!sc) {
        L.el.hidden = true;
        continue;
      }
      L.el.style.transform = `translate(${sc.x.toFixed(1)}px, ${sc.y.toFixed(1)}px)${ls === 1 ? '' : ` scale(${ls})`}`;
    }
  }

  dispose() {
    this.root.remove();
    this.pills.length = 0;
    this.sizes.clear();
  }
}
