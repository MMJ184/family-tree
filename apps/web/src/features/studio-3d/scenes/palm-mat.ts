import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  DoubleSide,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from 'three';
import { NOISE, type Shared } from '../gl.ts';
import { lin } from '../palette.ts';

// Date Palm Oasis materials. One shared set of "light" uniforms (sun or moon, sky, fog, lantern)
// feeds every shader, so tint() and the RTL mirror only touch one place.

export interface PalmLook {
  night: boolean;
  top: string;
  hor: string;
  sun: string;
  sky: string;
  bounce: string;
  sand: string;
  sandShade: string;
  soil: string;
  frond: string;
  dry: string;
  trunk: string;
  trunkDark: string;
  water: string;
  bank: string;
  lamp: string;
  bloom: number;
  exposure: number;
}

export const LOOK: { light: PalmLook; dark: PalmLook } = {
  light: {
    night: false,
    top: '#5f8fbf',
    hor: '#f6c992',
    sun: '#ffd49a',
    sky: '#b4c8dc',
    bounce: '#e9b47a',
    sand: '#efc48a',
    sandShade: '#c08350',
    soil: '#b98f60',
    frond: '#7e9a52',
    dry: '#c49a5a',
    trunk: '#9a7550',
    trunkDark: '#4f3926',
    water: '#1f8794',
    bank: '#c9a273',
    lamp: '#ffb24d',
    bloom: 0.16,
    exposure: 0.96,
  },
  dark: {
    night: true,
    top: '#02040d',
    hor: '#17204a',
    sun: '#b4c4ff',
    sky: '#3a4a85',
    bounce: '#3a3550',
    sand: '#8a86a8',
    sandShade: '#2e2f4c',
    soil: '#3f4560',
    frond: '#7fb294',
    dry: '#8a7458',
    trunk: '#5a463c',
    trunkDark: '#1f1714',
    water: '#1e4a6e',
    bank: '#5f5873',
    lamp: '#ffaa48',
    bloom: 0.62,
    exposure: 1.05,
  },
};

export function makeLight() {
  return {
    uSun: { value: new Vector3(-0.42, 0.2, -0.88).normalize() },
    /** Where the sun or moon disc is drawn: lower than the light so it shows above the dunes. */
    uDisc: { value: new Vector3(-0.42, 0.08, -0.9).normalize() },
    uSunCol: { value: lin('#000000') },
    uSkyCol: { value: lin('#000000') },
    uBounce: { value: lin('#000000') },
    uFogCol: { value: lin('#000000') },
    uFogNear: { value: 200 },
    uFogFar: { value: 900 },
    uLamp: { value: lin('#000000') },
    uNight: { value: 0 },
    uCamLod: { value: 200 },
  };
}
export type Light = ReturnType<typeof makeLight>;

const LIGHT_HEAD = /* glsl */ `
  uniform vec3 uDisc, uSun, uSunCol, uSkyCol, uBounce, uFogCol, uLamp; uniform float uFogNear, uFogFar, uNight;
  vec3 fogged(vec3 c, float d) { return mix(c, uFogCol, smoothstep(uFogNear, uFogFar, d)); }`;

/** Shared palm maths: growth by year, a curved trunk and a gentle crown sway. Mirrored on the CPU by palmCrown(). */
const PALM = /* glsl */ `
  uniform float uYear, uEnter, uMinYear, uTime, uFocus;
  attribute vec4 aPalm; attribute vec2 aLean, aLife; attribute float aHi;
  float yrNow() { return mix(uMinYear - 3., uYear, uEnter); }
  float hNow(float yr) { return aPalm.z * (.3 + .7 * smoothstep(aLife.x, aLife.x + 9., yr)); }
  vec3 trunkAt(float y01, float hn) {
    float k = pow(y01, 1.7);
    vec2 sw = vec2(sin(uTime * .55 + aPalm.w), cos(uTime * .43 + aPalm.w * 1.3)) * hn * .012;
    vec2 o = aLean * hn * k + sw * k * k;
    return vec3(aPalm.x + o.x, y01 * hn, aPalm.y + o.y);
  }
  const vec4 HIDE = vec4(0., 0., -2., 1.);`;

const FOCUS = /* glsl */ `c = mix(c, c * 1.18, vHi); c = mix(c, c * .32, uFocus * (1. - step(.5, vHi)));`;

/** Palm trunks: a curved, tapering column covered in the diamond pattern of old leaf bases. */
export function trunkMat(U: Shared, L: Light) {
  const uni = { ...U, ...L, uFocus: { value: 0 }, uA: { value: lin('#000000') }, uB: { value: lin('#000000') } };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `${PALM}
      varying vec2 vUv; varying vec3 vN, vW; varying float vHi, vY, vDead, vDepth;
      void main() { float yr = yrNow(); if (yr < aLife.x - .2) { gl_Position = HIDE; return; }
        float hn = hNow(yr); float y = position.y;
        float r = aPalm.z * (.028 + .012 * (1. - y)) * (.55 + .45 * hn / aPalm.z) + aPalm.z * .035 * exp(-y * 14.);
        vec3 c = trunkAt(y, hn);
        vec3 w = c + vec3(position.x * r, 0., position.z * r);
        vN = normalize(vec3(position.x, .15, position.z)); vW = w; vY = y * hn;
        vUv = vec2(uv.x * 9., y * hn / (aPalm.z * .062)); vHi = aHi; vDead = step(aLife.y, yr);
        vec4 mv = viewMatrix * vec4(w, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${LIGHT_HEAD} uniform float uFocus, uTime; uniform vec3 uA, uB;
      varying vec2 vUv; varying vec3 vN, vW; varying float vHi, vY, vDead, vDepth;
      void main() {
        float a = fract(vUv.x + vUv.y), b = fract(vUv.x - vUv.y);
        float d = min(min(a, 1. - a), min(b, 1. - b));
        float crev = smoothstep(.02, .16, d);
        float cell = fract(vUv.y + .5 * step(.5, fract(vUv.x)));
        vec3 base = mix(uB, uA, crev * (.55 + .45 * cell));
        vec3 n = normalize(vN);
        float dif = max(dot(n, uSun), 0.);
        vec3 c = base * (mix(uBounce, uSkyCol, n.y * .5 + .5) * .7 + uSunCol * dif * 1.25);
        vec3 V = normalize(cameraPosition - vW);
        c += uSunCol * pow(1. - max(dot(n, V), 0.), 3.) * .12 * (1. - uNight);
        c += uLamp * uNight * exp(-vY * .8) * .3 * (1. - vDead * .6);
        ${FOCUS}
        gl_FragColor = vec4(fogged(c, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Pinnate frond texture: a rachis with leaflets angled toward the tip, short spines at the base. */
export function frondTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const g = c.getContext('2d');
  if (g) {
    g.strokeStyle = '#fff';
    g.lineCap = 'round';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(64, 508);
    g.lineTo(64, 6);
    g.stroke();
    const n = 46;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const y = 500 - t * 490;
      const spine = t < 0.16;
      const len = spine ? 14 + t * 90 : 60 * Math.sin(Math.PI * Math.min(1, (t - 0.1) / 0.92)) ** 0.55 + 4;
      for (const s of [-1, 1]) {
        const off = s * (i % 2 ? 1 : 0.94);
        g.lineWidth = spine ? 2.5 : 4.5;
        g.beginPath();
        g.moveTo(64, y);
        g.quadraticCurveTo(64 + off * len * 0.55, y - len * 0.42, 64 + off * len, y - len * 0.72);
        g.stroke();
      }
    }
  }
  const tx = new CanvasTexture(c);
  tx.colorSpace = SRGBColorSpace;
  tx.anisotropy = 4;
  return tx;
}

/** Fronds: instanced arching blades with a vertex-shader sway; back-lit by the low sun. Far palms drop every other frond. */
export function frondMat(U: Shared, L: Light, tex: Texture) {
  const uni = {
    ...U,
    ...L,
    uFocus: { value: 0 },
    uTex: { value: tex },
    uLeaf: { value: lin('#000000') },
    uDry: { value: lin('#000000') },
  };
  const mat = new ShaderMaterial({
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `${PALM} uniform float uCamLod; attribute vec4 aFr; attribute vec3 aCol;
      varying vec2 vUv; varying vec3 vN, vW, vCol; varying float vHi, vDead, vDepth;
      void main() { float yr = yrNow(); if (yr < aLife.x - .2) { gl_Position = HIDE; return; }
        float hn = hNow(yr); vec3 crown = trunkAt(1., hn);
        float far = distance(cameraPosition, crown);
        if (aFr.w > .5 && far > uCamLod) { gl_Position = HIDE; return; }
        float dead = smoothstep(aLife.y, aLife.y + 3., yr);
        float t = position.y, ph = aPalm.w + aFr.x * 3.;
        float gust = sin(uTime * .7 + aPalm.x * .05 + aPalm.y * .04) * .5 + .5;
        float az = aFr.x + sin(uTime * 1.1 + ph) * .035 * (.5 + gust);
        float pitch = aFr.y + (sin(uTime * 1.6 + ph * 1.7) * .05 - .03) * (.4 + gust) * t - dead * .3;
        float Ln = aFr.z * hn * (far > uCamLod ? 1.1 : 1.);
        vec3 d = vec3(cos(pitch) * cos(az), sin(pitch), cos(pitch) * sin(az));
        vec3 side = vec3(-sin(az), 0., cos(az));
        float droop = .28 + max(0., -aFr.y) * .6 + dead * .15;
        vec3 p = crown + d * t * Ln; p.y -= droop * t * t * Ln;
        float wid = Ln * .3 * (far > uCamLod ? 1.25 : 1.);
        p += side * position.x * wid;
        p.y += abs(position.x) * wid * .55 * (1. - t * .4);
        vec3 tg = normalize(d * Ln - vec3(0., 2. * droop * t * Ln, 0.));
        vN = normalize(cross(side, tg)); if (vN.y < 0.) vN = -vN;
        vUv = uv; vW = p; vCol = aCol; vHi = aHi; vDead = dead;
        vec4 mv = viewMatrix * vec4(p, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${LIGHT_HEAD} uniform sampler2D uTex; uniform vec3 uLeaf, uDry; uniform float uFocus;
      varying vec2 vUv; varying vec3 vN, vW, vCol; varying float vHi, vDead, vDepth;
      void main() { if (texture2D(uTex, vUv).a < .42) discard;
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW);
        vec3 base = mix(uLeaf * vCol, uDry, vDead * .45) * (.62 + .5 * vUv.y);
        float dif = abs(dot(n, uSun));
        float trans = pow(max(dot(-V, uSun), 0.), 5.) * (1. - uNight) * .9;
        vec3 c = base * (mix(uBounce, uSkyCol, n.y * .5 + .5) * .75 + uSunCol * (dif * 1.1 + trans));
        c += uLamp * uNight * smoothstep(10., 0., vW.y) * .28;
        ${FOCUS}
        gl_FragColor = vec4(fogged(c, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Date clusters under the crown: ripen from yellow (khalal) to amber and deep red as the person ages. */
export function dateMat(U: Shared, L: Light) {
  const uni = { ...U, ...L, uFocus: { value: 0 } };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `${PALM} attribute float aDir;
      varying vec3 vN, vW; varying float vHi, vRipe, vDepth;
      void main() { float yr = yrNow(); float age = yr - aLife.x;
        if (age < 16. || yr > aLife.y) { gl_Position = HIDE; return; }
        float hn = hNow(yr); vec3 crown = trunkAt(1., hn);
        float s = hn * .085 * smoothstep(16., 19., age);
        vec2 o = vec2(cos(aDir), sin(aDir));
        float sw = sin(uTime * 1.3 + aPalm.w + aDir) * .04;
        vec3 p = position; p.xz += o * p.y * -sw * 4.;
        vec3 w = crown + vec3(o.x, 0., o.y) * hn * .07 - vec3(0., hn * .02, 0.) + p * s;
        vN = normalize(normal); vW = w; vHi = aHi; vRipe = clamp((age - 16.) / 40., 0., 1.);
        vec4 mv = viewMatrix * vec4(w, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${LIGHT_HEAD} uniform float uFocus;
      varying vec3 vN, vW; varying float vHi, vRipe, vDepth;
      void main() { vec3 n = normalize(vN), V = normalize(cameraPosition - vW);
        vec3 base = mix(mix(vec3(.95, .72, .18), vec3(.78, .36, .08), smoothstep(0., .5, vRipe)), vec3(.42, .12, .05), smoothstep(.5, 1., vRipe));
        float dif = max(dot(n, uSun), 0.);
        float sp = pow(max(dot(reflect(-uSun, n), V), 0.), 24.) * .5;
        vec3 c = base * (mix(uBounce, uSkyCol, n.y * .5 + .5) * .55 + uSunCol * dif) + uSunCol * sp;
        c += uLamp * uNight * .25 * base;
        ${FOCUS}
        gl_FragColor = vec4(fogged(c, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Irrigation basin (hawdh) at each palm's foot: damp soil inside a raised earthen rim. */
export function basinMat(U: Shared, L: Light) {
  const uni = { ...U, ...L, uFocus: { value: 0 }, uSoil: { value: lin('#000000') }, uRim: { value: lin('#000000') } };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: uni,
    vertexShader: /* glsl */ `${PALM}
      varying vec2 vQ; varying float vHi, vDepth, vA;
      void main() { float yr = yrNow(); if (yr < aLife.x - .2) { gl_Position = HIDE; return; }
        float hn = hNow(yr); float R = hn * .14 + .7;
        vec3 w = vec3(aPalm.x + position.x * R, .07, aPalm.y - position.y * R);
        vQ = position.xy; vHi = aHi; vA = smoothstep(aLife.x - .2, aLife.x + .8, yr);
        vec4 mv = viewMatrix * vec4(w, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${LIGHT_HEAD} uniform vec3 uSoil, uRim; uniform float uFocus;
      varying vec2 vQ; varying float vHi, vDepth, vA;
      void main() { float r = length(vQ); if (r > 1.) discard;
        float rim = smoothstep(.62, .8, r) * (1. - smoothstep(.86, 1., r));
        vec3 c = mix(uSoil * .72, uRim, rim);
        c *= mix(uBounce, uSkyCol, .5) * .5 + uSunCol * (.55 + rim * .5) * (1. - uNight * .5);
        c += uLamp * uNight * (1. - r) * .6;
        ${FOCUS}
        float a = smoothstep(1., .9, r) * vA;
        gl_FragColor = vec4(fogged(c, vDepth), a); }`,
  });
  return { mat, uni };
}

/** Falaj channels: plastered banks around flowing water that mirrors the sky; light runs along the selected lineage. */
export function falajMat(U: Shared, L: Light) {
  const uni = {
    ...U,
    ...L,
    uFocus: { value: 0 },
    uWater: { value: lin('#000000') },
    uBank: { value: lin('#000000') },
    uTop: { value: lin('#000000') },
  };
  const mat = new ShaderMaterial({
    depthWrite: false,
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aT, aS, aBirth, aHi, aLen;
      varying float vT, vS, vBirth, vHi, vLen, vDepth; varying vec3 vW;
      void main() { vT = aT; vS = aS; vBirth = aBirth; vHi = aHi; vLen = aLen; vW = position;
        vec4 mv = viewMatrix * vec4(position, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${LIGHT_HEAD} ${NOISE} uniform float uYear, uEnter, uMinYear, uTime, uFocus; uniform vec3 uWater, uBank, uTop;
      varying float vT, vS, vBirth, vHi, vLen, vDepth; varying vec3 vW;
      void main() { float yr = mix(uMinYear - 3., uYear, uEnter);
        float g = clamp((yr - vBirth) / 1.5, 0., 1.); if (vT > g) discard;
        float s = abs(vS); float along = vT * vLen;
        vec3 V = normalize(cameraPosition - vW);
        vec3 c;
        if (s > .56) {
          float edge = smoothstep(.56, .66, s) * (1. - smoothstep(.9, 1., s));
          c = uBank * (.7 + .3 * edge) * (mix(uBounce, uSkyCol, .6) * .5 + uSunCol * (.5 + .4 * edge) * (1. - uNight * .5));
        } else {
          float rip = noise(vec2(vS * 5. + along * .3, along * 1.4 - uTime * 1.8)) * .6 + noise(vec2(vS * 11., along * 3. - uTime * 2.6)) * .4;
          float fr = pow(1. - max(V.y, 0.), 4.);
          vec3 refl = mix(uSkyCol * .9, uTop, .3) + uFogCol * fr * (1. - uNight * .6);
          c = mix(uWater, refl, (.12 + fr * .3 + rip * .08) * (1. - uNight * .4));
          vec3 Rv = reflect(-V, normalize(vec3((rip - .5) * .5, 1., (rip - .5) * .3)));
          c += uSunCol * pow(max(dot(Rv, uSun), 0.), 90.) * 2.2 * (1. - uNight * .5);
          c *= .78 + .22 * smoothstep(.56, .3, s);
          float flow = smoothstep(.9, 1., fract(vT * max(1., vLen * .06) - uTime * .25 + vBirth * .37));
          c += uLamp * uNight * .1 + (uNight > .5 ? uLamp : uWater * 1.5) * vHi * (.35 + flow * 1.2);
        }
        c = mix(c, c * .4, uFocus * (1. - step(.5, vHi)));
        c += uSunCol * 1.5 * smoothstep(g - .04, g, vT) * (1. - step(.999, g)) * step(s, .56);
        gl_FragColor = vec4(fogged(c, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Desert floor: a flat oasis bed that rises into wind-rippled dunes, lit by the low sun or the moon. */
export function sandMat(L: Light, grove: number) {
  const uni = {
    ...L,
    uSand: { value: lin('#000000') },
    uShade: { value: lin('#000000') },
    uSoil: { value: lin('#000000') },
    uG: { value: grove },
    uA: { value: grove * 0.07 + 7 },
  };
  const H = /* glsl */ `${NOISE} uniform float uG, uA;
    float dune(vec2 p) {
      float r = length(p); float m = smoothstep(uG * 1.3, uG * 2.4, r);
      vec2 q = p / (uG * .7 + 60.);
      float n = noise(q * 1.3) * .62 + noise(q * 2.7 + 5.) * .28 + noise(q * 6.1 + 9.) * .1;
      float crest = 1. - abs(n * 2. - 1.);
      return m * uA * (crest * crest * .9 + n * .35) - .02;
    }`;
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `${H} varying vec3 vW, vN; varying float vDepth, vM;
      void main() { vec2 p = position.xy * vec2(1., -1.); float e = 2.5;
        float h = dune(p), hx = dune(p + vec2(e, 0.)), hz = dune(p + vec2(0., e));
        vN = normalize(vec3(h - hx, e, h - hz)); vW = vec3(p.x, h, p.y); vM = smoothstep(uG * .75 + noise(p * .05) * uG * .3, uG * 1.3, length(p));
        vec4 mv = viewMatrix * vec4(vW, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${LIGHT_HEAD} ${NOISE} uniform vec3 uSand, uShade, uSoil;
      varying vec3 vW, vN; varying float vDepth, vM;
      void main() { vec3 n = normalize(vN);
        float rip = sin(dot(vW.xz, vec2(.82, .57)) * 2.2 + noise(vW.xz * .08) * 9.) * .5 + .5;
        float speck = noise(vW.xz * 1.7);
        float patchy = smoothstep(.45, .75, noise(vW.xz * .09) * .7 + noise(vW.xz * .31) * .3);
        vec3 bed = mix(uSoil * (.85 + speck * .25), uSoil * vec3(.62, .78, .5), patchy * .55);
        vec3 alb = mix(bed, uSand * (.94 + rip * .08), vM);
        float dif = max(dot(n, uSun), 0.);
        float sh = smoothstep(0., .35, dif);
        vec3 c = mix(uShade, alb, .45 + .55 * sh) * (mix(uBounce, uSkyCol, .6) * .62 + uSunCol * dif * 1.05);
        c += uLamp * uNight * (1. - vM) * .025;
        gl_FragColor = vec4(fogged(c, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Sky: golden-hour gradient with a low sun, or a starry desert night with a crescent moon. */
export function skyMat(L: Light, U: Shared) {
  const uni = {
    ...L,
    uTop: { value: lin('#000000') },
    uHor: { value: lin('#000000') },
    uTime: U.uTime,
  };
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: uni,
    vertexShader: `varying vec3 vD; void main() { vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `${LIGHT_HEAD} uniform vec3 uTop, uHor; uniform float uTime; varying vec3 vD;
      float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() { vec3 d = normalize(vD); float h = d.y;
        vec3 c = mix(uHor, uTop, pow(clamp(h, 0., 1.), .5));
        c = mix(c, uFogCol, smoothstep(.06, -.02, h));
        float sd = max(dot(d, uDisc), 0.);
        if (uNight < .5) {
          c += uSunCol * (pow(sd, 6.) * .45 + pow(sd, 60.) * .6) ;
          c = mix(c, vec3(1., .93, .78) * 1.6, smoothstep(.9993, .9997, sd));
        } else {
          vec3 g = d * 260.; vec3 id = floor(g); vec3 f = fract(g) - .5;
          float st = step(.985, h3(id)) * smoothstep(.22, 0., length(f)) * smoothstep(.0, .25, h);
          st *= .6 + .4 * sin(uTime * 2. + h3(id + 3.) * 40.);
          c += vec3(.85, .9, 1.) * st * 1.4;
          float band = exp(-pow(dot(d, normalize(vec3(.3, .2, .93))) * 3., 2.)) * smoothstep(0., .4, h);
          c += vec3(.25, .27, .4) * band * .25;
          float m = smoothstep(.99955, .9997, sd);
          vec3 mo = normalize(uDisc + vec3(.012, .006, 0.));
          float cut = smoothstep(.99965, .9998, max(dot(d, mo), 0.));
          c = mix(c, vec3(1., .97, .86) * 1.5, m * (1. - cut));
          c += uSunCol * pow(sd, 120.) * .5;
        }
        gl_FragColor = vec4(c, 1.); }`,
  });
  return { mat, uni };
}

/** Lantern glow at each palm's foot (night only): a soft pool on the sand and a flickering flame. */
export function lampMat(U: Shared, L: Light, flame: boolean) {
  const uni = { ...U, ...L, uFocus: { value: 0 } };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: uni,
    vertexShader: /* glsl */ `${PALM}
      varying vec2 vQ; varying float vA, vHi;
      void main() { float yr = yrNow(); if (yr < aLife.x + .5) { gl_Position = HIDE; return; }
        float hn = hNow(yr); float R = hn * .14 + .7;
        float fl = .85 + .15 * sin(uTime * 9. + aPalm.w * 7.) * sin(uTime * 5.3 + aPalm.w);
        vA = (yr > aLife.y ? .35 : 1.) * fl * smoothstep(aLife.x + .5, aLife.x + 2., yr); vHi = aHi; vQ = position.xy;
        ${
          flame
            ? `vec3 c = vec3(aPalm.x + R * .82, .55, aPalm.y + R * .3); vec4 mv = viewMatrix * vec4(c, 1.); mv.xy += position.xy * .55; gl_Position = projectionMatrix * mv;`
            : `float s = R * 3.2; vec3 w = vec3(aPalm.x + position.x * s, .1, aPalm.y - position.y * s); gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);`
        } }`,
    fragmentShader: /* glsl */ `${LIGHT_HEAD} uniform float uFocus; varying vec2 vQ; varying float vA, vHi;
      void main() { float r = length(vQ) * 2.; if (r > 1.) discard;
        float k = ${flame ? 'exp(-r * r * 12.) * 3. + exp(-r * 3.) * .4' : 'exp(-r * r * 3.5) * .55'};
        k *= vA * (1. - uFocus * .7 * (1. - step(.5, vHi)));
        gl_FragColor = vec4(uLamp * k * uNight, 1.); }`,
  });
  return { mat, uni };
}
