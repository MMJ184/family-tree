import {
  AdditiveBlending,
  CatmullRomCurve3,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  BufferGeometry as LinesGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  type Sprite,
  Vector3,
} from 'three';
import { bake, builder, makeFog, retextSprite, skyDome, textSprite, tubeColored } from '../gl.ts';
import { spouseYear } from '../model.ts';
import { lin, NOW } from '../palette.ts';
import type { SceneBuilder } from './types.ts';

// Time River: time becomes distance. Each person is a ribbon from birth to death and
// children branch off their parent's ribbon. In Arabic the river runs right to left
// (earliest on the right, spec decision #10): every x below goes through X(), which
// carries the direction, and the shader compares positions along that direction.

export const riverScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const pp = ctx.pal();
  const dir = ctx.rtl() ? -1 : 1;
  const group = new Group();
  const pos = new Float32Array(M.n * 3);
  const mid = (M.minYear - 3 + NOW) / 2;
  const k = big ? 0.85 : 1.15;
  const X = (y: number) => dir * (y - mid) * k;
  // Every life gets its own lane: a person, their spouses half a lane below, then each child's line in turn.
  const lane = big ? 0.8 : 4.2;
  const z = new Map<string, number>();
  let L = 0;
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const p = M.get(id);
    z.set(id, L);
    const sp = p.spouses.filter((s) => {
      const q = M.byId.get(s.id);
      return q?.mi && q.anchor === p.id;
    });
    sp.forEach((s, j) => {
      if (!z.has(s.id)) z.set(s.id, L + (j + 1) / (sp.length + 1));
    });
    L += 1;
    for (const kid of p.kids) visit(kid);
  };
  visit(M.root.id);
  for (const p of M.people) if (!z.has(p.id)) z.set(p.id, L++);
  for (const [id, v] of z) z.set(id, (v - L / 2) * lane);
  const zOf = (id: string | null) => (id ? z.get(id) : undefined) ?? 0;
  const BR = 1.2;
  const startYear = (p: (typeof M.people)[number]) => (p.mi ? spouseYear(M, p) : p.born);
  const appear = new Float32Array(M.n);
  M.people.forEach((p, i) => {
    const sy = p.mi || !p.parent || p.virt ? startYear(p) : Math.min(startYear(p) + BR / k, p.died ?? NOW);
    pos[i * 3] = X(sy);
    pos[i * 3 + 1] = big ? 1.2 : 2.1;
    pos[i * 3 + 2] = zOf(p.id);
    appear[i] = sy; // the portrait shows when the "now" curtain reaches it
  });
  const B = builder();
  const r = big ? 0.13 : 0.3;
  const V = (x: number, zz: number) => new Vector3(x, 0.25, zz);
  for (const p of M.people) {
    const end = X(p.died ?? NOW);
    const s = X(startYear(p));
    const col = lin(p.color);
    const zS = zOf(p.id);
    let pts: Vector3[];
    if (p.mi) pts = [V(s - 3.5 * dir, zS + (Math.sign(zS - zOf(p.anchor)) || 1) * 4), V(s, zS)];
    else if (p.parent && !p.virt) {
      const zP = zOf(p.parent);
      const b = Math.min(BR, Math.max(0.3, dir * (end - s)));
      pts = [V(s, zP), V(s + dir * b * 0.5, (zP + zS) / 2), V(s + dir * b, zS)];
    } else pts = [V(s - 2 * dir, zS), V(s, zS)];
    const last = pts[pts.length - 1] as Vector3;
    if (dir * (end - last.x) > 1) pts.push(V((last.x + end) / 2, zS), V(end, zS));
    const curve = new CatmullRomCurve3(pts, false, 'centripetal');
    const len = curve.getLength();
    tubeColored(B, curve, r, r, Math.max(10, Math.ceil(len / 1.6)), big ? 5 : 8, p.born, p.id, col);
  }
  const g = bake(B);
  g.setAttribute('aCol', new Float32BufferAttribute(B.col, 3));
  const fog = makeFog();
  const ribbonUni = {
    ...U,
    ...fog,
    uMid: { value: mid },
    uK: { value: k },
    uDir: { value: dir },
    uFocus: { value: 0 },
  };
  const ribbonMat = new ShaderMaterial({
    uniforms: ribbonUni,
    vertexShader: /* glsl */ `attribute float aHi; attribute vec3 aCol; varying vec3 vW, vN, vCol; varying float vHi, vDepth;
      void main() { vCol = aCol; vHi = aHi; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
        vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform float uYear, uEnter, uMinYear, uTime, uMid, uK, uDir, uFocus, uFogNear, uFogFar; uniform vec3 uFogColor;
      varying vec3 vW, vN, vCol; varying float vHi, vDepth;
      void main() { float yr = mix(uMinYear - 3., uYear, uEnter); float front = uDir * (yr - uMid) * uK;
        float ahead = (vW.x - front) * uDir; if (ahead > .15) discard;
        vec3 n = normalize(vN); float dif = max(dot(n, normalize(vec3(.3, .9, .4))), 0.);
        vec3 col = vCol * (.35 + .75 * dif);
        float flow = smoothstep(.85, 1., fract(vW.x * uDir * .07 - uTime * .45)); col += vCol * flow * .45;
        col += vCol * 2.2 * smoothstep(-2.5, 0., ahead);
        col = mix(col, col * 1.3 + vCol * .5, vHi); col = mix(col, col * .3, uFocus * (1. - step(.5, vHi)));
        gl_FragColor = vec4(mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vDepth)), 1.); }`,
  });
  group.add(new Mesh(g, ribbonMat));
  const zs = [...z.values()];
  const zMin = Math.min(...zs) - 10;
  const zMax = Math.max(...zs) + 10;
  // The "now" curtain that rides the year slider
  const curtainUni = { uGlow: { value: lin(pp.glow) }, uTime: U.uTime };
  const curtain = new Mesh(
    new PlaneGeometry(zMax - zMin, 16),
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      uniforms: curtainUni,
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform vec3 uGlow; uniform float uTime; varying vec2 vUv; void main() { float edge = smoothstep(.0, .06, vUv.x) * smoothstep(1., .94, vUv.x);
        float scan = .5 + .5 * sin(vUv.y * 60. - uTime * 2.); float a = (1. - vUv.y) * .22 * edge * (.7 + .3 * scan) + smoothstep(.02, 0., vUv.y) * .6;
        gl_FragColor = vec4(uGlow * a, 1.); }`,
    }),
  );
  curtain.rotation.y = Math.PI / 2;
  curtain.position.set(0, 8, (zMin + zMax) / 2);
  group.add(curtain);
  // Decade lines and labels on the water
  const dl: number[] = [];
  const decades: Array<{ s: Sprite; text: string }> = [];
  const decadeH = big ? 3.2 : 2.2;
  const decadeInk = () => (ctx.dark() ? '#9fb3bd' : '#5a6a74');
  for (let y = Math.ceil((M.minYear - 3) / 10) * 10; y <= NOW; y += 10) {
    dl.push(X(y), 0.02, zMin, X(y), 0.02, zMax);
    const text = `${y}`;
    const tsp = textSprite(text, decadeInk(), decadeH, null, false);
    tsp.position.set(X(y), 1.4, zMax + 2.5);
    group.add(tsp);
    decades.push({ s: tsp, text });
  }
  const decadeMat = new LineBasicMaterial({ color: lin(pp.ring), transparent: true, opacity: 0.6 });
  group.add(
    new LineSegments(new LinesGeometry().setAttribute('position', new Float32BufferAttribute(dl, 3)), decadeMat),
  );
  const waterFog = makeFog();
  const waterUni = { ...waterFog, uC: { value: lin(pp.ground) }, uG: { value: lin(pp.glow) }, uTime: U.uTime };
  const water = new Mesh(
    new PlaneGeometry(2400, 2400),
    new ShaderMaterial({
      uniforms: waterUni,
      vertexShader: `varying vec2 vP; varying float vDepth; void main() { vP = position.xy; vec4 mv = modelViewMatrix * vec4(position, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uC, uG, uFogColor; uniform float uTime, uFogNear, uFogFar; varying vec2 vP; varying float vDepth;
        void main() { float w = sin(vP.x * 1.3 + uTime * .8 + sin(vP.y * .7) * 2.) * sin(vP.y * 1.7 - uTime * .5);
          vec3 c = uC + uG * .025 * smoothstep(.75, 1., w); gl_FragColor = vec4(mix(c, uFogColor, smoothstep(uFogNear, uFogFar, vDepth)), 1.); }`,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.2;
  group.add(water);
  const sky = skyDome(pp.top, pp.hor, pp.ground);
  group.add(sky.mesh);
  let inkDark = ctx.dark();
  const tint = () => {
    const q = ctx.pal();
    for (const f of [fog, waterFog]) {
      f.uFogColor.value.copy(lin(q.fog));
      f.uFogNear.value = q.fogNear;
      f.uFogFar.value = q.fogFar * 1.3;
    }
    waterUni.uC.value.copy(lin(q.ground));
    curtainUni.uGlow.value.copy(lin(q.glow));
    decadeMat.color.copy(lin(q.ring));
    if (inkDark !== ctx.dark()) {
      inkDark = ctx.dark();
      for (const d of decades) retextSprite(d.s, d.text, decadeInk(), decadeH, null, false);
    }
    sky.set(q.top, q.hor, q.ground);
    ctx.look(q.bloom, q.exposure);
  };
  const span = Math.abs(X(NOW) - X(M.minYear));
  const wz = zMax - zMin;
  const cx = X(mid + 4);
  return {
    key: 'river',
    group,
    pos,
    size: big ? 1.1 : 1.7,
    style: 0,
    lift: 5,
    tint,
    labelUp: true,
    dir,
    update: () => {
      curtain.position.x = X(ctx.effYear());
    },
    hiTargets: [{ geo: g, perPerson: true }],
    focus: [ribbonUni.uFocus],
    appear,
    view: {
      target: new Vector3(cx, 0, 0),
      cam: new Vector3(cx - dir * span * 0.12, span * 0.42 + wz * 0.25, wz * 0.45 + span * 0.36),
    },
    follow: 34,
  };
};
