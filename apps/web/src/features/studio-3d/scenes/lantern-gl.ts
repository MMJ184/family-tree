import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  FrontSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LatheGeometry,
  Mesh,
  NormalBlending,
  type PerspectiveCamera,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { NOISE, type Shared } from '../gl.ts';

// Lantern Lake GPU pieces: an instanced hexagonal fanous (drawn twice: real and mirrored
// under the water), a rippled water plane that reflects the sky analytically, a dusk or
// night sky with sun or moon, and one point cloud for embers, floating diyas and wedding glows.

/** Theme-driven colours shared by the sky, the water and the lanterns. */
export function lakeUniforms() {
  return {
    uTop: { value: new Color() },
    uHor: { value: new Color() },
    uBand: { value: new Color() },
    uSun: { value: new Color() },
    uSunDir: { value: new Vector3(0, 0.1, -1).normalize() },
    uHill: { value: new Color() },
    uStars: { value: 0 },
    uDeep: { value: new Color() },
    uWarm: { value: new Color() },
    uBrass: { value: new Color() },
    uAmb: { value: new Color() },
    uDay: { value: 0 },
    uAlpha: { value: 0.7 },
    uFanR: { value: 60 },
    uFanZ: { value: -20 },
  };
}
export type LakeUni = ReturnType<typeof lakeUniforms>;

// Sky colour for a view direction: gradient, warm horizon band, distant hills, sun or moon, stars.
const SKY = /* glsl */ `
  uniform vec3 uTop, uHor, uBand, uSun, uSunDir, uHill; uniform float uStars;
  vec3 skyCol(vec3 d, float halo) {
    float h = d.y;
    vec3 c = mix(uHor, uTop, pow(clamp(h, 0., 1.), .5));
    c += uBand * exp(-abs(h) * 14.);
    float m = max(dot(d, uSunDir), 0.);
    c += uSun * (smoothstep(.99965, .9998, m) * 1.25 + (pow(m, 90.) * .35 + pow(m, 9.) * .05) * halo);
    vec2 az = vec2(atan(d.x, -d.z), h);
    float hill = .012 + .022 * noise(vec2(az.x * 5., 1.)) + .008 * noise(vec2(az.x * 23., 3.));
    c = mix(c, uHill, step(abs(h), hill) * step(0., h));
    vec3 cell = floor(d * 420.);
    float st = step(.9965, hash(cell.xy + cell.z * 17.13)) * smoothstep(.04, .35, h);
    c += vec3(.9, .92, 1.) * st * uStars * (.5 + .5 * hash(cell.zy));
    return c;
  }`;

export function skyMesh(u: LakeUni) {
  const mesh = new Mesh(
    new SphereGeometry(1300, 48, 24),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: u,
      vertexShader: `varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `${NOISE}${SKY}
        uniform vec3 uDeep; varying vec3 vD;
        void main() { vec3 d = normalize(vD); gl_FragColor = vec4(d.y >= 0. ? skyCol(d, 1.) : mix(uHor, uDeep, .7), 1.); }`,
    }),
  );
  mesh.renderOrder = -10;
  return mesh;
}

export function waterMesh(u: LakeUni, U: Shared) {
  const geo = new CircleGeometry(1400, 96);
  geo.rotateX(-Math.PI / 2);
  const mesh = new Mesh(
    geo,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { ...u, uTime: U.uTime },
      vertexShader: `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `${NOISE}${SKY}
        uniform vec3 uDeep, uWarm; uniform float uTime, uDay, uAlpha, uFanR, uFanZ; varying vec3 vW;
        float wave(vec2 p) {
          return noise(p * .06 + vec2(uTime * .04, uTime * .025)) + noise(p * .17 - vec2(uTime * .07, -uTime * .05)) * .45;
        }
        void main() {
          vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC / dist;
          vec2 p = vW.xz; float e = .5;
          float k = .55 * (1. - smoothstep(40., 420., dist));
          vec3 n = normalize(vec3((wave(p - vec2(e, 0.)) - wave(p + vec2(e, 0.))) * k, 2. * e, (wave(p - vec2(0., e)) - wave(p + vec2(0., e))) * k));
          float fr = .03 + .97 * pow(1. - max(dot(n, V), 0.), 5.);
          vec3 R = reflect(-V, n); R.y = abs(R.y);
          vec3 col = mix(uDeep, skyCol(R, .2), clamp(fr * 1.15 + .12, 0., 1.));
          float m = max(dot(R, uSunDir), 0.);
          col += uSun * (pow(m, 1400.) * 2.4 + pow(m, 260.) * .18) * (.4 + .6 * uDay);
          // warm haze of the lanterns over the water near the family
          float fan = 1. - smoothstep(0., uFanR * 1.25, length(p - vec2(0., uFanZ)));
          col += uWarm * fan * fan * (uDay > .5 ? .05 : .085);
          float far = smoothstep(260., 1250., dist);
          col = mix(col, uHor, far * .85);
          gl_FragColor = vec4(col, mix(uAlpha, 1., max(far, fr * .5)));
        }`,
    }),
  );
  mesh.renderOrder = 0;
  return mesh;
}

/** Hexagonal fanous, unit body radius about 0.41, from -0.66 (finial) to 0.72 (ring). */
function fanousProfile() {
  const pts: Array<[number, number]> = [
    [0, -0.66],
    [0.035, -0.6],
    [0.06, -0.52],
    [0.17, -0.47],
    [0.27, -0.44],
    [0.3, -0.4],
    [0.34, -0.36],
    [0.39, -0.18],
    [0.41, 0],
    [0.39, 0.18],
    [0.34, 0.335],
    [0.29, 0.36],
    [0.33, 0.39],
    [0.25, 0.47],
    [0.14, 0.56],
    [0.065, 0.63],
    [0.05, 0.68],
    [0.03, 0.72],
    [0, 0.73],
  ];
  return pts.map(([x, y]) => new Vector2(x, y));
}

export interface LanternInst {
  pos: Float32Array;
  scale: Float32Array;
  col: Float32Array;
  birth: Float32Array;
  death: Float32Array;
  phase: Float32Array;
}

export function lanternGeometry(inst: LanternInst, keys: string[]) {
  // Flat-shaded facets: non-indexed so every face keeps its own normal.
  const lathe = new LatheGeometry(fanousProfile(), 6).toNonIndexed();
  lathe.computeVertexNormals();
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('position', lathe.getAttribute('position'));
  geo.setAttribute('normal', lathe.getAttribute('normal'));
  lathe.dispose();
  const n = keys.length;
  geo.setAttribute('aP', new InstancedBufferAttribute(inst.pos, 3));
  geo.setAttribute('aS', new InstancedBufferAttribute(inst.scale, 1));
  geo.setAttribute('aCol', new InstancedBufferAttribute(inst.col, 3));
  geo.setAttribute('aBirth', new InstancedBufferAttribute(inst.birth, 1));
  geo.setAttribute('aDeath', new InstancedBufferAttribute(inst.death, 1));
  geo.setAttribute('aPh', new InstancedBufferAttribute(inst.phase, 1));
  geo.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(n), 1));
  geo.userData.keys = keys;
  geo.instanceCount = n;
  return geo;
}

export function lanternMaterial(u: LakeUni, U: Shared, focus: { value: number }, mirror: boolean) {
  return new ShaderMaterial({
    side: mirror ? BackSide : FrontSide,
    // The reflection is light only: additive, so the dark brass never shows on the water.
    transparent: mirror,
    depthWrite: !mirror,
    blending: mirror ? AdditiveBlending : NormalBlending,
    uniforms: {
      ...U,
      uWarm: u.uWarm,
      uBrass: u.uBrass,
      uAmb: u.uAmb,
      uSunDir: u.uSunDir,
      uDay: u.uDay,
      uFocus: focus,
      uMirror: { value: mirror ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aP, aCol; attribute float aS, aBirth, aDeath, aHi, aPh;
      uniform float uYear, uEnter, uMinYear, uTime, uMirror;
      varying vec3 vN, vW, vL, vCol; varying float vA, vDead, vHi, vPh;
      void main() {
        float yr = mix(uMinYear - 3., uYear, uEnter);
        float app = smoothstep(aBirth, aBirth + .9, yr);
        vA = app; vDead = step(aDeath, yr); vHi = aHi; vCol = aCol; vPh = aPh; vL = position;
        float an = aPh * 6.2832 + uTime * .1, c = cos(an), s = sin(an);
        mat2 rot = mat2(c, -s, s, c);
        vec3 lp = position; lp.xz = rot * lp.xz;
        vec3 ln = normal; ln.xz = rot * ln.xz;
        // gentle sway
        float sw = sin(uTime * .7 + aPh * 9.) * .05;
        lp.xy = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * lp.xy; ln.xy = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * ln.xy;
        // Reflections stretch down the ripples, like light smeared on a lake.
        if (uMirror > .5) { lp.y *= 2.2; lp.xz *= .8; }
        vec3 w = aP + lp * aS * max(app, .001);
        w.y += sin(uTime * .8 + aBirth * 1.7) * .12; // same bob as the portraits
        if (uMirror > .5) {
          w.y = min(-w.y, -.02); ln.y = -ln.y;
          w.x += sin(w.y * 2.6 + uTime * 1.9 + w.z * .3) * (.06 + .035 * -w.y);
        }
        vN = ln; vW = w;
        vec4 mv = viewMatrix * vec4(w, 1.);
        gl_Position = projectionMatrix * mv;
        // Depth pushed back so the portrait at the lantern's heart is never hidden by its own glass.
        if (uMirror < .5) { vec4 b = projectionMatrix * vec4(mv.xy, mv.z - aS * .62, 1.); gl_Position.z = b.z / b.w * gl_Position.w; }
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFocus, uTime, uDay, uMirror; uniform vec3 uWarm, uBrass, uAmb, uSunDir;
      varying vec3 vN, vW, vL, vCol; varying float vA, vDead, vHi, vPh;
      void main() {
        if (vA < .01) discard;
        bool refl = uMirror > .5;
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW);
        float y = vL.y, az = atan(vL.z, vL.x), fu = fract(az / 1.0471976);
        vec3 glow = mix(uWarm, vCol, .2);
        float fl = .9 + .1 * sin(uTime * 7.3 + vPh * 40.) * sin(uTime * 3.1 + vPh * 17.);
        float hot = (vDead > .5 ? .3 : 1.) * fl * (1. + .45 * step(.5, vHi) + .5 * step(1.5, vHi));
        float dif = max(dot(n, uSunDir), 0.), fr = pow(1. - max(dot(n, V), 0.), 2.5);
        vec3 col = refl ? vec3(0.) : uBrass * (uAmb + dif * uDay * 1.4) + glow * fr * .35 * hot;
        if (y > -.36 && y < .335) {
          // pointed-arch window on each face, with a fine lattice
          float px = (fu - .5) * 2., py = (y + .36) / .695;
          float top = .74 + .2 * (1. - pow(min(abs(px) / .76, 1.), 1.4));
          float win = smoothstep(.8, .74, abs(px)) * smoothstep(.04, .09, py) * smoothstep(top + .02, top - .02, py);
          float lat = smoothstep(.75, .95, max(abs(sin(px * 8.5 + py * 6.)), abs(sin(px * 8.5 - py * 6.))));
          vec3 lit = glow * (1.5 + 1.9 * (1. - py)) * mix(1., .62, uDay) * (1. - lat * .45);
          col = mix(col, lit * hot, win);
          col += glow * hot * .5 * smoothstep(.12, 0., abs(py - .02)) * (1. - win);
        } else if (y > .37 && y < .62) {
          float holes = step(.55, sin(az * 18. + y * 9.) * sin(y * 64.));
          col += glow * holes * 1.4 * hot;
        } else if (y < -.4) {
          col += glow * .25 * hot * smoothstep(-.66, -.44, y);
        }
        if (refl) {
          // a soft smear of the lit body (no window detail, no silhouette), broken into rippling bands
          float body = smoothstep(-.55, -.2, y) * smoothstep(.55, .15, y);
          col = glow * hot * body * pow(max(dot(n, V), 0.), 2.4) * 3.;
          float rip = smoothstep(-.3, 1., sin(vW.y * 8. + uTime * 2.4 + sin(vW.x * 2.3 + uTime * .9) * 2. + sin(vW.x * .6 - uTime * .5) * 2.));
          col *= (.25 + .75 * rip) * exp(vW.y * .07) * mix(.5, .16, uDay);
          col *= uFocus > .5 && vHi < .5 ? .12 : 1.;
        } else if (uFocus > .5 && vHi < .5) col = mix(col * .2, uAmb * .9, uDay * .7); // fade into the haze by day
        gl_FragColor = vec4(col, 1.);
      }`,
  });
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
 * One draw call for every soft light: embers (kind 0), floating diyas on the water (1), shared
 * wedding glows (2), the halo around each lantern (3) and that halo's reflection on the lake (4).
 */
export function glowPoints(d: GlowData, u: LakeUni, U: Shared, opt: { rise: number; wed: number; halo: number }) {
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
    uWarm: u.uWarm,
    uDay: u.uDay,
    uPx: { value: 400 },
    uRise: { value: opt.rise },
    uWed: { value: opt.wed },
    uHalo: { value: opt.halo },
    uFocus: { value: 0 },
  };
  const pts = new Points(
    geo,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: uni,
      vertexShader: /* glsl */ `
        attribute float aKind, aPh, aBirth, aDeath, aHi; uniform float uTime, uYear, uEnter, uMinYear, uPx, uRise, uWed, uHalo, uDay;
        varying float vA, vK, vHi, vPh;
        void main() {
          vec3 p = position; vPh = aPh; float yr = mix(uMinYear - 3., uYear, uEnter); float sz;
          vK = aKind; vHi = aHi;
          if (aKind < .5) {
            float life = fract(uTime * (.012 + fract(aPh * 3.1) * .02) + aPh);
            p.y += life * uRise; p.x += sin(uTime * .35 + aPh * 20.) * 1.4; p.z += cos(uTime * .3 + aPh * 13.) * 1.4;
            vA = smoothstep(0., .15, life) * (1. - smoothstep(.7, 1., life)) * (.55 + .45 * sin(uTime * 2.6 + aPh * 40.));
            sz = .16 + fract(aPh * 7.) * .12;
          } else if (aKind < 1.5) {
            vA = (.7 + .3 * sin(uTime * 5. + aPh * 50.)) * smoothstep(uMinYear - 3., uMinYear + 10., yr);
            p.y = .1 + sin(uTime * .9 + aPh * 30.) * .04; sz = .5;
          } else if (aKind < 2.5) {
            vA = smoothstep(aBirth, aBirth + 1.5, yr) * (.75 + .25 * sin(uTime * 1.3 + aPh * 9.)); sz = uWed;
          } else {
            float bob = sin(uTime * .8 + aBirth * 1.7) * .12;
            p.y += aKind < 3.5 ? bob : -bob;
            vA = smoothstep(aBirth, aBirth + .9, yr) * (step(yr, aDeath) * .75 + .25) * (.9 + .1 * sin(uTime * 4. + aPh * 30.));
            if (aKind > 3.5) p.y *= .75; // the pillar hangs from the waterline
            sz = uHalo * (aKind < 3.5 ? 1. : 2.) * (1. + .25 * step(.5, aHi));
          }
          vec4 mv = viewMatrix * vec4(p, 1.);
          gl_PointSize = clamp(sz * uPx / max(-mv.z, .1), 1.5, 220.);
          if (vA < .005) gl_PointSize = 0.;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uWarm; uniform float uFocus, uDay, uTime; varying float vA, vK, vHi, vPh;
        void main() {
          vec2 q = (gl_PointCoord - .5) * 2.;
          // reflected halos become narrow, rippling pillars of light
          bool pillar = vK > 3.5;
          float d = pillar ? length(vec2(q.x * 3.4, q.y)) : length(q); if (d > 1.) discard;
          float band = pillar ? .55 + .45 * sin(q.y * 16. + uTime * 3. + vPh * 20.) : 1.;
          vec3 c = vK < .5 ? vec3(1., .62, .25) : vK < 1.5 ? uWarm * 1.3 : vK < 2.5 ? vec3(1., .66, .55) : uWarm;
          float core = vK > 2.5 ? exp(-d * d * (pillar ? 3. : 4.5)) * (vK < 3.5 ? .3 : .26 * band) * mix(1., .5, uDay)
            : vK > 1.5 ? exp(-d * d * 5.) * .55 : exp(-d * d * 7.) + smoothstep(.3, 0., d) * .8;
          float a = vA * core * (vK > 1.5 && uFocus > .5 && vHi < .5 ? .2 : 1.) * mix(1., .7, uDay);
          gl_FragColor = vec4(c * a, 1.);
        }`,
    }),
  );
  pts.frustumCulled = false;
  pts.renderOrder = 2;
  const v = new Vector2();
  // World-unit point sizes need the drawing buffer height and the projection scale.
  pts.onBeforeRender = (r, _s, cam) => {
    r.getDrawingBufferSize(v);
    uni.uPx.value = (v.y * (cam as PerspectiveCamera).projectionMatrix.elements[5]) / 2;
  };
  return { pts, uni };
}
