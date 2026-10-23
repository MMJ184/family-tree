import { CustomBlending, DoubleSide, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, Vector4 } from 'three';
import { NOISE, type Shared } from '../gl.ts';
import { lin } from '../palette.ts';

// Family Galaxy materials: the GPU star field (one Points draw for bulge, arms, disk, HII knots and
// the far sky) and the unresolved galaxy light (one disk plane with arms, dust lanes and nebulae).
// Both share the spiral: angle = arm phase + offset across the arm + ln(r / rc) * wind.

export const MAX_ARMS = 16;
export const MAX_GENS = 24;

export interface GalaxyLook {
  dark: boolean;
  top: string;
  hor: string;
  ground: string;
  core: string;
  warm: string;
  blue: string;
  pink: string;
  link: string;
  ring: string;
  haze: number;
  stars: number;
  bloom: number;
  exposure: number;
}

export const LOOK: { dark: GalaxyLook; light: GalaxyLook } = {
  dark: {
    dark: true,
    top: '#000000',
    hor: '#02030a',
    ground: '#000000',
    core: '#ffe3b0',
    warm: '#ffc98a',
    blue: '#9fc2ff',
    pink: '#ff5fa2',
    link: '#b9d4ff',
    ring: '#ffcf7a',
    haze: 1,
    stars: 1,
    bloom: 0.85,
    exposure: 1.0,
  },
  light: {
    dark: false,
    top: '#1c1f4f',
    hor: '#33357a',
    ground: '#181a44',
    core: '#ffe6bd',
    warm: '#ffcf96',
    blue: '#b4cfff',
    pink: '#ff74b0',
    link: '#d4e3ff',
    ring: '#ffd793',
    haze: 0.85,
    stars: 0.95,
    bloom: 0.5,
    exposure: 1.0,
  },
};

/** Shared GLSL: spiral angle, arm taper and the birth year of a radius (the galaxy grows outward). */
const SPIRAL = /* glsl */ `
  uniform float uRc, uWind, uR, uGR[${MAX_GENS}], uGY[${MAX_GENS}];
  uniform int uNG;
  float taperR(float r) { return clamp(.35 + .65 * (r / uRc - 1.) * .5, .35, 1.); }
  float birthAt(float r) { float b = uGY[0]; for (int i = 1; i < ${MAX_GENS}; i++) { if (i >= uNG) break; if (r > uGR[i] - 1.5) b = uGY[i]; } return b; }`;

export interface SpiralUniforms {
  uRc: { value: number };
  uWind: { value: number };
  uR: { value: number };
  uGR: { value: number[] };
  uGY: { value: number[] };
  uNG: { value: number };
}

/**
 * Star particles. Attributes: position (kind-specific), aK (kind, arm span, height, radial jitter),
 * aC (tint rgb, phase), aS (world size). Kinds: 0 bulge, 1 arm star, 2 disk, 3 HII knot, 4 far sky.
 * Arm stars and knots slide along their log spiral (which reads as the arms turning); bulge and disk
 * rotate differentially.
 */
export function starMat(U: Shared, S: SpiralUniforms) {
  const uni = {
    ...U,
    ...S,
    uFocus: { value: 0 },
    uPR: { value: 1 },
    uWarm: { value: lin('#000000') },
    uBlue: { value: lin('#000000') },
    uPink: { value: lin('#000000') },
    uGain: { value: 1 },
    uLmin: { value: 0 },
    uLmax: { value: 1 },
    uSz: { value: 1 },
  };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    uniforms: uni,
    vertexShader: /* glsl */ `
      ${SPIRAL}
      attribute vec4 aK, aC; attribute float aS;
      uniform float uTime, uYear, uEnter, uMinYear, uPR, uGain, uLmin, uLmax, uSz;
      uniform vec3 uWarm, uBlue, uPink;
      varying vec3 vCol; varying float vA, vSpike;
      void main() {
        float kind = aK.x; vec3 p; float r = 0.;
        float yr = mix(uMinYear - 3., uYear, uEnter);
        float tw = .75 + .25 * sin(uTime * (.7 + fract(aC.w) * 1.6) + aC.w * 6.28);
        if (kind > 3.5) { p = position; r = 0.; vCol = aC.rgb; vA = tw; }
        else if (kind > .5 && kind < 1.5 || kind > 2.5) {
          // Slide along the arm: a log spiral turned by d(theta) is the same spiral scaled.
          float span = uLmax - uLmin;
          float l = uLmin + mod(position.x - uLmin - uTime * .006, span);
          r = uRc * exp(l) * (1. + aK.w);
          float th = position.y + position.z * aK.y * taperR(r) + l * uWind;
          p = vec3(cos(th) * r, aK.z, sin(th) * r);
          float k = smoothstep(uLmin, uLmin + span * .08, l) * smoothstep(uLmax, uLmax - span * .25, l);
          float t = smoothstep(uRc * .4, uR * .9, r);
          vCol = kind > 2.5 ? uPink * aC.rgb : mix(uWarm, uBlue, t) * aC.rgb;
          vA = k * tw * (kind > 2.5 ? 1.2 : 1.);
        } else {
          // Bulge and disk: differential rotation (flat rotation curve, faster inside).
          r = position.x;
          float th = position.y + uTime * .05 * uRc / (r + uRc * .6);
          p = vec3(cos(th) * r, position.z, sin(th) * r);
          float t = smoothstep(uRc * .5, uR, r);
          vCol = (kind < .5 ? uWarm : mix(uWarm, uBlue, t * .7)) * aC.rgb;
          vA = tw;
        }
        if (kind < 3.5) vA *= smoothstep(birthAt(r), birthAt(r) + 4., yr) * uGain;
        vSpike = step(2.4, aS) * step(kind, 1.5) * step(.5, kind);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        float px = kind > 3.5 ? aS * uPR : aS * uSz * uPR * 900. / -mv.z;
        gl_PointSize = clamp(px, 1., 40.);
        vA *= min(1., px * px);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFocus; varying vec3 vCol; varying float vA, vSpike;
      void main() {
        vec2 q = gl_PointCoord - .5; float d = length(q); if (d > .5) discard;
        float a = exp(-d * d * 28.) + exp(-d * 9.) * .25;
        a += vSpike * (exp(-abs(q.x) * 70.) * exp(-abs(q.y) * 7.) + exp(-abs(q.y) * 70.) * exp(-abs(q.x) * 7.)) * .6;
        a *= vA * (1. - uFocus * .5) * smoothstep(.5, .35, d);
        gl_FragColor = vec4(vCol * a, 0.); }`,
  });
  return { mat, uni };
}

/**
 * Unresolved galaxy light on a disk plane: warm bulge, exponential disk, blue arms with dust lanes on
 * their inner edge and pink HII nebulae just downstream. Premultiplied output: rgb adds light, alpha is
 * the dust that darkens what lies behind.
 */
export function hazeMat(U: Shared, S: SpiralUniforms, arms: Vector4[]) {
  const uni = {
    ...U,
    ...S,
    uFocus: { value: 0 },
    uArms: { value: arms },
    uNA: { value: arms.length },
    uCore: { value: lin('#000000') },
    uWarm: { value: lin('#000000') },
    uBlue: { value: lin('#000000') },
    uPink: { value: lin('#000000') },
    uGain: { value: 1 },
  };
  while (uni.uArms.value.length < MAX_ARMS) uni.uArms.value.push(new Vector4());
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      ${SPIRAL}
      ${NOISE}
      uniform float uTime, uYear, uEnter, uMinYear, uFocus, uGain; uniform vec4 uArms[${MAX_ARMS}]; uniform int uNA;
      uniform vec3 uCore, uWarm, uBlue, uPink;
      varying vec2 vP;
      float fbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += noise(p) * a; p = p * 2.03 + 17.1; a *= .5; } return s; }
      void main() {
        vec2 p = vec2(vP.x, -vP.y); float r = length(p), th = atan(p.y, p.x);
        float yr = mix(uMinYear - 3., uYear, uEnter);
        float grow = smoothstep(birthAt(r), birthAt(r) + 6., yr);
        // Clumps drift with differential rotation inside the fixed arm envelope.
        float rot = uTime * .05 * uRc / (r + uRc * .6);
        vec2 q = vec2(cos(th - rot), sin(th - rot)) * r;
        float n1 = fbm(q * .16), n2 = fbm(q * .45 + 3.), n3 = fbm(q * .9 - 7.);
        float lw = log(max(r, .01) / uRc) * uWind;
        float arm = 0., dust = 0., hii = 0.;
        for (int i = 0; i < ${MAX_ARMS}; i++) {
          if (i >= uNA) break;
          vec4 A = uArms[i];
          float d = th - (A.x + lw); d = mod(d + 3.14159, 6.28318) - 3.14159;
          float hw = max(A.y * taperR(r) * .5, .04) + 1.2 / max(r, 1.);
          float u = d / hw;
          arm += exp(-u * u * 1.6) * A.z;
          dust += exp(-pow((u - .85) * 2.8, 2.)) * A.z;
          hii += exp(-pow((u + .25) * 2.2, 2.)) * A.z;
        }
        float inner = smoothstep(uRc * .45, uRc * 1.4, r), outer = 1. - smoothstep(uR * .75, uR * 1.25, r);
        float bulge = exp(-pow(r / (uRc * .32), 1.1));
        float disk = exp(-r / (uR * .35)) * outer;
        float a = arm * inner * outer;
        vec3 armC = mix(uWarm, uBlue, smoothstep(uRc, uR * .8, r));
        vec3 col = uCore * bulge * .9 + uWarm * disk * .1 + armC * a * (.3 + .4 * n1) * (.55 + .8 * n2);
        float knots = smoothstep(.58, .78, n3) * hii * inner * outer;
        col += uPink * knots * .4;
        float lane = clamp(dust * inner * outer * smoothstep(.35, .75, n2 + n1 * .5), 0., 1.);
        col *= 1. - lane * .85;
        col *= grow * uGain * (1. - uFocus * .45);
        float alpha = lane * .55 * grow * outer;
        // Fade out the plane's square edge.
        float edge = 1. - smoothstep(uR * 1.05, uR * 1.3, r);
        gl_FragColor = vec4(col * edge, alpha * edge); }`,
  });
  return { mat, uni };
}
