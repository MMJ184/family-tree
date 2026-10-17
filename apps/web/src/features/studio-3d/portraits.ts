import {
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  MathUtils,
  Mesh,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { Shared } from './gl.ts';
import type { StudioModel, StudioPerson } from './model.ts';
import { lin } from './palette.ts';
import { isRoot } from './scenes/types.ts';

// Portraits: every person's picture packed into one canvas atlas, drawn by one instanced
// billboard mesh (a single draw call for the whole family).

/** Placeholder portrait: Gulf dress silhouette (ghutra and agal, or shayla) on the family colour. */
export function drawPortrait(g: CanvasRenderingContext2D, p: StudioPerson, x: number, y: number, s: number) {
  const c = p.color;
  const cx = x + s / 2;
  const grd = g.createRadialGradient(cx, y + s * 0.35, s * 0.05, cx, y + s / 2, s * 0.75);
  grd.addColorStop(0, new Color(c).lerp(new Color('#ffffff'), 0.35).getStyle());
  grd.addColorStop(1, c);
  g.fillStyle = grd;
  g.fillRect(x, y, s, s);
  const skin = ['#c9976f', '#b9845e', '#d8a983', '#a87653'][p.idx % 4] ?? '#c9976f';
  if (p.sex === 'M') {
    g.fillStyle = '#e9e6de';
    g.beginPath();
    g.ellipse(cx, y + s * 1.06, s * 0.4, s * 0.33, 0, Math.PI, 2 * Math.PI);
    g.fill(); // kandura shoulders
    g.fillStyle = '#f1efe8';
    g.beginPath();
    g.moveTo(cx - s * 0.3, y + s * 0.86);
    g.quadraticCurveTo(cx - s * 0.31, y + s * 0.2, cx, y + s * 0.15);
    g.quadraticCurveTo(cx + s * 0.31, y + s * 0.2, cx + s * 0.3, y + s * 0.86);
    g.lineTo(cx + s * 0.17, y + s * 0.86);
    g.quadraticCurveTo(cx + s * 0.2, y + s * 0.42, cx, y + s * 0.3);
    g.quadraticCurveTo(cx - s * 0.2, y + s * 0.42, cx - s * 0.17, y + s * 0.86);
    g.closePath();
    g.fill(); // ghutra drape
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.beginPath();
    g.ellipse(cx, y + s * 0.6, s * 0.18, s * 0.24, 0, 0, 2 * Math.PI);
    g.fill();
    g.fillStyle = skin;
    g.beginPath();
    g.ellipse(cx, y + s * 0.5, s * 0.135, s * 0.17, 0, 0, 2 * Math.PI);
    g.fill(); // face
    g.fillStyle = 'rgba(40,28,20,0.55)';
    g.beginPath();
    g.ellipse(cx, y + s * 0.62, s * 0.1, s * 0.06, 0, 0, Math.PI);
    g.fill(); // beard
    g.strokeStyle = '#1b1a1f';
    g.lineWidth = s * 0.045;
    g.beginPath();
    g.ellipse(cx, y + s * 0.3, s * 0.2, s * 0.05, 0, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke(); // agal
  } else {
    g.fillStyle = '#16141c';
    g.beginPath();
    g.moveTo(cx - s * 0.42, y + s);
    g.quadraticCurveTo(cx - s * 0.38, y + s * 0.62, cx - s * 0.24, y + s * 0.52);
    g.quadraticCurveTo(cx - s * 0.28, y + s * 0.14, cx, y + s * 0.13);
    g.quadraticCurveTo(cx + s * 0.28, y + s * 0.14, cx + s * 0.24, y + s * 0.52);
    g.quadraticCurveTo(cx + s * 0.38, y + s * 0.62, cx + s * 0.42, y + s);
    g.closePath();
    g.fill(); // shayla and abaya
    g.fillStyle = skin;
    g.beginPath();
    g.ellipse(cx, y + s * 0.44, s * 0.125, s * 0.16, 0, 0, 2 * Math.PI);
    g.fill(); // face
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = s * 0.02;
    g.beginPath();
    g.arc(cx, y + s * 0.42, s * 0.2, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
  }
}

export class Atlas {
  readonly cv: HTMLCanvasElement;
  readonly tex: CanvasTexture;
  readonly uv: Float32Array;
  private readonly cells: Array<[number, number, number]> = [];
  private readonly thumbs = new Map<string, string>();
  private readonly images: HTMLImageElement[] = [];
  private disposed = false;

  constructor(private readonly M: StudioModel) {
    const n = M.n;
    const cell = n > 160 ? 64 : 128;
    const cols = Math.ceil(Math.sqrt(n));
    const side = MathUtils.ceilPowerOfTwo(cols * cell);
    this.cv = document.createElement('canvas');
    this.cv.width = this.cv.height = side;
    this.uv = new Float32Array(n * 4);
    const g = this.cv.getContext('2d');
    M.people.forEach((p, i) => {
      const x = (i % cols) * cell;
      const y = Math.floor(i / cols) * cell;
      if (g) drawPortrait(g, p, x, y, cell);
      this.uv.set([x / side, 1 - (y + cell) / side, cell / side, cell / side], i * 4);
      this.cells.push([x, y, cell]);
    });
    this.tex = new CanvasTexture(this.cv);
    this.tex.colorSpace = SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.tex.generateMipmaps = true;
  }

  /** Loads real photos into their cells. CORS-blocked images fail to load and keep the drawn portrait. */
  loadPhotos() {
    const g = this.cv.getContext('2d');
    if (!g) return;
    this.M.people.forEach((p, i) => {
      const url = p.person.photoUrl;
      const cell = this.cells[i];
      if (!url || !cell) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => {
        if (this.disposed || !img.naturalWidth) return;
        const [x, y, s] = cell;
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) * 0.3; // faces sit in the upper part of most photos
        try {
          g.drawImage(img, sx, sy, side, side, x, y, s, s);
          this.tex.needsUpdate = true;
          this.thumbs.delete(p.id);
        } catch {
          // keep the drawn portrait
        }
      };
      img.src = url;
      this.images.push(img);
    });
  }

  /** Small data URL of a person's portrait (tooltip). */
  thumb(p: StudioPerson): string {
    const hit = this.thumbs.get(p.id);
    if (hit) return hit;
    const cell = this.cells[p.idx];
    if (!cell) return '';
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const [x, y, s] = cell;
    let url = '';
    try {
      c.getContext('2d')?.drawImage(this.cv, x, y, s, s, 0, 0, 96, 96);
      url = c.toDataURL();
    } catch {
      url = '';
    }
    this.thumbs.set(p.id, url);
    return url;
  }

  dispose() {
    this.disposed = true;
    for (const img of this.images) {
      img.onload = null;
      img.src = '';
    }
    this.images.length = 0;
    this.thumbs.clear();
    this.tex.dispose();
    this.cv.width = this.cv.height = 0;
  }
}

export interface Medals {
  mesh: Mesh;
  geo: InstancedBufferGeometry;
  mat: ShaderMaterial;
  uni: {
    uAtlas: { value: Texture };
    uMorph: { value: number };
    uScale: { value: number };
    uStyle: { value: number };
    uFocus: { value: number };
    uLift: { value: number };
  };
  from: InstancedBufferAttribute;
  to: InstancedBufferAttribute;
  birth: InstancedBufferAttribute;
  hi: InstancedBufferAttribute;
}

/** Size factor of one portrait relative to the scene size (founder larger, married-in smaller). */
export const sizeFactor = (p: StudioPerson) => (isRoot(p) ? 1.35 : p.mi ? 0.85 : 1);

export function createMedals(M: StudioModel, U: Shared, atlas: Atlas): Medals {
  const uni = {
    uAtlas: { value: atlas.tex as Texture },
    uMorph: { value: 1 },
    uScale: { value: 1 },
    uStyle: { value: 0 },
    uFocus: { value: 0 },
    uLift: { value: 6 },
  };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ...U, ...uni },
    vertexShader: /* glsl */ `
      attribute vec3 aFrom; attribute vec3 aTo; attribute vec4 aUv; attribute vec3 aCol; attribute float aSize; attribute float aBirth; attribute float aDeath; attribute float aHi;
      uniform float uMorph, uYear, uEnter, uMinYear, uScale, uLift, uTime;
      varying vec2 vQ; varying vec4 vUv; varying vec3 vCol; varying float vDead, vHi, vA;
      void main() {
        float m = uMorph; m = m < .5 ? 4.*m*m*m : 1. - pow(-2.*m + 2., 3.) / 2.;
        vec3 p = mix(aFrom, aTo, m); p.y += sin(m * 3.14159) * uLift;
        float yr = mix(uMinYear - 3., uYear, uEnter);
        float app = smoothstep(aBirth, aBirth + .9, yr);
        vA = app; vDead = step(aDeath, yr); vHi = aHi; vCol = aCol; vUv = aUv; vQ = position.xy * 2.;
        p.y += sin(uTime * .8 + aBirth * 1.7) * .12;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        float s = aSize * uScale * (.35 + .65 * app) * (1. + .3 * step(1.5, aHi));
        mv.xy += position.xy * s * 2.3;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas; uniform float uTime, uStyle, uFocus;
      varying vec2 vQ; varying vec4 vUv; varying vec3 vCol; varying float vDead, vHi, vA;
      void main() {
        float r = length(vQ); if (r > 1. || vA < .01) discard;
        float core = uStyle > .5 ? .5 : .6, rimW = .085;
        vec3 col; float a;
        if (r < core) {
          vec2 uv = vQ / core * .5 + .5;
          col = texture2D(uAtlas, vUv.xy + uv * vUv.zw).rgb;
          if (vDead > .5) { float l = dot(col, vec3(.3, .59, .11)); col = mix(col, vec3(l), .85) * .75; }
          col += smoothstep(.55, 0., length(vQ / core - vec2(-.35, .45))) * .18;
          col *= (.82 + .18 * smoothstep(core, core * .6, r)) * .86;
          a = 1.;
        } else if (r < core + rimW) {
          float lit = vDead > .5 ? .7 : 2.1;
          col = vCol * lit * (1. + .45 * step(1.5, vHi) + .2 * step(.5, vHi)); a = 1.;
          col *= .85 + .3 * smoothstep(core + rimW, core, r);
        } else {
          float d = r - core - rimW;
          float glow = exp(-d * (uStyle > .5 ? 5. : 9.));
          col = vCol * (vDead > .5 ? .5 : 1.3); a = glow * (uStyle > .5 ? .85 : .3) * (1. + step(.5, vHi));
          if (vHi > 1.5) { float ph = fract(uTime * .55); float pr = core + rimW + .05 + .3 * ph; a += smoothstep(.03, 0., abs(r - pr)) * (1. - ph) * .9; }
        }
        float dim = uFocus > .5 && vHi < .5 ? .28 : 1.;
        gl_FragColor = vec4(col, a * vA * dim);
      }`,
  });
  // The shader material copies the uniform objects by reference, so `uni` stays live.
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const n = M.n;
  const attr = (k: string, size: number) => {
    const a = new InstancedBufferAttribute(new Float32Array(n * size), size);
    geo.setAttribute(k, a);
    return a;
  };
  const uv = attr('aUv', 4);
  const col = attr('aCol', 3);
  const sz = attr('aSize', 1);
  const birth = attr('aBirth', 1);
  const death = attr('aDeath', 1);
  const hi = attr('aHi', 1);
  const from = attr('aFrom', 3);
  const to = attr('aTo', 3);
  (uv.array as Float32Array).set(atlas.uv);
  M.people.forEach((p, i) => {
    const c = lin(p.color);
    col.setXYZ(i, c.r, c.g, c.b);
    sz.setX(i, sizeFactor(p));
    birth.setX(i, p.born);
    death.setX(i, p.died ?? 9999);
  });
  geo.instanceCount = n;
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return { mesh, geo, mat, uni, from, to, birth, hi };
}
