import {
  CircleGeometry,
  Color,
  CubicBezierCurve3,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  ShaderMaterial,
  Shape,
  Vector3,
} from 'three';
import { addCurveLine, flowLines, lineBuilder, skyDome } from '../gl.ts';
import { spouseIndex } from '../model.ts';
import { lin } from '../palette.ts';
import type { SceneBuilder } from './types.ts';

// Glass Strata: each generation is a frosted glass plate; people stand on pins of light.

export const glassScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const pp = ctx.pal();
  const group = new Group();
  const pos = new Float32Array(M.n * 3);
  const W = Math.max(70, M.root.leaves * (big ? 4.2 : 9));
  const GY = 13;
  const at = new Map<string, Vector3>();
  const atOf = (id: string | null) => (id ? at.get(id) : undefined) ?? new Vector3();
  for (const p of M.people) if (!p.mi) at.set(p.id, new Vector3((p.ang - 0.5) * W, p.gen * GY + 2.6, 0));
  for (const p of M.people) {
    if (!p.mi) continue;
    const a = atOf(p.anchor);
    const k = spouseIndex(M, p);
    at.set(p.id, a.clone().add(new Vector3((k % 2 ? -1 : 1) * 2.2, -0.4, 3.6 + Math.floor(k / 2) * 2.6)));
  }
  M.people.forEach((p, i) => {
    const v = atOf(p.id);
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z;
  });
  // Frosted glass: tinted body, Fresnel-bright edges, soft sheen across the top face
  const glassUni = {
    uTint: { value: lin(pp.plate) },
    uGlow: { value: lin(pp.glow) },
    uTime: U.uTime,
    uBody: { value: ctx.dark() ? 0.1 : 0.22 },
  };
  const glassMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: glassUni,
    vertexShader: `varying vec3 vN, vW; varying vec2 vXZ; void main() { vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vXZ = position.xz;
      gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uTint, uGlow; uniform float uTime, uBody; varying vec3 vN, vW; varying vec2 vXZ;
      void main() { vec3 n = normalize(vN), V = normalize(cameraPosition - vW); float fr = pow(1. - abs(dot(n, V)), 2.4);
        float top = step(.6, n.y); float sheen = top * smoothstep(.0, 1., sin(vXZ.x * .05 + vXZ.y * .08 - uTime * .25) * .5 + .5) * .12;
        vec3 c = uTint * (uBody + fr * .9) + uGlow * (fr * .35 + sheen); float a = uBody + fr * .55 + sheen + top * .06;
        gl_FragColor = vec4(c, clamp(a, 0., .85)); }`,
  });
  const edgeMat = new LineBasicMaterial({ color: lin(pp.glow).multiplyScalar(1.8), transparent: true, opacity: 0.8 });
  const plates: Object3D[] = [];
  for (let g = 0; g <= M.maxGen; g++) {
    const xs = M.people.filter((p) => p.gen === g).map((p) => atOf(p.id).x);
    if (!xs.length) continue;
    const x0 = Math.min(...xs) - 6;
    const x1 = Math.max(...xs) + 6;
    const w = Math.max(14, x1 - x0);
    const d = 15;
    const r = 2.4;
    const sh = new Shape();
    sh.moveTo(-w / 2 + r, -d / 2);
    sh.lineTo(w / 2 - r, -d / 2);
    sh.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
    sh.lineTo(w / 2, d / 2 - r);
    sh.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
    sh.lineTo(-w / 2 + r, d / 2);
    sh.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
    sh.lineTo(-w / 2, -d / 2 + r);
    sh.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
    const geo = new ExtrudeGeometry(sh, {
      depth: 0.55,
      bevelEnabled: true,
      bevelThickness: 0.18,
      bevelSize: 0.22,
      bevelSegments: 4,
      curveSegments: 10,
    });
    geo.rotateX(-Math.PI / 2);
    const plate = new Mesh(geo, glassMat);
    plate.position.set((x0 + x1) / 2, g * GY - 0.4, 1.4);
    group.add(plate);
    const edges = new LineSegments(new EdgesGeometry(geo, 25), edgeMat);
    edges.position.copy(plate.position);
    group.add(edges);
    const born = Math.min(...M.people.filter((p) => p.gen === g && !p.mi).map((p) => p.born), 9999);
    plate.userData.born = born;
    edges.userData.born = born;
    plates.push(plate, edges);
  }
  // Pins of light under each person and bloodline links between plates
  const pinGeo = new CylinderGeometry(0.07, 0.07, 1, 6);
  pinGeo.translate(0, 0.5, 0);
  const pins = new InstancedMesh(pinGeo, new MeshBasicMaterial({ color: new Color(1.6, 1.6, 1.6) }), M.n);
  const mtx = new Matrix4();
  M.people.forEach((p, i) => {
    const c = atOf(p.id);
    mtx.makeScale(1, 2.2, 1).setPosition(c.x, c.y - 2.6, c.z);
    pins.setMatrixAt(i, mtx);
    pins.setColorAt(i, lin(p.color));
  });
  group.add(pins);
  const B = lineBuilder();
  const glow = lin(pp.glow);
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    const a = atOf(p.parent);
    const c = atOf(p.id);
    addCurveLine(
      B,
      new CubicBezierCurve3(
        a,
        a.clone().add(new Vector3(0, GY * 0.55, -2)),
        c.clone().add(new Vector3(0, -GY * 0.55, -2)),
        c,
      ),
      big ? 10 : 22,
      p.born,
      p.id,
      glow,
    );
  }
  const { lines, uni } = flowLines(B, U, 0.5);
  group.add(lines);
  const sky = skyDome(pp.top, pp.hor, pp.ground);
  group.add(sky.mesh);
  const floorUni = { uC: { value: lin(pp.ground) }, uG: { value: lin(pp.glow) } };
  const floor = new Mesh(
    new CircleGeometry(600, 64),
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: floorUni,
      vertexShader: `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform vec3 uC, uG; varying vec2 vP; void main() { float r = length(vP); vec2 gr = abs(fract(vP / 8.) - .5);
        float line = smoothstep(.485, .5, max(gr.x, gr.y)); vec3 c = mix(uC, uG * .5, line * .16 * (1. - smoothstep(30., 160., r)));
        gl_FragColor = vec4(c, 1. - smoothstep(260., 600., r)); }`,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -6;
  group.add(floor);
  const tint = () => {
    const q2 = ctx.pal();
    glassUni.uTint.value.copy(lin(q2.plate));
    glassUni.uGlow.value.copy(lin(q2.glow));
    glassUni.uBody.value = ctx.dark() ? 0.1 : 0.22;
    edgeMat.color.copy(lin(q2.glow)).multiplyScalar(1.8);
    // recolour lines to the theme glow
    const attr = lines.geometry.getAttribute('aCol');
    const gc = lin(q2.glow);
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = gc.r;
      arr[i + 1] = gc.g;
      arr[i + 2] = gc.b;
    }
    attr.needsUpdate = true;
    sky.set(q2.top, q2.hor, q2.ground);
    floorUni.uC.value.copy(lin(q2.ground));
    floorUni.uG.value.copy(lin(q2.glow));
    ctx.look(q2.bloom * 0.9, q2.exposure);
  };
  const yearHook = (yr: number) => {
    for (const o of plates) o.visible = (o.userData.born as number) <= yr + 0.5;
    M.people.forEach((p, i) => {
      const c = atOf(p.id);
      const s = p.born <= yr ? 2.2 : 0.0001;
      mtx.makeScale(1, s, 1).setPosition(c.x, c.y - 2.6, c.z);
      pins.setMatrixAt(i, mtx);
    });
    pins.instanceMatrix.needsUpdate = true;
  };
  const top = M.maxGen * GY;
  return {
    key: 'glass',
    group,
    pos,
    size: big ? 1.25 : 1.8,
    style: 0,
    lift: 8,
    tint,
    yearHook,
    labelUp: true,
    hiTargets: [{ geo: lines.geometry }],
    focus: [uni.uFocus],
    view: { target: new Vector3(0, top * 0.56, 0), cam: new Vector3(W * 0.36, top * 0.95 + 12, W * 0.72 + 48) },
    follow: 22,
  };
};
