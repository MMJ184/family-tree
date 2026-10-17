import {
  BoxGeometry,
  CubicBezierCurve3,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  ShaderMaterial,
  type Sprite,
  Vector3,
} from 'three';
import { addCurveLine, flowLines, lineBuilder, makeFog, NOISE, retextSprite, skyDome, textSprite } from '../gl.ts';
import { type StudioBusiness, spouseIndex } from '../model.ts';
import { lin, rng } from '../palette.ts';
import type { SceneBuilder } from './types.ts';

// Heritage City: every person is a tower whose height is the size of their line. Windows go
// dark at death, light bridges join parent and child, businesses are lit shopfronts.

const SIGN_INK = '#1b1408';
const SIGN_BG = 'rgba(255,214,140,0.95)';

export const cityScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const pp = ctx.pal();
  const group = new Group();
  const pos = new Float32Array(M.n * 3);
  const r = rng(21);
  const W = Math.max(60, M.root.leaves * (big ? 3.3 : 8));
  const DZ = big ? 9 : 13;
  const foot = big ? 1.5 : 3.2;
  const base = new Map<string, Vector3>();
  const hgt = new Map<string, number>();
  for (const p of M.people) {
    if (p.mi) continue;
    base.set(p.id, new Vector3((p.ang - 0.5) * W, 0, (p.gen - Math.floor(M.maxGen / 2)) * DZ));
    hgt.set(p.id, (big ? 2.5 : 4) + Math.sqrt(p.leaves) * (big ? 3.6 : 6.5) + r() * 1.5);
  }
  for (const p of M.people) {
    if (!p.mi) continue;
    const i = spouseIndex(M, p);
    const a = (p.anchor ? base.get(p.anchor) : undefined) ?? new Vector3();
    base.set(
      p.id,
      a.clone().add(new Vector3((i % 2 ? -1 : 1) * foot * 1.15, 0, foot * 0.9 + Math.floor(i / 2) * foot)),
    );
    hgt.set(p.id, ((p.anchor ? hgt.get(p.anchor) : undefined) ?? 6) * 0.45 + 1.5);
  }
  const baseOf = (id: string) => base.get(id) ?? new Vector3();
  const hOf = (id: string) => hgt.get(id) ?? 4;
  const geo = new BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const n = M.n;
  const ab = new Float32Array(n);
  const ad = new Float32Array(n);
  const as = new Float32Array(n);
  const ac = new Float32Array(n * 3);
  geo.setAttribute('aBirth', new InstancedBufferAttribute(ab, 1));
  geo.setAttribute('aDeath', new InstancedBufferAttribute(ad, 1));
  geo.setAttribute('aSeed', new InstancedBufferAttribute(as, 1));
  geo.setAttribute('aCol', new InstancedBufferAttribute(ac, 3));
  geo.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(n), 1));
  geo.userData.keys = M.people.map((p) => p.id);
  const fog = makeFog();
  const towerUni = {
    ...U,
    ...fog,
    uWall: { value: lin('#000000') },
    uWin: { value: lin('#ffc870') },
    uNight: { value: 1 },
    uFocus: { value: 0 },
  };
  const towerMat = new ShaderMaterial({
    uniforms: towerUni,
    vertexShader: /* glsl */ `attribute float aBirth, aDeath, aSeed, aHi; attribute vec3 aCol; uniform float uYear, uEnter, uMinYear;
      varying vec3 vW, vN, vCol; varying float vDead, vSeed, vHi, vTop, vDepth;
      void main() { float yr = mix(uMinYear - 3., uYear, uEnter); float grow = smoothstep(aBirth, aBirth + 2.5, yr);
        vec3 p = position * vec3(grow, max(grow, .001), grow); vTop = position.y;
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vCol = aCol; vDead = step(aDeath, yr); vSeed = aSeed; vHi = aHi; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform vec3 uWall, uWin, uFogColor; uniform float uFogNear, uFogFar, uFocus, uNight;
      varying vec3 vW, vN, vCol; varying float vDead, vSeed, vHi, vTop, vDepth;
      ${NOISE}
      void main() { vec3 n = normalize(vN); vec3 col; float shade = .55 + .45 * max(dot(n, normalize(vec3(.4, .8, .3))), 0.);
        if (n.y > .5) col = vCol * (.55 + .5 * vHi) + uWall * .3;
        else {
          vec2 fc = vec2(abs(n.x) > .5 ? vW.z : vW.x, vW.y); vec2 cell = floor(fc / vec2(.8, 1.1)), gg = fract(fc / vec2(.8, 1.1));
          float win = step(.2, gg.x) * step(gg.x, .78) * step(.28, gg.y) * step(gg.y, .8) * step(.6, vW.y);
          float on = step(.4, hash(cell + vSeed * 17.)) * (1. - vDead * .92);
          col = uWall * shade + win * on * uWin * (1.2 + .8 * hash(cell * 3.1)) * uNight + win * (1. - on) * uWall * .35;
          col += vCol * smoothstep(.9, 1., vTop) * 1.1;
          col = mix(col, col * 1.2 + vCol * .25, vHi);
        }
        col = mix(col, col * .35, uFocus * (1. - step(.5, vHi)));
        gl_FragColor = vec4(mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vDepth)), 1.); }`,
  });
  const towers = new InstancedMesh(geo, towerMat, n);
  const mtx = new Matrix4();
  M.people.forEach((p, i) => {
    const b = baseOf(p.id);
    const f = p.mi ? foot * 0.7 : foot;
    mtx.makeScale(f, hOf(p.id), f).setPosition(b.x, 0, b.z);
    towers.setMatrixAt(i, mtx);
    ab[i] = p.born;
    ad[i] = p.died ?? 9999;
    as[i] = r() * 10;
    const c = lin(p.color);
    ac[i * 3] = c.r;
    ac[i * 3 + 1] = c.g;
    ac[i * 3 + 2] = c.b;
    pos[i * 3] = b.x;
    pos[i * 3 + 1] = hOf(p.id) + (big ? 1.6 : 2.6);
    pos[i * 3 + 2] = b.z;
  });
  towers.frustumCulled = false;
  group.add(towers);
  // Light bridges from each parent's roof to each child's roof
  const B = lineBuilder();
  const amber = lin('#ffc870');
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    const a = baseOf(p.parent).clone().setY(hOf(p.parent));
    const c = baseOf(p.id).clone().setY(hOf(p.id));
    addCurveLine(
      B,
      new CubicBezierCurve3(a, a.clone().setY(a.y + 7), c.clone().setY(c.y + 7), c),
      big ? 10 : 20,
      p.born,
      p.id,
      amber,
    );
  }
  const { lines, uni } = flowLines(B, U, 0.45);
  group.add(lines);
  // Family businesses as glowing shopfronts with a sign
  const shops: Object3D[] = [];
  const signs: Array<{ s: Sprite; bz: StudioBusiness }> = [];
  const bizName = (bz: StudioBusiness) => (ctx.lang() === 'ar' ? bz.ar : bz.en);
  for (const bz of M.biz) {
    const owners = bz.owners.map((o) => base.get(o)).filter((v): v is Vector3 => !!v);
    if (!owners.length) continue;
    const c = owners
      .reduce((s, v) => s.add(v), new Vector3())
      .multiplyScalar(1 / owners.length)
      .add(new Vector3(0, 0, DZ * 0.5));
    const shop = new Mesh(
      new BoxGeometry(6, 2.2, 3),
      new MeshBasicMaterial({ color: lin('#e2b05a').multiplyScalar(1.4) }),
    );
    shop.position.copy(c).setY(0.9);
    const sign = textSprite(bizName(bz), SIGN_INK, 2.6, SIGN_BG, ctx.rtl());
    sign.position.copy(c).setY(4.4);
    shop.userData.year = bz.year;
    sign.userData.year = bz.year;
    group.add(shop, sign);
    shops.push(shop, sign);
    signs.push({ s: sign, bz });
  }
  const groundFog = makeFog();
  const groundUni = { ...groundFog, uC: { value: lin(pp.ground) }, uL: { value: lin('#ffc870') }, uDZ: { value: DZ } };
  const ground = new Mesh(
    new PlaneGeometry(2400, 2400),
    new ShaderMaterial({
      uniforms: groundUni,
      vertexShader: `varying vec2 vP; varying float vDepth; void main() { vP = position.xy; vec4 mv = modelViewMatrix * vec4(position, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uC, uL, uFogColor; uniform float uDZ, uFogNear, uFogFar; varying vec2 vP; varying float vDepth;
        void main() { float sy = abs(fract((vP.y + uDZ * .5) / uDZ) - .5) * uDZ; float street = smoothstep(.25, .0, abs(sy - uDZ * .5 + .3));
          float dash = step(.5, fract(vP.x * .25)); float near = 1. - smoothstep(60., 160., length(vP)); vec3 c = uC + uL * street * dash * .12 * near;
          gl_FragColor = vec4(mix(c, uFogColor, smoothstep(uFogNear, uFogFar, vDepth)), 1.); }`,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);
  const dark0 = ctx.dark();
  const sky = skyDome(dark0 ? '#050816' : pp.top, dark0 ? '#3a1f33' : pp.hor, pp.ground);
  group.add(sky.mesh);
  const tint = () => {
    const q = ctx.pal();
    const dark = ctx.dark();
    towerUni.uWall.value.copy(lin(dark ? '#1b2330' : '#9aa6ad'));
    towerUni.uNight.value = dark ? 1 : 0.18;
    for (const f of [fog, groundFog]) {
      f.uFogColor.value.copy(lin(dark ? '#1a1424' : q.fog));
      f.uFogNear.value = q.fogNear;
      f.uFogFar.value = q.fogFar;
    }
    groundUni.uC.value.copy(lin(dark ? '#0b0d13' : '#cfc8bb'));
    sky.set(dark ? '#050816' : q.top, dark ? '#3a1f33' : q.hor, q.ground);
    ctx.look(dark ? 0.85 : 0.15, q.exposure);
  };
  const yearHook = (yr: number) => {
    for (const o of shops) o.visible = yr >= (o.userData.year as number);
  };
  const relang = () => {
    for (const { s, bz } of signs) retextSprite(s, bizName(bz), SIGN_INK, 2.6, SIGN_BG, ctx.rtl());
  };
  const depth = (M.maxGen + 1) * DZ;
  const tallest = Math.max(...hgt.values());
  return {
    key: 'city',
    group,
    pos,
    size: big ? 1.15 : 1.75,
    style: 0,
    lift: 7,
    tint,
    yearHook,
    relang,
    labelUp: true,
    hiTargets: [{ geo, perPerson: true }, { geo: lines.geometry }],
    focus: [towerUni.uFocus, uni.uFocus],
    view: {
      target: new Vector3(0, tallest * 0.3, 0),
      cam: new Vector3(W * 0.42, tallest * 1.4 + depth * 0.55, depth * 0.8 + W * 0.42),
    },
    follow: 36,
  };
};
