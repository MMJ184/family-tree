import {
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { bake, barkMaterial, builder, makeFog, NOISE, skyDome, tube } from '../gl.ts';
import { spouseYear } from '../model.ts';
import { lin, rng } from '../palette.ts';
import { bonsaiLayout } from './bonsai-layout.ts';
import { isRoot, type SceneBuilder } from './types.ts';

// Bonsai: the family as a small moyogi (informal upright) tree in a glazed pot, lit like a
// studio product shot. The founder sits where the trunk opens into the crown, each line of
// descent is a wired branch, and the youngest generations sit on the outer foliage pads.

/** Studio colours for this scene (sRGB hex), per theme. */
const LOOK = {
  light: {
    wallTop: '#d9d6d0',
    wallLow: '#f3f1ec',
    floor: '#efece6',
    pool: '#fbfaf7',
    shadow: '#a39c90',
    glazeA: '#1d3b52',
    glazeB: '#3f6f8a',
    leafLow: '#2f5a37',
    leafTop: '#86ad5f',
    dead: '#b9b2a2',
    moss: '#62803a',
    soil: '#5a4a38',
    stone: '#6e6a63',
    key: '#fffaf0',
    bloom: 0.06,
    exposure: 0.98,
  },
  dark: {
    wallTop: '#07080a',
    wallLow: '#1a1c20',
    floor: '#16181b',
    pool: '#2c2f34',
    shadow: '#040506',
    glazeA: '#1d3542',
    glazeB: '#4d7f8c',
    leafLow: '#1e4029',
    leafTop: '#79a65a',
    dead: '#8e877a',
    moss: '#45612a',
    soil: '#3a2f24',
    stone: '#6f6c67',
    key: '#fff3dc',
    bloom: 0.2,
    exposure: 1.02,
  },
};
type Look = typeof LOOK.light;

// Shared studio lighting: a large key softbox (upper left, front), a cool fill and a rim from behind.
const LIGHTS = /* glsl */ `
  uniform vec3 uKey;
  vec3 studio(vec3 base, vec3 n, vec3 V, float gloss, float wrap) {
    vec3 L1 = normalize(vec3(-.55, .8, .6)), L2 = normalize(vec3(.8, .25, .45)), L3 = normalize(vec3(.2, .5, -1.));
    float k = clamp((dot(n, L1) + wrap) / (1. + wrap), 0., 1.);
    float f = max(dot(n, L2), 0.);
    float rim = pow(1. - max(dot(n, V), 0.), 3.) * max(dot(n, L3) + .4, 0.);
    float sky = n.y * .5 + .5;
    vec3 c = base * (.2 + .22 * sky + uKey * k * .95 + vec3(.72, .8, .9) * f * .22) + uKey * rim * .35;
    vec3 R = reflect(-V, n);
    float soft = smoothstep(.86, .97, dot(R, L1));
    c += uKey * (soft * .55 + pow(max(dot(R, L2), 0.), 40.) * .18) * gloss;
    return c;
  }`;

export const bonsaiScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const look = (): Look => (ctx.dark() ? LOOK.dark : LOOK.light);
  const L0 = look();
  const group = new Group();
  const pos = new Float32Array(M.n * 3);
  const m = ctx.rtl() ? -1 : 1;
  const size = big ? 0.66 : 1.05;
  const disc = size * 2.3 * 0.685; // visible medal diameter
  const S = disc * (big ? 1.3 : 1.5); // spacing between portraits
  const rnd = rng(17);
  const L = bonsaiLayout(M, S, big, rng(5));
  const { R, Cy, Cz } = L;
  const C = new Vector3(0, Cy, Cz);
  const at = (i: number) => new Vector3((L.X[i] ?? 0) * m, L.Y[i] ?? 0, L.Z[i] ?? 0);
  for (let i = 0; i < M.n; i++) {
    const v = at(i);
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z;
  }
  const atId = (id: string) => at(M.get(id).idx);

  // Trunk: an S-curved spine from the soil to the founder, with a short leader into the crown
  const B = builder();
  let cx0 = 0;
  let cx1 = 0;
  for (const pad of L.pads) {
    cx0 = Math.min(cx0, pad.x - pad.rx);
    cx1 = Math.max(cx1, pad.x + pad.rx);
  }
  const potW = Math.max(R * 0.28, (cx1 - cx0) * 0.22);
  const rT = 0.11 * potW + 0.2;
  const leaderTop = new Vector3(-0.04 * R * m, Cy + R * 0.2, Cz * 1.1);
  const spine = new CatmullRomCurve3(
    [
      new Vector3(0, -0.2, 0),
      new Vector3(0.32 * potW * m, Cy * 0.22, 0.03 * R),
      new Vector3(-0.26 * potW * m, Cy * 0.52, 0.06 * R),
      new Vector3(0.12 * potW * m, Cy * 0.8, 0.09 * R),
      C,
      leaderTop,
    ],
    false,
    'centripetal',
  );
  const root = M.root;
  tube(B, spine, rT, rT * 0.22, big ? 40 : 56, big ? 12 : 16, root.born - 1, root.id, 2.6);
  // Nebari: surface roots flaring into the moss
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.4 + rnd() * 0.4;
    const len = potW * (0.4 + rnd() * 0.25);
    tube(
      B,
      new CatmullRomCurve3([
        new Vector3(0, rT * 0.9, 0),
        new Vector3(Math.cos(a) * len * 0.4, 0.05, Math.sin(a) * len * 0.3),
        new Vector3(Math.cos(a) * len, -0.15, Math.sin(a) * len * 0.62),
      ]),
      rT * 0.55,
      0.05,
      10,
      8,
      root.born - 2,
      '',
      2.4,
    );
  }
  const sp = spine.getSpacedPoints(80);
  const startFor = (child: Vector3) => {
    // side branches leave low on the trunk, upper ones higher up the leader
    const up = Math.max(0, (child.y - Cy) / R);
    const hy = Cy + Math.min(1, up) * (leaderTop.y - Cy) * 0.9;
    for (const q of sp) if (q.y >= hy - 1e-3 && q.y >= Cy * 0.98) return q.clone();
    return (sp[sp.length - 1] ?? C).clone();
  };
  const maxLeaves = Math.max(1, root.leaves);
  const rad = (leaves: number) => 0.03 + S * 0.03 + rT * 0.5 * Math.sqrt(leaves / maxLeaves);
  const down = new Vector3(0, -1, 0);
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    const par = M.get(p.parent);
    const c = atId(p.id);
    const a = isRoot(par) ? startFor(c) : atId(par.id);
    const d = c.clone().sub(a);
    const len = d.length();
    const short = len < S * 2.2;
    // wired look: dips out from the parent, then the tip rises to the pad
    const side = new Vector3(-d.y, d.x, 0).normalize().multiplyScalar(len * 0.07 * (rnd() < 0.5 ? -1 : 1));
    const curve = short
      ? new CatmullRomCurve3([
          a,
          a
            .clone()
            .lerp(c, 0.5)
            .addScaledVector(down, len * 0.12),
          c,
        ])
      : new CatmullRomCurve3(
          [
            a,
            a
              .clone()
              .addScaledVector(d, 0.33)
              .addScaledVector(down, len * 0.08)
              .add(side),
            a
              .clone()
              .addScaledVector(d, 0.72)
              .addScaledVector(down, len * 0.02),
            c,
          ],
          false,
          'centripetal',
        );
    tube(
      B,
      curve,
      rad(par.leaves) * 0.85,
      rad(p.leaves) * 0.7,
      short ? 5 : big ? 10 : 16,
      big ? 5 : 7,
      p.born,
      p.id,
      short ? 1 : 1.6,
    );
  }
  for (const p of M.people) {
    // short twig to a spouse who married in
    if (!p.mi || !p.anchor) continue;
    const a = atId(p.anchor);
    const c = atId(p.id);
    const s = M.get(p.anchor).spouses.find((x) => x.id === p.id);
    tube(
      B,
      new CatmullRomCurve3([
        a,
        a
          .clone()
          .lerp(c, 0.5)
          .addScaledVector(down, S * 0.2),
        c,
      ]),
      rad(1) * 0.5,
      rad(1) * 0.4,
      5,
      5,
      s ? s.year : p.born,
      p.id,
      1,
    );
  }
  const fog = makeFog();
  const barkGeo = bake(B);
  const bark = barkMaterial(U, fog);
  group.add(new Mesh(barkGeo, bark.mat));

  // Foliage pads: faceted clouds behind every slot of every pad; one instanced mesh
  const perCell = big ? 1 : 2;
  const puffH = big ? 0.78 : 0.62;
  let count = 0;
  for (const pad of L.pads) count += pad.cells.length * perCell;
  const puffGeo = new IcosahedronGeometry(1, 1);
  const pb = new Float32Array(count);
  const pd = new Float32Array(count);
  const ps = new Float32Array(count);
  const ph = new Float32Array(count);
  const keys: string[] = [];
  const puffUni = {
    ...U,
    uLow: { value: lin(L0.leafLow) },
    uTop: { value: lin(L0.leafTop) },
    uDead: { value: lin(L0.dead) },
    uKey: { value: lin(L0.key) },
    uFocus: { value: 0 },
  };
  const puffMat = new ShaderMaterial({
    uniforms: puffUni,
    vertexShader: /* glsl */ `attribute float aBirth, aDeath, aSeed, aHi; uniform float uYear, uEnter, uMinYear, uTime;
      varying vec3 vW; varying float vSeed, vDead, vHi, vLocalY;
      void main() { float yr = mix(uMinYear - 3., uYear, uEnter);
        float grow = smoothstep(aBirth + .3, aBirth + 2.2, yr);
        vec3 p = position * grow; vLocalY = position.y;
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.);
        w.x += sin(uTime * .7 + aSeed * 40.) * .03 * grow; w.y += cos(uTime * .55 + aSeed * 31.) * .02 * grow;
        vW = w.xyz; vSeed = aSeed; vDead = smoothstep(aDeath + .5, aDeath + 2.5, yr); vHi = aHi;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform vec3 uLow, uTop, uDead; uniform float uFocus;
      varying vec3 vW; varying float vSeed, vDead, vHi, vLocalY;
      ${LIGHTS}
      void main() { vec3 n = normalize(cross(dFdx(vW), dFdy(vW))); vec3 V = normalize(cameraPosition - vW);
        if (dot(n, V) < 0.) n = -n;
        float t = clamp(vLocalY * .5 + .5, 0., 1.) * .6 + n.y * .4;
        vec3 base = mix(uLow, uTop, clamp(t + (vSeed - .5) * .3, 0., 1.));
        base = mix(base, uDead, vDead * .6);
        vec3 c = studio(base, n, V, .06, .3);
        c = mix(c, c * .32, uFocus * (1. - step(.5, vHi)));
        gl_FragColor = vec4(c, 1.); }`,
  });
  const puffs = new InstancedMesh(puffGeo, puffMat, Math.max(1, count));
  const mtx = new Matrix4();
  const q = new Quaternion();
  const sc = new Vector3();
  const v = new Vector3();
  const yAxis = new Vector3(0, 1, 0);
  let k = 0;
  for (const pad of L.pads) {
    const first = pad.members.reduce((y, p) => Math.min(y, p.born), 9999);
    const rootId = pad.roots[0] ?? root.id;
    for (const cell of pad.cells) {
      const p = cell.id ? M.get(cell.id) : null;
      for (let j = 0; j < perCell; j++, k++) {
        const edge = Math.min(1, ((cell.x - pad.x) / pad.rx) ** 2 + ((cell.y - pad.y) / pad.ry) ** 2);
        v.set(
          (cell.x + (rnd() - 0.5) * S * (j ? 0.9 : 0.3)) * m,
          cell.y - S * (0.2 + rnd() * 0.12) - j * S * 0.12,
          cell.z - S * (0.5 + rnd() * 0.25),
        );
        q.setFromAxisAngle(yAxis, rnd() * Math.PI * 2);
        const s = S * (j ? 0.5 : big ? 0.74 : 0.66) * (0.85 + rnd() * 0.3) * (1 - edge * 0.25);
        sc.set(s * 1.3, s * puffH, s * 1.1);
        mtx.compose(v, q, sc);
        puffs.setMatrixAt(k, mtx);
        pb[k] = (p ? (p.mi ? spouseYear(M, p) : p.born) : first + 4) + rnd();
        pd[k] = (p?.died ?? 9999) + rnd();
        ps[k] = rnd();
        keys.push(p ? p.id : rootId);
      }
    }
  }
  puffGeo.setAttribute('aBirth', new InstancedBufferAttribute(pb, 1));
  puffGeo.setAttribute('aDeath', new InstancedBufferAttribute(pd, 1));
  puffGeo.setAttribute('aSeed', new InstancedBufferAttribute(ps, 1));
  puffGeo.setAttribute('aHi', new InstancedBufferAttribute(ph, 1));
  puffGeo.userData.keys = keys;
  puffs.count = count;
  puffs.frustumCulled = false;
  group.add(puffs);

  // Shallow oval pot with a glossy glaze
  const PX = potW;
  const PZ = 0.64 * potW;
  const PH = 0.27 * potW;
  const potTop = 0.05 * potW;
  const prof = [
    [0.0, 0],
    [0.86, 0],
    [0.9, 0.03],
    [0.93, 0.12],
    [0.97, 0.78],
    [1.0, 0.9],
    [1.035, 0.94],
    [1.03, 1.0],
    [0.95, 1.0],
    [0.93, 0.86],
    [0.0, 0.86],
  ].map(([r, y]) => new Vector2(r ?? 0, y ?? 0));
  const potGeo = new LatheGeometry(prof, 72);
  potGeo.scale(PX, PH, PZ);
  potGeo.translate(0, potTop - PH, 0);
  potGeo.computeVertexNormals();
  const glazeUni = { uA: { value: lin(L0.glazeA) }, uB: { value: lin(L0.glazeB) }, uKey: { value: lin(L0.key) } };
  const potMat = new ShaderMaterial({
    uniforms: glazeUni,
    vertexShader: /* glsl */ `varying vec3 vN, vW; varying float vY; void main() { vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vY = position.y;
      gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform vec3 uA, uB; varying vec3 vN, vW; varying float vY;
      ${NOISE}
      ${LIGHTS}
      void main() { vec3 n = normalize(vN); vec3 V = normalize(cameraPosition - vW);
        float drip = noise(vec2(atan(vW.z, vW.x) * 14., vY * 2.)) * .6 + noise(vW.xz * 1.7) * .4;
        vec3 base = mix(uA, uB, drip * .18 + smoothstep(.5, 1., n.y) * .2);
        vec3 c = studio(base, n, V, 1.1, .1);
        float fr = pow(1. - max(dot(n, V), 0.), 4.); c += uKey * fr * .12;
        gl_FragColor = vec4(c, 1.); }`,
  });
  const pot = new Mesh(potGeo, potMat);
  group.add(pot);
  // Moss over the soil, and a small stone
  const soilY = potTop - PH * 0.14;
  const mossGeo = new RingGeometry(0, 1, 64, 8);
  mossGeo.rotateX(-Math.PI / 2);
  {
    // a low mound of moss, slightly above the pot's inner floor
    const mp = mossGeo.getAttribute('position');
    for (let i = 0; i < mp.count; i++) {
      const r2 = mp.getX(i) ** 2 + mp.getZ(i) ** 2;
      mp.setY(i, 0.012 * potW + (1 - r2) * 0.07 * potW);
    }
  }
  mossGeo.scale(PX * 0.94, 1, PZ * 0.92);
  mossGeo.translate(0, soilY, 0);
  const mossUni = { uMoss: { value: lin(L0.moss) }, uSoil: { value: lin(L0.soil) }, uKey: { value: lin(L0.key) } };
  const moss = new Mesh(
    mossGeo,
    new ShaderMaterial({
      uniforms: mossUni,
      vertexShader: /* glsl */ `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `uniform vec3 uMoss, uSoil; varying vec3 vW;
        ${NOISE}
        ${LIGHTS}
        void main() { float a = noise(vW.xz * 1.6) * .55 + noise(vW.xz * 5.) * .3 + noise(vW.xz * 14.) * .15;
          vec3 base = mix(uSoil, uMoss, smoothstep(.12, .32, a)) * (.85 + .22 * noise(vW.xz * 9.));
          vec3 n = normalize(vec3((noise(vW.xz * 5. + 3.) - .5) * .6, 1., (noise(vW.xz * 5. - 7.) - .5) * .6));
          gl_FragColor = vec4(studio(base, n, normalize(cameraPosition - vW), 0., .4), 1.); }`,
    }),
  );
  group.add(moss);
  const stoneUni = { uC: { value: lin(L0.stone) }, uKey: { value: lin(L0.key) } };
  const stoneMat = new ShaderMaterial({
    uniforms: stoneUni,
    vertexShader: /* glsl */ `varying vec3 vW; void main() { vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform vec3 uC; varying vec3 vW;
      ${NOISE}
      ${LIGHTS}
      void main() { vec3 n = normalize(cross(dFdx(vW), dFdy(vW))); vec3 V = normalize(cameraPosition - vW); if (dot(n, V) < 0.) n = -n;
        vec3 base = uC * (.85 + .3 * noise(vW.xy * 3.));
        gl_FragColor = vec4(studio(base, n, V, .15, .2), 1.); }`,
  });
  const stones = new InstancedMesh(new IcosahedronGeometry(1, 1), stoneMat, 2);
  mtx.compose(
    new Vector3(-0.42 * PX * m, soilY + 0.03 * potW, 0.25 * PZ),
    new Quaternion().setFromAxisAngle(yAxis, 0.6),
    new Vector3(0.2 * potW, 0.11 * potW, 0.15 * potW),
  );
  stones.setMatrixAt(0, mtx);
  mtx.compose(
    new Vector3(-0.27 * PX * m, soilY + 0.015 * potW, 0.42 * PZ),
    new Quaternion().setFromAxisAngle(yAxis, 1.9),
    new Vector3(0.09 * potW, 0.05 * potW, 0.075 * potW),
  );
  stones.setMatrixAt(1, mtx);
  group.add(stones);

  // Seamless sweep: floor curving up into a back wall, with a light pool and a contact shadow
  const floorY = potTop - PH - 0.06 * potW;
  const back = -1.5 * R;
  const bend = 2.2 * R;
  const prof2: Array<[number, number, number]> = [];
  for (let j = 0; j <= 10; j++) prof2.push([floorY, 600 - (j / 10) * (600 - back), 0]);
  for (let j = 1; j <= 24; j++) {
    const a = (j / 24) * (Math.PI / 2);
    prof2.push([floorY + bend * (1 - Math.cos(a)), back - bend * Math.sin(a), 0.5 * (j / 24)]);
  }
  for (let j = 1; j <= 8; j++) prof2.push([floorY + bend + (j / 8) * 900, back - bend, 0.5 + 0.5 * (j / 8)]);
  const sv: number[] = [];
  const sf: number[] = [];
  const si: number[] = [];
  const cols = 24;
  prof2.forEach(([y, z, f], j) => {
    for (let c = 0; c <= cols; c++) {
      sv.push((c / cols - 0.5) * 1600, y, z);
      sf.push(f);
      if (j > 0 && c < cols) {
        const a = (j - 1) * (cols + 1) + c;
        const b = j * (cols + 1) + c;
        si.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  });
  const sweepGeo = new BufferGeometry();
  sweepGeo.setAttribute('position', new Float32BufferAttribute(sv, 3));
  sweepGeo.setAttribute('aF', new Float32BufferAttribute(sf, 1));
  sweepGeo.setIndex(si);
  const sweepUni = {
    uTop: { value: lin(L0.wallTop) },
    uLow: { value: lin(L0.wallLow) },
    uFloor: { value: lin(L0.floor) },
    uPool: { value: lin(L0.pool) },
    uShadow: { value: lin(L0.shadow) },
    uPot: { value: new Vector3(PX, PZ, R) },
    uFloorY: { value: floorY },
  };
  const sweep = new Mesh(
    sweepGeo,
    new ShaderMaterial({
      uniforms: sweepUni,
      vertexShader: /* glsl */ `attribute float aF; varying float vF; varying vec3 vW; void main() { vF = aF; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `uniform vec3 uTop, uLow, uFloor, uPool, uShadow, uPot; uniform float uFloorY; varying float vF; varying vec3 vW;
        float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() { float R = uPot.z;
          float pool = 1. - smoothstep(0., 3.4 * R, length(vec2(vW.x * .7, vW.z + .3 * R)));
          vec3 floorC = mix(uFloor, uPool, pool);
          float wallH = clamp((vW.y - uFloorY) / (5. * R), 0., 1.);
          vec3 wallC = mix(mix(uLow, uPool, (1. - smoothstep(0., 2.6 * R, abs(vW.x))) * .5), uTop, smoothstep(.0, 1., wallH));
          vec3 c = mix(floorC, wallC, smoothstep(.0, .6, vF));
          float onFloor = 1. - smoothstep(.0, .25, vF);
          float contact = 1. - smoothstep(.8, 1.7, length(vec2(vW.x / uPot.x, vW.z / uPot.y)));
          float drop = 1. - smoothstep(.2, 1., length(vec2((vW.x - .45 * R) / (1.7 * R), (vW.z + .7 * R) / (1.0 * R))));
          c = mix(c, uShadow, onFloor * (contact * .8 + drop * .22));
          c *= 1. - smoothstep(4. * R, 14. * R, length(vW.xz)) * .35;
          c += (h(gl_FragCoord.xy) - .5) / 255.;
          gl_FragColor = vec4(c, 1.); }`,
    }),
  );
  group.add(sweep);
  const sky = skyDome(L0.wallTop, L0.wallLow, L0.floor);
  sky.mesh.renderOrder = -2;
  group.add(sky.mesh);

  const tint = () => {
    const lk = look();
    const q2 = ctx.pal();
    bark.uni.uBarkA.value.copy(lin(q2.barkA));
    bark.uni.uBarkB.value.copy(lin(q2.barkB));
    bark.uni.uGlow.value.copy(lin(q2.glow));
    bark.uni.uSky.value.copy(lin(lk.key));
    bark.uni.uGround.value.copy(lin(lk.soil));
    fog.uFogNear.value = 4000;
    fog.uFogFar.value = 5000;
    fog.uFogColor.value.copy(lin(lk.wallLow));
    puffUni.uLow.value.copy(lin(lk.leafLow));
    puffUni.uTop.value.copy(lin(lk.leafTop));
    puffUni.uDead.value.copy(lin(lk.dead));
    for (const u of [puffUni, glazeUni, mossUni, stoneUni]) u.uKey.value.copy(lin(lk.key));
    glazeUni.uA.value.copy(lin(lk.glazeA));
    glazeUni.uB.value.copy(lin(lk.glazeB));
    mossUni.uMoss.value.copy(lin(lk.moss));
    mossUni.uSoil.value.copy(lin(lk.soil));
    stoneUni.uC.value.copy(lin(lk.stone));
    sweepUni.uTop.value.copy(lin(lk.wallTop));
    sweepUni.uLow.value.copy(lin(lk.wallLow));
    sweepUni.uFloor.value.copy(lin(lk.floor));
    sweepUni.uPool.value.copy(lin(lk.pool));
    sweepUni.uShadow.value.copy(lin(lk.shadow));
    sky.set(lk.wallTop, lk.wallLow, lk.floor);
    ctx.look(lk.bloom, lk.exposure);
  };
  tint();

  // Default camera: the whole tree and pot in frame, slightly from above and to the key-light side
  let x0 = -PX;
  let x1 = PX;
  let y1 = Cy;
  for (let i = 0; i < M.n; i++) {
    x0 = Math.min(x0, (pos[i * 3] ?? 0) - disc);
    x1 = Math.max(x1, (pos[i * 3] ?? 0) + disc);
    y1 = Math.max(y1, (pos[i * 3 + 1] ?? 0) + disc);
  }
  for (const pad of L.pads)
    for (const c of pad.cells) {
      x0 = Math.min(x0, c.x * m - S);
      x1 = Math.max(x1, c.x * m + S);
    }
  const yb = floorY;
  const w = x1 - x0;
  const h = y1 - yb + disc;
  const t = Math.tan((42 / 2) * (Math.PI / 180));
  // Turntable pivot on the tree's axis; framed a little narrower so the scene rail at the start side stays clear
  const dist = Math.max(h / 2 / t, w / 2 / (t * 1.36 * 0.74)) * 1.08;
  const target = new Vector3((x0 + x1) / 2, (yb + y1) / 2 + disc * 0.4, Cz);
  const dir = new Vector3(-0.14 * m, 0.24, 1).normalize();
  return {
    key: 'bonsai',
    group,
    pos,
    size,
    style: 0,
    lift: 3,
    tint,
    hiTargets: [{ geo: barkGeo }, { geo: puffGeo, perPerson: true }],
    focus: [bark.uni.uFocus, puffUni.uFocus],
    view: { target, cam: target.clone().addScaledVector(dir, dist) },
    follow: big ? 22 : 34,
    labelScale: 0.78,
  };
};
