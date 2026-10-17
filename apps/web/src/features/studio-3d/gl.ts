import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  type Color,
  type Curve,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  LineSegments,
  Mesh,
  type Object3D,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from 'three';
import { lin } from './palette.ts';

// Shared shader chunks, geometry builders and materials used by several scenes.

export interface Shared {
  uYear: { value: number };
  uTime: { value: number };
  uEnter: { value: number };
  uMinYear: { value: number };
}

export const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }`;

export function makeFog() {
  return { uFogColor: { value: lin('#000000') }, uFogNear: { value: 120 }, uFogFar: { value: 520 } };
}
export type Fog = ReturnType<typeof makeFog>;

export interface TubeBuilder {
  pos: number[];
  nor: number[];
  t: number[];
  u: number[];
  birth: number[];
  grow: number[];
  key: string[];
  idx: number[];
  col: number[];
}

export const builder = (): TubeBuilder => ({
  pos: [],
  nor: [],
  t: [],
  u: [],
  birth: [],
  grow: [],
  key: [],
  idx: [],
  col: [],
});

const FALLBACK_N = new Vector3(1, 0, 0);
const FALLBACK_B = new Vector3(0, 0, 1);

/** Tapered tube along a curve; appends to the builder. aT runs 0..1 from parent to child. */
export function tube(
  B: TubeBuilder,
  curve: Curve<Vector3>,
  r0: number,
  r1: number,
  segs: number,
  radial: number,
  birth: number,
  hiKey: string,
  grow = 1.4,
) {
  const frames = curve.computeFrenetFrames(segs, false);
  const base = B.pos.length / 3;
  const P = new Vector3();
  const n = new Vector3();
  for (let i = 0; i <= segs; i++) {
    const tt = i / segs;
    curve.getPointAt(tt, P);
    const r = r0 + (r1 - r0) * tt ** 0.85;
    const N = frames.normals[i] ?? FALLBACK_N;
    const Bn = frames.binormals[i] ?? FALLBACK_B;
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2;
      n.copy(N).multiplyScalar(Math.cos(v)).addScaledVector(Bn, Math.sin(v)).normalize();
      B.pos.push(P.x + n.x * r, P.y + n.y * r, P.z + n.z * r);
      B.nor.push(n.x, n.y, n.z);
      B.t.push(tt);
      B.u.push(j / radial);
      B.birth.push(birth);
      B.grow.push(grow);
      B.key.push(hiKey);
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < radial; j++) {
      const a = base + i * (radial + 1) + j;
      const b = a + radial + 1;
      B.idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
}

/** Same as tube, with a colour per vertex (for ribbons). */
export function tubeColored(
  B: TubeBuilder,
  curve: Curve<Vector3>,
  r0: number,
  r1: number,
  segs: number,
  radial: number,
  birth: number,
  key: string,
  color: Color,
) {
  const before = B.pos.length / 3;
  tube(B, curve, r0, r1, segs, radial, birth, key);
  const added = B.pos.length / 3 - before;
  for (let i = 0; i < added; i++) B.col.push(color.r, color.g, color.b);
}

/** Geometry whose per-vertex `aHi` is driven from the lineage via userData.keys. */
export function bake(B: TubeBuilder): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(B.pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(B.nor, 3));
  g.setAttribute('aT', new Float32BufferAttribute(B.t, 1));
  g.setAttribute('aU', new Float32BufferAttribute(B.u, 1));
  g.setAttribute('aBirth', new Float32BufferAttribute(B.birth, 1));
  g.setAttribute('aGrow', new Float32BufferAttribute(B.grow, 1));
  g.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(B.key.length), 1));
  g.setIndex(B.idx);
  g.userData.keys = B.key;
  return g;
}

/** Bark: lit procedural bark that grows in the shader; light flows along the selected lineage. */
export function barkMaterial(U: Shared, fog: Fog) {
  const uni = {
    ...U,
    ...fog,
    uBarkA: { value: lin('#000000') },
    uBarkB: { value: lin('#000000') },
    uGlow: { value: lin('#000000') },
    uSky: { value: lin('#000000') },
    uGround: { value: lin('#000000') },
    uFocus: { value: 0 },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `
      attribute float aT, aU, aBirth, aGrow, aHi; varying float vT, vU, vBirth, vGrow, vHi, vDepth; varying vec3 vN, vW;
      void main() { vT = aT; vU = aU; vBirth = aBirth; vGrow = aGrow; vHi = aHi; vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform float uYear, uEnter, uMinYear, uTime, uFogNear, uFogFar, uFocus; uniform vec3 uBarkA, uBarkB, uGlow, uSky, uGround, uFogColor;
      varying float vT, vU, vBirth, vGrow, vHi, vDepth; varying vec3 vN, vW;
      ${NOISE}
      void main() {
        float yr = mix(uMinYear - 3., uYear, uEnter);
        float g = clamp((yr - vBirth) / vGrow, 0., 1.); if (vT > g) discard;
        vec3 n = normalize(vN);
        float bark = noise(vec2(vU * 7., vT * 26. + vBirth)) * .6 + noise(vec2(vU * 23., vT * 90.)) * .4;
        float ridges = smoothstep(.35, .65, noise(vec2(vU * 14., vT * 6. + vBirth * .1)));
        vec3 base = mix(uBarkA, uBarkB, bark * .8 + ridges * .25);
        vec3 L = normalize(vec3(.45, .9, .35));
        float dif = max(dot(n, L), 0.);
        vec3 hemi = mix(uGround, uSky, n.y * .5 + .5);
        vec3 col = base * (hemi * .6 + dif * 1.05);
        vec3 V = normalize(cameraPosition - vW); float rim = pow(1. - max(dot(n, V), 0.), 3.);
        col += uGlow * rim * .06;
        float flow = smoothstep(.9, 1., fract(vT * 2.5 - uTime * .3 + vBirth * .37));
        col += uGlow * flow * .07;
        col = mix(col, col * 1.25 + uGlow * .12, vHi) + uGlow * vHi * flow * .9;
        col = mix(col, col * .35, uFocus * (1. - step(.5, vHi)));
        col += uGlow * 2.5 * smoothstep(g - .05, g, vT) * (1. - step(.999, g));
        col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vDepth));
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  return { mat, uni };
}

export interface LineBuilder {
  pos: number[];
  t: number[];
  birth: number[];
  col: number[];
  key: string[];
}
export const lineBuilder = (): LineBuilder => ({ pos: [], t: [], birth: [], col: [], key: [] });

export function addCurveLine(
  B: LineBuilder,
  curve: Curve<Vector3>,
  n: number,
  birth: number,
  key: string,
  color: Color,
) {
  const pts = curve.getSpacedPoints(n);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    B.pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    B.t.push(i / n, (i + 1) / n);
    B.birth.push(birth, birth);
    B.key.push(key, key);
    B.col.push(color.r, color.g, color.b, color.r, color.g, color.b);
  }
}

/** Light lines: additive, with pulses running parent to child. */
export function flowLines(B: LineBuilder, U: Shared, base = 0.35) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(B.pos, 3));
  g.setAttribute('aT', new Float32BufferAttribute(B.t, 1));
  g.setAttribute('aBirth', new Float32BufferAttribute(B.birth, 1));
  g.setAttribute('aCol', new Float32BufferAttribute(B.col, 3));
  g.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(B.t.length), 1));
  g.userData.keys = B.key;
  const uni = { ...U, uFocus: { value: 0 }, uBase: { value: base } };
  const m = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aT, aBirth, aHi; attribute vec3 aCol; varying float vT, vBirth, vHi; varying vec3 vCol;
      void main() { vT = aT; vBirth = aBirth; vHi = aHi; vCol = aCol; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `uniform float uYear, uEnter, uMinYear, uTime, uFocus, uBase; varying float vT, vBirth, vHi; varying vec3 vCol;
      void main() { float yr = mix(uMinYear - 3., uYear, uEnter); float g = clamp((yr - vBirth) / 1.2, 0., 1.); if (vT > g) discard;
        float pulse = smoothstep(.85, 1., fract(vT * 1.6 - uTime * .45 + vBirth * .13));
        float a = uBase + pulse * .9 + vHi * (.5 + 1.3 * pulse);
        a *= uFocus > .5 && vHi < .5 ? .18 : 1.;
        gl_FragColor = vec4(vCol * a, 1.); }`,
  });
  return { lines: new LineSegments(g, m), uni };
}

/** Soft round sprite texture (glows, nebulae, fireflies). */
export function softTex(stops: Array<[number, string]>): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [o, col] of stops) r.addColorStop(o, col);
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  }
  const tx = new CanvasTexture(c);
  tx.colorSpace = SRGBColorSpace;
  return tx;
}

export function skyDome(top: string, hor: string, ground: string) {
  const uni = { uTop: { value: lin(top) }, uHor: { value: lin(hor) }, uGround: { value: lin(ground) } };
  const mesh = new Mesh(
    new SphereGeometry(1400, 32, 16),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: uni,
      vertexShader: `varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform vec3 uTop, uHor, uGround; varying vec3 vD; void main() { float h = vD.y;
        vec3 c = h > 0. ? mix(uHor, uTop, pow(h, .55)) : mix(uHor, uGround, pow(-h, .4)); gl_FragColor = vec4(c, 1.); }`,
    }),
  );
  const set = (t: string, h: string, g: string) => {
    uni.uTop.value.copy(lin(t));
    uni.uHor.value.copy(lin(h));
    uni.uGround.value.copy(lin(g));
  };
  return { mesh, set };
}

/** Frosted glass: tinted body, Fresnel-bright edges, soft moving sheen. */
export function glassShader(U: Shared, tint: string, glow: string, body: number) {
  const uni = { uTint: { value: lin(tint) }, uGlow: { value: lin(glow) }, uTime: U.uTime, uBody: { value: body } };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: uni,
    vertexShader: `varying vec3 vN, vW; void main() { vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uTint, uGlow; uniform float uTime, uBody; varying vec3 vN, vW;
      void main() { vec3 n = normalize(vN), V = normalize(cameraPosition - vW); float fr = pow(1. - abs(dot(n, V)), 2.4);
        float sheen = smoothstep(.0, 1., sin(vW.x * .05 + vW.y * .09 - uTime * .25) * .5 + .5) * .1;
        vec3 c = uTint * (uBody + fr * .9) + uGlow * (fr * .35 + sheen); gl_FragColor = vec4(c, clamp(uBody + fr * .55 + sheen, 0., .85)); }`,
  });
  return { mat, uni };
}

const SIGN_FONT = '600 48px "IBM Plex Sans Arabic", Manrope, sans-serif';

function signTexture(text: string, color: string, bg: string | null, rtl: boolean) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  if (!g) return { tex: new CanvasTexture(c), aspect: 1 };
  const fs = 48;
  g.font = SIGN_FONT;
  c.width = Math.ceil(g.measureText(text).width + 40);
  c.height = fs + 28;
  if (bg) {
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(2, 2, c.width - 4, c.height - 4, 16);
    g.fill();
  }
  g.font = SIGN_FONT;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.direction = rtl ? 'rtl' : 'ltr';
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return { tex, aspect: c.width / c.height };
}

/** Text sign drawn on a canvas. */
export function textSprite(text: string, color: string, h: number, bg: string | null, rtl: boolean): Sprite {
  const { tex, aspect } = signTexture(text, color, bg, rtl);
  const s = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  s.scale.set(h * aspect, h, 1);
  return s;
}

/** Redraws a sign sprite in place (new language or theme), freeing the old texture. */
export function retextSprite(s: Sprite, text: string, color: string, h: number, bg: string | null, rtl: boolean) {
  const { tex, aspect } = signTexture(text, color, bg, rtl);
  s.material.map?.dispose();
  s.material.map = tex;
  s.material.needsUpdate = true;
  s.scale.set(h * aspect, h, 1);
}

type Disposable = { dispose: () => void };
const isTexture = (v: unknown): v is Texture =>
  !!v && typeof v === 'object' && (v as { isTexture?: boolean }).isTexture === true;

/** Free GPU memory: geometries, instance buffers, materials and any textures they hold. */
export function disposeTree(root: Object3D) {
  root.traverse((o) => {
    if (o instanceof InstancedMesh) o.dispose();
    // Sprites share one geometry across the whole of three.js: never dispose it.
    const geo = (o as { geometry?: Disposable }).geometry;
    if (!(o instanceof Sprite) && geo) geo.dispose();
    const mats = (o as { material?: unknown }).material;
    const list = (Array.isArray(mats) ? mats : mats ? [mats] : []) as Array<
      Disposable & { uniforms?: Record<string, { value: unknown }>; map?: Texture | null }
    >;
    for (const m of list) {
      for (const u of Object.values(m.uniforms ?? {})) if (isTexture(u.value)) u.value.dispose();
      m.map?.dispose();
      m.dispose();
    }
  });
}
