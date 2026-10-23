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
import { type StudioPerson, spouseIndex } from '../model.ts';
import { lin } from '../palette.ts';
import { sizeFactor } from '../portraits.ts';
import {
  backdropMaterial,
  bookMaterial,
  cardMaterial,
  type LayerData,
  pageMaterial,
  ribbonMaterial,
  rosetteMaterial,
} from './paper-gl.ts';
import type { SceneBuilder } from './types.ts';

// Paper Pop-up: the family as a pop-up book. Each generation is a cut-paper card with
// arched edges and jaali cut-outs, set on concentric arcs (founders at the back, the
// youngest in front). People are paper rosette tags; folded paper strips run from each
// parent over the next card to the child. Cards fold up from the page as the years pass.

/** Card colours from the back layer to the front one. */
const STOPS = {
  light: ['#56679a', '#7d93a6', '#8fa284', '#b8a074', '#c4805e', '#d99c74', '#e8c39b'],
  dark: ['#e7a95f', '#c97b4c', '#9a5a4c', '#6c4659', '#463d63', '#2e3258', '#222849'],
};
/** Backlight through each layer in the lamplit theme (back layers glow most). */
const GLOW = [0.85, 0.42, 0.24, 0.12, 0.06, 0.03, 0.02];

const ramp = (stops: string[], t: number) => {
  const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  return lin(stops[i] ?? '#ffffff').lerp(lin(stops[i + 1] ?? stops[i] ?? '#ffffff'), x - i);
};
const rampN = (vals: number[], t: number) => {
  const x = Math.min(0.9999, Math.max(0, t)) * (vals.length - 1);
  const i = Math.floor(x);
  const a = vals[i] ?? 0;
  return a + ((vals[i + 1] ?? a) - a) * (x - i);
};

export const paperScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const dirX = ctx.rtl() ? -1 : 1;
  const nL = M.maxGen + 1;
  const size = big ? 0.95 : 1.4;
  const GY = big ? 6.2 : 7.6; // visible band of each card
  const A = big ? 1.1 : 1.4; // arch height
  const P = big ? 2.4 : 3.2; // arch period
  const s = big ? 2.7 : 4.6; // minimum spacing between people on a card
  const span = big ? 1.3 : 1.0; // arc angle of the stage
  const sp = 0.74; // spouse offset in units of s
  const rowGap = big ? 3.3 : 4; // vertical step between staggered rows of tags on one card
  const gap = big ? 9 : 8; // minimum depth between cards

  // Spouses laid out beside each person: count per side (even index to the right, odd to the left).
  const spouses = new Map<string, number>();
  for (const p of M.people) if (p.mi && p.anchor) spouses.set(p.anchor, (spouses.get(p.anchor) ?? 0) + 1);
  const rightOf = (id: string) => s * (0.5 + sp * Math.ceil((spouses.get(id) ?? 0) / 2));
  const leftOf = (id: string) => s * (0.5 + sp * Math.floor((spouses.get(id) ?? 0) / 2));

  // Each generation packed along its card in tree order: near its place in the tree, never closer than
  // the minimum spacing. Crowded generations stagger into up to three rows of tags.
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
    for (; nr <= 3; nr++) {
      const xs = pack(row, nr, () => 0);
      w = (xs[xs.length - 1] ?? 0) - (xs[0] ?? 0);
      if (w <= span * Rcap || nr === 3) break;
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
  // Card heights: each card shows a band above the one in front, tall enough for its rows.
  const H: number[] = new Array(nL).fill(0);
  for (let g = nL - 1; g >= 0; g--)
    H[g] = (g === nL - 1 ? GY * 0.8 : (H[g + 1] ?? 0) + GY) + ((rows[g] ?? 1) - 1) * rowGap;
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
    const k = spouseIndex(M, p);
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

  // ---- Cards: one mesh, one strip per generation ----
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
  const card = cardMaterial(U, L, { A, P });
  const cards = new Mesh(cardGeo, card.mat);
  cards.frustumCulled = false;
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
  const aCol = iattr('aCol', 3);
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
    const c = lin(p.color);
    aCol.set([c.r, c.g, c.b], i * 3);
    aTh[i] = th;
    aSize[i] = tagR(p);
    aBirth[i] = p.born;
    aDeath[i] = p.died ?? 9999;
  });
  const ros = rosetteMaterial(U);
  const tags = new Mesh(rg, ros.mat);
  tags.frustumCulled = false;
  tags.renderOrder = 5;
  group.add(tags);

  // ---- Folded paper ribbons: parent tag, over the child's card edge, down to the child's tag ----
  const rp: number[] = [];
  const rn: number[] = [];
  const rt: number[] = [];
  const rb: number[] = [];
  const rf: number[] = [];
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
        rkeys.push(p.id);
      }
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2;
      ridx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const ribGeo = new BufferGeometry();
  ribGeo.setAttribute('position', new Float32BufferAttribute(rp, 3));
  ribGeo.setAttribute('normal', new Float32BufferAttribute(rn, 3));
  ribGeo.setAttribute('aT', new Float32BufferAttribute(rt, 1));
  ribGeo.setAttribute('aBirth', new Float32BufferAttribute(rb, 1));
  ribGeo.setAttribute('aF', new Float32BufferAttribute(rf, 1));
  ribGeo.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(rt.length), 1));
  ribGeo.setIndex(ridx);
  ribGeo.userData.keys = rkeys;
  const rib = ribbonMaterial(U);
  const ribbons = new Mesh(ribGeo, rib.mat);
  ribbons.frustumCulled = false;
  group.add(ribbons);

  // ---- The open book: floor page, upright back page, cover boards and page blocks ----
  const Rl = R[nL - 1] ?? 20;
  const R0 = R[0] ?? 20;
  const top = (H[0] ?? 0) + A;
  const xw = Rl * Math.sin(half) + (big ? 10 : 7);
  const zB = R0 * Math.cos(half) - (big ? 5 : 4);
  const zF = Rl + (big ? 12 : 9);
  const yT = top + (big ? 10 : 7);
  const floorPage = pageMaterial(U, L, [-xw, zB, xw, zF], true);
  const fm = new Mesh(new PlaneGeometry(2 * xw, zF - zB), floorPage.mat);
  fm.rotation.x = -Math.PI / 2;
  fm.position.set(0, 0, (zB + zF) / 2);
  group.add(fm);
  const backPage = pageMaterial(U, L, [-xw, 0, xw, yT], false);
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
  box(2 * xw, yT, blk, 0, yT / 2, zB - blk / 2 - 0.12, 1);
  box(2 * xw + 2, yT + 2, cov, 0, yT / 2 + 1 - blk, zB - blk - cov / 2, 0);
  const bookGeo = new BufferGeometry();
  bookGeo.setAttribute('position', new Float32BufferAttribute(bp, 3));
  bookGeo.setAttribute('normal', new Float32BufferAttribute(bn, 3));
  bookGeo.setAttribute('aKind', new Float32BufferAttribute(bk, 1));
  bookGeo.setIndex(bi);
  const book = bookMaterial();
  group.add(new Mesh(bookGeo, book.mat));
  const back = backdropMaterial();
  group.add(new Mesh(new SphereGeometry(1400, 32, 16), back.mat));

  const tint = () => {
    const dark = ctx.dark();
    const stops = dark ? STOPS.dark : STOPS.light;
    for (let g = 0; g < nL; g++) {
      const t = nL > 1 ? g / (nL - 1) : 1;
      (card.uni.uCol.value[g] as Color).copy(ramp(stops, nL > 1 ? t : 0.9));
      card.uni.uTrans.value[g] = dark ? rampN(GLOW, t) : 0;
    }
    card.uni.uBackCol.value.copy(lin(dark ? '#3a3350' : '#e9dcc3'));
    card.uni.uAmb.value = dark ? 0.32 : 0.66;
    card.uni.uDif.value = dark ? 0.28 : 0.46;
    card.uni.uRim.value = dark ? 0.55 : 0.12;
    card.uni.uRimCol.value.copy(lin(dark ? '#ffc070' : '#fff6e6'));
    card.uni.uShadow.value = dark ? 0.6 : 0.55;
    ros.uni.uPaper.value.copy(lin(dark ? '#f1dcb8' : '#f8f1e2'));
    ros.uni.uInk.value.copy(lin(dark ? '#e09a52' : '#a2533b'));
    ros.uni.uLight.value = dark ? 0.86 : 1;
    ros.uni.uShadowA.value = dark ? 0.5 : 0.3;
    rib.uni.uCol.value.copy(lin(dark ? '#b8774a' : big ? '#c88a68' : '#b5603f'));
    rib.uni.uHiCol.value.copy(lin(dark ? '#ffbf6a' : '#d9762f'));
    rib.uni.uAmb.value = dark ? 0.42 : 0.6;
    rib.uni.uDif.value = dark ? 0.45 : 0.55;
    rib.uni.uGlow.value = dark ? 0.6 : 0;
    for (const pg of [floorPage, backPage]) {
      pg.uni.uPaper.value.copy(lin(dark ? '#2b2d4c' : '#f6efe1'));
      pg.uni.uInk.value.copy(lin(dark ? '#c98a52' : '#b0664a'));
      pg.uni.uShadow.value = dark ? 0.6 : 0.38;
    }
    backPage.uni.uGlow.value.copy(lin(dark ? '#d9893f' : '#000000'));
    book.uni.uCover.value.copy(lin(dark ? '#2c2240' : '#7a3b2e'));
    book.uni.uEdge.value.copy(lin(dark ? '#8f7a68' : '#eadcc0'));
    book.uni.uAmb.value = dark ? 0.4 : 0.6;
    back.uni.uTop.value.copy(lin(dark ? '#070a1c' : '#d9cdb5'));
    back.uni.uHor.value.copy(lin(dark ? '#161c3c' : '#efe6d4'));
    back.uni.uLow.value.copy(lin(dark ? '#0c1028' : '#e2d6bf'));
    back.uni.uLamp.value.copy(new Color(dark ? '#ffae55' : '#fff3dc'));
    back.uni.uLampK.value = dark ? 0.28 : 0.25;
    ctx.look(dark ? 0.32 : 0.04, dark ? 1.05 : 1.08);
  };

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
    focus: [ros.uni.uFocus, rib.uni.uFocus, card.uni.uFocus],
    view: {
      target: new Vector3(0, top * 0.42, (zB + zF) / 2),
      cam: new Vector3(0, top * 0.45 + xw * 0.4, (zB + zF) / 2 + xw * 1.75 + 6),
    },
    follow: big ? 20 : 32,
  };
};
