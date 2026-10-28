import {
  BufferGeometry,
  type Camera,
  Color,
  type Curve,
  Float32BufferAttribute,
  Matrix3,
  type Object3D,
  PerspectiveCamera,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';

// Helpers shared by the botanical scenes (Living Tree, Bonsai, Banyan): an exact inverse of the
// renderer's tone mapping (so neutral stages land on true black or white), a wood tube builder
// that remembers each ring's centre and radius (bark scale, thickening with age), 3D noise, and
// a default-view fit.

// ---------- display colour -> scene colour (inverse of three's ACES filmic tone mapping) ----------

const IN = new Matrix3().set(0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777);
const OUT = new Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602);
const IN_INV = IN.clone().invert();
const OUT_INV = OUT.clone().invert();
const fitInv = (y: number) => {
  // The fit's asymptote is ~1.0165, so it stays finite up to pure white.
  const t = Math.min(1, Math.max(0, y));
  const a = 1 - 0.983729 * t;
  const b = 0.0245786 - 0.432951 * t;
  const c = -(0.000090537 + 0.238081 * t);
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
};
const tmpV = new Vector3();

/** The linear scene colour that ACES filmic tone mapping at `exposure` shows on screen as `hex`. */
export function untone(hex: string, exposure: number, out = new Color()): Color {
  const c = new Color(hex); // linear
  tmpV.set(c.r, c.g, c.b).applyMatrix3(OUT_INV);
  tmpV.set(fitInv(tmpV.x), fitInv(tmpV.y), fitInv(tmpV.z)).applyMatrix3(IN_INV);
  const k = 0.6 / exposure;
  return out.setRGB(Math.max(0, tmpV.x * k), Math.max(0, tmpV.y * k), Math.max(0, tmpV.z * k));
}

// ---------- wood ----------

export interface Wood {
  pos: number[];
  nor: number[];
  ctr: number[];
  t: number[];
  s: number[];
  u: number[];
  r: number[];
  birth: number[];
  grow: number[];
  kind: number[];
  key: string[];
  idx: number[];
}

export const woodBuilder = (): Wood => ({
  pos: [],
  nor: [],
  ctr: [],
  t: [],
  s: [],
  u: [],
  r: [],
  birth: [],
  grow: [],
  kind: [],
  key: [],
  idx: [],
});

export interface TubeOpts {
  birth: number;
  /** Years the tube takes to grow from its start to its end. */
  grow: number;
  /** Person whose lineage lights this tube ('' for none). */
  key: string;
  /** 0 bark, 1 marriage twig (gold), 2 root, 3 deadwood; scenes may add their own. */
  kind?: number;
  /** Radius multiplier along the tube (flares, knots). */
  shape?: (t: number) => number;
}

const FN = new Vector3(1, 0, 0);
const FB = new Vector3(0, 0, 1);

/** Tapered tube along a curve (r0 at the start, r1 at the end), appended to the builder. */
export function tube(
  B: Wood,
  curve: Curve<Vector3>,
  r0: number,
  r1: number,
  segs: number,
  radial: number,
  o: TubeOpts,
) {
  const frames = curve.computeFrenetFrames(segs, false);
  const len = curve.getLength();
  const base = B.pos.length / 3;
  const P = new Vector3();
  const n = new Vector3();
  for (let i = 0; i <= segs; i++) {
    const tt = i / segs;
    curve.getPointAt(tt, P);
    const r = (r0 + (r1 - r0) * tt ** 0.8) * (o.shape ? o.shape(tt) : 1);
    const N = frames.normals[i] ?? FN;
    const Bn = frames.binormals[i] ?? FB;
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2;
      n.copy(N).multiplyScalar(Math.cos(v)).addScaledVector(Bn, Math.sin(v)).normalize();
      B.pos.push(P.x + n.x * r, P.y + n.y * r, P.z + n.z * r);
      B.nor.push(n.x, n.y, n.z);
      B.ctr.push(P.x, P.y, P.z);
      B.t.push(tt);
      B.s.push(tt * len);
      B.u.push(j / radial);
      B.r.push(r);
      B.birth.push(o.birth);
      B.grow.push(o.grow);
      B.kind.push(o.kind ?? 0);
      B.key.push(o.key);
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < radial; j++) {
      const a = base + i * (radial + 1) + j;
      const b = a + radial + 1;
      B.idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
}

/** Geometry whose per-vertex `aHi` the engine drives from the lineage (userData.keys). */
export function bakeWood(B: Wood): BufferGeometry {
  const g = new BufferGeometry();
  const f = (a: number[], k: number) => new Float32BufferAttribute(a, k);
  g.setAttribute('position', f(B.pos, 3));
  g.setAttribute('normal', f(B.nor, 3));
  g.setAttribute('aC', f(B.ctr, 3));
  g.setAttribute('aT', f(B.t, 1));
  g.setAttribute('aS', f(B.s, 1));
  g.setAttribute('aU', f(B.u, 1));
  g.setAttribute('aR', f(B.r, 1));
  g.setAttribute('aBirth', f(B.birth, 1));
  g.setAttribute('aGrow', f(B.grow, 1));
  g.setAttribute('aKind', f(B.kind, 1));
  g.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(B.key.length), 1));
  g.setIndex(B.idx);
  g.userData.keys = B.key;
  return g;
}

// ---------- GLSL ----------

/** Hash and value noise in 2D and 3D. */
export const NOISE3 = /* glsl */ `
  float h31(vec3 p) { p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vn3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
    return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }`;

/** Bump-mapped normal from a height value via screen-space derivatives (three's perturbNormalArb). */
export const BUMP = /* glsl */ `
  vec3 bump(vec3 n, vec3 w, float h, float k) {
    vec3 dpx = dFdx(w), dpy = dFdy(w);
    vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
    float det = dot(dpx, r1);
    if (abs(det) < 1e-9) return n;
    vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
    vec3 v = abs(det) * n - grad * k;
    return dot(v, v) > 1e-20 ? normalize(v) : n;
  }
  // Facet normal from screen-space derivatives, facing the viewer; falls back to V on degenerate pixels.
  vec3 facet(vec3 w, vec3 V) {
    vec3 c = cross(dFdx(w), dFdy(w));
    if (dot(c, c) < 1e-20) return V;
    c = normalize(c);
    return dot(c, V) < 0. ? -c : c;
  }`;

// ---------- framing ----------

/**
 * A default view looking along `dir` that frames every point (each grown by `pad`) on a stage of the
 * engine's reference aspect (1.45, the area beside the scene rail; the engine backs off on narrower stages).
 */
export function fitView(points: Vector3[], pad: number, dir: Vector3, aspect = 1.45, fill = 0.94) {
  if (!points.length) return { target: new Vector3(), cam: dir.clone().multiplyScalar(60) };
  const cam = new PerspectiveCamera(42, aspect, 0.5, 5000);
  const target = new Vector3();
  for (const p of points) target.add(p);
  target.multiplyScalar(1 / Math.max(1, points.length));
  const v = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  const place = (d: number) => {
    cam.position.copy(target).addScaledVector(dir, d);
    cam.lookAt(target);
    cam.updateMatrixWorld();
  };
  const bounds = (d: number) => {
    place(d);
    let x0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    const t = Math.tan((21 * Math.PI) / 180);
    for (const p of points) {
      const dist = Math.max(1e-3, p.distanceTo(cam.position));
      const r = pad / (dist * t);
      v.copy(p).project(cam);
      x0 = Math.min(x0, v.x - r / aspect);
      x1 = Math.max(x1, v.x + r / aspect);
      y0 = Math.min(y0, v.y - r);
      y1 = Math.max(y1, v.y + r);
    }
    return { x0, x1, y0, y1 };
  };
  let d = 100;
  for (let pass = 0; pass < 4; pass++) {
    let lo = 1;
    let hi = 20000;
    for (let it = 0; it < 48; it++) {
      const mid = (lo + hi) / 2;
      const b = bounds(mid);
      if (b.x0 >= -fill && b.x1 <= fill && b.y0 >= -fill && b.y1 <= fill) hi = mid;
      else lo = mid;
    }
    d = hi;
    // Re-centre the target on the framed points.
    const b = bounds(d);
    const k = d * Math.tan((21 * Math.PI) / 180);
    right.setFromMatrixColumn(cam.matrixWorld, 0);
    up.setFromMatrixColumn(cam.matrixWorld, 1);
    target.addScaledVector(right, ((b.x0 + b.x1) / 2) * k * aspect).addScaledVector(up, ((b.y0 + b.y1) / 2) * k);
  }
  return { target, cam: target.clone().addScaledVector(dir, d) };
}

/**
 * Lineage highlight on wood (GLSL): thin limbs take the teal (with a current flowing parent to child);
 * thick wood (trunks, pillars) only carries the current and a teal edge, so teal never floods a large
 * surface. Gold marriage twigs stay gold and brighten. `thick` 0..1, `edge` 0..1 (Fresnel).
 */
export const LINEAGE = /* glsl */ `
  vec3 lineage(vec3 col, vec3 hi, vec3 gold, float on, float isGold, float flow, float thick, float edge, float dark) {
    vec3 thin = dark > .5 ? col * .8 + hi * (.16 + .6 * flow) : mix(col, hi, .45) + hi * flow * .28;
    // Thick wood keeps its bark: the current moves along it and only the silhouette catches the teal.
    vec3 fat = col + hi * (flow * .32 + edge * edge * .32) * (dark > .5 ? .85 : .6);
    vec3 h = mix(mix(thin, fat, thick), col + gold * .22, isGold);
    return mix(col, h, step(.5, on));
  }`;

// ---------- point sprites ----------

/** Pixels per world unit at distance 1 on the reference stage (740 px drawing buffer, 42 degree lens). */
export const REF_PX = 964;

/**
 * Keeps `uPx` (pixels per world unit at distance 1) in step with the drawing buffer and the lens, so
 * point sprites keep their world size at any pixel ratio or stage height. Shaders scale pixel caps by
 * uPx / REF_PX.
 */
export function trackPointScale(obj: Object3D, uPx: { value: number }) {
  const buf = new Vector2();
  obj.onBeforeRender = (r: WebGLRenderer, _s: unknown, cam: Camera) => {
    r.getDrawingBufferSize(buf);
    uPx.value = (buf.y * cam.projectionMatrix.elements[5]) / 2;
  };
}

/** Vertex shader of a far backdrop dome: always drawn at the far plane, so zooming out never clips it. */
export const DOME_VERT = /* glsl */ `varying vec3 vD;
  void main() { vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`;
