import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { type StudioPerson, spouseYear } from '../model.ts';
import { sizeFactor } from '../portraits.ts';
import {
  backdropMaterial,
  bookMaterial,
  cardMaterial,
  dustPoints,
  type LayerData,
  pageMaterial,
  paperLook,
  ribbonMaterial,
  rosetteMaterial,
  tableMaterial,
} from './paper-gl.ts';
import type { SceneBuilder } from './types.ts';

// Paper Pop-up: the family as a pop-up book. Each generation is a cut-paper card with an arched
// edge and jaali cut-outs, standing on concentric arcs of the open page (founders at the back, the
// youngest in front). People are paper rosettes; folded paper strips run from each parent over the
// next card down to the child; a gold-foil band ties each couple. Cards fold up as the years pass.
// Dark: white paper under one warm reading lamp on a black table. Light: muted pastel papers on a
// white book, soft daylight and crisp paper shadows on a pale grey table.

/** Display colours (what the screen shows): 2-4 signature colours per theme plus neutrals. */
const LOOK = {
  dark: {
    // Signature: white card stock, the warm lamp, oxblood paper strips and leather binding.
    cards: ['#f5f3ef', '#ebe8e3'],
    lamp: '#fff0dc',
    ribbon: '#74342a',
    cover: '#3e1914',
    // Neutrals and the reserved accents.
    page: '#f5f2ec',
    edge: '#d9d3c9',
    tag: '#f8f5ef',
    tagDead: '#c6c1b8',
    ink: '#6c665f',
    table: '#1f1e1d',
    far: '#000000',
    // Outside the selected lineage, strips and bands fade into dimmed paper (not to black, which would outline them).
    dim: '#6f6a63',
    gold: '#e2b65a',
    teal: '#4fd1bd',
  },
  light: {
    // Signature: muted pastel card stock from the back (cool, like distance) to the front (warm), oxblood strips
    // and binding. Picked per generation, never blended (blends of pastels turn khaki).
    cards: ['#a2afc6', '#b3aecb', '#c6a9bc', '#a5bccb', '#adbea5', '#e0bb9e', '#e5b4a4', '#d6a6a6'],
    lamp: '#ffffff',
    ribbon: '#7f362b',
    cover: '#5c241c',
    page: '#fcfcfb',
    edge: '#eeeeec',
    tag: '#fefefd',
    tagDead: '#d8d8d5',
    ink: '#6a6a6a',
    table: '#f4f4f4',
    far: '#ebebeb',
    dim: '#ededed',
    gold: '#b7862c',
    teal: '#0f6b63',
  },
};

/** Lighting and finish per theme (light values are display-space multipliers). */
const FINISH = {
  dark: {
    lamp: 0.82,
    sun: 0,
    sky: 0.03,
    gnd: 0.018,
    dapple: 0,
    shadowK: 0.78,
    shadowW: 2.2,
    edgeK: 0.16,
    glowK: 0.18,
    dimK: 0.62,
    tagDimK: 0.35,
    tagDimA: 0.45,
    tagShadow: 0.42,
    floorShadow: 0.55,
    cast: 3.2,
    tableShadow: 0.7,
    dust: 1,
    bloom: 0.38,
    exposure: 1,
  },
  light: {
    lamp: 0,
    sun: 0.62,
    sky: 0.48,
    gnd: 0.36,
    dapple: 0.07,
    shadowK: 0.5,
    shadowW: 0.65,
    edgeK: 0.08,
    glowK: 0,
    dimK: 0.62,
    tagDimK: 0.15,
    tagDimA: 0.35,
    tagShadow: 0.36,
    floorShadow: 0.4,
    cast: 1.6,
    tableShadow: 0.32,
    dust: 0,
    bloom: 0,
    exposure: 1,
  },
};

/**
 * Card colour of layer g of nL: spread over the list from the back (first) to the front (last), never blended.
 * Families deeper than the list repeat neighbouring colours rather than wrap round to the back's.
 */
const pick = (list: string[], g: number, nL: number) =>
  list[
    nL > list.length ? Math.floor((g * list.length) / nL) : Math.round((g * (list.length - 1)) / Math.max(1, nL - 1))
  ] ?? '#ffffff';

export const paperScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const dirX = ctx.rtl() ? -1 : 1;
  const nL = M.maxGen + 1;
  const size = big ? 1.1 : 1.75;
  const GY = big ? 6.2 : 7.6; // visible band of each card
  const A = big ? 1.1 : 1.4; // arch height
  const P = big ? 2.4 : 3.2; // arch period
  const s = big ? 2.7 : 4.6; // minimum spacing between people on a card
  const span = big ? 1.3 : 1.0; // arc angle of the stage
  const sp = big ? 0.9 : 0.82; // spouse offset in units of s (clears a selected founder's enlarged portrait)
  const rowGap = big ? 3.3 : 4; // vertical step between staggered rows of tags on one card
  const gap = big ? 9 : 8; // minimum depth between cards

  // Married-in spouses sit beside their partner in wedding order, alternating sides (slot 0 to the right,
  // 1 to the left, 2 further right, ...). Slots count only the spouses laid out beside this person, so the
  // room reserved while packing always matches where they are placed.
  const slotOf = new Map<string, number>();
  const spouses = new Map<string, number>();
  const addSlot = (p: StudioPerson, anchor: string) => {
    const k = spouses.get(anchor) ?? 0;
    slotOf.set(p.id, k);
    spouses.set(anchor, k + 1);
  };
  for (const a of M.people)
    for (const w of a.spouses) {
      const p = M.byId.get(w.id);
      if (p?.mi && p.anchor === a.id && !slotOf.has(p.id)) addSlot(p, a.id);
    }
  for (const p of M.people) if (p.mi && p.anchor && !slotOf.has(p.id)) addSlot(p, p.anchor);
  const rightOf = (id: string) => s * (0.5 + sp * Math.ceil((spouses.get(id) ?? 0) / 2));
  const leftOf = (id: string) => s * (0.5 + sp * Math.floor((spouses.get(id) ?? 0) / 2));

  // Each generation packed along its card in tree order: near its place in the tree, never closer than
  // the minimum spacing (spouses included). Crowded generations stagger into up to three rows of tags
  // (five in large families, so the book stays closer to the stage's shape).
  const rows: number[] = [];
  const R: number[] = [];
  const xOf = new Map<string, number>();
  const rowOf = new Map<string, number>();
  const pack = (row: StudioPerson[], nr: number, target: (p: StudioPerson) => number) => {
    const xs: number[] = [];
    row.forEach((p, k) => {
      let x = target(p);
      const same = row[k - nr];
      const prev = row[k - 1];
      if (same) x = Math.max(x, (xs[k - nr] ?? 0) + rightOf(same.id) + leftOf(p.id));
      if (prev) x = Math.max(x, (xs[k - 1] ?? 0) + s * 0.3);
      xs.push(x);
    });
    const mid = ((xs[0] ?? 0) + (xs[xs.length - 1] ?? 0)) / 2;
    return xs.map((x) => x - mid);
  };
  const Rcap = big ? 120 : 80;
  const spanMax = big ? 2 : 1.4;
  for (let g = 0; g < nL; g++) {
    const row = M.people.filter((p) => !p.mi && p.gen === g).sort((a, b) => a.ang - b.ang);
    let nr = 1;
    let w = 0;
    const maxRows = big ? 5 : 3;
    for (; nr <= maxRows; nr++) {
      const xs = pack(row, nr, () => 0);
      w = (xs[xs.length - 1] ?? 0) - (xs[0] ?? 0);
      if (w <= span * Rcap || nr === maxRows) break;
    }
    // Crowded generations may open wider than the stage's usual angle before the card moves forward.
    const r = Math.max(big ? 60 : 46, (w + s) / spanMax, g ? (R[g - 1] ?? 0) + gap : 0);
    const spr = Math.max(span, w / r);
    R.push(r);
    rows.push(nr);
    const xs = pack(row, nr, (p) => (p.ang - 0.5) * spr * r);
    row.forEach((p, k) => {
      xOf.set(p.id, xs[k] ?? 0);
      rowOf.set(p.id, k % nr);
    });
  }
  // Card heights: each card shows a band above the one in front, tall enough for its rows. The front card
  // stands a little taller, so the couple bands under its lowest row stay above the page.
  const H: number[] = new Array(nL).fill(0);
  for (let g = nL - 1; g >= 0; g--)
    H[g] = (g === nL - 1 ? GY * 0.8 + (big ? 0.4 : 1) : (H[g + 1] ?? 0) + GY) + ((rows[g] ?? 1) - 1) * rowGap;
  const rowY = (g: number, k: number) => (H[g] ?? 0) - GY * 0.42 - k * rowGap;
  // Year each card folds up: the first birth on it (or on any later card, for empty generations).
  const born: number[] = new Array(nL).fill(9999);
  for (const p of M.people) if (!p.mi) born[p.gen] = Math.min(born[p.gen] ?? 9999, p.born);
  for (let g = nL - 2; g >= 0; g--) born[g] = Math.min(born[g] ?? 9999, born[g + 1] ?? 9999);
  for (let g = 0; g < nL; g++) if ((born[g] ?? 9999) >= 9999) born[g] = M.minYear;
  const L: LayerData = { R, H, born };

  // Positions: angle on the arc, radius just in front of the card, height on the card's band.
  const thOf = new Map<string, number>();
  const at = new Map<string, Vector3>();
  const radial = (r: number, th: number, y: number) => new Vector3(Math.sin(th) * r, y, Math.cos(th) * r);
  let maxTh = span / 2;
  for (const p of M.people) {
    if (p.mi) continue;
    const r = R[p.gen] ?? 1;
    const th = ((xOf.get(p.id) ?? 0) / r) * dirX;
    thOf.set(p.id, th);
    at.set(p.id, radial(r + 0.7, th, rowY(p.gen, rowOf.get(p.id) ?? 0)));
  }
  for (const p of M.people) {
    if (!p.mi) continue;
    const a = p.anchor ? M.byId.get(p.anchor) : undefined;
    const g = a?.gen ?? 0;
    const k = slotOf.get(p.id) ?? 0;
    const side = (k % 2 ? -1 : 1) * Math.ceil((k + 1) / 2);
    const r = (R[g] ?? 0) + 0.85;
    const th = (a ? (thOf.get(a.id) ?? 0) : 0) + (side * sp * s * dirX) / r;
    thOf.set(p.id, th);
    at.set(p.id, radial(r, th, (a ? (at.get(a.id)?.y ?? rowY(g, 0)) : rowY(g, 0)) - 0.35));
  }
  for (const th of thOf.values()) maxTh = Math.max(maxTh, Math.abs(th));
  const atOf = (id: string | null) => (id ? at.get(id) : undefined) ?? new Vector3();
  const pos = new Float32Array(M.n * 3);
  M.people.forEach((p, i) => {
    const v = atOf(p.id);
    pos.set([v.x, v.y, v.z], i * 3);
  });

  const look = paperLook(U);

  // ---- Cards: one mesh, one strip per generation (built back to front: the draw order of the cut edges) ----
  const cp: number[] = [];
  const cl: number[] = [];
  const cth: number[] = [];
  const cv: number[] = [];
  const cidx: number[] = [];
  const half = maxTh + (big ? 0.05 : 0.08);
  for (let g = 0; g < nL; g++) {
    const r = R[g] ?? 0;
    const segs = Math.min(320, Math.max(24, Math.ceil((r * half * 2) / 1.2)));
    const base = cp.length / 3;
    for (let i = 0; i <= segs; i++) {
      const th = -half + (2 * half * i) / segs;
      for (let v = 0; v < 2; v++) {
        cp.push(Math.sin(th) * r, v * ((H[g] ?? 0) + A), Math.cos(th) * r);
        cl.push(g);
        cth.push(th);
        cv.push(v);
      }
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2;
      cidx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const cardGeo = new BufferGeometry();
  cardGeo.setAttribute('position', new Float32BufferAttribute(cp, 3));
  cardGeo.setAttribute('aL', new Float32BufferAttribute(cl, 1));
  cardGeo.setAttribute('aTh', new Float32BufferAttribute(cth, 1));
  cardGeo.setAttribute('aV', new Float32BufferAttribute(cv, 1));
  cardGeo.setIndex(cidx);
  const card = cardMaterial(U, look, L, { A, P });
  const cards = new Mesh(cardGeo, card.mat);
  cards.frustumCulled = false;
  cards.renderOrder = 1;
  group.add(cards);

  // ---- Rosette tags (one instanced draw) ----
  const n = M.n;
  const rg = new InstancedBufferGeometry();
  rg.setAttribute('position', new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  rg.setIndex([0, 1, 2, 0, 2, 3]);
  const iattr = (k: string, w: number) => {
    const a = new InstancedBufferAttribute(new Float32Array(n * w), w);
    rg.setAttribute(k, a);
    return a.array as Float32Array;
  };
  const aPos = iattr('aPos', 3);
  const aTh = iattr('aTh', 1);
  const aSize = iattr('aSize', 1);
  const aBirth = iattr('aBirth', 1);
  const aDeath = iattr('aDeath', 1);
  iattr('aHi', 1);
  rg.userData.keys = M.people.map((p) => p.id);
  rg.instanceCount = n;
  const tagR = (p: StudioPerson) => size * sizeFactor(p) * 1.22;
  M.people.forEach((p, i) => {
    const th = thOf.get(p.id) ?? 0;
    const v = atOf(p.id)
      .clone()
      .sub(new Vector3(Math.sin(th), 0, Math.cos(th)).multiplyScalar(0.25));
    aPos.set([v.x, v.y, v.z], i * 3);
    aTh[i] = th;
    aSize[i] = tagR(p);
    aBirth[i] = p.born;
    aDeath[i] = p.died ?? 9999;
  });
  const ros = rosetteMaterial(U, look);
  const tags = new Mesh(rg, ros.mat);
  tags.frustumCulled = false;
  tags.renderOrder = 5;
  group.add(tags);

  // ---- Folded paper strips (parent tag, over the child's card edge, down to the child's tag) and gold couple bands ----
  const rp: number[] = [];
  const rn: number[] = [];
  const rt: number[] = [];
  const rb: number[] = [];
  const rf: number[] = [];
  const rk: number[] = [];
  const rkeys: string[] = [];
  const ridx: number[] = [];
  const wid = big ? 0.13 : 0.36;
  const segs = big ? 14 : 22;
  const P0 = new Vector3();
  const tan = new Vector3();
  const side = new Vector3();
  const nor = new Vector3();
  const lerpTh = (a: number, b: number, t: number) => a + (b - a) * t;
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    const par = M.byId.get(p.parent);
    if (!par) continue;
    const gp = par.gen;
    const gc = p.gen;
    const tp = thOf.get(par.id) ?? 0;
    const tc = thOf.get(p.id) ?? 0;
    const rp0 = (R[gp] ?? 0) + 0.62;
    const rc = R[gc] ?? 0;
    const edge = (H[gc] ?? 0) + A + 0.35;
    const yp = atOf(par.id).y - tagR(par) * 0.75;
    const yc = atOf(p.id).y + tagR(p) * 0.8;
    const mid = rp0 + (rc - rp0) * 0.5;
    const curve = new CatmullRomCurve3(
      [
        radial(rp0, tp, yp),
        radial(mid, lerpTh(tp, tc, 0.55), Math.max(edge, (yp + edge) / 2) - 0.2),
        radial(rc - 0.3, tc, edge + 0.15),
        radial(rc + 0.25, tc, edge - 0.1),
        radial(rc + 0.6, tc, (edge + yc) / 2),
        radial(rc + 0.62, tc, yc),
      ],
      false,
      'centripetal',
    );
    const base = rp.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      curve.getPointAt(t, P0);
      curve.getTangentAt(t, tan);
      const th = Math.atan2(P0.x, P0.z);
      side.set(Math.cos(th), 0, -Math.sin(th));
      nor.crossVectors(tan, side).normalize();
      // Accordion: alternate vertices pushed out along the normal, faces shaded by parity.
      const z = (i % 2 ? 1 : -1) * wid * 0.35;
      for (let k = -1; k <= 1; k += 2) {
        rp.push(
          P0.x + side.x * wid * k + nor.x * z,
          P0.y + side.y * wid * k + nor.y * z,
          P0.z + side.z * wid * k + nor.z * z,
        );
        rn.push(nor.x, nor.y, nor.z);
        rt.push(t);
        rb.push(p.born);
        rf.push(i % 2);
        rk.push(0);
        rkeys.push(p.id);
      }
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2;
      ridx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  // Gold-foil band between spouses, under the portraits and over the rosettes. A spouse in an outer slot
  // hangs her band lower and a hair further out (more than a band's width), so bands never overlap or z-fight.
  const bw = size * 0.26;
  const bSegs = big ? 6 : 12;
  const band = (a: StudioPerson, b: StudioPerson, order: number, yr: number, key: string) => {
    const ta = thOf.get(a.id) ?? 0;
    const tb = thOf.get(b.id) ?? 0;
    const r = (R[a.gen] ?? 0) + 0.66 + 0.05 * order;
    const ya = atOf(a.id).y;
    const yb = atOf(b.id).y;
    const drop = size * (1.1 + 0.4 * order);
    const base = rp.length / 3;
    for (let i = 0; i <= bSegs; i++) {
      const t = i / bSegs;
      const th = ta + (tb - ta) * t;
      const y = Math.max(0.4 + bw / 2, ya + (yb - ya) * t - drop - Math.sin(Math.PI * t) * size * 0.15);
      const ox = Math.sin(th);
      const oz = Math.cos(th);
      for (let k = -1; k <= 1; k += 2) {
        rp.push(ox * r, y + (k * bw) / 2, oz * r);
        rn.push(ox, 0, oz);
        rt.push(t);
        rb.push(yr);
        rf.push(0.5);
        rk.push(1);
        rkeys.push(key);
      }
    }
    for (let i = 0; i < bSegs; i++) {
      const v = base + i * 2;
      ridx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
  };
  for (const p of M.people) {
    if (!p.mi || !p.anchor) continue;
    const a = M.byId.get(p.anchor);
    if (a) band(a, p, Math.floor((slotOf.get(p.id) ?? 0) / 2), spouseYear(M, p), p.id);
  }
  // Couples who were both born into the family keep their own places; a band joins them when they share a
  // card and stand near each other (a band across the whole card would cross everyone in between).
  for (const p of M.people) {
    if (p.mi) continue;
    for (const w of p.spouses) {
      const q = M.byId.get(w.id);
      if (!q || q.mi || q.gen !== p.gen || p.id > q.id) continue;
      const arc = Math.abs((thOf.get(p.id) ?? 0) - (thOf.get(q.id) ?? 0)) * (R[p.gen] ?? 0);
      if (arc <= s * 3.2) band(p, q, 0, w.year, q.id);
    }
  }
  const ribGeo = new BufferGeometry();
  ribGeo.setAttribute('position', new Float32BufferAttribute(rp, 3));
  ribGeo.setAttribute('normal', new Float32BufferAttribute(rn, 3));
  ribGeo.setAttribute('aT', new Float32BufferAttribute(rt, 1));
  ribGeo.setAttribute('aBirth', new Float32BufferAttribute(rb, 1));
  ribGeo.setAttribute('aF', new Float32BufferAttribute(rf, 1));
  ribGeo.setAttribute('aK', new Float32BufferAttribute(rk, 1));
  ribGeo.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(rt.length), 1));
  ribGeo.setIndex(ridx);
  ribGeo.userData.keys = rkeys;
  const rib = ribbonMaterial(U, look);
  const ribbons = new Mesh(ribGeo, rib.mat);
  ribbons.frustumCulled = false;
  group.add(ribbons);

  // ---- The open book: floor page, upright back page, cover boards and page blocks; the table and backdrop ----
  const Rl = R[nL - 1] ?? 20;
  const R0 = R[0] ?? 20;
  const top = (H[0] ?? 0) + A;
  const xw = Rl * Math.sin(half) + (big ? 10 : 7);
  const zB = R0 * Math.cos(half) - (big ? 5 : 4);
  const zF = Rl + (big ? 12 : 9);
  const yT = top + (big ? 10 : 7);
  const cardCols = Array.from({ length: nL }, () => new Color());
  const floorPage = pageMaterial(U, look, L, cardCols, [-xw, zB, xw, zF], half, true);
  const fm = new Mesh(new PlaneGeometry(2 * xw, zF - zB), floorPage.mat);
  fm.rotation.x = -Math.PI / 2;
  fm.position.set(0, 0, (zB + zF) / 2);
  group.add(fm);
  const backPage = pageMaterial(U, look, L, cardCols, [-xw, 0, xw, yT], half, false);
  const bm = new Mesh(new PlaneGeometry(2 * xw, yT), backPage.mat);
  bm.position.set(0, yT / 2, zB);
  group.add(bm);
  const bp: number[] = [];
  const bn: number[] = [];
  const bk: number[] = [];
  const bi: number[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, kind: number) => {
    const g = new BoxGeometry(w, h, d);
    const base = bp.length / 3;
    const ps = g.getAttribute('position');
    const ns = g.getAttribute('normal');
    for (let i = 0; i < ps.count; i++) {
      bp.push(ps.getX(i) + x, ps.getY(i) + y, ps.getZ(i) + z);
      bn.push(ns.getX(i), ns.getY(i), ns.getZ(i));
      bk.push(kind);
    }
    for (const i of g.getIndex()?.array ?? []) bi.push(base + i);
    g.dispose();
  };
  const blk = big ? 1.4 : 1;
  const cov = 0.35;
  box(2 * xw, blk, zF - zB, 0, -blk / 2 - 0.12, (zB + zF) / 2, 1);
  box(2 * xw + 2, cov, zF - zB + 2, 0, -blk - cov / 2, (zB + zF) / 2 + 1 - blk, 0);
  box(2 * xw, yT, blk, 0, yT / 2, zB - blk / 2 - 0.12, 2);
  box(2 * xw + 2, yT + 2, cov, 0, yT / 2 + 1 - blk, zB - blk - cov / 2, 0);
  const bookGeo = new BufferGeometry();
  bookGeo.setAttribute('position', new Float32BufferAttribute(bp, 3));
  bookGeo.setAttribute('normal', new Float32BufferAttribute(bn, 3));
  bookGeo.setAttribute('aKind', new Float32BufferAttribute(bk, 1));
  bookGeo.setIndex(bi);
  const coverRect: [number, number, number, number] = [-xw - 1, zB - blk - cov, xw + 1, zF + 2 - blk];
  const book = bookMaterial(U, look, coverRect);
  group.add(new Mesh(bookGeo, book.mat));
  const tableY = -blk - cov - 0.02;
  const table = tableMaterial(U, look, coverRect);
  const tableSize = Math.max(xw, zF - zB) * 12;
  const tm = new Mesh(new PlaneGeometry(tableSize, tableSize), table.mat);
  tm.rotation.x = -Math.PI / 2;
  tm.position.set(0, tableY, (zB + zF) / 2);
  group.add(tm);
  const back = backdropMaterial(look);
  group.add(new Mesh(new SphereGeometry(1400, 24, 12), back.mat));

  // ---- Dust in the lamp light (dark theme) ----
  const dust = dustPoints(U, look, { x: xw * 0.85, y0: 1, y1: yT + 6, z0: zB + 2, z1: zF + 6 }, big ? 220 : 160);
  group.add(dust.pts);

  // Reading lamp in front of the book, above and to the start side, aimed at the middle of the stage:
  // card faces turn to it, and its pool falls off towards the book's edges.
  const zMid = (zB + zF) / 2;
  const lampAt = new Vector3(-0.3 * xw * dirX, top + xw * 0.75, zF + xw * 0.5);
  const poolAt = new Vector3(0, top * 0.3, zMid - (zF - zB) * 0.05);
  look.uLampPos.value.copy(lampAt);
  look.uLampAxis.value.copy(poolAt).sub(lampAt).normalize();
  look.uLampCone.value.set(Math.cos(0.72), Math.cos(0.22));
  look.uLampR.value = xw * 1.5;

  const tint = () => {
    const dark = ctx.dark();
    const C = dark ? LOOK.dark : LOOK.light;
    const F = dark ? FINISH.dark : FINISH.light;
    for (let g = 0; g < nL; g++) {
      const c = card.uni.uCol.value[g] as Color;
      c.set(dark ? (C.cards[g % C.cards.length] ?? '#ffffff') : pick(C.cards, g, nL));
      cardCols[g]?.copy(c);
    }
    const d0 = lampAt.distanceTo(poolAt);
    look.uLampK.value = F.lamp * (1 + (d0 * d0) / (look.uLampR.value * look.uLampR.value));
    look.uLampCol.value.set(C.lamp);
    look.uSunDir.value.set(-0.42 * dirX, 0.78, 0.46).normalize();
    look.uSunK.value = F.sun;
    look.uSky.value.setScalar(F.sky);
    look.uGnd.value.setScalar(F.gnd);
    look.uDapple.value = F.dapple;
    look.uInk.value.set(C.ink);
    look.uTeal.value.set(C.teal);
    look.uGold.value.set(C.gold);
    look.uDimC.value.set(C.dim);
    look.uDimK.value = F.dimK;
    look.uGlowK.value = F.glowK;
    look.uExp.value = F.exposure;
    card.uni.uShadowK.value = F.shadowK;
    card.uni.uShadowW.value = F.shadowW;
    card.uni.uEdgeK.value = F.edgeK;
    ros.uni.uPaper.value.set(C.tag);
    ros.uni.uDead.value.set(C.tagDead);
    ros.uni.uShadowA.value = F.tagShadow;
    ros.uni.uShadowOff.value.set(0.1 * dirX, -0.16);
    ros.uni.uTagDimK.value = F.tagDimK;
    ros.uni.uTagDimA.value = F.tagDimA;
    rib.uni.uRib.value.set(C.ribbon);
    for (const pg of [floorPage, backPage]) {
      pg.uni.uPage.value.set(C.page);
      pg.uni.uShadowK.value = F.floorShadow;
      pg.uni.uCast.value = F.cast;
    }
    book.uni.uCover.value.set(C.cover);
    book.uni.uEdge.value.set(C.edge);
    table.uni.uTable.value.set(C.table);
    table.uni.uFar.value.set(C.far);
    table.uni.uShadowK.value = F.tableShadow;
    // The lamp-lit table fades to black well before the stage's edges; the daylight table fades to the backdrop grey.
    table.uni.uFade.value.set(xw * (dark ? 0.6 : 1.4), xw * (dark ? 1.3 : 4.5));
    back.uni.uFar.value.set(C.far);
    dust.uni.uDustK.value = F.dust;
    dust.pts.visible = F.dust > 0;
    ctx.look(F.bloom, F.exposure);
  };

  // Frame the whole book from the front and a little above (the engine widens it for narrow stages).
  const target = new Vector3(0, top * 0.42, zMid + (zF - zB) * 0.06);
  const el = 0.3;
  const dist = Math.max((xw + 3) / 0.47, (yT * 0.62 + (zF - zB) * 0.22) / 0.45);
  const cam = target.clone().add(new Vector3(0, Math.sin(el), Math.cos(el)).multiplyScalar(dist));

  return {
    key: 'paper',
    group,
    pos,
    size,
    style: 0,
    lift: 5,
    tint,
    labelScale: 0.85,
    hiTargets: [{ geo: rg, perPerson: true }, { geo: ribGeo }],
    focus: [look.uFocus],
    view: { target, cam },
    follow: big ? 20 : 32,
  };
};
