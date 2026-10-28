import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LatheGeometry,
  Matrix3,
  Mesh,
  type PerspectiveCamera,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector4,
} from 'three';
import { NOISE, type Shared } from '../gl.ts';

// Lantern Lake GPU pieces: an instanced paper fanous (hexagonal lantern with a candle inside),
// its reflection on the lake as a column of ripple glints, screen-space thread ribbons that tie
// each lantern to its parent's, the sky and the rippled water, and one point cloud for halos,
// wedding glows and floating diyas. Every material reads the theme from `lakeUniforms()`.

/** Theme-driven values shared by the sky, the water, the lanterns, the threads and the glows. */
export function lakeUniforms() {
  return {
    uSkyTop: { value: new Color() },
    uSkyHor: { value: new Color() },
    uHill: { value: new Color() },
    uStars: { value: 0 },
    /** Water seen looking down, and the far water / mist it fades into. */
    uWater: { value: new Color() },
    uWaterFar: { value: new Color() },
    uMist: { value: 0 },
    /** Warm light of the lanterns on the water (night only). */
    uSheen: { value: 0 },
    uWarm: { value: new Color() },
    uPaper: { value: new Color() },
    uFrame: { value: new Color() },
    uHi: { value: new Color() },
    uGold: { value: new Color() },
    uThread: { value: new Color() },
    /** Hemisphere light for the day theme: sky above, the water's bounce below. */
    uSkyL: { value: new Color() },
    uGroundL: { value: new Color() },
    uDay: { value: 0 },
    uExpo: { value: 1 },
    /** Paper glow strength (candle through paper), the reflection strength and the threads' opacity. */
    uGlow: { value: 1 },
    uRefl: { value: 1 },
    uThreadA: { value: 0.5 },
    uFanR: { value: 60 },
    uFanC: { value: new Vector2() },
    /** Ripple rings: x, z, phase, strength (0 = unused). */
    uRings: { value: Array.from({ length: 8 }, () => new Vector4()) },
    uFocus: { value: 0 },
  };
}
export type LakeUni = ReturnType<typeof lakeUniforms>;

// Inverses of the matrices in three's ACESFilmicToneMapping, so backgrounds land on exact display colours.
const m3 = (m: Matrix3) => `mat3(${m.elements.map((e) => e.toFixed(6)).join(', ')})`;
const ACES_IN_INV = m3(
  new Matrix3().set(0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777).invert(),
);
const ACES_OUT_INV = m3(
  new Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602).invert(),
);
/** Display colour to scene colour: the ACES output pass then shows `c` as designed. */
const UNTONE = /* glsl */ `
  uniform float uExpo;
  vec3 untone(vec3 c) {
    c = clamp(${ACES_OUT_INV} * c, 0., .99);
    vec3 a = 1. - .983729 * c, b = .0245786 - .432951 * c, k = .000090537 + .238081 * c;
    vec3 v = (sqrt(b * b + 4. * a * k) - b) / (2. * a);
    return max(${ACES_IN_INV} * v, 0.) * (.6 / uExpo);
  }`;

const YEAR = /* glsl */ `float yr = mix(uMinYear - 3., uYear, uEnter);`;

// Sky colour (display space) for a view direction: neutral gradient, a low far shore, faint stars.
const SKY = /* glsl */ `
  uniform vec3 uSkyTop, uSkyHor, uHill; uniform float uStars;
  vec3 skyCol(vec3 d, float t, float stars) {
    float h = d.y;
    vec3 c = mix(uSkyHor, uSkyTop, smoothstep(0., .4, max(h, 0.)));
    float az = atan(d.x, -d.z);
    if (h < .03) {
      float hill = .007 + .011 * noise(vec2(az * 3.2, 1.7)) + .005 * noise(vec2(az * 14., 3.1));
      c = mix(c, uHill, (1. - smoothstep(hill - .0012, hill + .0012, h)) * step(-.001, h));
    }
    if (stars > 0. && uStars > 0.) {
      // one soft dot in a few cells of an azimuth / elevation grid, twinkling slowly
      vec2 sp = vec2(az, asin(clamp(h, -1., 1.))) * 115.;
      vec2 ci = floor(sp), cf = fract(sp) - .5;
      float hs = hash(ci);
      vec2 off = vec2(hash(ci + 7.13), hash(ci + 3.71)) - .5;
      float st = step(.968, hs) * smoothstep(.2, .03, length(cf - off * .55));
      st *= (.25 + .75 * hash(ci + 1.9)) * (.62 + .38 * sin(t * (.6 + 2.2 * hash(ci + 5.3)) + hs * 60.));
      c += vec3(.8, .83, .9) * st * uStars * stars * smoothstep(.04, .3, h);
    }
    return c;
  }`;

export function skyMesh(u: LakeUni, U: Shared) {
  const mesh = new Mesh(
    new SphereGeometry(1300, 48, 24),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: { ...u, uTime: U.uTime },
      vertexShader: `varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: /* glsl */ `${NOISE}${SKY}${UNTONE}
        uniform vec3 uWaterFar; uniform float uTime; varying vec3 vD;
        void main() { vec3 d = normalize(vD); gl_FragColor = vec4(untone(d.y >= 0. ? skyCol(d, uTime, 1.) : uWaterFar), 1.); }`,
    }),
  );
  mesh.renderOrder = -10;
  return mesh;
}

/** The lake: rippled water reflecting the sky, ripple rings around floating lamps, mist by day. */
export function waterMesh(u: LakeUni, U: Shared) {
  const geo = new CircleGeometry(1400, 96);
  geo.rotateX(-Math.PI / 2);
  const mesh = new Mesh(
    geo,
    new ShaderMaterial({
      depthWrite: false,
      uniforms: { ...u, uTime: U.uTime },
      vertexShader: `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `${NOISE}${SKY}${UNTONE}
        uniform vec3 uWater, uWaterFar, uWarm; uniform float uTime, uDay, uMist, uSheen, uFanR; uniform vec2 uFanC;
        uniform vec4 uRings[8];
        varying vec3 vW;
        float wave(vec2 p) {
          return noise(p * .075 + vec2(uTime * .03, uTime * .018)) + noise(p * .21 - vec2(uTime * .05, -uTime * .04)) * .5;
        }
        void main() {
          vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC / dist;
          vec2 p = vW.xz; float e = .6;
          float w0 = wave(p);
          vec2 g = vec2(wave(p + vec2(e, 0.)) - w0, wave(p + vec2(0., e)) - w0) / e;
          g *= .55 * (1. - smoothstep(60., 520., dist));
          // rings spreading from the floating lamps and from under the lowest lantern
          float rg = 0.;
          for (int i = 0; i < 8; i++) {
            vec4 r = uRings[i];
            if (r.w <= 0.) continue;
            vec2 d = p - r.xy; float L = length(d) + 1e-3;
            if (L > 8.5 * r.w) continue;
            for (int k = 0; k < 2; k++) {
              float ph = fract(uTime * .07 + r.z + float(k) * .5);
              float R = ph * 7. * r.w;
              float env = exp(-pow((L - R) / (.3 + ph * .8), 2.)) * (1. - ph) * smoothstep(0., .12, ph);
              g += d / L * cos((L - R) * 6.) * env * .45;
              rg += env * r.w;
            }
          }
          vec3 n = normalize(vec3(-g.x, 1., -g.y));
          float fr = .02 + .98 * pow(1. - max(dot(n, V), 0.), 5.);
          vec3 R = reflect(-V, n); R.y = abs(R.y);
          // the ripples break the stars' reflections up, so the water keeps only the sky's gradient
          vec3 col = mix(uWater, skyCol(R, uTime, 0.), clamp(fr, 0., 1.));
          // the lanterns' warm light on the water (night): broad, faint, broken by the ripples
          float fan = exp(-pow(length(p - uFanC) / uFanR, 2.));
          col += uWarm * uSheen * (fan * (.35 + 6. * max(dot(n.xz, normalize(uFanC - p + 1e-3)), 0.)) + rg * .3);
          // slow drifting mist by day
          if (uMist > 0.) {
            float mist = noise(p * .011 + vec2(uTime * .012, 0.)) * noise(p * .027 - vec2(0., uTime * .017));
            col = mix(col, uWaterFar, uMist * smoothstep(.12, .45, mist));
          }
          col = mix(col, uWaterFar, smoothstep(90., 780., dist));
          gl_FragColor = vec4(untone(col), 1.);
        }`,
    }),
  );
  mesh.renderOrder = -9;
  return mesh;
}

/** Hexagonal fanous, unit body radius about 0.41, from -0.7 (bottom finial) to 0.74 (top knob). */
function fanousProfile(big: boolean) {
  const full: Array<[number, number]> = [
    [0, -0.7],
    [0.026, -0.665],
    [0.05, -0.61],
    [0.03, -0.565],
    [0.06, -0.525],
    [0.17, -0.475],
    [0.27, -0.435],
    [0.33, -0.405],
    [0.345, -0.375],
    [0.362, -0.362],
    [0.396, -0.18],
    [0.41, 0],
    [0.396, 0.18],
    [0.362, 0.335],
    [0.368, 0.35],
    [0.338, 0.37],
    [0.358, 0.392],
    [0.3, 0.45],
    [0.22, 0.52],
    [0.13, 0.575],
    [0.07, 0.61],
    [0.05, 0.645],
    [0.068, 0.675],
    [0.042, 0.705],
    [0.03, 0.725],
    [0, 0.74],
  ];
  // Large families: the same silhouette with fewer rings.
  const lite = new Set([1, 3, 6, 15, 18, 20, 22, 24]);
  const pts = big ? full.filter((_, i) => !lite.has(i)) : full;
  return pts.map(([x, y]) => new Vector2(x, y));
}

export interface LanternInst {
  pos: Float32Array;
  scale: Float32Array;
  birth: Float32Array;
  death: Float32Array;
  phase: Float32Array;
}

/** Shared per-person attributes: the lanterns and their reflections use the same buffers (one aHi). */
export function lanternAttrs(inst: LanternInst) {
  return {
    aP: new InstancedBufferAttribute(inst.pos, 3),
    aS: new InstancedBufferAttribute(inst.scale, 1),
    aBirth: new InstancedBufferAttribute(inst.birth, 1),
    aDeath: new InstancedBufferAttribute(inst.death, 1),
    aPh: new InstancedBufferAttribute(inst.phase, 1),
    aHi: new InstancedBufferAttribute(new Float32Array(inst.scale.length), 1),
  };
}
export type LanternAttrs = ReturnType<typeof lanternAttrs>;

export function lanternGeometry(at: LanternAttrs, keys: string[], big: boolean) {
  // Flat-shaded facets: non-indexed so every face keeps its own normal.
  const lathe = new LatheGeometry(fanousProfile(big), 6).toNonIndexed();
  lathe.computeVertexNormals();
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('position', lathe.getAttribute('position'));
  geo.setAttribute('normal', lathe.getAttribute('normal'));
  lathe.dispose();
  for (const [k, a] of Object.entries(at)) geo.setAttribute(k, a);
  geo.userData.keys = keys;
  geo.instanceCount = keys.length;
  return geo;
}

const BOB = /* glsl */ `sin(uTime * .8 + aBirth * 1.7) * .12`;

export function lanternMaterial(u: LakeUni, U: Shared) {
  return new ShaderMaterial({
    uniforms: { ...U, ...u },
    vertexShader: /* glsl */ `
      attribute vec3 aP; attribute float aS, aBirth, aDeath, aHi, aPh;
      uniform float uYear, uEnter, uMinYear, uTime;
      varying vec3 vN, vW, vL, vC; varying float vA, vDead, vHi, vPh, vS;
      void main() {
        ${YEAR}
        float app = smoothstep(aBirth, aBirth + .9, yr);
        vA = app; vDead = smoothstep(aDeath, aDeath + .8, yr); vHi = aHi; vPh = aPh; vL = position;
        // a slow turn and a gentle sway (pivot at the body's centre)
        float an = aPh * 6.2832 + uTime * .05, c = cos(an), s = sin(an);
        vec3 lp = position, ln = normal;
        lp.xz = mat2(c, -s, s, c) * lp.xz; ln.xz = mat2(c, -s, s, c) * ln.xz;
        float sw = sin(uTime * .55 + aPh * 9.) * .03;
        mat2 r2 = mat2(cos(sw), -sin(sw), sin(sw), cos(sw));
        lp.xy = r2 * lp.xy; ln.xy = r2 * ln.xy;
        float S = aS * max(app, .001); vS = S;
        vec3 o = aP + vec3(0., ${BOB}, 0.);
        vec3 w = o + lp * S;
        vC = o + vec3(0., -.27 * S, 0.);
        vN = ln; vW = w;
        vec4 mv = viewMatrix * vec4(w, 1.);
        gl_Position = projectionMatrix * mv;
        // Depth pushed back so the portrait at the lantern's heart is never hidden by its own paper.
        vec4 b = projectionMatrix * vec4(mv.xy, mv.z - aS * .62, 1.); gl_Position.z = b.z / b.w * gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFocus, uTime, uDay, uGlow; uniform vec3 uWarm, uPaper, uFrame, uHi, uSkyL, uGroundL;
      varying vec3 vN, vW, vL, vC; varying float vA, vDead, vHi, vPh, vS;
      ${NOISE}
      ${UNTONE}
      void main() {
        if (vA < .01) discard;
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW);
        float y = vL.y, az = atan(vL.z, vL.x);
        // facet-local coordinate: 0 at a panel's centre, +-.5 at its ribs
        float u = fract(az / 1.0471976 + .5) - .5, au = abs(u);
        bool hi = vHi > .5, day = uDay > .5;
        float dim = uFocus > .5 && !hi ? 1. : 0.;
        float fl = .9 + .1 * sin(uTime * 6.1 + vPh * 40.) * sin(uTime * 2.3 + vPh * 17.);
        float candle = (1. - .78 * vDead) * fl * (1. - .82 * dim);
        vec3 frame = hi ? uHi : uFrame;
        // by day a lantern whose candle is out has aged paper and a duller frame
        vec3 paperC = uPaper;
        if (day && vDead > .01) {
          frame = mix(frame, vec3(dot(frame, vec3(.3, .59, .11))) * .9, .45 * vDead);
          paperC = mix(paperC, vec3(dot(paperC, vec3(.3, .59, .11))) * .93, .55 * vDead);
        }
        vec3 L = normalize(vec3(-.45, .8, .4));
        float dif = max(dot(n, L), 0.);
        vec3 hemi = mix(uGroundL, uSkyL, n.y * .5 + .5);
        float spec = pow(max(dot(reflect(-V, n), L), 0.), 28.);
        // metal / lacquer parts
        vec3 metal = day
          ? frame * (hemi * (.62 + .5 * dif)) + uSkyL * spec * .35
          : frame * (.1 + .16 * dif) + uWarm * (.05 * candle + spec * .25 * candle);
        if (hi && !day) metal = uHi * (.55 + .45 * dif) * (vHi > 1.5 ? 1.5 : 1.);
        vec3 col = metal;
        bool body = y > -.362 && y < .335;
        float rib = day ? smoothstep(.405, .435, au) : smoothstep(.43, .46, au);
        float rail = 1. - smoothstep(-.35, -.335, y) * smoothstep(.322, .307, y);
        if (body && max(rib, rail) < .5) {
          // paper panel: a pointed-arch window (one layer) in a double-layer surround, with a fine jaali
          float ax = au / .3;
          float top = .1 + .15 * sqrt(max(0., 1. - ax));
          float win = smoothstep(1.02, .96, ax) * smoothstep(-.3, -.285, y) * smoothstep(top + .012, top - .004, y);
          float edge = smoothstep(.035, .0, abs(ax - 1.) * .3) * step(-.3, y) * step(y, top + .01)
                     + smoothstep(.012, .0, abs(y - top)) * step(ax, 1.) + smoothstep(.01, .0, abs(y + .29)) * step(ax, 1.);
          vec2 q = vec2(u * .4, y) / .055;
          float jaali = smoothstep(.07, .02, min(abs(fract(q.x + q.y) - .5), abs(fract(q.x - q.y) - .5))) * win;
          float fib = noise(vec2(u * 5., y * 26.)) * .6 + noise(vec2(u * 21., y * 7.)) * .4;
          // candle seen through the paper: a soft hot spot where the view ray passes the flame
          vec3 rd = -V, toC = vC - cameraPosition;
          float dperp = length(toC - dot(toC, rd) * rd) / max(vS, 1e-3);
          float core = exp(-dperp * dperp / .012);
          float lift = exp(-pow((y + .2) / .3, 2.));
          if (day) {
            vec3 paper = paperC * hemi * (.86 + .16 * dif) * (.95 + .08 * fib);
            // the lower body sits in its own soft shadow
            paper *= .84 + .16 * smoothstep(-.36, .1, y);
            paper *= mix(.9, 1.04, win);
            paper += uWarm * (.05 + .07 * lift) * win * candle * uGlow;
            col = mix(paper, frame * .9, clamp(edge, 0., 1.) * .8);
            col = mix(col, paperC * .62, jaali * .25);
            col += uWarm * core * .22 * candle;
            // soft definition at grazing angles
            col *= .78 + .22 * pow(max(dot(n, V), 0.), .45);
          } else {
            float layer = mix(.42, 1., win);
            vec3 glow = uWarm * (.38 + .95 * lift) * layer * (.82 + .3 * fib) * (1. - .45 * smoothstep(.25, .45, au));
            glow *= 1. - .35 * jaali;
            glow *= 1. - .6 * clamp(edge, 0., 1.);
            col = glow * candle * uGlow + uWarm * core * 1.6 * candle;
            if (hi) col += uHi * clamp(edge, 0., 1.) * .5;
          }
        } else if (y > .392 && y < .61) {
          // pierced dome: staggered rows of small holes letting the light out
          float row = (y - .392) / .036;
          vec2 hq = vec2(u * 7. + .5 * mod(floor(row), 2.), row);
          float hole = smoothstep(.3, .18, length(fract(hq) - .5)) * step(au, .42) * step(.5, row) * step(row, 5.4);
          col = day ? mix(col, frame * .35, hole * .8) : col + uWarm * hole * 1.1 * candle * uGlow;
        } else if (y < -.362 && y > -.5 && !day) {
          // the tray under the body catches the candle light
          col += uWarm * .12 * candle * smoothstep(-.5, -.37, y);
        }
        if (dim > .5) col = day ? mix(col, uSkyL * .92, .62) : col * .35;
        gl_FragColor = vec4(day ? untone(col) : col, 1.);
      }`,
  });
}

/**
 * Reflections: under every lantern, a column of short horizontal glints broken by the ripples,
 * brightest at the mirrored lantern, plus its faint mirrored body. Additive at night; a soft darker
 * smear by day (the blending is switched in the scene's tint).
 */
export function reflectionMesh(at: LanternAttrs, n: number, u: LakeUni, U: Shared) {
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  for (const [k, a] of Object.entries(at)) geo.setAttribute(k, a);
  geo.instanceCount = n;
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { ...U, ...u },
    vertexShader: /* glsl */ `
      attribute vec3 aP; attribute float aS, aBirth, aDeath, aHi, aPh;
      uniform float uYear, uEnter, uMinYear, uTime;
      varying vec2 vQ; varying float vA, vDead, vHi, vPh, vH;
      void main() {
        ${YEAR}
        float app = smoothstep(aBirth, aBirth + .9, yr);
        vA = app; vDead = smoothstep(aDeath, aDeath + .8, yr); vHi = aHi; vPh = aPh;
        float S = aS * max(app, .001);
        vec3 c = vec3(aP.x, -(aP.y + ${BOB}), aP.z);
        // about the same angular height for every lantern, never shorter than the lantern itself
        float halfH = max(S * 1.05, length(cameraPosition - c) * .034);
        vec3 right = normalize(vec3(viewMatrix[0][0], 0., viewMatrix[2][0]) + 1e-5);
        float qx = position.x * S * 1.3, qy = mix(-1., .5, position.y) * halfH;
        vec3 w = c + right * qx + vec3(0., qy, 0.);
        w.y = min(w.y, -.04);
        vQ = vec2(qx, qy) / S; vH = halfH / S;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uDay, uFocus, uRefl; uniform vec3 uWarm, uFrame, uPaper, uHi;
      varying vec2 vQ; varying float vA, vDead, vHi, vPh, vH;
      float h1(float x) { return fract(sin(x * 91.17 + vPh * 413.3) * 43758.5453); }
      void main() {
        if (vA < .01) discard;
        float x = vQ.x, y = vQ.y, ay = abs(y) / vH;
        // irregular horizontal ripple bands drifting slowly towards the viewer
        float s = y / vH * 8.5 + uTime * .22;
        s += .35 * sin(s * 1.7 + vPh * 20.);
        float b = floor(s), f = fract(s);
        float body = exp(-pow(y / .45, 2.));
        float cx = (h1(b) - .5) * (.1 + .5 * ay) + sin(uTime * .7 + b * 1.3 + vPh * 9.) * .035;
        float hl = mix(.03, .17, h1(b + 17.)) * (1. - .5 * ay) + body * .1;
        float glint = smoothstep(hl, hl * .4, abs(x - cx)) * smoothstep(.0, .08, f) * smoothstep(.34, .14, f);
        glint *= step(.25 + .6 * ay, h1(b + 31.) + body * .5) * (.35 + .65 * h1(b + 51.));
        float I = glint * exp(-ay * ay * 2.4) + body * smoothstep(.34, .16, abs(x)) * (.06 + .2 * glint);
        float lit = (1. - .75 * vDead) * (uFocus > .5 && vHi < .5 ? .1 : 1.) * uRefl;
        if (uDay < .5) gl_FragColor = vec4(uWarm * I * lit * .3, 1.);
        else {
          vec3 c = mix(vHi > .5 ? uHi : uFrame, uPaper, .3) * .6;
          gl_FragColor = vec4(c, clamp(I * .5, 0., 1.) * lit * vA);
        }
      }`,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return { mesh, geo, mat };
}

export interface ThreadBuilder {
  pos: number[];
  dir: number[];
  side: number[];
  t: number[];
  birth: number[];
  kind: number[];
  bob: number[];
  keys: string[];
  idx: number[];
}
export const threadBuilder = (): ThreadBuilder => ({
  pos: [],
  dir: [],
  side: [],
  t: [],
  birth: [],
  kind: [],
  bob: [],
  keys: [],
  idx: [],
});

/**
 * Adds one thread sampled at n+1 points. kind 0: descent (parent to child), 1: marriage cord.
 * bobA/bobB are the birth years of the two lanterns it ties, so its ends bob with them.
 */
export function addThread(
  B: ThreadBuilder,
  pts: Array<{ x: number; y: number; z: number }>,
  birth: number,
  key: string,
  kind: number,
  bobA: number,
  bobB: number,
) {
  const n = pts.length - 1;
  const base = B.pos.length / 3;
  for (let i = 0; i <= n; i++) {
    const p = pts[i] as { x: number; y: number; z: number };
    const a = pts[Math.max(0, i - 1)] as { x: number; y: number; z: number };
    const b = pts[Math.min(n, i + 1)] as { x: number; y: number; z: number };
    for (const s of [-1, 1]) {
      B.pos.push(p.x, p.y, p.z);
      B.dir.push(b.x - a.x, b.y - a.y, b.z - a.z);
      B.side.push(s);
      B.t.push(i / n);
      B.birth.push(birth);
      B.kind.push(kind);
      B.bob.push(bobA, bobB);
      B.keys.push(key);
    }
    if (i) {
      const v = base + i * 2;
      B.idx.push(v - 2, v - 1, v, v - 1, v + 1, v);
    }
  }
}

/** Threads as ribbons of constant on-screen width (WebGL lines are 1px): wider for the lineage. */
export function threadMesh(B: ThreadBuilder, u: LakeUni, U: Shared) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(B.pos, 3));
  g.setAttribute('aDir', new Float32BufferAttribute(B.dir, 3));
  g.setAttribute('aSide', new Float32BufferAttribute(B.side, 1));
  g.setAttribute('aT', new Float32BufferAttribute(B.t, 1));
  g.setAttribute('aBirth', new Float32BufferAttribute(B.birth, 1));
  g.setAttribute('aKind', new Float32BufferAttribute(B.kind, 1));
  g.setAttribute('aBob', new Float32BufferAttribute(B.bob, 2));
  g.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(B.keys.length), 1));
  g.setIndex(B.idx);
  g.userData.keys = B.keys;
  const uni = { ...U, ...u, uRes: { value: new Vector2(1, 1) }, uDpr: { value: 1 } };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // The ribbon is widened in screen space, so its winding depends on the view: draw both faces.
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `
      attribute vec3 aDir; attribute float aSide, aT, aBirth, aKind, aHi; attribute vec2 aBob;
      uniform vec2 uRes; uniform float uDpr, uTime, uFocus;
      varying float vT, vBirth, vKind, vHi, vSide, vW;
      void main() {
        vT = aT; vBirth = aBirth; vKind = aKind; vHi = aHi; vSide = aSide;
        vec3 p = position;
        p.y += mix(sin(uTime * .8 + aBob.x * 1.7), sin(uTime * .8 + aBob.y * 1.7), aT) * .12;
        vec4 c0 = projectionMatrix * viewMatrix * vec4(p, 1.);
        vec4 c1 = projectionMatrix * viewMatrix * vec4(p + aDir * .05, 1.);
        vec2 d = (c1.xy / max(c1.w, 1e-4) - c0.xy / max(c0.w, 1e-4)) * uRes;
        d = length(d) > 1e-6 ? normalize(d) : vec2(1., 0.);
        float w = (aKind > .5 ? 1.5 : 1.15) + aHi * 1.5;
        if (uFocus > .5 && aHi < .5) w = .9;
        w *= uDpr;
        vW = w;
        c0.xy += vec2(-d.y, d.x) * aSide * (w + 1.) / uRes * c0.w;
        gl_Position = c0;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uYear, uEnter, uMinYear, uTime, uFocus, uDay, uThreadA; uniform vec3 uThread, uGold, uHi, uWarm;
      varying float vT, vBirth, vKind, vHi, vSide, vW;
      ${UNTONE}
      void main() {
        ${YEAR}
        float g = clamp((yr - vBirth) / 1.3, 0., 1.); if (vT > g) discard;
        // anti-aliased edge: the ribbon is drawn one pixel wider than the thread
        float px = abs(vSide) * (vW + 1.) * .5;
        float a = 1. - smoothstep(vW * .5 - .5, vW * .5 + .5, px);
        vec3 c = vKind > .5 ? uGold : uThread;
        float k = vKind > .5 ? (uDay > .5 ? .85 : .7) : uThreadA;
        if (vHi > .5) {
          float pulse = smoothstep(.86, 1., fract(vT * 1.4 - uTime * .32 + vBirth * .13));
          c = vKind > .5 ? uGold : uHi * (1. + pulse * (uDay > .5 ? .35 : 1.1));
          k = 1.;
        } else if (uFocus > .5) k *= .22;
        // by day the threads are ink: shown exactly as designed
        gl_FragColor = vec4(uDay > .5 ? untone(c) : c, a * k);
      }`,
  });
  const mesh = new Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  const v = new Vector2();
  mesh.onBeforeRender = (r) => {
    r.getDrawingBufferSize(v);
    uni.uRes.value.copy(v);
    uni.uDpr.value = r.getPixelRatio();
  };
  return { mesh, geo: g };
}

export interface GlowData {
  pos: Float32Array;
  kind: Float32Array;
  phase: Float32Array;
  birth: Float32Array;
  death: Float32Array;
  /** Person per point for the lineage highlight ('' for scenery). */
  keys: string[];
}

/**
 * One draw call for every soft light: floating diyas on the water (kind 1), shared wedding glows (2)
 * and the halo around each lantern (3). Halos and wedding glows are night only.
 */
export function glowPoints(d: GlowData, u: LakeUni, U: Shared, opt: { wed: number; halo: number; diya: number }) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(d.pos, 3));
  geo.setAttribute('aKind', new BufferAttribute(d.kind, 1));
  geo.setAttribute('aPh', new BufferAttribute(d.phase, 1));
  geo.setAttribute('aBirth', new BufferAttribute(d.birth, 1));
  geo.setAttribute('aDeath', new BufferAttribute(d.death, 1));
  geo.setAttribute('aHi', new BufferAttribute(new Float32Array(d.keys.length), 1));
  geo.userData.keys = d.keys;
  const uni = {
    ...U,
    ...u,
    uPx: { value: 400 },
    uWed: { value: opt.wed },
    uHalo: { value: opt.halo },
    uDiya: { value: opt.diya },
  };
  const pts = new Points(
    geo,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: uni,
      vertexShader: /* glsl */ `
        attribute float aKind, aPh, aBirth, aDeath, aHi; uniform float uTime, uYear, uEnter, uMinYear, uPx, uWed, uHalo, uDiya, uDay;
        varying float vA, vK, vHi, vPh;
        void main() {
          vec3 p = position; vPh = aPh; vK = aKind; vHi = aHi; float sz;
          ${YEAR}
          if (aKind < 1.5) {
            vA = (.75 + .25 * sin(uTime * 4.3 + aPh * 50.)) * smoothstep(uMinYear - 3., uMinYear + 8., yr);
            p.y = .12 + sin(uTime * .9 + aPh * 30.) * .03; sz = uDiya;
          } else if (aKind < 2.5) {
            vA = smoothstep(aBirth, aBirth + 1.5, yr) * (1. - uDay); sz = uWed;
          } else {
            p.y += sin(uTime * .8 + aBirth * 1.7) * .12;
            vA = smoothstep(aBirth, aBirth + .9, yr) * (1. - .7 * smoothstep(aDeath, aDeath + .8, yr)) * (1. - uDay);
            sz = uHalo;
          }
          vec4 mv = viewMatrix * vec4(p, 1.);
          gl_PointSize = clamp(sz * uPx / max(-mv.z, .1), 1.5, 240.);
          if (vA < .005) gl_PointSize = 0.;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uWarm, uGold, uFrame; uniform float uFocus, uDay, uTime; varying float vA, vK, vHi, vPh;
        void main() {
          vec2 q = (gl_PointCoord - .5) * 2.;
          float d = length(q); if (d > 1.) discard;
          float a; vec3 c;
          bool day = uDay > .5;
          if (vK < 1.5) {
            // a diya: a small clay bowl (seen by day) with a tiny flame over its own pool of light
            float flame = exp(-(q.x * q.x * 60. + (q.y + .05) * (q.y + .05) * 18.));
            if (day) {
              float bowl = smoothstep(1., .75, length((q - vec2(0., .2)) * vec2(1.7, 5.)));
              c = mix(vec3(.16, .1, .07), uWarm * 1.2, flame);
              a = max(bowl * .9, flame);
            } else {
              c = uWarm * (1.4 * flame + .35 * exp(-d * d * 6.));
              a = 1.;
            }
          } else if (vK < 2.5) { c = uGold; a = exp(-d * d * 4.5) * .28; }
          else { c = uWarm; a = exp(-d * d * 5.5) * .08; }
          a *= vA * (vK > 1.5 && uFocus > .5 && vHi < .5 ? .15 : 1.);
          // additive light at night, plain paint by day (the blending is switched in the scene's tint)
          gl_FragColor = day ? vec4(c, a) : vec4(c * a, 1.);
        }`,
    }),
  );
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  const v = new Vector2();
  // World-unit point sizes need the drawing buffer height and the projection scale.
  pts.onBeforeRender = (r, _s, cam) => {
    r.getDrawingBufferSize(v);
    uni.uPx.value = (v.y * (cam as PerspectiveCamera).projectionMatrix.elements[5]) / 2;
  };
  return { pts, geo };
}
