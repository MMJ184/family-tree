import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  Color,
  DoubleSide,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
  Vector2,
  Vector3,
} from 'three';
import type { Shared } from '../gl.ts';
import { BUMP, DOME_VERT, LINEAGE, NOISE3, REF_PX, untone } from './tree-gl.ts';

// Living Tree materials: fissured Ghaf bark lit by garden uplights (night) or soft daylight with
// ink edges (botanical plate), drooping feathery foliage and pods, the ground with leaf litter
// and the canopy's shadow, fireflies and a neutral backdrop. Every material reads one shared
// light rig, so tint() swaps the theme by changing uniforms only.

/** Scene palette (sRGB hex). Two to four signature colours per theme from the Ghaf itself; the rest is neutral. */
export const LOOK = {
  dark: {
    dark: true,
    // signature: umber bark, sage leaves, warm firefly / uplight amber
    barkA: '#1f1915',
    barkB: '#786652',
    leafA: '#2a3624',
    leafB: '#8a9c76',
    dry: '#6e5a3c',
    pod: '#8a6738',
    up: '#ffd7aa',
    fly: '#ffc773',
    // neutrals
    bgTop: '#000000',
    bgHor: '#050505',
    groundIn: '#1a1a1a',
    groundOut: '#050505',
    litter: '#3a3026',
    shadow: '#000000',
    sky: '#3d4249',
    bounce: '#120f0c',
    key: '#bcc4d1',
    keyI: 1.0,
    upI: 1.0,
    ink: 0,
    hi: '#4fd1bd',
    gold: '#e2b65a',
    tip: '#ffd9a0',
    bloom: 0.42,
    exposure: 1.0,
  },
  light: {
    dark: false,
    // signature: graphite bark, sage leaves, dry pod ochre
    barkA: '#36332f',
    barkB: '#958f86',
    leafA: '#34482c',
    leafB: '#7d946b',
    dry: '#b49f7c',
    pod: '#8d6a3a',
    up: '#000000',
    fly: '#000000',
    // neutrals
    bgTop: '#ffffff',
    bgHor: '#f3f3f3',
    groundIn: '#f7f7f7',
    groundOut: '#f3f3f3',
    litter: '#c9c4ba',
    shadow: '#9a9a9a',
    sky: '#ffffff',
    bounce: '#b9b9b9',
    key: '#ffffff',
    keyI: 1.25,
    upI: 0,
    ink: 1,
    hi: '#0f6b63',
    gold: '#b7862c',
    tip: '#0f6b63',
    // No bloom by day: the white stage would bleed over everything.
    bloom: 0,
    exposure: 1.0,
  },
};
export type TreeLook = typeof LOOK.dark;

// ---------- shared rig ----------

export function treeRig() {
  const c = () => ({ value: new Color(0, 0, 0) });
  return {
    uKeyDir: { value: new Vector3(-0.45, 0.85, 0.3).normalize() },
    uKeyCol: c(),
    uSkyCol: c(),
    uBounce: c(),
    uUpCol: c(),
    /** Three garden uplights on a ring around the trunk foot: radius, height, reach. */
    uUp: { value: new Vector3(4, 0.4, 14) },
    uFogCol: c(),
    uFogNear: { value: 200 },
    uFogFar: { value: 900 },
    uDimCol: c(),
    uHiCol: c(),
    uGold: c(),
    uTip: c(),
    uInk: { value: 0 },
    uDark: { value: 1 },
    uFocus: { value: 0 },
  };
}
export type TreeRig = ReturnType<typeof treeRig>;

export function setRig(R: TreeRig, L: TreeLook, plain: (hex: string) => Color) {
  R.uKeyCol.value.copy(plain(L.key)).multiplyScalar(L.keyI);
  R.uSkyCol.value.copy(plain(L.sky)).multiplyScalar(L.dark ? 0.1 : 0.55);
  R.uBounce.value.copy(plain(L.bounce)).multiplyScalar(L.dark ? 0.12 : 0.35);
  R.uUpCol.value.copy(plain(L.up)).multiplyScalar(L.upI * 1.6);
  // Fog fades into the backdrop's horizon colour, so the ground's far edge never shows as an arc.
  R.uFogCol.value.copy(untone(L.bgHor, L.exposure));
  R.uDimCol.value.copy(untone(L.dark ? '#050505' : '#f1f1f1', L.exposure));
  R.uHiCol.value.copy(plain(L.hi));
  R.uGold.value.copy(plain(L.gold));
  R.uTip.value.copy(plain(L.tip)).multiplyScalar(L.dark ? 2.2 : 1);
  R.uInk.value = L.ink;
  R.uDark.value = L.dark ? 1 : 0;
  R.uKeyDir.value.set(L.dark ? -0.35 : -0.5, 0.9, L.dark ? 0.45 : 0.35).normalize();
}

const RIG = /* glsl */ `
  uniform vec3 uKeyDir, uKeyCol, uSkyCol, uBounce, uUpCol, uUp, uFogCol, uDimCol, uHiCol, uGold, uTip;
  uniform float uInk, uDark, uFocus, uFogNear, uFogFar;
  uniform float uYear, uEnter, uMinYear, uTime;
  float yrNow() { return mix(uMinYear - 3., uYear, uEnter); }
  // Warm light from three fixtures at the trunk foot (night only).
  float uplightR(vec3 w, vec3 n, float wrap, float reach) {
    float s = 0.;
    for (int i = 0; i < 3; i++) {
      float a = float(i) * 2.0944 + .6;
      vec3 d = vec3(cos(a) * uUp.x, uUp.y, sin(a) * uUp.x) - w;
      float l = max(length(d), 1e-3);
      s += clamp((dot(n, d / l) + wrap) / (1. + wrap), 0., 1.) / (1. + l * l / max(reach * reach, 1e-3));
    }
    return s;
  }
  float uplight(vec3 w, vec3 n, float wrap) { return uplightR(w, n, wrap, uUp.z); }
  vec3 lit(vec3 base, vec3 n, vec3 w, float ao, float wrap) {
    vec3 hemi = mix(uBounce, uSkyCol, n.y * .5 + .5);
    float k = clamp((dot(n, uKeyDir) + wrap) / (1. + wrap), 0., 1.);
    return base * (hemi * ao + uKeyCol * k * mix(.55, 1., ao) + uUpCol * uplight(w, n, wrap));
  }
  vec3 fogged(vec3 c, float depth) { return mix(c, uFogCol, smoothstep(uFogNear, uFogFar, depth)); }
  vec3 focused(vec3 c, float hi) { return mix(c, uDimCol, uFocus * (1. - step(.5, hi)) * mix(.5, .62, uDark)); }`;

// ---------- wood ----------

/**
 * Bark: interlacing fissures that run along each limb (seamless round the tube), bump-lit; young
 * wood is slimmer and thickens over the years. Lineage limbs carry a teal current; spouse twigs are gold.
 */
export function woodMaterial(U: Shared, R: TreeRig) {
  const uni = {
    ...U,
    ...R,
    uBarkA: { value: new Color() },
    uBarkB: { value: new Color() },
    /** Wood radius from which the lineage shows only as a current and an edge (thin to thick). */
    uThick: { value: new Vector2(0.3, 0.8) },
    /** Night only: the moon's silver-blue edge light and cool fill, and the crown's height range (trunk top, top). */
    uRimCol: { value: new Color() },
    uSpan: { value: new Vector2(10, 40) },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `
      attribute vec3 aC; attribute float aT, aS, aU, aR, aBirth, aGrow, aHi, aKind;
      uniform float uYear, uEnter, uMinYear;
      varying float vT, vS, vU, vR, vBirth, vGrow, vHi, vKind, vDepth; varying vec3 vN, vW;
      void main() {
        float yr = mix(uMinYear - 3., uYear, uEnter);
        float thick = mix(.6, 1., smoothstep(aBirth, aBirth + 40., yr));
        vec3 p = aC + (position - aC) * (aKind > .5 ? 1. : thick);
        vT = aT; vS = aS; vU = aU; vR = aR * thick; vBirth = aBirth; vGrow = aGrow; vHi = aHi; vKind = aKind;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(p, 1.); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z;
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      ${RIG}
      ${NOISE3}
      ${BUMP}
      ${LINEAGE}
      uniform vec3 uBarkA, uBarkB, uRimCol; uniform vec2 uThick, uSpan;
      varying float vT, vS, vU, vR, vBirth, vGrow, vHi, vKind, vDepth; varying vec3 vN, vW;
      void main() {
        // Growth cut-off: discarded at the end, after the derivatives (fwidth, bump) are taken.
        float g = clamp((yrNow() - vBirth) / vGrow, 0., 1.);
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW);
        // Seamless cylinder coordinates in world units; fissures stretch along the limb and twist a little.
        float a = vU * 6.2832 + vS * .05;
        vec3 q = vec3(cos(a) * vR, sin(a) * vR, vS * .16) * 1.5 + vBirth * .37;
        q.xy += (vn3(q * .6 + 7.) - .5) * 1.4;
        float f1 = vn3(q * vec3(1., 1., .55)), f2 = vn3(q * vec3(2.3, 2.3, 1.2) + 3.);
        // Anti-aliased: lines widen to a pixel, and fade out where they would be finer than one.
        float w1 = fwidth(f1), w2 = fwidth(f2);
        float crack = (1. - smoothstep(.0, .1 + w1 * 1.5, abs(f1 - .5))) * (1. - smoothstep(.04, .16, w1));
        float crack2 = (1. - smoothstep(.0, .07 + w2 * 1.5, abs(f2 - .5))) * .6 * (1. - smoothstep(.03, .12, w2));
        float plate = vn3(q * 5.);
        float h = 1. - max(crack, crack2) * (1. - .4 * (1. - smoothstep(.05, .15, vR)));
        float detail = 1. - smoothstep(.03, .14, w1);
        vec3 nb = bump(n, vW, h, .9 * min(vR * 2.5, 1.) * detail);
        vec3 base = mix(uBarkA, uBarkB, h * (.72 + .28 * plate));
        base *= 1. + (.28 * vn3(q * 13.) - .14) * detail;
        float ao = mix(.45, 1., h) * (.55 + .45 * smoothstep(-.6, .4, nb.y));
        vec3 col = lit(base, nb, vW, ao, .35);
        // Night: the uplights reach further up the wood (low limbs glow warm), the moon fills the
        // upper limbs cool, and every limb catches a thin silver-blue edge against the black.
        float hgt = smoothstep(uSpan.x * .5, uSpan.y, vW.y);
        float edge = pow(clamp(1. - abs(dot(n, V)), 0., 1.), 2.4);
        col += uDark * (base * uUpCol * uplightR(vW, nb, .5, uUp.z * 2.6) * .55 * (1. - hgt)
          + base * uRimCol * (.18 + .55 * hgt) + uRimCol * edge * (.1 + .08 * hgt));
        // Gold for a marriage twig.
        float isGold = step(.5, vKind) * (1. - step(1.5, vKind));
        col = mix(col, uGold * (uDark > .5 ? .55 : .6) * (.75 + .25 * max(dot(nb, uKeyDir), 0.)) + uGold * uDark * .12, isGold);
        // Ink edges on the botanical plate.
        float rim = clamp(1. - abs(dot(n, V)), 0., 1.);
        col *= 1. - uInk * .55 * pow(rim, 2.2);
        // Lineage: a teal current flows from parent to child.
        float flow = smoothstep(.86, 1., fract(vS * .07 - uTime * .32 + vBirth * .13));
        col = lineage(col, uHiCol, uGold, vHi, isGold, flow, smoothstep(uThick.x, uThick.y, vR), pow(rim, 2.), uDark);
        col = focused(col, vHi);
        // The growing tip.
        col = mix(col, uTip, smoothstep(g - .06, g, vT) * (1. - step(.999, g)) * .9);
        if (vT > g) discard;
        gl_FragColor = vec4(fogged(col, vDepth), 1.); }`,
  });
  return { mat, uni };
}

// ---------- foliage and pods ----------

/** Atlas of three cells: two drooping Ghaf sprays (tiny paired leaflets on a fine stem) and a cluster of pods. */
export function foliageAtlas(): CanvasTexture {
  const W = 384;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (g) {
    let s = 7;
    const r = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const spray = (x0: number, bend: number) => {
      // R: shading (stem darker), A: coverage
      const cx = x0 + 64;
      const pts: Array<[number, number]> = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        pts.push([cx + Math.sin(t * 2.2) * bend * t * 30, 8 + t * 488]);
      }
      g.strokeStyle = 'rgba(150,150,150,1)';
      g.lineWidth = 3;
      g.beginPath();
      pts.forEach(([x, y], i) => {
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.stroke();
      // pinnae: short side stems with paired leaflets, longer in the middle, shorter at the tip
      for (let i = 2; i < 40; i++) {
        const [x, y] = pts[i] ?? [cx, 0];
        const t = i / 40;
        const len = (22 + 36 * Math.sin(Math.min(1, t * 1.3) * Math.PI)) * (0.85 + r() * 0.3);
        for (const side of [-1, 1]) {
          const ang = side * (0.95 + r() * 0.25) + 0.35 * side * t;
          const dx = Math.sin(ang) * len;
          const dy = Math.cos(ang) * len * 0.45;
          g.strokeStyle = 'rgba(170,170,170,1)';
          g.lineWidth = 1.4;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + dx, y + dy);
          g.stroke();
          for (let k = 1; k <= 5; k++) {
            const u = k / 5.5;
            const px = x + dx * u;
            const py = y + dy * u;
            const lr = 6.2 - u * 1.8;
            for (const s2 of [-1, 1]) {
              const shade = 210 + Math.floor(r() * 45);
              g.fillStyle = `rgba(${shade},${shade},${shade},1)`;
              g.beginPath();
              g.ellipse(
                px + s2 * Math.cos(ang) * lr * 0.9,
                py - s2 * Math.sin(ang) * lr * 0.9 + 2,
                lr,
                lr * 0.42,
                ang + (s2 * Math.PI) / 2.6,
                0,
                Math.PI * 2,
              );
              g.fill();
            }
          }
        }
      }
    };
    spray(0, 0.6);
    spray(128, -0.8);
    // pods: slender, beaded, slightly curved, hanging from one point
    for (let k = 0; k < 4; k++) {
      const x0 = 256 + 30 + k * 22;
      const len = 300 + r() * 160;
      const bend = (r() - 0.5) * 40;
      for (let i = 0; i < 60; i++) {
        const t = i / 60;
        const x = x0 + Math.sin(t * 2.4) * bend * t;
        const y = 10 + t * len;
        const bead = 0.75 + 0.25 * Math.abs(Math.sin(t * 30));
        const w = (3 + 5 * Math.sin(Math.min(1, t * 3) * Math.PI * 0.5)) * bead * (1 - t * 0.35);
        const grd = g.createLinearGradient(x - w, 0, x + w, 0);
        grd.addColorStop(0, 'rgba(120,120,120,1)');
        grd.addColorStop(0.4, 'rgba(255,255,255,1)');
        grd.addColorStop(1, 'rgba(110,110,110,1)');
        g.fillStyle = grd;
        g.beginPath();
        g.ellipse(x, y, w, len / 60 + 1.5, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Instanced sprays (kind 0, 1) and pods (kind 2) hanging from the limbs: they unfurl after a birth,
 * sway in a slow breeze, dry and drop after a death. Lit by the rig; night uplights shine through them.
 */
export function foliageMaterial(U: Shared, R: TreeRig, atlas: Texture) {
  const uni = {
    ...U,
    ...R,
    uAtlas: { value: atlas },
    uLeafA: { value: new Color() },
    uLeafB: { value: new Color() },
    uDry: { value: new Color() },
    uPod: { value: new Color() },
  };
  const mat = new ShaderMaterial({
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `
      attribute float aBirth, aDeath, aPhase, aVar, aKind, aHi;
      uniform float uYear, uEnter, uMinYear, uTime;
      varying vec2 vUv; varying vec3 vN, vW; varying float vVar, vKind, vHi, vDry, vA, vDepth;
      void main() {
        float yr = mix(uMinYear - 3., uYear, uEnter);
        float open = smoothstep(aBirth, aBirth + 2.2, yr);
        float fall = max(yr - aDeath - 1.5, 0.);
        vec3 p = position;
        p.y *= open; p.x *= .4 + .6 * open;
        float hang = -p.y; // 0 at the stem, 1 at the tip
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.);
        vec4 o = modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.);
        float gust = .6 + .4 * sin(uTime * .35 + o.x * .03 + o.z * .02);
        float sw = sin(uTime * .9 + aPhase) * gust;
        w.x += sw * hang * hang * .35; w.z += cos(uTime * .7 + aPhase * 1.7) * gust * hang * hang * .22;
        w.y -= fall * fall * 2.6; w.y = max(w.y, .02);
        vN = normalize(mat3(modelMatrix * instanceMatrix) * vec3(0., 0., 1.));
        vUv = vec2((aKind + uv.x) / 3., uv.y); vW = w.xyz; vVar = aVar; vKind = aKind; vHi = aHi;
        vDry = smoothstep(aDeath, aDeath + 1.5, yr); vA = open * (1. - smoothstep(1., 3., fall));
        vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      ${RIG}
      uniform sampler2D uAtlas; uniform vec3 uLeafA, uLeafB, uDry, uPod;
      varying vec2 vUv; varying vec3 vN, vW; varying float vVar, vKind, vHi, vDry, vA, vDepth;
      void main() {
        vec4 tx = texture2D(uAtlas, vUv);
        // Distant sprays keep their body: the alpha cut eases as the texture shrinks on screen.
        float fp = max(fwidth(vUv.x) * 384., fwidth(vUv.y) * 512.);
        if (tx.a < clamp(.5 - .12 * log2(max(fp, 1.)), .16, .5) || vA < .02) discard;
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW); if (dot(n, V) < 0.) n = -n;
        float tip = 1. - vUv.y;
        vec3 leaf = mix(uLeafA, uLeafB, clamp(tip * .55 + vVar * .5 + (tx.r - .8) * .9, 0., 1.));
        leaf = mix(leaf, uDry, vDry * .85);
        vec3 base = vKind > 1.5 ? uPod * (.55 + .6 * tx.r) * (.85 + .3 * vVar) : leaf;
        float ao = .55 + .45 * tip;
        vec3 col = lit(base, normalize(n + vec3(0., .6, 0.)), vW, ao, .6);
        // Night: the uplights shine through the thin leaves from below.
        col += uUpCol * uplight(vW, vec3(0., -1., 0.), 1.) * base * .55 * step(vKind, 1.5);
        col *= .82 + .18 * smoothstep(.3, .8, tx.a);
        col = focused(col, vHi);
        gl_FragColor = vec4(fogged(col, vDepth), 1.); }`,
  });
  return { mat, uni };
}

// ---------- ground ----------

/** The ground: a neutral disc lifted under the tree, leaf litter, the canopy's soft shadow and the uplight pools. */
export function groundMaterial(U: Shared, R: TreeRig) {
  const uni = {
    ...U,
    ...R,
    uIn: { value: new Color() },
    uOut: { value: new Color() },
    uLitter: { value: new Color() },
    uShadow: { value: new Color() },
    /** Canopy radius now (grows with the family), crown outer radius, trunk radius. */
    uCan: { value: new Vector3(10, 30, 2) },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `varying vec3 vW; varying float vDepth;
      void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      ${RIG}
      ${NOISE3}
      uniform vec3 uIn, uOut, uLitter, uShadow, uCan;
      varying vec3 vW; varying float vDepth;
      void main() {
        vec2 p = vW.xz; float r = length(p);
        float R = uCan.y;
        vec3 c = mix(uIn, uOut, smoothstep(R * .2, R * 2.6, r));
        // Leaf litter: small dry leaflets scattered under the crown, thicker near the trunk.
        vec2 cell = floor(p * 2.2); vec2 f = fract(p * 2.2) - .5;
        float hsh = h21(cell);
        vec2 o = vec2(h21(cell + 3.1), h21(cell + 7.7)) - .5;
        float ang = hsh * 6.2832; vec2 d = f - o * .5; d = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * d;
        float leaf = 1. - smoothstep(.08, .14, length(d * vec2(1., 2.6)));
        float dens = (1. - smoothstep(uCan.x * .5, uCan.x * 1.05, r)) * .55 + .25 * (1. - smoothstep(0., uCan.z * 4., r));
        leaf *= step(1. - dens, h21(cell + 11.3));
        float mott = vn2(p * .35) * .6 + vn2(p * 1.7) * .4;
        c = mix(c, uLitter, leaf * (.45 + .3 * hsh) + (mott - .5) * .06 * (1. - smoothstep(0., R * 1.4, r)));
        // Daylight: the crown's soft shadow, dappled, with a darker core at the trunk foot.
        vec2 sp = p + uKeyDir.xz / max(uKeyDir.y, .3) * uCan.x * .25;
        float can = 1. - smoothstep(uCan.x * .55, uCan.x * 1.08, length(sp));
        float dap = smoothstep(.35, .7, vn2(sp * .45) * .6 + vn2(sp * 1.3) * .4);
        float sh = can * (.35 + .4 * dap) + .5 * exp(-r * r / (uCan.z * uCan.z * 3.));
        c = mix(c, uShadow, clamp(sh, 0., 1.) * (1. - uDark) * .62);
        // Night: pools of warm light at the uplights, the trunk's dark foot.
        vec3 col = c + c * uUpCol * uplight(vW + vec3(0., .02, 0.), vec3(0., 1., 0.), 0.) * 1.6 * uDark;
        col *= 1. - uDark * .6 * exp(-r * r / (uCan.z * uCan.z * 1.4));
        gl_FragColor = vec4(fogged(col, vDepth), 1.); }`,
  });
  return { mat, uni };
}

// ---------- night fireflies ----------

export function fireflyMaterial(U: Shared, tex: Texture) {
  const uni = { uTime: U.uTime, uCol: { value: new Color() }, uTex: { value: tex }, uPx: { value: REF_PX } };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aPh; uniform float uTime, uPx; varying float vA;
      void main() { vec3 p = position;
        p.x += sin(uTime * .21 + aPh) * 1.6; p.y += sin(uTime * .33 + aPh * 1.9) * .9; p.z += cos(uTime * .19 + aPh * 2.3) * 1.6;
        vA = pow(max(sin(uTime * (.5 + fract(aPh) * .6) + aPh * 7.), 0.), 3.);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        float k = uPx / ${REF_PX.toFixed(1)};
        gl_PointSize = clamp(uPx * .31 / max(-mv.z, .1), 1.5 * k, 9. * k); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform sampler2D uTex; uniform vec3 uCol; varying float vA;
      void main() { float a = texture2D(uTex, gl_PointCoord).a * vA; gl_FragColor = vec4(uCol * a * 2.4, 1.); }`,
  });
  return { mat, uni };
}

// ---------- backdrop ----------

/** A neutral dome: the colours are display colours, untoned so they land exactly on screen. */
export function backdropMaterial() {
  const uni = { uTop: { value: new Color() }, uHor: { value: new Color() } };
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: uni,
    vertexShader: DOME_VERT,
    fragmentShader: /* glsl */ `uniform vec3 uTop, uHor; varying vec3 vD;
      void main() { gl_FragColor = vec4(mix(uHor, uTop, smoothstep(0., .6, vD.y)), 1.); }`,
  });
  return { mat, uni };
}
