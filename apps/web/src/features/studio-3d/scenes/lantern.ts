import { Group, Mesh, QuadraticBezierCurve3, Vector3 } from 'three';
import { addCurveLine, flowLines, lineBuilder } from '../gl.ts';
import { type StudioPerson, spouseIndex, spouseYear } from '../model.ts';
import { lin, rng } from '../palette.ts';
import { sizeFactor } from '../portraits.ts';
import { glowPoints, lakeUniforms, lanternGeometry, lanternMaterial, skyMesh, waterMesh } from './lantern-gl.ts';
import type { SceneBuilder } from './types.ts';

// Lantern Lake: each life is a fanous lantern floating over a still lake. The founder hovers
// just above the water; every generation is a higher, wider tier of an amphitheatre fan.
// Threads of light run from a parent's ring to a child's finial; couples share a twin cord
// and a soft glow. The water mirrors the lanterns (drawn again, flipped, under its surface).

const THEME = {
  dark: {
    top: '#040919',
    hor: '#161d44',
    band: '#2a1636',
    sun: '#c9d4ff',
    sunDir: new Vector3(0.55, 0.22, -1).normalize(),
    hill: '#03050c',
    stars: 1,
    deep: '#02040b',
    warm: '#ff9d3c',
    brass: '#4a3016',
    amb: '#1c1626',
    alpha: 0.68,
    bloom: 1.0,
    exposure: 1.0,
    base: 0.45,
  },
  light: {
    top: '#7b93bb',
    hor: '#f6c27d',
    band: '#6e3410',
    sun: '#fff0c8',
    sunDir: new Vector3(0.75, 0.06, -1).normalize(),
    hill: '#9a7c72',
    stars: 0,
    deep: '#6a5848',
    warm: '#ff8f2e',
    brass: '#7a5428',
    amb: '#6a5856',
    alpha: 0.84,
    bloom: 0.38,
    exposure: 0.9,
    base: 0.9,
  },
};

export const lanternScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const dir = ctx.rtl() ? -1 : 1;
  const size = big ? 0.66 : 0.78;
  const K = 3.4 * size; // lantern scale: the portrait sits in the body like a round window
  const sOf = (p: StudioPerson) => K * sizeFactor(p);
  const gap = K * (big ? 1.08 : 1.3);
  const SPAN = big ? 4.2 : 2.8;
  const H0 = 1.2 + 0.7 * K * 1.35;
  const rand = rng(23);

  // Width of each line person (spouses float beside them), then leaf-weighted angular sectors.
  const spouses = new Map<string, StudioPerson[]>();
  for (const p of M.people) if (p.mi && p.anchor) spouses.set(p.anchor, [...(spouses.get(p.anchor) ?? []), p]);
  const self = (p: StudioPerson) => 1 + 0.9 * (spouses.get(p.id)?.length ?? 0);
  const W = new Map<string, number>();
  const weigh = (p: StudioPerson): number => {
    const k = p.kids.reduce((s, id) => s + weigh(M.get(id)), 0);
    const w = Math.max(self(p), k);
    W.set(p.id, w);
    return w;
  };
  weigh(M.root);
  const A = new Map<string, number>();
  const sector = (p: StudioPerson, a0: number, a1: number) => {
    A.set(p.id, (a0 + a1) / 2);
    const tot = p.kids.reduce((s, id) => s + (W.get(id) ?? 1), 0);
    if (!tot) return;
    const span = ((a1 - a0) * tot) / (W.get(p.id) ?? tot);
    let a = (a0 + a1) / 2 - span / 2;
    for (const id of p.kids) {
      const w = (span * (W.get(id) ?? 1)) / tot;
      sector(M.get(id), a, a + w);
      a += w;
    }
  };
  sector(M.root, 0, 1);

  // Tier radii: wide enough that neighbours on a tier do not touch (85th percentile), always growing.
  // Large families stagger each tier into two rows, so neighbours may sit closer side by side.
  const line = M.people.filter((p) => !p.mi);
  const R: number[] = [0];
  const row = new Map<string, number>();
  for (let g = 1; g <= M.maxGen; g++) {
    const tier = line.filter((p) => p.gen === g).sort((a, b) => (A.get(a.id) ?? 0) - (A.get(b.id) ?? 0));
    const req: number[] = [];
    const need = (a: StudioPerson | undefined, b: StudioPerson | undefined, f: number) => {
      if (!a || !b) return;
      const dA = Math.max(1e-4, (A.get(b.id) ?? 0) - (A.get(a.id) ?? 0));
      req.push((f * gap * (self(a) + self(b))) / 2 / (dA * SPAN));
    };
    tier.forEach((p, k) => {
      row.set(p.id, big ? (k % 2 ? 1 : -1) : 0);
      if (big) {
        need(tier[k - 1], p, 0.55);
        need(tier[k - 2], p, 1);
      } else need(tier[k - 1], p, 1);
    });
    req.sort((x, y) => x - y);
    const q = req.length ? (req[Math.floor(req.length * 0.85)] ?? 0) : 0;
    R.push(Math.max(q, (R[g - 1] ?? 0) + (big ? 4.5 : 5.5), g === 1 ? gap * 2.4 : 0));
  }
  const Rmax = R[M.maxGen] ?? 20;
  // Tiers climb in proportion to the lake they span, so the fan reads as an amphitheatre.
  const GY = Math.max(big ? 3.3 : 3.9, (Rmax * 0.4) / Math.max(1, M.maxGen));
  const at = new Map<string, Vector3>();
  const atOf = (id: string | null) => (id ? at.get(id) : undefined) ?? new Vector3();
  const theta = (p: StudioPerson) => ((A.get(p.id) ?? 0.5) - 0.5) * SPAN * dir;
  for (const p of line) {
    const r = R[p.gen] ?? 0;
    const th = theta(p);
    const jit = p === M.root ? 0 : (rand() - 0.5) * 0.7 + (row.get(p.id) ?? 0) * GY * 0.24;
    at.set(p.id, new Vector3(Math.sin(th) * r, H0 + p.gen * GY + jit, -Math.cos(th) * r));
  }
  for (const p of M.people) {
    if (!p.mi) continue;
    const a = M.get(p.anchor ?? M.root.id);
    const k = spouseIndex(M, p);
    const off = (k % 2 ? -1 : 1) * dir * (Math.floor(k / 2) + 1) * gap * 0.95;
    const r = R[a.gen] ?? 0;
    const base = atOf(a.id);
    if (r < 1) at.set(p.id, base.clone().add(new Vector3(off, -0.15, 0)));
    else {
      const th = theta(a) + off / r;
      at.set(p.id, new Vector3(Math.sin(th) * r, base.y - 0.15, -Math.cos(th) * r));
    }
  }
  const pos = new Float32Array(M.n * 3);
  M.people.forEach((p, i) => {
    const v = atOf(p.id);
    pos.set([v.x, v.y, v.z], i * 3);
  });
  const topY = H0 + M.maxGen * GY;

  // Lake, sky and lanterns (real and mirrored), all sharing the theme uniforms.
  const u = lakeUniforms();
  u.uFanR.value = Rmax;
  u.uFanZ.value = -Rmax * 0.45;
  group.add(skyMesh(u), waterMesh(u, U));
  const inst = {
    pos,
    scale: new Float32Array(M.n),
    col: new Float32Array(M.n * 3),
    birth: new Float32Array(M.n),
    death: new Float32Array(M.n),
    phase: new Float32Array(M.n),
  };
  M.people.forEach((p, i) => {
    const c = lin(p.color);
    inst.scale[i] = sOf(p);
    inst.col.set([c.r, c.g, c.b], i * 3);
    inst.birth[i] = p.born;
    inst.death[i] = p.died ?? 9999;
    inst.phase[i] = rand();
  });
  const lgeo = lanternGeometry(
    inst,
    M.people.map((p) => p.id),
  );
  const lFocus = { value: 0 };
  const lanterns = new Mesh(lgeo, lanternMaterial(u, U, lFocus, false));
  const mirror = new Mesh(lgeo, lanternMaterial(u, U, lFocus, true));
  lanterns.frustumCulled = false;
  mirror.frustumCulled = false;
  mirror.renderOrder = 1; // after the water, added on top of it
  group.add(lanterns, mirror);

  // Threads: a sagging string from the parent's ring to the child's finial; couples get a twin cord.
  const B = lineBuilder();
  const thread = lin('#ffbf6a');
  const segs = big ? 10 : 20;
  for (const p of line) {
    if (!p.parent || p.virt) continue;
    const par = M.get(p.parent);
    const a = atOf(par.id)
      .clone()
      .add(new Vector3(0, 0.73 * sOf(par), 0));
    const c = atOf(p.id)
      .clone()
      .add(new Vector3(0, -0.66 * sOf(p), 0));
    const mid = a.clone().lerp(c, 0.5);
    mid.y -= a.distanceTo(c) * 0.3;
    const col = thread.clone().lerp(lin(p.color), 0.2).multiplyScalar(0.95);
    addCurveLine(B, new QuadraticBezierCurve3(a, mid, c), segs, p.born, p.id, col);
  }
  const cord = lin('#ffb59c').multiplyScalar(0.85);
  const glows: number[] = [];
  const wedYears: number[] = [];
  const wedKeys: string[] = [];
  for (const p of M.people) {
    if (!p.mi || !p.anchor) continue;
    const a = atOf(p.anchor);
    const b = atOf(p.id);
    const side = b.clone().sub(a).setY(0).normalize();
    const yr = spouseYear(M, p);
    for (const dy of [-0.09, 0.09]) {
      const s = a.clone().addScaledVector(side, 0.38 * sOf(M.get(p.anchor)));
      const e = b.clone().addScaledVector(side, -0.38 * sOf(p));
      s.y += dy * K;
      e.y += dy * K;
      const mid = s.clone().lerp(e, 0.5);
      mid.y -= 0.35;
      addCurveLine(B, new QuadraticBezierCurve3(s, mid, e), big ? 4 : 8, yr, p.id, cord);
    }
    const m = a.clone().lerp(b, 0.5);
    glows.push(m.x, m.y, m.z);
    wedYears.push(yr);
    wedKeys.push(p.id);
  }
  const { lines, uni: lineUni } = flowLines(B, U, THEME.dark.base);
  lines.renderOrder = 1;
  // The threads' reflection: the same strings flipped under the surface, fainter.
  const { lines: mlines, uni: mUni } = flowLines(
    { ...B, pos: B.pos.map((v, k) => (k % 3 === 1 ? -v : v)) },
    U,
    THEME.dark.base * 0.6,
  );
  const mgeo = mlines.geometry;
  mlines.renderOrder = -1;
  group.add(lines, mlines);

  // Embers rising through the tiers, diyas on the lake, wedding glows, lantern halos and their reflections.
  const nE = big ? 900 : 450;
  const nD = big ? 420 : 260;
  const nW = wedYears.length;
  const o3 = nE + nD + nW;
  const total = o3 + M.n * 2;
  const gd = {
    pos: new Float32Array(total * 3),
    kind: new Float32Array(total),
    phase: new Float32Array(total),
    birth: new Float32Array(total),
    death: new Float32Array(total).fill(9999),
    keys: new Array<string>(total).fill(''),
  };
  for (let i = 0; i < total; i++) {
    gd.phase[i] = rand();
    if (i < nE) {
      const r = Math.sqrt(rand()) * Rmax * 1.1;
      const th = (rand() - 0.5) * (SPAN + 0.6);
      gd.pos.set([Math.sin(th) * r, rand() * topY + 0.5, -Math.cos(th) * r], i * 3);
    } else if (i < nE + nD) {
      const r = Rmax * (0.2 + 1.6 * rand()) + 6;
      const th = rand() * Math.PI * 2;
      gd.pos.set([Math.sin(th) * r, 0.1, -Math.cos(th) * r - Rmax * 0.2], i * 3);
      gd.kind[i] = 1;
    } else if (i < o3) {
      const k = i - nE - nD;
      gd.pos.set(glows.slice(k * 3, k * 3 + 3), i * 3);
      gd.kind[i] = 2;
      gd.birth[i] = wedYears[k] ?? 0;
      gd.keys[i] = wedKeys[k] ?? '';
    } else {
      const j = (i - o3) % M.n;
      const p = M.people[j] as StudioPerson;
      const flip = i - o3 >= M.n;
      gd.pos.set([pos[j * 3] ?? 0, (flip ? -1 : 1) * (pos[j * 3 + 1] ?? 0), pos[j * 3 + 2] ?? 0], i * 3);
      gd.kind[i] = flip ? 4 : 3;
      gd.birth[i] = p.born;
      gd.death[i] = p.died ?? 9999;
      gd.keys[i] = p.id;
    }
  }
  const { pts, uni: glowUni } = glowPoints(gd, u, U, { rise: 9, wed: K * 1.7, halo: K * 2.6 });
  group.add(pts);

  const tint = () => {
    const t = ctx.dark() ? THEME.dark : THEME.light;
    u.uTop.value.set(t.top);
    u.uHor.value.set(t.hor);
    u.uBand.value.set(t.band);
    u.uSun.value.set(t.sun);
    u.uSunDir.value.copy(t.sunDir);
    u.uHill.value.set(t.hill);
    u.uStars.value = t.stars;
    u.uDeep.value.set(t.deep);
    u.uWarm.value.set(t.warm);
    u.uBrass.value.set(t.brass);
    u.uAmb.value.set(t.amb);
    u.uDay.value = ctx.dark() ? 0 : 1;
    u.uAlpha.value = t.alpha;
    lineUni.uBase.value = t.base;
    mUni.uBase.value = t.base * (ctx.dark() ? 0.6 : 0.3);
    ctx.look(t.bloom, t.exposure);
  };
  tint();

  return {
    key: 'lantern',
    group,
    pos,
    size,
    style: 0,
    lift: 6,
    tint,
    labelScale: 0.85,
    hiTargets: [
      { geo: lgeo, perPerson: true },
      { geo: lines.geometry },
      { geo: mgeo },
      { geo: pts.geometry, perPerson: true },
    ],
    focus: [lFocus, lineUni.uFocus, mUni.uFocus, glowUni.uFocus],
    view: {
      target: new Vector3(0, topY * 0.36, -Rmax * 0.4),
      cam: new Vector3(0, topY * 0.55 + Rmax * 0.3 + 4, Rmax * 1.05 + 24),
    },
    follow: 16,
  };
};
