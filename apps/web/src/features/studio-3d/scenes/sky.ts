import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  QuadraticBezierCurve3,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { addCurveLine, flowLines, lineBuilder, skyDome, softTex } from '../gl.ts';
import { spouseIndex } from '../model.ts';
import { lin, PORTRAIT_COLOURS, rng } from '../palette.ts';
import type { SceneBuilder } from './types.ts';

// Constellation: each generation is an orbit; light runs along the bloodlines.

export const skyScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const pos = new Float32Array(M.n * 3);
  const spread = Math.max(1, Math.sqrt(M.n / 30));
  const R = (g: number) => 7 + g * 12 * spread;
  const Y = (g: number) => -g * 3.2;
  const at = new Map<string, Vector3>();
  const atOf = (id: string | null) => (id ? at.get(id) : undefined) ?? new Vector3();
  for (const p of M.people) {
    if (p.mi) continue;
    const th = p.ang * Math.PI * 2 + 0.2;
    at.set(
      p.id,
      p.gen === 0
        ? new Vector3(0, 2, 0)
        : new Vector3(Math.cos(th) * R(p.gen), Y(p.gen) + Math.sin(th * 3) * 1.2, Math.sin(th) * R(p.gen)),
    );
  }
  for (const p of M.people) {
    if (!p.mi) continue;
    const a = atOf(p.anchor);
    const k = spouseIndex(M, p);
    const out = new Vector3(a.x, 0, a.z);
    if (out.lengthSq() < 0.01) out.set(1, 0, 0);
    out.normalize();
    const tan = new Vector3(-out.z, 0, out.x);
    at.set(
      p.id,
      a
        .clone()
        .addScaledVector(tan, (k % 2 ? -1 : 1) * (2.6 + Math.floor(k / 2) * 2.2))
        .add(new Vector3(0, 1.2, 0)),
    );
  }
  M.people.forEach((p, i) => {
    const v = atOf(p.id);
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z;
  });
  // Bloodline arcs
  const B = lineBuilder();
  const blood = lin(M.homeColor).multiplyScalar(1.1);
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    const a = atOf(p.parent);
    const c = atOf(p.id);
    const mid = a.clone().lerp(c, 0.5);
    mid.y += 3 + a.distanceTo(c) * 0.12;
    addCurveLine(B, new QuadraticBezierCurve3(a, mid, c), big ? 10 : 24, p.born, p.id, blood);
  }
  // Couples share a small ring
  const gold = lin('#e2b05a').multiplyScalar(0.6);
  for (const p of M.people) {
    if (!p.mi || !p.anchor) continue;
    const a = atOf(p.anchor);
    const c = atOf(p.id);
    const m = a.clone().lerp(c, 0.5);
    const r = a.distanceTo(c) / 2 + 0.9;
    const s = M.get(p.anchor).spouses.find((x) => x.id === p.id);
    const ring: Vector3[] = [];
    for (let k = 0; k <= 40; k++) {
      const v = (k / 40) * Math.PI * 2;
      ring.push(new Vector3(m.x + Math.cos(v) * r, m.y, m.z + Math.sin(v) * r));
    }
    addCurveLine(B, new CatmullRomCurve3(ring, true), 40, s ? s.year : p.born, p.id, gold);
  }
  const { lines, uni } = flowLines(B, U, 0.55);
  group.add(lines);
  // Orbit rings per generation
  const og: number[] = [];
  for (let g = 1; g <= M.maxGen; g++)
    for (let k = 0; k < 160; k++) {
      const a0 = (k / 160) * Math.PI * 2;
      const a1 = ((k + 1) / 160) * Math.PI * 2;
      og.push(Math.cos(a0) * R(g), Y(g), Math.sin(a0) * R(g), Math.cos(a1) * R(g), Y(g), Math.sin(a1) * R(g));
    }
  group.add(
    new LineSegments(
      new BufferGeometry().setAttribute('position', new Float32BufferAttribute(og, 3)),
      new LineBasicMaterial({ color: lin('#3a6b78'), transparent: true, opacity: 0.35, depthWrite: false }),
    ),
  );
  // Starfield and nebulae
  const sr = rng(5);
  const sN = 3200;
  const sp = new Float32Array(sN * 3);
  const sph = new Float32Array(sN);
  for (let i = 0; i < sN; i++) {
    const u = sr() * 2 - 1;
    const th = sr() * 6.283;
    const rr = 500 + sr() * 600;
    const s = Math.sqrt(1 - u * u);
    sp[i * 3] = Math.cos(th) * s * rr;
    sp[i * 3 + 1] = u * rr;
    sp[i * 3 + 2] = Math.sin(th) * s * rr;
    sph[i] = sr() * 100;
  }
  const sg = new BufferGeometry();
  sg.setAttribute('position', new BufferAttribute(sp, 3));
  sg.setAttribute('aPh', new BufferAttribute(sph, 1));
  group.add(
    new Points(
      sg,
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uTime: U.uTime },
        vertexShader: `attribute float aPh; uniform float uTime; varying float vA; void main() { vA = .35 + .65 * (.5 + .5 * sin(uTime * (.6 + fract(aPh) * 1.5) + aPh));
          vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = (1.2 + fract(aPh * 7.) * 2.2); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying float vA; void main() { float d = length(gl_PointCoord - .5); if (d > .5) discard; gl_FragColor = vec4(vec3(.85, .9, 1.) * vA * (1. - d * 2.), 1.); }`,
      }),
    ),
  );
  const neb = softTex([
    [0, 'rgba(255,255,255,0.9)'],
    [0.4, 'rgba(255,255,255,0.25)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  const nebulae = [M.homeColor, ...PORTRAIT_COLOURS.slice(1, 4), PORTRAIT_COLOURS[0] ?? '#d99a3a'];
  nebulae.forEach((c, i) => {
    // The sprites share one texture; disposing it more than once on teardown is harmless.
    const s = new Sprite(
      new SpriteMaterial({
        map: neb,
        color: lin(c),
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    const a = i * 1.3 + 0.5;
    const r = R(M.maxGen) * 0.8;
    s.position.set(Math.cos(a) * r, -20 - i * 6, Math.sin(a) * r - 40);
    s.scale.setScalar(R(M.maxGen) * 1.6 + 80);
    group.add(s);
  });
  const bg = skyDome('#02040a', '#071423', '#02040a');
  group.add(bg.mesh);
  const w = R(M.maxGen);
  return {
    key: 'sky',
    group,
    pos,
    size: big ? 1.3 : 2.0,
    style: 1,
    lift: 10,
    tint: () => ctx.look(1.1, 1.1),
    hiTargets: [{ geo: lines.geometry }],
    focus: [uni.uFocus],
    view: { target: new Vector3(0, -M.maxGen * 1.6, 0), cam: new Vector3(w * 0.62, w * 0.72 + 12, w * 0.95 + 16) },
    follow: 24,
  };
};
