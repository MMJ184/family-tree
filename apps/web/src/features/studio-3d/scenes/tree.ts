import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { bake, barkMaterial, builder, makeFog, skyDome, softTex, tube } from '../gl.ts';
import { spouseIndex } from '../model.ts';
import { lin, rng } from '../palette.ts';
import { isRoot, type SceneBuilder } from './types.ts';

// Living Tree: the founder is the trunk and every line of descent is a real branch.

export const treeScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const pp = ctx.pal();
  const group = new Group();
  const pos = new Float32Array(M.n * 3);
  const spread = Math.max(1, Math.sqrt(M.n / 30));
  const H = 8.5 * spread ** 0.75;
  const trunk = 11 * spread ** 0.6;
  const R = (g: number) => (g === 0 ? 0 : (5 + g * 7.5) * spread);
  const rnd = rng(3);
  const jit = new Map<string, number>();
  for (const p of M.people) jit.set(p.id, rnd());
  const at = new Map<string, Vector3>();
  const atOf = (id: string | null) => (id ? at.get(id) : undefined) ?? new Vector3(0, trunk, 0);
  for (const p of M.people) {
    if (p.mi) continue;
    if (isRoot(p)) {
      at.set(p.id, new Vector3(0, trunk, 0));
      continue;
    }
    const th = p.ang * Math.PI * 2 * 0.985 + 0.4;
    const r = R(p.gen);
    at.set(
      p.id,
      new Vector3(
        Math.cos(th) * r,
        trunk + p.gen * H + ((jit.get(p.id) ?? 0.5) - 0.5) * 2.4 - r * 0.06,
        Math.sin(th) * r,
      ),
    );
  }
  for (const p of M.people) {
    if (!p.mi) continue;
    const a = atOf(p.anchor);
    const out = new Vector3(a.x, 0, a.z);
    if (out.lengthSq() < 0.01) out.set(1, 0, 0);
    out.normalize();
    const tan = new Vector3(-out.z, 0, out.x);
    const k = spouseIndex(M, p);
    at.set(
      p.id,
      a
        .clone()
        .addScaledVector(tan, (k % 2 ? -1 : 1) * (2.9 + Math.floor(k / 2) * 2.4))
        .add(new Vector3(0, -1.1, 0))
        .addScaledVector(out, -0.6),
    );
  }
  M.people.forEach((p, i) => {
    const v = atOf(p.id);
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z;
  });

  // Branches
  const B = builder();
  const maxLeaves = M.root.leaves;
  const rad = (leaves: number) => 0.16 + 0.95 * Math.sqrt(leaves / maxLeaves) * (big ? 1.6 : 1);
  const root = M.root;
  const base = new Vector3(0, -0.5, 0);
  tube(
    B,
    new CatmullRomCurve3([
      base,
      new Vector3(0.6, trunk * 0.35, 0.3),
      new Vector3(-0.4, trunk * 0.7, -0.2),
      atOf(root.id),
    ]),
    rad(root.leaves) * 2.1,
    rad(root.leaves) * 1.25,
    28,
    14,
    root.born - 1,
    root.id,
    2.5,
  );
  for (let k = 0; k < 7; k++) {
    // roots into the ground
    const a = (k / 7) * Math.PI * 2 + rnd() * 0.5;
    const L = 7 + rnd() * 8;
    tube(
      B,
      new CatmullRomCurve3([
        new Vector3(0, 1.2, 0),
        new Vector3(Math.cos(a) * L * 0.4, -0.1, Math.sin(a) * L * 0.4),
        new Vector3(Math.cos(a) * L, -0.9, Math.sin(a) * L),
      ]),
      rad(root.leaves) * 0.9,
      0.06,
      14,
      8,
      root.born - 2,
      '',
      2.5,
    );
  }
  const up = new Vector3(0, 1, 0);
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    const a = atOf(p.parent);
    const c = atOf(p.id);
    const d = c.clone().sub(a);
    const curve = new CatmullRomCurve3(
      [
        a.clone(),
        a
          .clone()
          .addScaledVector(d, 0.22)
          .addScaledVector(up, H * 0.42),
        a
          .clone()
          .addScaledVector(d, 0.68)
          .addScaledVector(up, H * 0.2),
        c.clone(),
      ],
      false,
      'centripetal',
    );
    tube(B, curve, rad(M.get(p.parent).leaves) * 0.82, rad(p.leaves) * 0.85, big ? 10 : 22, big ? 6 : 10, p.born, p.id);
  }
  for (const p of M.people) {
    // short twig to a spouse who married in
    if (!p.mi || !p.anchor) continue;
    const a = atOf(p.anchor);
    const c = atOf(p.id);
    const s = M.get(p.anchor).spouses.find((x) => x.id === p.id);
    tube(
      B,
      new CatmullRomCurve3([
        a.clone(),
        a
          .clone()
          .lerp(c, 0.5)
          .add(new Vector3(0, -0.8, 0)),
        c.clone(),
      ]),
      0.12,
      0.08,
      8,
      6,
      s ? s.year : p.born,
      p.id,
      1,
    );
  }
  const fog = makeFog();
  const barkGeo = bake(B);
  const bark = barkMaterial(U, fog);
  group.add(new Mesh(barkGeo, bark.mat));

  // Leaves: one instanced mesh; open after birth, turn amber and fall after death
  const leafCanvas = document.createElement('canvas');
  leafCanvas.width = 64;
  leafCanvas.height = 128;
  const lg = leafCanvas.getContext('2d');
  if (lg) {
    lg.fillStyle = '#fff';
    lg.beginPath();
    lg.moveTo(32, 4);
    lg.bezierCurveTo(62, 40, 58, 96, 32, 124);
    lg.bezierCurveTo(6, 96, 2, 40, 32, 4);
    lg.fill();
    lg.strokeStyle = 'rgba(0,0,0,0.35)';
    lg.lineWidth = 3;
    lg.beginPath();
    lg.moveTo(32, 10);
    lg.lineTo(32, 120);
    lg.stroke();
  }
  const leafTex = new CanvasTexture(leafCanvas);
  const per = big ? 7 : 22;
  const owners = M.people.filter((p) => !p.mi);
  const count = owners.length * per;
  const leafGeo = new PlaneGeometry(0.9, 1.6);
  leafGeo.translate(0, 0.8, 0);
  const lb = new Float32Array(count);
  const ld = new Float32Array(count);
  const lp = new Float32Array(count);
  const lc = new Float32Array(count * 3);
  leafGeo.setAttribute('aBirth', new InstancedBufferAttribute(lb, 1));
  leafGeo.setAttribute('aDeath', new InstancedBufferAttribute(ld, 1));
  leafGeo.setAttribute('aPhase', new InstancedBufferAttribute(lp, 1));
  leafGeo.setAttribute('aCol', new InstancedBufferAttribute(lc, 3));
  const leafFog = makeFog();
  const leafUni = {
    ...U,
    ...leafFog,
    uLeaf: { value: leafTex },
    uAutumn: { value: lin('#000000') },
    uFocus: { value: 0 },
  };
  const leafMat = new ShaderMaterial({
    side: DoubleSide,
    transparent: true,
    depthWrite: true,
    uniforms: leafUni,
    vertexShader: /* glsl */ `attribute float aBirth, aDeath, aPhase; attribute vec3 aCol; uniform float uYear, uEnter, uMinYear, uTime;
      varying vec2 vUv; varying vec3 vCol; varying float vA, vFall, vDepth;
      void main() { vUv = uv; float yr = mix(uMinYear - 3., uYear, uEnter);
        float grow = smoothstep(aBirth + .8, aBirth + 2.6, yr); float fall = max(yr - aDeath, 0.);
        vec3 p = position * grow; float sw = sin(uTime * 1.4 + aPhase) * .28; p.x += sw * p.y * .45; p.z += cos(uTime * 1.1 + aPhase) * .1 * p.y;
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.);
        float drop = fall * fall * 5.; w.y = max(w.y - drop, .05 + aPhase * .002); w.x += sin(fall * 2.5 + aPhase) * min(fall, 2.) * 1.2;
        vFall = clamp(fall * 1.5, 0., 1.); vCol = aCol; vA = grow * (1. - smoothstep(1.8, 3.2, fall));
        vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform sampler2D uLeaf; uniform vec3 uAutumn, uFogColor; uniform float uFogNear, uFogFar, uFocus;
      varying vec2 vUv; varying vec3 vCol; varying float vA, vFall, vDepth;
      void main() { vec4 tx = texture2D(uLeaf, vUv); if (tx.a < .5 || vA < .03) discard;
        vec3 c = mix(vCol, uAutumn, vFall) * (.75 + .35 * vUv.y);
        c = mix(c, c * .4, uFocus); c = mix(c, uFogColor, smoothstep(uFogNear, uFogFar, vDepth));
        gl_FragColor = vec4(c, vA); }`,
  });
  const leaves = new InstancedMesh(leafGeo, leafMat, Math.max(1, count));
  leaves.count = count;
  const mtx = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const sc = new Vector3();
  const lr = rng(9);
  let li = 0;
  const leafBase = lin(pp.leaf);
  for (const p of owners) {
    const c = atOf(p.id);
    const fam = lin(p.color);
    for (let k = 0; k < per; k++, li++) {
      const along =
        k < per * 0.3 && p.parent
          ? atOf(p.parent)
              .clone()
              .lerp(c, 0.45 + lr() * 0.5)
          : c.clone();
      const ph = lr() * Math.PI * 2;
      const rr = 0.8 + lr() * (k < per * 0.3 ? 1.2 : 3.4);
      along.add(new Vector3(Math.cos(ph) * rr, (lr() - 0.3) * 2.6, Math.sin(ph) * rr));
      e.set(lr() * 1.4 - 0.7, lr() * 6.28, lr() * 1.6 - 0.8);
      q.setFromEuler(e);
      const s = 0.6 + lr() * 0.8;
      sc.set(s, s, s);
      mtx.compose(along, q, sc);
      leaves.setMatrixAt(li, mtx);
      lb[li] = p.born + lr() * 1.5;
      ld[li] = (p.died ?? 9999) + lr() * 1.2;
      lp[li] = lr() * 100;
      const cc = leafBase
        .clone()
        .lerp(fam, 0.22 + lr() * 0.15)
        .multiplyScalar(0.8 + lr() * 0.45);
      lc[li * 3] = cc.r;
      lc[li * 3 + 1] = cc.g;
      lc[li * 3 + 2] = cc.b;
    }
  }
  leaves.frustumCulled = false;
  group.add(leaves);

  // Ground with generation contour rings, and fireflies
  const groundFog = makeFog();
  const gUni = {
    ...groundFog,
    uGround: { value: lin('#000000') },
    uRing: { value: lin('#000000') },
    uStep: { value: 7.5 * spread },
    uTime: U.uTime,
  };
  const gmat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: gUni,
    vertexShader: `varying vec2 vP; varying float vDepth; void main() { vP = position.xy; vec4 mv = modelViewMatrix * vec4(position, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uGround, uRing, uFogColor; uniform float uStep, uFogNear, uFogFar, uTime; varying vec2 vP; varying float vDepth;
      void main() { float r = length(vP); float ring = smoothstep(.12, 0., abs(fract((r - 5.) / uStep) - .5) - .47) * step(4., r);
        vec3 c = mix(uGround, uRing, ring * .7); float a = 1. - smoothstep(180., 420., r);
        c = mix(c, uFogColor, smoothstep(uFogNear, uFogFar, vDepth)); gl_FragColor = vec4(c, a); }`,
  });
  const ground = new Mesh(new CircleGeometry(440, 96), gmat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1;
  group.add(ground);
  const fN = 260;
  const fp = new Float32Array(fN * 3);
  const fph = new Float32Array(fN);
  const top = trunk + (M.maxGen + 1) * H;
  const wide = R(M.maxGen) + 10;
  for (let i = 0; i < fN; i++) {
    const a = rnd() * 6.28;
    const r = rnd() * wide;
    fp[i * 3] = Math.cos(a) * r;
    fp[i * 3 + 1] = 2 + rnd() * top;
    fp[i * 3 + 2] = Math.sin(a) * r;
    fph[i] = rnd() * 50;
  }
  const fg = new BufferGeometry();
  fg.setAttribute('position', new BufferAttribute(fp, 3));
  fg.setAttribute('aPh', new BufferAttribute(fph, 1));
  const fireUni = {
    uTime: U.uTime,
    uCol: { value: lin('#000000') },
    uTex: {
      value: softTex([
        [0, 'rgba(255,255,255,1)'],
        [0.25, 'rgba(255,255,255,0.5)'],
        [1, 'rgba(255,255,255,0)'],
      ]),
    },
  };
  const fire = new Points(
    fg,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: fireUni,
      vertexShader: `attribute float aPh; uniform float uTime; varying float vA; void main() { vec3 p = position; p.y += sin(uTime * .4 + aPh) * 1.5; p.x += cos(uTime * .3 + aPh) * 1.2;
        vA = .4 + .6 * sin(uTime * 1.7 + aPh * 3.); vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = 70. / -mv.z * (1. + vA); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; uniform vec3 uCol; varying float vA; void main() { float a = texture2D(uTex, gl_PointCoord).a * max(vA, 0.); gl_FragColor = vec4(uCol * 2.2 * a, 1.); }`,
    }),
  );
  group.add(fire);
  const sky = skyDome(pp.top, pp.hor, pp.ground);
  group.add(sky.mesh);

  const tint = () => {
    const q2 = ctx.pal();
    bark.uni.uBarkA.value.copy(lin(q2.barkA));
    bark.uni.uBarkB.value.copy(lin(q2.barkB));
    bark.uni.uGlow.value.copy(lin(q2.glow));
    bark.uni.uSky.value.copy(lin(q2.skyL));
    bark.uni.uGround.value.copy(lin(q2.groundL));
    for (const f of [fog, leafFog, groundFog]) {
      f.uFogNear.value = q2.fogNear;
      f.uFogFar.value = q2.fogFar;
      f.uFogColor.value.copy(lin(q2.fog));
    }
    leafUni.uAutumn.value.copy(lin(q2.autumn));
    gUni.uGround.value.copy(lin(q2.ground));
    gUni.uRing.value.copy(lin(q2.ring));
    fireUni.uCol.value.copy(lin(q2.fire)).multiplyScalar(ctx.dark() ? 1 : 0.35);
    sky.set(q2.top, q2.hor, q2.ground);
    ctx.look(q2.bloom, q2.exposure);
  };
  tint();
  const top2 = trunk + M.maxGen * H;
  const w = R(M.maxGen);
  const D = Math.max(w * 1.15, top2 * 1.05) + 26;
  return {
    key: 'tree',
    group,
    pos,
    size: big ? 1.35 : 2.1,
    style: 0,
    lift: 6,
    tint,
    hiTargets: [{ geo: barkGeo }],
    focus: [bark.uni.uFocus, leafUni.uFocus],
    view: { target: new Vector3(0, top2 * 0.56, 0), cam: new Vector3(D * 0.62, top2 * 0.7 + 6, D * 0.86) },
    follow: big ? 40 : 50,
  };
};
