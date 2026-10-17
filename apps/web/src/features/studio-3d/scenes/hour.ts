import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  QuadraticBezierCurve3,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
} from 'three';
import { addCurveLine, flowLines, glassShader, lineBuilder, skyDome } from '../gl.ts';
import { lin, rng } from '../palette.ts';
import type { SceneBuilder } from './types.ts';

// Hourglass: one person at the waist, ancestors in the dome above, descendants in the bowl
// below, siblings around the waist and everyone else on a faint outer ring.

export const hourScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const pp = ctx.pal();
  const group = new Group();
  const pos = new Float32Array(M.n * 3);
  const f = M.byId.get(ctx.focusId()) ?? M.root;
  const at = new Map<string, Vector3>();
  const Vv = (x: number, y: number, zz: number) => new Vector3(x, y, zz);
  const STEP = 7.5;
  at.set(f.id, Vv(0, 0, 0));
  let up = 0;
  let downD = 0;
  const anc = (id: string, k: number, s0: number, s1: number) => {
    const par = M.get(id)
      .parents.slice()
      .sort((a, b) => (M.get(a).mi ? 1 : 0) - (M.get(b).mi ? 1 : 0));
    par.forEach((pid, j) => {
      if (at.has(pid)) return;
      const a0 = s0 + ((s1 - s0) * j) / par.length;
      const a1 = s0 + ((s1 - s0) * (j + 1)) / par.length;
      const th = ((a0 + a1) / 2) * Math.PI * 2;
      const r = 4 + k * 6;
      at.set(pid, Vv(Math.cos(th) * r, k * STEP, Math.sin(th) * r));
      up = Math.max(up, k);
      anc(pid, k + 1, a0, a1);
    });
  };
  anc(f.id, 1, 0, 1);
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const dl = (id: string): number => {
    const hit = memo.get(id);
    if (hit != null) return hit;
    if (visiting.has(id)) return 1; // guards against a (rejected by the API) cycle
    visiting.add(id);
    const kids = M.get(id).children;
    const v = kids.length ? kids.reduce((s, c) => s + dl(c), 0) : 1;
    visiting.delete(id);
    memo.set(id, v);
    return v;
  };
  const desc = (id: string, k: number, s0: number, s1: number) => {
    let a = s0;
    const tot = dl(id);
    for (const c of M.get(id).children) {
      const w = ((s1 - s0) * dl(c)) / tot;
      if (!at.has(c)) {
        const th = (a + w / 2) * Math.PI * 2;
        const r = 4 + k * (big ? 8 : 6.5);
        at.set(c, Vv(Math.cos(th) * r, -k * STEP, Math.sin(th) * r));
        downD = Math.max(downD, k);
        desc(c, k + 1, a, a + w);
      }
      a += w;
    }
  };
  desc(f.id, 1, 0, 1);
  // The glass, sized from the depth of the lines; then each person's radius follows the cone at their height
  const Hu = Math.max(up, 1) * STEP + 5;
  const Hd = Math.max(downD, 1) * STEP + 5;
  const Ru = 8 + Math.max(up, 1) * 6 + 4;
  const Rd = 8 + Math.max(downD, 1) * (big ? 8 : 6.5) + 4;
  const coneR = (y: number) => 1.4 + (y > 0 ? (Ru - 1.4) * (y / Hu) : (Rd - 1.4) * (-y / Hd));
  for (const [id, a] of at) {
    if (id === f.id) continue;
    const rr = Math.hypot(a.x, a.z) || 1;
    const kk = (coneR(a.y) * 0.78) / rr;
    a.x *= kk;
    a.z *= kk;
  }
  // Spouses beside their partner
  for (const id of [...at.keys()]) {
    M.get(id).spouses.forEach((s, j) => {
      if (at.has(s.id)) return;
      const a = at.get(id) as Vector3;
      const out = Vv(a.x, 0, a.z);
      if (out.lengthSq() < 0.01) out.set(1, 0, 0);
      out.normalize();
      at.set(
        s.id,
        a
          .clone()
          .addScaledVector(Vv(-out.z, 0, out.x), (j % 2 ? -1 : 1) * (2.8 + Math.floor(j / 2) * 2.4))
          .add(Vv(0, 0.6, 0)),
      );
    });
  }
  // Siblings on a ring at the waist
  const sibs = [...new Set(f.parents.flatMap((pid) => M.get(pid).children))].filter((id) => id !== f.id && !at.has(id));
  sibs.forEach((id, j) => {
    const th = Math.PI * (0.25 + (1.5 * (j + 0.5)) / Math.max(1, sibs.length));
    at.set(id, Vv(Math.cos(th) * 11, 0, Math.sin(th) * 11));
  });
  const Rmax = 4 + Math.max(up, downD, 1) * 7 + 10;
  // Everyone else: a faint outer ring, the wider family
  const rest = M.people.filter((p) => !at.has(p.id));
  const restIds = new Set(rest.map((p) => p.id));
  rest.forEach((p, j) => {
    const th = (j / Math.max(1, rest.length)) * Math.PI * 2;
    const rr = Rmax + 14 + (j % 3) * 3;
    at.set(p.id, Vv(Math.cos(th) * rr, ((j % 5) - 2) * 1.2, Math.sin(th) * rr));
  });
  M.people.forEach((p, i) => {
    const v = at.get(p.id) ?? Vv(0, 0, 0);
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z;
  });
  // Links between parent and child where both sit in the hourglass
  const B = lineBuilder();
  const glow = lin(pp.glow);
  for (const p of M.people) {
    if (restIds.has(p.id)) continue;
    for (const pid of p.parents) {
      if (restIds.has(pid)) continue;
      const a = at.get(pid);
      const c = at.get(p.id);
      if (!a || !c) continue;
      const m = a.clone().lerp(c, 0.5).multiplyScalar(0.8);
      addCurveLine(B, new QuadraticBezierCurve3(a, m, c), 16, p.born, p.id, glow);
    }
  }
  const { lines, uni } = flowLines(B, U, 0.5);
  group.add(lines);
  // The glass: two open cones meeting at the waist
  const gm = glassShader(U, pp.plate, pp.glow, ctx.dark() ? 0.05 : 0.12);
  const top = new Mesh(new CylinderGeometry(Ru, 1.4, Hu, 72, 1, true), gm.mat);
  top.position.y = Hu / 2;
  group.add(top);
  const bot = new Mesh(new CylinderGeometry(1.4, Rd, Hd, 72, 1, true), gm.mat);
  bot.position.y = -Hd / 2;
  group.add(bot);
  [Hu, -Hd].forEach((y, i) => {
    const ring = new Mesh(
      new TorusGeometry(i ? Rd : Ru, 0.18, 8, 96),
      new MeshBasicMaterial({ color: lin('#e2b05a').multiplyScalar(1.6) }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    group.add(ring);
  });
  // Sand: heritage falling from ancestors to descendants through the waist
  const sN = 900;
  const sp = new Float32Array(sN * 3);
  const sph = new Float32Array(sN);
  const sr = rng(4);
  for (let i = 0; i < sN; i++) sph[i] = sr();
  const sg = new BufferGeometry();
  sg.setAttribute('position', new BufferAttribute(sp, 3));
  sg.setAttribute('aPh', new BufferAttribute(sph, 1));
  const sand = new Points(
    sg,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: U.uTime,
        uHu: { value: Hu },
        uHd: { value: Hd },
        uRu: { value: Ru },
        uRd: { value: Rd },
        uCol: { value: lin('#f0c060') },
      },
      vertexShader: `attribute float aPh; uniform float uTime, uHu, uHd, uRu, uRd; varying float vA;
        void main() { float t = fract(uTime * .06 + aPh); float y = t < .5 ? mix(uHu * .9, 0., t * 2.) : mix(0., -uHd * .9, (t - .5) * 2.);
          float w = t < .5 ? (1. - t * 2.) * uRu * .7 : (t - .5) * 2. * uRd * .7; float a = aPh * 61. + t * 4.; float rr = w * fract(aPh * 13.7);
          vec3 p = vec3(cos(a) * rr, y, sin(a) * rr); vA = .5 + .5 * sin(aPh * 40. + uTime);
          vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = 60. / -mv.z * (.6 + vA); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uCol; varying float vA; void main() { float d = length(gl_PointCoord - .5); if (d > .5) discard; gl_FragColor = vec4(uCol * 1.6 * (1. - d * 2.) * vA, 1.); }`,
    }),
  );
  sand.frustumCulled = false;
  group.add(sand);
  const sky = skyDome(pp.top, pp.hor, pp.ground);
  group.add(sky.mesh);
  const tint = () => {
    const q = ctx.pal();
    sky.set(q.top, q.hor, q.ground);
    gm.uni.uTint.value.copy(lin(q.plate));
    gm.uni.uGlow.value.copy(lin(q.glow));
    gm.uni.uBody.value = ctx.dark() ? 0.05 : 0.12;
    ctx.look(q.bloom, q.exposure);
  };
  const D = Rmax * 1.25 + 30;
  return {
    key: 'hour',
    group,
    pos,
    size: big ? 1.25 : 1.8,
    style: 0,
    lift: 6,
    tint,
    centre: f.id,
    hiTargets: [{ geo: lines.geometry }],
    focus: [uni.uFocus],
    view: { target: Vv(0, (Hu - Hd) / 4, 0), cam: Vv(D * 0.75, (Hu - Hd) / 4 + D * 0.18, D * 0.95) },
    follow: 30,
  };
};
