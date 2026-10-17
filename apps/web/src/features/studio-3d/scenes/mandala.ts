import {
  CircleGeometry,
  ExtrudeGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  QuadraticBezierCurve3,
  Quaternion,
  ShaderMaterial,
  Shape,
  Vector3,
} from 'three';
import { addCurveLine, flowLines, lineBuilder, skyDome } from '../gl.ts';
import { spouseIndex } from '../model.ts';
import { lin } from '../palette.ts';
import { isRoot, type SceneBuilder } from './types.ts';

// Girih Mandala: the family as an Islamic eight-point star pattern. Founders in the centre
// rosette, each generation a ring of enamel and gold tiles joined by gold threads.

export const mandalaScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const pp = ctx.pal();
  const group = new Group();
  const pos = new Float32Array(M.n * 3);
  const spread = Math.max(1, Math.sqrt(M.n / 30));
  const R = (g: number) => g * (big ? 9 : 11) * spread;
  const at = new Map<string, Vector3>();
  const atOf = (id: string | null) => (id ? at.get(id) : undefined) ?? new Vector3();
  for (const p of M.people) {
    if (p.mi) continue;
    const th = p.ang * Math.PI * 2;
    at.set(p.id, p.gen === 0 ? new Vector3(0, 0, 0) : new Vector3(Math.cos(th) * R(p.gen), 0, Math.sin(th) * R(p.gen)));
  }
  for (const p of M.people) {
    if (!p.mi) continue;
    const a = atOf(p.anchor);
    const i = spouseIndex(M, p);
    const out = a.clone().setY(0);
    if (out.lengthSq() < 0.01) out.set(1, 0, 0);
    out.normalize();
    const anchorGen = p.anchor ? M.byId.get(p.anchor)?.gen : undefined;
    const gap = (big ? 2.2 : 3.6) * (anchorGen === 0 ? 1.9 : 1);
    at.set(
      p.id,
      a
        .clone()
        .addScaledVector(new Vector3(-out.z, 0, out.x), (i % 2 ? -1 : 1) * gap * (1 + Math.floor(i / 2)))
        .addScaledVector(out, big ? 0.8 : 1.6),
    );
  }
  // Eight-point star tile (two squares at 45 degrees), extruded with a bevel
  const star = (rO: number, rI: number) => {
    const s = new Shape();
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + Math.PI / 16;
      const r = k % 2 ? rI : rO;
      if (k) s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath();
    return s;
  };
  const geo = new ExtrudeGeometry(star(1, 0.62), {
    depth: 0.5,
    bevelEnabled: true,
    bevelThickness: 0.18,
    bevelSize: 0.14,
    bevelSegments: 2,
  });
  geo.rotateX(-Math.PI / 2);
  const n = M.n;
  const ab = new Float32Array(n);
  const ad = new Float32Array(n);
  const ac = new Float32Array(n * 3);
  geo.setAttribute('aBirth', new InstancedBufferAttribute(ab, 1));
  geo.setAttribute('aDeath', new InstancedBufferAttribute(ad, 1));
  geo.setAttribute('aCol', new InstancedBufferAttribute(ac, 3));
  geo.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(n), 1));
  geo.userData.keys = M.people.map((p) => p.id);
  const tileUni = { ...U, uGold: { value: lin('#d9a84a') }, uFocus: { value: 0 } };
  const tileMat = new ShaderMaterial({
    uniforms: tileUni,
    vertexShader: /* glsl */ `attribute float aBirth, aDeath, aHi; attribute vec3 aCol; uniform float uYear, uEnter, uMinYear;
      varying vec3 vN, vCol, vW, vL; varying float vDead, vHi;
      void main() { float yr = mix(uMinYear - 3., uYear, uEnter); float grow = smoothstep(aBirth, aBirth + 1.6, yr);
        vec3 p = position * vec3(grow, max(grow, .001), grow); vL = position;
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vCol = aCol; vDead = step(aDeath, yr); vHi = aHi; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform vec3 uGold; uniform float uFocus, uTime; varying vec3 vN, vCol, vW, vL; varying float vDead, vHi;
      void main() { vec3 n = normalize(vN), V = normalize(cameraPosition - vW), L = normalize(vec3(.3, 1., .4));
        float dif = max(dot(n, L), 0.), spec = pow(max(dot(reflect(-L, n), V), 0.), 24.);
        vec3 col;
        if (n.y > .92 && length(vL.xz) < .62) { vec3 en = vCol; if (vDead > .5) en = mix(en, vec3(dot(en, vec3(.3, .59, .11))), .8) * .7;
          col = en * (.55 + .5 * dif) + spec * .35; }
        else col = uGold * (.45 + .8 * dif) + spec * vec3(1., .85, .55) * 1.4;
        col = mix(col, col * 1.25, vHi); col = mix(col, col * .3, uFocus * (1. - step(.5, vHi)));
        gl_FragColor = vec4(col, 1.); }`,
  });
  const tiles = new InstancedMesh(geo, tileMat, n);
  const mtx = new Matrix4();
  const q = new Quaternion();
  const sc = new Vector3();
  const up = new Vector3(0, 1, 0);
  M.people.forEach((p, i) => {
    const a = atOf(p.id);
    const s = (isRoot(p) ? 4.4 : p.mi ? 2 : 3.3) * (big ? 0.55 : 1);
    // One star point aims along the ring's radius. (In the prototype the matrix line had been
    // swallowed by this comment, so every tile sat at the origin; fixed here.)
    q.setFromAxisAngle(up, -Math.atan2(a.z, a.x) - Math.PI / 16);
    sc.set(s, s * 0.8, s);
    mtx.compose(a, q, sc);
    tiles.setMatrixAt(i, mtx);
    ab[i] = p.born;
    ad[i] = p.died ?? 9999;
    const c = lin(p.color);
    ac[i * 3] = c.r;
    ac[i * 3 + 1] = c.g;
    ac[i * 3 + 2] = c.b;
    pos[i * 3] = a.x;
    pos[i * 3 + 1] = (big ? 2.2 : 4.2) + (isRoot(p) ? 1 : 0);
    pos[i * 3 + 2] = a.z;
  });
  tiles.frustumCulled = false;
  group.add(tiles);
  // Gold threads from parent to child
  const B = lineBuilder();
  const gold = lin('#f0c060');
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    const a = atOf(p.parent).clone().setY(0.8);
    const c = atOf(p.id).clone().setY(0.8);
    const m = a.clone().lerp(c, 0.5).setY(2.5);
    addCurveLine(B, new QuadraticBezierCurve3(a, m, c), big ? 10 : 18, p.born, p.id, gold);
  }
  const { lines, uni } = flowLines(B, U, 0.5);
  group.add(lines);
  // Floor: a slowly turning eight-fold girih lattice with gold generation rings
  const floorUni = {
    uTime: U.uTime,
    uBg: { value: lin('#000000') },
    uGold: { value: lin('#c8963e') },
    uStep: { value: R(1) },
    uMax: { value: R(M.maxGen) + 14 },
  };
  const floorMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: floorUni,
    vertexShader: `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform float uTime, uStep, uMax; uniform vec3 uBg, uGold; varying vec2 vP;
      void main() { float c = cos(uTime * .02), s = sin(uTime * .02); vec2 p = mat2(c, -s, s, c) * vP; float r = length(p), a = atan(p.y, p.x);
        float sec = abs(mod(a, .785398) - .392699); vec2 q = vec2(cos(sec), sin(sec)) * r; float S = 4.2;
        float l1 = abs(fract((q.x * .3827 + q.y * .9239) / S) - .5), l2 = abs(fract((q.x * .9239 - q.y * .3827) / S) - .5), l3 = abs(fract(q.x / S) - .5);
        float lat = smoothstep(.05, .0, min(min(l1, l2), l3) - .0);
        float ring = smoothstep(.12, .0, abs(fract(r / uStep + .5) - .5) * uStep - .1) * step(uStep * .5, r);
        float fade = 1. - smoothstep(uMax * .55, uMax * 1.05, r);
        vec3 col = uBg + uGold * (lat * .07 * (1. - smoothstep(uMax * .2, uMax * .9, r)) + ring * .4) * fade; gl_FragColor = vec4(col, 1.); }`,
  });
  const floor = new Mesh(new CircleGeometry(1200, 128), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.05;
  group.add(floor);
  const sky = skyDome(pp.top, pp.hor, pp.ground);
  group.add(sky.mesh);
  const tint = () => {
    const q2 = ctx.pal();
    floorUni.uBg.value.copy(lin(ctx.dark() ? '#081a20' : '#efe6d4'));
    sky.set(q2.top, q2.hor, q2.ground);
    ctx.look(ctx.dark() ? 0.7 : 0.12, q2.exposure);
  };
  const w = R(M.maxGen) + 10;
  return {
    key: 'mandala',
    group,
    pos,
    size: big ? 1.1 : 1.6,
    style: 0,
    lift: 5,
    tint,
    labelUp: true,
    hiTargets: [{ geo, perPerson: true }, { geo: lines.geometry }],
    focus: [tileUni.uFocus, uni.uFocus],
    view: { target: new Vector3(0, 0, 0), cam: new Vector3(w * 0.2, w * 1.75 + 12, w * 0.7) },
    follow: 30,
  };
};
