import { BufferGeometry, CanvasTexture, type Curve, Float32BufferAttribute, Vector3 } from 'three';

// Banyan geometry: tapered tubes that remember their centre line, so the shader can
// thicken a prop-root into a trunk as the years pass, plus the banyan leaf texture.

export interface WoodBuilder {
  pos: number[];
  nor: number[];
  /** Centre line point for each vertex (thickening). */
  ctr: number[];
  /** 0..1 along the tube (growth), arc length in world units (bark pattern), around (0..1). */
  t: number[];
  s: number[];
  u: number[];
  birth: number[];
  grow: number[];
  /** Thickness the tube starts at, as a share of its final radius. */
  thin: number[];
  col: number[];
  key: string[];
  idx: number[];
}

export const woodBuilder = (): WoodBuilder => ({
  pos: [],
  nor: [],
  ctr: [],
  t: [],
  s: [],
  u: [],
  birth: [],
  grow: [],
  thin: [],
  col: [],
  key: [],
  idx: [],
});

export interface WoodOpts {
  birth: number;
  grow: number;
  key: string;
  thin?: number;
  /** Radius multiplier along the tube (flares, knots). */
  shape?: (t: number) => number;
  col?: [number, number, number];
}

const FN = new Vector3(1, 0, 0);
const FB = new Vector3(0, 0, 1);

/** Tapered tube along a curve (r0 at t = 0, r1 at t = 1). */
export function wood(
  B: WoodBuilder,
  curve: Curve<Vector3>,
  r0: number,
  r1: number,
  segs: number,
  radial: number,
  o: WoodOpts,
) {
  const frames = curve.computeFrenetFrames(segs, false);
  const len = curve.getLength();
  const base = B.pos.length / 3;
  const P = new Vector3();
  const n = new Vector3();
  const col = o.col ?? [1, 1, 1];
  for (let i = 0; i <= segs; i++) {
    const tt = i / segs;
    curve.getPointAt(tt, P);
    const r = (r0 + (r1 - r0) * tt ** 0.85) * (o.shape ? o.shape(tt) : 1);
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
      B.birth.push(o.birth);
      B.grow.push(o.grow);
      B.thin.push(o.thin ?? 0.4);
      B.col.push(col[0], col[1], col[2]);
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

/** Geometry whose `aHi` the engine drives from the lineage (userData.keys). */
export function bakeWood(B: WoodBuilder): BufferGeometry {
  const g = new BufferGeometry();
  const f = (a: number[], k: number) => new Float32BufferAttribute(a, k);
  g.setAttribute('position', f(B.pos, 3));
  g.setAttribute('normal', f(B.nor, 3));
  g.setAttribute('aC', f(B.ctr, 3));
  g.setAttribute('aT', f(B.t, 1));
  g.setAttribute('aS', f(B.s, 1));
  g.setAttribute('aU', f(B.u, 1));
  g.setAttribute('aBirth', f(B.birth, 1));
  g.setAttribute('aGrow', f(B.grow, 1));
  g.setAttribute('aThin', f(B.thin, 1));
  g.setAttribute('aCol', f(B.col, 3));
  g.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(B.key.length), 1));
  g.setIndex(B.idx);
  g.userData.keys = B.key;
  return g;
}

/** Broad, leathery banyan leaf (ovate, blunt tip) with a pale midrib and veins in the green channel. */
export function leafTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 96;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(32, 94);
    g.bezierCurveTo(4, 78, 0, 30, 18, 10);
    g.bezierCurveTo(26, 2, 38, 2, 46, 10);
    g.bezierCurveTo(64, 30, 60, 78, 32, 94);
    g.fill();
    g.globalCompositeOperation = 'source-atop';
    g.strokeStyle = 'rgba(160,160,160,1)';
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(32, 92);
    g.lineTo(32, 8);
    g.stroke();
    g.lineWidth = 1.2;
    for (let k = 0; k < 5; k++) {
      const y = 80 - k * 15;
      g.beginPath();
      g.moveTo(32, y);
      g.quadraticCurveTo(20, y - 6, 10, y - 14);
      g.moveTo(32, y);
      g.quadraticCurveTo(44, y - 6, 54, y - 14);
      g.stroke();
    }
  }
  return new CanvasTexture(c);
}
