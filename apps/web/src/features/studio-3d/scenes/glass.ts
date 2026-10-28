import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  type Color,
  CubicBezierCurve3,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  FrontSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix3,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  ShaderMaterial,
  Shape,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bake, builder, tube } from '../gl.ts';
import { type StudioModel, type StudioPerson, spouseYear } from '../model.ts';
import { lin } from '../palette.ts';
import type { SceneBuilder } from './types.ts';

// Glass Strata: an exploded stack of glass floors, one per generation, the founder's at the bottom.
// Each floor is the family's plot in that generation: an ordered treemap divides it among the
// branches, so every person owns a cell etched into their floor, inside their parent's cell one
// floor down, and a line of descent rises as a column. Fibres of light carry each child up from the
// parent through the glass; spouses stand in a row in front of their partner, joined by gold bars.
//
// Dark: clear crystal on black, edge-lit from indigo (oldest) to silver (youngest). Light: frosted
// slabs with soft cool tints and polished darker edges on white, with a soft shadow below. Close up:
// bevel highlights, studio reflections, etched cells and year spans, a slow sheen across the glass
// and light pulses rising along the fibres (the ambient motion).

const LOOK = {
  dark: {
    centre: '#131313',
    edge: '#000000',
    tintLo: '#343a7a',
    tintHi: '#8996b0',
    edgeLo: '#7f7ae0',
    edgeHi: '#d3def0',
    envLo: '#000000',
    envHi: '#1e1e1e',
    key: '#ffffff',
    bodyA: 0.05,
    sideE: 0.78,
    sideA: 0.5,
    rimE: 0.5,
    rimA: 0.3,
    band: 0.13,
    sheen: 0.13,
    etch: '#dfe6f3',
    etchA: 0.24,
    fibre: '#c3cee0',
    pin: '#b9c2d0',
    gold: '#e2b65a',
    teal: '#4fd1bd',
    shade: '#000000',
    shadeA: 0,
    pool: '#9aa6bd',
    poolA: 0.07,
    bloom: 0.45,
    exposure: 1,
  },
  light: {
    // A light grey stage rather than paper white, so the white frosted panes read against it.
    centre: '#f5f5f5',
    edge: '#e3e3e3',
    tintLo: '#d9dcf0',
    tintHi: '#e9eef5',
    edgeLo: '#4b5598',
    edgeHi: '#6a7f9f',
    envLo: '#bdbdbd',
    envHi: '#ffffff',
    key: '#ffffff',
    bodyA: 0.34,
    sideE: 0.3,
    sideA: 0.86,
    rimE: 0.22,
    rimA: 0.5,
    band: 0.18,
    sheen: 0.08,
    etch: '#4d5563',
    etchA: 0.46,
    fibre: '#353a43',
    pin: '#3f4651',
    gold: '#b7862c',
    teal: '#0f6b63',
    shade: '#1a1a1a',
    shadeA: 0.16,
    pool: '#8d9ccc',
    poolA: 0.08,
    // No bloom: the untoned white backdrop is far above the bloom threshold and would veil everything.
    bloom: 0,
    exposure: 1,
  },
};
type Look = typeof LOOK.dark;

/** Elevation of the default camera (radians): high enough to see into each floor. */
const VIEW_ELEV = 0.42;

// Backdrop and ground land on exact neutral colours: their colour goes through the inverse of the
// renderer's ACES tone curve (the same trick the metro uses for print colours).
const ACES_IN_INV = new Matrix3()
  .fromArray([0.59719, 0.076, 0.0284, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777])
  .invert();
const ACES_OUT_INV = new Matrix3()
  .fromArray([1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602])
  .invert();
const UNTONE = /* glsl */ `uniform float uExpo; uniform mat3 uInInv, uOutInv;
  vec3 untone(vec3 c) { vec3 y = max(uOutInv * clamp(c, 0., .985), 0.);
    vec3 A = y * .983729 - 1., B = y * .432951 - .0245786, C = y * .238081 + .000090537;
    vec3 v = (-B - sqrt(max(B * B - 4. * A * C, 0.))) / (2. * A);
    return max(uInInv * v, 0.) / (uExpo / .6); }`;
const YEAR = /* glsl */ `float yr = mix(uMinYear - 3., uYear, uEnter);`;
/** Screen-space vignette: 0 at the middle of the view, 1 towards its corners. */
const VIGNETTE = /* glsl */ `float vignette(vec3 v) { vec2 q = v.xy / max(-v.z, 1e-3); return smoothstep(.15, 1.05, length(q * vec2(.62, 1.))); }`;

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface GlassPlan {
  /** Plate width (x) and depth (z). */
  PW: number;
  PD: number;
  /** Cell of each born-in person on their floor (plate coordinates, before mirroring). */
  rect: Map<string, Rect>;
  /** Spouses beside each person, in wedding order. */
  wed: Map<string, StudioPerson[]>;
  /** Depth of the strip along the front edge kept for the floor's etched years. */
  strip: number;
}

/**
 * Ordered treemap of the plate: each person's cell is split among their children (in birth order)
 * by halving the list where the weights balance and cutting the cell across its longer side.
 * A person weighs their own seat (more with spouses) or their children's total, whichever is more.
 */
export function glassPlan(M: StudioModel, cell: number, margin: number, strip: number): GlassPlan {
  const wed = new Map<string, StudioPerson[]>();
  for (const p of M.people) {
    if (!p.mi || !p.anchor) continue;
    wed.set(p.anchor, [...(wed.get(p.anchor) ?? []), p]);
  }
  for (const [id, list] of wed) {
    const order = M.get(id).spouses.map((s) => s.id);
    list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  const wt = new Map<string, number>();
  const weigh = (p: StudioPerson): number => {
    const own = 1 + 0.55 * (wed.get(p.id)?.length ?? 0);
    let s = 0;
    for (const k of p.kids) s += weigh(M.get(k));
    const w = Math.max(own, s);
    wt.set(p.id, w);
    return w;
  };
  const total = weigh(M.root);
  const area = total * cell * cell;
  const PW = Math.max(36, Math.sqrt(area * 2.8)) + margin * 2;
  const PD = Math.max(14, area / Math.sqrt(area * 2.8)) + margin * 2 + strip;
  const rect = new Map<string, Rect>();
  const split = (list: StudioPerson[], r: Rect) => {
    const first = list[0];
    if (!first) return;
    if (list.length === 1) {
      place(first, r);
      return;
    }
    const ws = list.map((p) => wt.get(p.id) ?? 1);
    const tot = ws.reduce((a, b) => a + b, 0);
    let acc = 0;
    let k = 1;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < list.length - 1; i++) {
      acc += ws[i] ?? 0;
      const d = Math.abs(acc - tot / 2);
      if (d < best) {
        best = d;
        k = i + 1;
      }
    }
    const fa = ws.slice(0, k).reduce((a, b) => a + b, 0) / tot;
    if (r.x1 - r.x0 >= r.z1 - r.z0) {
      const xm = r.x0 + (r.x1 - r.x0) * fa;
      split(list.slice(0, k), { ...r, x1: xm });
      split(list.slice(k), { ...r, x0: xm });
    } else {
      const zm = r.z0 + (r.z1 - r.z0) * fa;
      split(list.slice(0, k), { ...r, z1: zm });
      split(list.slice(k), { ...r, z0: zm });
    }
  };
  const place = (p: StudioPerson, r: Rect) => {
    rect.set(p.id, r);
    split(
      p.kids.map((k) => M.get(k)),
      r,
    );
  };
  place(M.root, { x0: -PW / 2 + margin, z0: -PD / 2 + margin, x1: PW / 2 - margin, z1: PD / 2 - margin - strip });
  return { PW, PD, rect, wed, strip };
}

const sdRoundRect = (w: number, d: number, r: number) => {
  const s = new Shape();
  s.moveTo(-w / 2 + r, -d / 2);
  s.lineTo(w / 2 - r, -d / 2);
  s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
  s.lineTo(w / 2, d / 2 - r);
  s.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
  s.lineTo(-w / 2 + r, d / 2);
  s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
  s.lineTo(-w / 2, -d / 2 + r);
  s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  return s;
};

export const glassScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const look = (): Look => (ctx.dark() ? LOOK.dark : LOOK.light);
  const L0 = look();
  const dir = ctx.rtl() ? -1 : 1;
  const group = new Group();
  const n = M.n;
  const pos = new Float32Array(n * 3);
  const appear = new Float32Array(n);

  const size = big ? 1.05 : 1.75; // portrait scale
  const medal = size * 2.3 * 0.685; // visible medal diameter
  const strip = big ? 4.2 : 3.6;
  const plan = glassPlan(M, big ? 5.4 : 9.6, big ? 1.6 : 2.2, strip);
  const { PW, PD, rect, wed } = plan;
  const T = big ? 1.3 : 1.1; // slab thickness
  const GY = Math.max(big ? 14 : 10, PD * 0.44); // floor spacing
  const h0 = big ? 1.7 : 2.5; // portraits hover this far above their floor
  const topGen = M.maxGen;
  const yOf = (g: number) => g * GY;

  // ---- Seats: each person at their cell's centre, spouses in a row in front of their partner,
  // alternating sides, one portrait apart (down to just over a portrait's width in small cells). A partner's
  // portrait stands higher than the row, so no camera angle can line it up with a spouse's.
  const seat = new Map<string, Vector3>();
  const raise = new Map<string, number>();
  for (const p of M.people) {
    if (p.mi) continue;
    const r = rect.get(p.id);
    if (!r) continue;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const ws = wed.get(p.id) ?? [];
    // The row starts three quarters of a step to each side, so even the nearest spouse clears the
    // partner's medal on screen from low camera angles (and when the partner's medal grows on selection).
    const dz = ws.length ? Math.min(medal * 2.3, (r.z1 - r.z0) * 0.4) : 0;
    seat.set(p.id, new Vector3(dir * cx, yOf(p.gen), cz - dz * 0.5));
    if (ws.length) raise.set(p.id, medal * 0.95);
    const reach = 0.75 + Math.floor((ws.length - 1) / 2);
    const step = Math.min(medal * 1.62, Math.max(medal * 1.05, ((r.x1 - r.x0) / 2 - medal * 0.6) / reach));
    ws.forEach((s, k) => {
      const x = cx + (k % 2 ? -1 : 1) * (0.75 + Math.floor(k / 2)) * step;
      seat.set(s.id, new Vector3(dir * x, yOf(p.gen), cz + dz * 0.5));
    });
  }
  const seatOf = (id: string | null) => (id ? seat.get(id) : undefined) ?? new Vector3();

  // The default camera (also used for the fitted view below).
  const yaw = -dir * 0.3;
  const elev = VIEW_ELEV;
  const dirV = new Vector3(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev));

  // ---- Default view: the whole stack from the front, a little above and turned, fitted (the seat
  // nudging below projects with this camera) ----
  const groundY = -T - GY * 0.62;
  const top = yOf(topGen) + h0 + 2;
  const target = new Vector3(0, (groundY * 0.25 + top) / 2, 0);
  const probe = new PerspectiveCamera(42, 1.45, 0.5, 8000);
  const corners: Vector3[] = [];
  for (const x of [-PW / 2, PW / 2])
    for (const z of [-PD / 2, PD / 2]) for (const y of [-T, top]) corners.push(new Vector3(x, y, z));
  const v = new Vector3();
  const fits = (d: number) => {
    probe.position.copy(target).addScaledVector(dirV, d);
    probe.lookAt(target);
    probe.updateMatrixWorld();
    return corners.every((c) => {
      v.copy(c).project(probe);
      return Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.9 && v.z < 1;
    });
  };
  let lo = 5;
  let hi = 6000;
  for (let it = 0; it < 32; it++) {
    const m = (lo + hi) / 2;
    if (fits(m)) hi = m;
    else lo = m;
  }

  // Portraits on one floor that the default camera would line up (one behind the other, or a raised
  // partner in front of someone further back) are nudged apart along the screen's horizontal, which is
  // close to world x, staying inside their cells.
  {
    probe.position.copy(target).addScaledVector(dirV, hi);
    probe.lookAt(target);
    probe.updateMatrixWorld();
    const xA = new Vector3(0, 1, 0).cross(dirV).normalize();
    const f = 1 / Math.tan((42 * Math.PI) / 360);
    const radius = (p: StudioPerson) => medal * 0.5 * (p.mi ? 0.85 : 1);
    const bounds = (p: StudioPerson) => {
      const r = rect.get(p.mi && p.anchor ? p.anchor : p.id);
      if (!r) return null;
      const a = dir > 0 ? r.x0 : -r.x1;
      const b = dir > 0 ? r.x1 : -r.x0;
      return { x0: a + medal * 0.45, x1: b - medal * 0.45, z0: r.z0 + medal * 0.45, z1: r.z1 - medal * 0.45 };
    };
    const byFloor = new Map<number, StudioPerson[]>();
    for (const p of M.people) if (seat.has(p.id)) byFloor.set(p.gen, [...(byFloor.get(p.gen) ?? []), p]);
    const w = new Vector3();
    const project = (I: { v: Vector3; h: number; s: Vector3; depth: number }) => {
      w.copy(I.v);
      w.y += I.h;
      I.depth = -w.clone().applyMatrix4(probe.matrixWorldInverse).z;
      I.s.copy(w).project(probe);
      I.s.x *= probe.aspect;
    };
    for (const list of byFloor.values()) {
      const items = list.map((p) => ({
        v: seatOf(p.id),
        h: h0 + (raise.get(p.id) ?? 0),
        r: radius(p),
        b: bounds(p),
        s: new Vector3(),
        depth: 1,
      }));
      for (let it = 0; it < 60; it++) {
        let moved = false;
        for (const I of items) project(I);
        for (let i = 0; i < items.length; i++) {
          const A = items[i] as (typeof items)[number];
          for (let j = i + 1; j < items.length; j++) {
            const B = items[j] as (typeof items)[number];
            // Screen units: NDC height 2 = the whole view; a radius r at depth d spans r * f / d.
            const du = B.s.x - A.s.x;
            const dv = B.s.y - A.s.y;
            const need = ((A.r * f) / A.depth + (B.r * f) / B.depth) * 1.1;
            if (du * du + dv * dv >= need * need) continue;
            const want = Math.sqrt(Math.max(0, need * need - dv * dv));
            // World distance along xA that moves a portrait one screen unit, at their mean depth.
            const k = (A.depth + B.depth) / 2 / f;
            const push = (((want - Math.abs(du)) / 2) * k + 0.02) * (du >= 0 ? 1 : -1);
            A.v.addScaledVector(xA, -push);
            B.v.addScaledVector(xA, push);
            moved = true;
          }
        }
        for (const I of items) {
          if (!I.b) continue;
          I.v.x = Math.min(Math.max(I.v.x, Math.min(I.b.x0, I.b.x1)), Math.max(I.b.x0, I.b.x1));
          I.v.z = Math.min(Math.max(I.v.z, Math.min(I.b.z0, I.b.z1)), Math.max(I.b.z0, I.b.z1));
        }
        if (!moved) break;
      }
    }
  }

  M.people.forEach((p, i) => {
    const v = seatOf(p.id);
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y + h0 + (raise.get(p.id) ?? 0);
    pos[i * 3 + 2] = v.z;
    appear[i] = p.mi ? spouseYear(M, p) : p.born;
  });

  // ---- Shared uniforms (theme) ----
  const focus = { value: 0 };
  const shared = {
    uEnvLo: { value: lin(L0.envLo) },
    uEnvHi: { value: lin(L0.envHi) },
    uKey: { value: lin(L0.key) },
    uEtch: { value: lin(L0.etch) },
    uEtchA: { value: L0.etchA },
    uTeal: { value: lin(L0.teal) },
    uGold: { value: lin(L0.gold) },
    uBodyA: { value: L0.bodyA },
    uSideE: { value: L0.sideE },
    uSideA: { value: L0.sideA },
    uRimE: { value: L0.rimE },
    uRimA: { value: L0.rimA },
    uBand: { value: L0.band },
    uSheen: { value: L0.sheen },
    uFocus: focus,
    uHalf: { value: new Vector3(PW / 2, PD / 2, big ? 3 : 2.4) },
  };

  // ---- Floor year spans, etched along each floor's front edge (one canvas for all floors) ----
  const floors: number[] = [];
  for (let g = 0; g <= topGen; g++) if (M.people.some((p) => p.gen === g && !p.mi)) floors.push(g);
  const span = (g: number) => {
    const ys = M.people.filter((p) => p.gen === g && !p.mi).map((p) => p.born);
    const a = Math.min(...ys);
    const b = Math.max(...ys);
    return a === b ? `${a}` : `${a} – ${b}`;
  };
  const ROW = 96;
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 1024;
  labelCanvas.height = ROW * Math.max(1, floors.length);
  const labelW: number[] = [];
  const drawLabels = () => {
    const g = labelCanvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
    g.fillStyle = '#ffffff';
    g.font = '600 64px Manrope, "IBM Plex Sans Arabic", sans-serif';
    g.textBaseline = 'middle';
    floors.forEach((f, i) => {
      const t = span(f);
      // The quads are sized from the first measurement (plus a margin); later redraws (once the app's
      // font has loaded) squeeze the text into that width if it came out wider.
      labelW[i] ??= Math.min(1000, g.measureText(t).width * 1.12 + 8);
      g.fillText(t, 4, i * ROW + ROW / 2 + 2, (labelW[i] ?? 1000) - 8);
    });
  };
  drawLabels();
  const labelTex = new CanvasTexture(labelCanvas);
  labelTex.anisotropy = 8;
  const uLabels = { value: labelTex };

  // ---- Floors: slab + etched cells + year span in one mesh each, drawn bottom to top ----
  const slab = new ExtrudeGeometry(sdRoundRect(PW, PD, shared.uHalf.value.z), {
    depth: T - 0.36,
    bevelEnabled: true,
    bevelThickness: 0.18,
    bevelSize: 0.22,
    bevelSegments: big ? 2 : 4,
    curveSegments: big ? 5 : 9,
  });
  slab.rotateX(-Math.PI / 2);
  slab.translate(0, -(T - 0.18), 0);
  const slabPos = slab.getAttribute('position').array as Float32Array;
  const slabNor = slab.getAttribute('normal').array as Float32Array;
  slab.dispose();
  const floorMeshes: Mesh[] = [];
  const floorGeos: BufferGeometry[] = [];
  const floorBorn: number[] = [];
  const inset = big ? 0.42 : 0.7;
  const ramp = (a: string, b: string, t: number) => lin(a).lerp(lin(b), t);
  floors.forEach((g, fi) => {
    const P: number[] = Array.from(slabPos);
    const N: number[] = Array.from(slabNor);
    const nv0 = P.length / 3;
    const part: number[] = new Array(nv0).fill(0);
    const q: number[] = new Array(nv0 * 4).fill(0);
    const born: number[] = new Array(nv0).fill(-1e4);
    const keys: string[] = new Array(nv0).fill('');
    const quad = (
      x0: number,
      z0: number,
      x1: number,
      z1: number,
      y: number,
      k: number,
      qs: number[][],
      b: number,
      key: string,
    ) => {
      const c = [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z0],
        [x1, z1],
        [x0, z1],
      ];
      // Winding facing up (+y).
      const order = [0, 2, 1, 3, 5, 4];
      for (const o of order) {
        const v = c[o] as number[];
        P.push(v[0] ?? 0, y, v[1] ?? 0);
        N.push(0, 1, 0);
        part.push(k);
        const qq = qs[o] ?? qs[0] ?? [0, 0, 0, 0];
        q.push(qq[0] ?? 0, qq[1] ?? 0, qq[2] ?? 0, qq[3] ?? 0);
        born.push(b);
        keys.push(key);
      }
    };
    for (const p of M.people) {
      if (p.mi || p.gen !== g) continue;
      const r = rect.get(p.id);
      if (!r) continue;
      const a = dir > 0 ? r.x0 : -r.x1;
      const b = dir > 0 ? r.x1 : -r.x0;
      const cx = (a + b) / 2;
      const cz = (r.z0 + r.z1) / 2;
      const hx = Math.max(0.2, (b - a) / 2 - inset);
      const hz = Math.max(0.2, (r.z1 - r.z0) / 2 - inset);
      const qv = [cx, cz, hx, hz];
      // A little larger than the cell, so the etched outline is not clipped.
      quad(
        cx - hx - 0.3,
        cz - hz - 0.3,
        cx + hx + 0.3,
        cz + hz + 0.3,
        0.035,
        1,
        [qv, qv, qv, qv, qv, qv],
        p.born,
        p.id,
      );
    }
    // Etched year span, front edge (front-left in English, front-right in Arabic).
    const lw = labelW[fi] ?? 200;
    const lh = big ? 2.6 : 2.1;
    const len = (lh * lw) / ROW;
    const z1 = PD / 2 - strip * 0.28;
    const z0 = z1 - lh;
    const xa = dir > 0 ? -PW / 2 + 2.4 : PW / 2 - 2.4 - len;
    const v0 = 1 - (fi * ROW) / labelCanvas.height;
    const v1 = 1 - ((fi + 1) * ROW) / labelCanvas.height;
    const u1 = lw / labelCanvas.width;
    quad(
      xa,
      z0,
      xa + len,
      z1,
      0.03,
      2,
      [
        [0, v0, 0, 0],
        [u1, v0, 0, 0],
        [u1, v1, 0, 0],
        [0, v0, 0, 0],
        [u1, v1, 0, 0],
        [0, v1, 0, 0],
      ],
      -1e4,
      '',
    );
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(N, 3));
    geo.setAttribute('aPart', new Float32BufferAttribute(part, 1));
    geo.setAttribute('aQ', new Float32BufferAttribute(q, 4));
    geo.setAttribute('aBorn', new Float32BufferAttribute(born, 1));
    geo.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(part.length), 1));
    geo.userData.keys = keys;
    const t = topGen ? g / topGen : 1;
    const uni = {
      ...U,
      ...shared,
      uLabels,
      uTint: { value: ramp(L0.tintLo, L0.tintHi, t) },
      uEdge: { value: ramp(L0.edgeLo, L0.edgeHi, t) },
      uFade: { value: 1 },
      uT: { value: t },
    };
    const mat = new ShaderMaterial({
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      // Large families: front faces only (half the overdraw of a dozen overlapping panes).
      side: big ? FrontSide : DoubleSide,
      uniforms: uni,
      vertexShader: /* glsl */ `attribute float aPart, aBorn, aHi; attribute vec4 aQ;
        varying vec3 vN, vW, vL; varying vec4 vQ; varying float vPart, vBorn, vHi;
        void main() { vN = (mat3(modelMatrix) * normal) / max(length(mat3(modelMatrix) * normal), 1e-6); vL = position; vQ = aQ; vPart = aPart; vBorn = aBorn; vHi = aHi;
          vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `uniform vec3 uTint, uEdge, uEnvLo, uEnvHi, uKey, uEtch, uTeal, uHalf;
        uniform float uBodyA, uSideE, uSideA, uRimE, uRimA, uBand, uSheen, uEtchA, uFocus, uFade, uT, uTime, uYear, uEnter, uMinYear;
        uniform sampler2D uLabels;
        varying vec3 vN, vW, vL; varying vec4 vQ; varying float vPart, vBorn, vHi;
        float sdBox(vec2 p, vec2 b, float r) { vec2 d = abs(p) - b + r; return length(max(d, 0.)) + min(max(d.x, d.y), 0.) - r; }
        void main() { ${YEAR}
          float lit = step(.5, vHi) * uFocus;
          if (vPart < .5) {
            vec3 n = vN / max(length(vN), 1e-6); if (!gl_FrontFacing) n = -n;
            vec3 V = normalize(cameraPosition - vW);
            float ct = clamp(dot(n, V), 0., 1.);
            float F = .04 + .96 * pow(max(1. - ct, 0.), 5.);
            vec3 R = reflect(-V, n);
            vec3 env = mix(uEnvLo, uEnvHi, smoothstep(-.3, .9, R.y));
            // A long horizontal studio light, the reflection that makes a flat pane read as glass.
            env += uKey * uBand * smoothstep(.1, .28, R.y) * (1. - smoothstep(.42, .66, R.y));
            env += uKey * smoothstep(.86, .985, dot(R, normalize(vec3(-.45, .78, .45))));
            env += uKey * .45 * smoothstep(.93, .995, dot(R, normalize(vec3(.7, .45, .55))));
            float up = abs(n.y);
            float side = 1. - smoothstep(.3, .8, up);
            float sd = sdBox(vL.xz, uHalf.xy, uHalf.z);
            float rim = (1. - smoothstep(0., 1.1, -sd)) * step(.9, up);
            // A soft band of light drifting across the pane, staggered per floor so the bands never
            // line up through the stack (they would read as a vertical beam).
            float sheen = pow(max(0., sin((vW.x + vW.z * .6) * .045 - uTime * .22 + uT * 2.6)), 18.) * step(.9, up);
            // Depth across the pane: a touch denser towards the back edge, so stacked floors separate.
            float back = (1. - smoothstep(-uHalf.y, uHalf.y, vL.z)) * step(.9, up);
            vec3 col = uTint * uBodyA * (1. + .35 * back) + env * F + uEdge * (side * uSideE + rim * uRimE) + uKey * sheen * uSheen;
            float a = uBodyA * (1. + .3 * back) + F * .5 + side * uSideA + rim * uRimA + sheen * uSheen * .2;
            // A crisp line where the bevel meets the top face.
            float lip = (1. - smoothstep(.0, .12, abs(-sd - .3))) * step(.9, up);
            col += uEdge * lip * uRimE * 1.4; a += lip * uRimA;
            a = clamp(a, 0., .96) * uFade;
            gl_FragColor = vec4(col * uFade, a);
          } else if (vPart < 1.5) {
            if (yr < vBorn) discard;
            vec2 p = vL.xz - vQ.xy;
            float sd = sdBox(p, vQ.zw, .9);
            float aa = max(fwidth(sd) * 1.2, 1e-4);
            float line = 1. - smoothstep(0., aa, abs(sd) - .05);
            float fill = 1. - smoothstep(-aa, aa, sd);
            float dim = uFocus * (1. - lit);
            // Premultiplied blending: alpha must stay within 0..1 or the floor below goes negative.
            float a = clamp(line * uEtchA * (1. - .6 * dim) + fill * .035 * (1. - dim) + lit * (line * .75 + fill * .1), 0., 1.);
            vec3 c = mix(uEtch, uTeal, lit);
            gl_FragColor = vec4(c * a * uFade, a * uFade);
          } else {
            float t = clamp(texture2D(uLabels, vQ.xy).a * (uEtchA * 2. + .1) * (1. - .5 * uFocus), 0., 1.);
            gl_FragColor = vec4(uEtch * t * uFade, t * uFade);
          }
        }`,
    });
    const mesh = new Mesh(geo, mat);
    mesh.position.y = yOf(g);
    // Bottom to top, always before the portraits (renderOrder 10), however many floors there are.
    mesh.renderOrder = 1 + (8 * fi) / Math.max(1, floors.length - 1);
    mesh.userData.uni = uni;
    group.add(mesh);
    floorMeshes.push(mesh);
    floorGeos.push(geo);
    floorBorn.push(Math.min(...M.people.filter((p) => p.gen === g && !p.mi).map((p) => p.born)));
  });

  // ---- Pins: a fine stem from each seat up to the portrait, a ring where it meets the glass ----
  const stem = new CylinderGeometry(big ? 0.04 : 0.055, big ? 0.04 : 0.055, h0 - 0.6, 6, 1, true);
  stem.translate(0, (h0 - 0.6) / 2, 0);
  stem.setAttribute('aFoot', new Float32BufferAttribute(new Float32Array(stem.getAttribute('position').count), 1));
  const foot = new CylinderGeometry(big ? 0.3 : 0.42, big ? 0.3 : 0.42, 0.05, big ? 14 : 24);
  foot.translate(0, 0.06, 0);
  foot.setAttribute(
    'aFoot',
    new Float32BufferAttribute(new Float32Array(foot.getAttribute('position').count).fill(1), 1),
  );
  const pinGeo = mergeGeometries([stem.toNonIndexed(), foot.toNonIndexed()]) ?? new BufferGeometry();
  stem.dispose();
  foot.dispose();
  const pBorn = new Float32Array(n);
  const pStem = new Float32Array(n);
  pinGeo.setAttribute('aBorn', new InstancedBufferAttribute(pBorn, 1));
  pinGeo.setAttribute('aStem', new InstancedBufferAttribute(pStem, 1));
  pinGeo.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(n), 1));
  pinGeo.userData.keys = M.people.map((p) => p.id);
  const pinUni = {
    ...U,
    uPin: { value: lin(L0.pin) },
    uTeal: shared.uTeal,
    uFocus: focus,
    uDimTo: { value: lin(L0.centre) },
  };
  const pins = new InstancedMesh(
    pinGeo,
    new ShaderMaterial({
      uniforms: pinUni,
      vertexShader: /* glsl */ `attribute float aBorn, aHi, aFoot, aStem; uniform float uYear, uEnter, uMinYear;
        varying float vHi, vFoot; varying vec3 vN;
        void main() { ${YEAR} float on = smoothstep(aBorn - .2, aBorn + .6, yr); vHi = aHi; vFoot = aFoot; vN = normal;
          vec3 p = position; if (aFoot < .5) p.y *= aStem; p *= on;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.); }`,
      fragmentShader: /* glsl */ `uniform vec3 uPin, uTeal, uDimTo; uniform float uFocus; varying float vHi, vFoot; varying vec3 vN;
        void main() { float lit = step(.5, vHi) * uFocus; vec3 c = mix(uPin, uTeal, lit);
          c *= vFoot > .5 ? (.75 + .35 * max(vN.y, 0.)) : 1.;
          c = mix(c, uDimTo, uFocus * (1. - lit) * .7);
          gl_FragColor = vec4(c, 1.); }`,
    }),
    n,
  );
  const mtx = new Matrix4();
  M.people.forEach((p, i) => {
    const s = seatOf(p.id);
    mtx.makeTranslation(s.x, s.y, s.z);
    pins.setMatrixAt(i, mtx);
    pBorn[i] = appear[i] ?? p.born;
    pStem[i] = (h0 - 0.6 + (raise.get(p.id) ?? 0)) / (h0 - 0.6);
  });
  pins.frustumCulled = false;
  group.add(pins);

  // ---- Spouse bars: gold, flat on the glass, from each partner to each spouse ----
  const spouses = M.people.filter((p) => p.mi && p.anchor && seat.has(p.anchor));
  const nb = Math.max(1, spouses.length);
  const barGeo = new BoxGeometry(1, 1, 1);
  barGeo.translate(0, 0.5, 0.5);
  const bBorn = new Float32Array(nb);
  barGeo.setAttribute('aBorn', new InstancedBufferAttribute(bBorn, 1));
  barGeo.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(nb), 1));
  barGeo.userData.keys = spouses.map((p) => p.id);
  const barUni = { ...U, uGold: shared.uGold, uFocus: focus, uDimTo: pinUni.uDimTo };
  const bars = new InstancedMesh(
    barGeo,
    new ShaderMaterial({
      uniforms: barUni,
      vertexShader: /* glsl */ `attribute float aBorn, aHi; uniform float uYear, uEnter, uMinYear; varying float vHi; varying vec3 vN;
        void main() { ${YEAR} float on = smoothstep(aBorn - .2, aBorn + .8, yr); vHi = aHi; vN = normal;
          vec3 p = position; p.z *= on;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.); }`,
      fragmentShader: /* glsl */ `uniform vec3 uGold, uDimTo; uniform float uFocus; varying float vHi; varying vec3 vN;
        void main() { float lit = step(.5, vHi) * uFocus; vec3 c = uGold * (.8 + .3 * max(vN.y, 0.));
          c = mix(c, uDimTo, uFocus * (1. - lit) * .65);
          gl_FragColor = vec4(c, 1.); }`,
    }),
    nb,
  );
  bars.count = spouses.length;
  const barScale = new Vector3();
  spouses.forEach((p, i) => {
    // The bar grows from the partner's seat towards the spouse's.
    const a = seatOf(p.anchor);
    const b = seatOf(p.id);
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    mtx.makeRotationY(Math.atan2(b.x - a.x, b.z - a.z));
    mtx.scale(barScale.set(big ? 0.12 : 0.17, big ? 0.06 : 0.08, d));
    mtx.setPosition(a.x, a.y + 0.05, a.z);
    bars.setMatrixAt(i, mtx);
    bBorn[i] = spouseYear(M, p);
  });
  bars.frustumCulled = false;
  group.add(bars);

  // ---- Fibres: from each parent's seat up through the glass to each child's seat ----
  const B = builder();
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    const a = seatOf(p.parent)
      .clone()
      .setY(seatOf(p.parent).y + 0.08);
    const c = seatOf(p.id)
      .clone()
      .setY(seatOf(p.id).y + 0.08);
    const rise = c.y - a.y;
    tube(
      B,
      new CubicBezierCurve3(a, a.clone().setY(a.y + rise * 0.55), c.clone().setY(c.y - rise * 0.6), c),
      big ? 0.055 : 0.1,
      big ? 0.045 : 0.08,
      big ? 10 : 18,
      big ? 4 : 6,
      p.born,
      p.id,
      1.6,
    );
  }
  const fibreGeo = bake(B);
  const fibreUni = {
    ...U,
    uFibre: { value: lin(L0.fibre) },
    uTeal: shared.uTeal,
    uFocus: focus,
    uDimTo: pinUni.uDimTo,
    uPulse: { value: ctx.dark() ? 1 : 0.35 },
    uSoft: { value: big ? 0.55 : 1 },
    uWide: { value: big ? 0.05 : 0.07 },
  };
  const fibres = new Mesh(
    fibreGeo,
    new ShaderMaterial({
      // gl.ts tube() winds its triangles inward: the outer wall is the back face.
      side: BackSide,
      uniforms: fibreUni,
      vertexShader: /* glsl */ `attribute float aT, aBirth, aGrow, aHi; uniform float uFocus, uWide;
        varying float vT, vBirth, vGrow, vHi; varying vec3 vN, vW;
        void main() { vT = aT; vBirth = aBirth; vGrow = aGrow; vHi = aHi; vN = (mat3(modelMatrix) * normal) / max(length(mat3(modelMatrix) * normal), 1e-6);
          vec3 p = position + normal * uWide * step(.5, aHi) * uFocus;
          vec4 w = modelMatrix * vec4(p, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `uniform vec3 uFibre, uTeal, uDimTo; uniform float uYear, uEnter, uMinYear, uTime, uFocus, uPulse, uSoft;
        varying float vT, vBirth, vGrow, vHi; varying vec3 vN, vW;
        void main() { ${YEAR} float g = clamp((yr - vBirth) / vGrow, 0., 1.); if (vT > g) discard;
          float lit = step(.5, vHi) * uFocus;
          float pulse = smoothstep(.82, 1., fract(vT * 1.4 - uTime * .32 + vBirth * .131));
          vec3 c = mix(uFibre, uTeal, lit);
          vec3 V = normalize(cameraPosition - vW); float ed = 1. - abs(dot(vN / max(length(vN), 1e-6), V));
          c *= .78 + .3 * (1. - ed);
          c += (uPulse > .5 ? c : vec3(1.)) * pulse * uPulse * .9 * (1. - uFocus * (1. - lit));
          // Large families: many fibres share a column, so each one is quieter.
          c = mix(uDimTo, c, mix(uSoft, 1., lit));
          c = mix(c, uDimTo, uFocus * (1. - lit) * .75);
          gl_FragColor = vec4(c, 1.); }`,
    }),
  );
  group.add(fibres);

  // ---- Backdrop (neutral vignette) and the ground: a soft shadow and a faint pool of light ----
  const bgUni = {
    uCentre: { value: lin(L0.centre) },
    uEdge: { value: lin(L0.edge) },
    uExpo: { value: L0.exposure },
    uInInv: { value: ACES_IN_INV },
    uOutInv: { value: ACES_OUT_INV },
  };
  const sky = new Mesh(
    new SphereGeometry(1400, 32, 16),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: bgUni,
      vertexShader: `varying vec3 vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.); vV = mv.xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${UNTONE} ${VIGNETTE} uniform vec3 uCentre, uEdge; varying vec3 vV;
        void main() { gl_FragColor = vec4(untone(mix(uCentre, uEdge, vignette(vV))), 1.); }`,
    }),
  );
  sky.renderOrder = -1;
  group.add(sky);
  const gUni = {
    ...U,
    ...bgUni,
    uShade: { value: lin(L0.shade) },
    uShadeA: { value: L0.shadeA },
    uPool: { value: lin(L0.pool) },
    uPoolA: { value: L0.poolA },
    uHalf: shared.uHalf,
  };
  // Opaque, in display space: the same vignette as the backdrop with the shadow and the light pool
  // mixed in before untoning (alpha blending over the untoned stage would wash them out).
  const ground = new Mesh(
    new PlaneGeometry(PW * 4 + 200, PD * 4 + 200),
    new ShaderMaterial({
      uniforms: gUni,
      vertexShader: `varying vec2 vP; varying vec3 vV; void main() { vec4 w = modelMatrix * vec4(position, 1.); vP = w.xz; vec4 mv = viewMatrix * w; vV = mv.xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${UNTONE} ${VIGNETTE} uniform vec3 uShade, uPool, uHalf, uCentre, uEdge; uniform float uShadeA, uPoolA, uTime; varying vec2 vP; varying vec3 vV;
        float sdBox(vec2 p, vec2 b, float r) { vec2 d = abs(p) - b + r; return length(max(d, 0.)) + min(max(d.x, d.y), 0.) - r; }
        void main() { vec2 p = vP - vec2(4., 6.);
          float d = sdBox(p, uHalf.xy, uHalf.z);
          float sh = 1. - smoothstep(-uHalf.y * .5, uHalf.y * .45, d);
          // Light let through the tinted glass: a soft pool with a slow caustic shimmer.
          vec2 c = vP * .16; float w = sin(c.x + uTime * .5) * sin(c.y * 1.3 - uTime * .4) + sin((c.x + c.y) * .7 + uTime * .3);
          float pool = (1. - smoothstep(-uHalf.y * .2, uHalf.y * .3, sdBox(vP, uHalf.xy * .85, uHalf.z))) * (.75 + .25 * w);
          vec3 col = mix(mix(uCentre, uEdge, vignette(vV)), uShade, sh * uShadeA);
          col = mix(col, uPool, pool * uPoolA);
          gl_FragColor = vec4(untone(col), 1.); }`,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = groundY;
  ground.renderOrder = 0;
  group.add(ground);

  const tint = () => {
    const t = look();
    shared.uEnvLo.value.copy(lin(t.envLo));
    shared.uEnvHi.value.copy(lin(t.envHi));
    shared.uKey.value.copy(lin(t.key));
    shared.uEtch.value.copy(lin(t.etch));
    shared.uEtchA.value = t.etchA;
    shared.uTeal.value.copy(lin(t.teal));
    shared.uGold.value.copy(lin(t.gold));
    shared.uBodyA.value = t.bodyA;
    shared.uSideE.value = t.sideE;
    shared.uSideA.value = t.sideA;
    shared.uRimE.value = t.rimE;
    shared.uRimA.value = t.rimA;
    shared.uBand.value = t.band;
    shared.uSheen.value = t.sheen;
    floors.forEach((g, fi) => {
      const mesh = floorMeshes[fi];
      if (!mesh) return;
      const u = mesh.userData.uni as { uTint: { value: Color }; uEdge: { value: Color }; uFade: { value: number } };
      const k = topGen ? g / topGen : 1;
      u.uTint.value.copy(ramp(t.tintLo, t.tintHi, k));
      u.uEdge.value.copy(ramp(t.edgeLo, t.edgeHi, k));
      // Lower floors sit under more glass: frosted glass veils them a little more.
      u.uFade.value = Math.max(0.4, 1 - (ctx.dark() ? 0.035 : 0.07) * (topGen - g));
    });
    pinUni.uPin.value.copy(lin(t.pin));
    pinUni.uDimTo.value.copy(lin(t.centre));
    fibreUni.uFibre.value.copy(lin(t.fibre));
    fibreUni.uPulse.value = ctx.dark() ? 1 : 0.35;
    bgUni.uCentre.value.copy(lin(t.centre));
    bgUni.uEdge.value.copy(lin(t.edge));
    bgUni.uExpo.value = t.exposure;
    gUni.uShade.value.copy(lin(t.shade));
    gUni.uShadeA.value = t.shadeA;
    gUni.uPool.value.copy(lin(t.pool));
    gUni.uPoolA.value = t.poolA;
    ctx.look(t.bloom, t.exposure);
  };
  const yearHook = (yr: number) => {
    floorMeshes.forEach((m, i) => {
      m.visible = (floorBorn[i] ?? 0) <= yr + 0.5;
    });
  };
  void document.fonts
    ?.load('600 64px Manrope')
    .then(() => {
      if (!group.parent) return;
      drawLabels();
      labelTex.needsUpdate = true;
    })
    .catch(() => {});

  tint();
  return {
    key: 'glass',
    group,
    pos,
    size,
    style: 0,
    lift: 8,
    tint,
    yearHook,
    appear,
    labelUp: true,
    labelScale: big ? 0.85 : 0.92,
    hiTargets: [
      ...floorGeos.map((geo) => ({ geo, perPerson: true })),
      { geo: pinGeo, perPerson: true },
      { geo: barGeo, perPerson: true },
      { geo: fibreGeo },
    ],
    focus: [focus],
    view: { target, cam: target.clone().addScaledVector(dirV, hi) },
    follow: big ? 26 : 34,
  };
};
