import {
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix3,
  Mesh,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { Shared } from './gl.ts';
import type { StudioModel, StudioPerson } from './model.ts';
import { NOW } from './palette.ts';
import { isRoot } from './scenes/types.ts';

// Portraits: every person's picture packed into one canvas atlas, drawn by one instanced
// billboard mesh (a single draw call for the whole family). The placeholder is an illustrated
// bust; the medal shader adds the rim language and follows the theme through `uDark`:
//   neutral rim (born in), gold rim (married in), thinner grey rim and a quieter picture
//   (deceased), teal rim (the selected person's lineage), thicker teal rim with a pulse
//   (the selected person); everyone else dims and loses colour while someone is selected.

// ---------- placeholder artwork ----------

type RGB = [number, number, number];

const rgbOf = (hex: string): RGB => {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Mixes two hex colours in sRGB (t = 0 gives a) and returns a CSS colour, optionally translucent. */
function mix(a: string, b: string, t: number, alpha = 1): string {
  const A = rgbOf(a);
  const B = rgbOf(b);
  const c = A.map((v, i) => Math.round(v + ((B[i] ?? v) - v) * t));
  return alpha >= 1 ? `rgb(${c.join(',')})` : `rgba(${c.join(',')},${alpha})`;
}

function hslOf(hex: string): [number, number, number] {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255) as RGB;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** A hex colour at some opacity, as a CSS colour. */
const tint = (hex: string, alpha: number) => mix(hex, hex, 0, alpha);

const hsl = (h: number, s: number, l: number) =>
  `hsl(${h.toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%)`;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic pick from a list, by a seed and a salt (so different traits vary independently). */
const pick = <T>(list: readonly T[], seed: number, salt: number): T =>
  list[(Math.imul(seed ^ salt, 2654435761) >>> 0) % list.length] as T;

/** Places that call for South Asian dress on the placeholder (the Gujarati family); everyone else wears Gulf dress. */
const SOUTH_ASIA =
  /\b(india|gujarat|surat|ahmedabad|rajkot|vadodara|baroda|bhavnagar|amreli|mumbai|bombay|pune|delhi|kolkata|chennai|hyderabad|bengaluru|bangalore|kerala|kochi|goa|jaipur|pakistan|karachi|lahore|bangladesh|dhaka|sri lanka|colombo|nepal|kathmandu)\b|الهند|باكستان|بنغلاديش/i;

type Band = 'child' | 'youth' | 'adult' | 'elder';

interface Look {
  male: boolean;
  south: boolean;
  band: Band;
  age: number;
  seed: number;
  skin: string;
  hair: string;
}

const GULF_SKIN = ['#d9ab84', '#c99a72', '#b98760', '#e2b994', '#a9774f'] as const;
const SOUTH_SKIN = ['#c68e63', '#b47b51', '#a26b44', '#d39f72', '#8e5d3b'] as const;

function lookOf(p: StudioPerson): Look {
  const place = `${p.person.birthPlace ?? ''} ${p.person.currentCity ?? ''}`;
  const age = (p.died ?? NOW) - p.born;
  const band: Band = age < 13 ? 'child' : age < 25 ? 'youth' : age < 62 ? 'adult' : 'elder';
  const seed = hash(p.id);
  const south = SOUTH_ASIA.test(place);
  const elderHair = age >= 72 ? '#dcd9d3' : '#a9a6a1';
  return {
    male: p.sex === 'M',
    south,
    band,
    age,
    seed,
    skin: pick(south ? SOUTH_SKIN : GULF_SKIN, seed, 11),
    hair: band === 'elder' ? elderHair : age >= 52 ? '#5d5853' : '#1d1917',
  };
}

/** Proportions of the bust: face centre and radii, shoulder line and half-width (cell = unit square). */
interface Frame {
  cx: number;
  hy: number;
  fx: number;
  fy: number;
  sy: number;
  sw: number;
}

const frameOf = (L: Look): Frame =>
  L.band === 'child'
    ? { cx: 0.5, hy: 0.475, fx: 0.104, fy: 0.122, sy: 0.775, sw: 0.29 }
    : L.band === 'youth'
      ? { cx: 0.5, hy: 0.46, fx: 0.096, fy: 0.125, sy: 0.73, sw: 0.35 }
      : { cx: 0.5, hy: 0.455, fx: 0.098, fy: 0.127, sy: 0.725, sw: 0.37 };

function linear(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: string[]) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((c, i) => {
    gr.addColorStop(stops.length > 1 ? i / (stops.length - 1) : 0, c);
  });
  return gr;
}

/** Studio backdrop: a neutral grey lit from the top left, with a faint tint of the family colour. */
function backdrop(g: CanvasRenderingContext2D, color: string) {
  const [h0, s0] = hslOf(color);
  // Teal is reserved for the selection, so teal family colours lean to a cool steel instead.
  const h = h0 >= 150 && h0 <= 200 ? 212 : h0;
  const s = Math.min(s0, 0.6) * 0.28;
  const gr = g.createRadialGradient(0.4, 0.3, 0.02, 0.5, 0.52, 0.74);
  gr.addColorStop(0, hsl(h, s, 0.62));
  gr.addColorStop(0.45, hsl(h, s, 0.47));
  gr.addColorStop(1, hsl(h, s * 0.9, 0.29));
  g.fillStyle = gr;
  g.fillRect(0, 0, 1, 1);
}

/** Head shape: an egg, a little narrower at the chin. */
function egg(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, chin: number) {
  g.beginPath();
  g.moveTo(cx - rx, cy);
  g.bezierCurveTo(cx - rx, cy - ry * 0.56, cx - rx * 0.56, cy - ry, cx, cy - ry);
  g.bezierCurveTo(cx + rx * 0.56, cy - ry, cx + rx, cy - ry * 0.56, cx + rx, cy);
  g.bezierCurveTo(cx + rx, cy + ry * 0.58, cx + rx * chin * 0.62, cy + ry, cx, cy + ry);
  g.bezierCurveTo(cx - rx * chin * 0.62, cy + ry, cx - rx, cy + ry * 0.58, cx - rx, cy);
  g.closePath();
}

/** Shoulders and chest, from below the cell up to the base of the neck. */
function torso(g: CanvasRenderingContext2D, F: Frame, fill: string | CanvasGradient, nw = 0.085) {
  const { cx, sy, sw } = F;
  g.beginPath();
  g.moveTo(cx - sw - 0.16, 1.02);
  g.bezierCurveTo(cx - sw - 0.12, sy + 0.05, cx - sw + 0.04, sy - 0.035, cx - nw, sy - 0.05);
  g.quadraticCurveTo(cx, sy - 0.062, cx + nw, sy - 0.05);
  g.bezierCurveTo(cx + sw - 0.04, sy - 0.035, cx + sw + 0.12, sy + 0.05, cx + sw + 0.16, 1.02);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

function neck(g: CanvasRenderingContext2D, F: Frame, L: Look, w = 0.056) {
  const { cx, hy, fy, sy } = F;
  g.fillStyle = linear(g, cx - w, 0, cx + w, 0, [mix(L.skin, '#3a2216', 0.16), mix(L.skin, '#3a2216', 0.42)]);
  g.beginPath();
  g.moveTo(cx - w, hy + fy * 0.55);
  g.lineTo(cx - w * 1.05, sy - 0.03);
  g.quadraticCurveTo(cx, sy + 0.012, cx + w * 1.05, sy - 0.03);
  g.lineTo(cx + w, hy + fy * 0.55);
  g.closePath();
  g.fill();
}

function face(g: CanvasRenderingContext2D, F: Frame, L: Look) {
  const { cx, hy, fx, fy } = F;
  const gr = g.createRadialGradient(cx - fx * 0.38, hy - fy * 0.32, fx * 0.08, cx, hy, fy * 1.12);
  gr.addColorStop(0, mix(L.skin, '#fff1e2', 0.2));
  gr.addColorStop(0.62, L.skin);
  gr.addColorStop(1, mix(L.skin, '#3b2016', 0.3));
  g.fillStyle = gr;
  egg(g, cx, hy, fx, fy, L.male ? 0.92 : 0.8);
  g.fill();
}

function ears(g: CanvasRenderingContext2D, F: Frame, L: Look, ring = false) {
  const { cx, hy, fx, fy } = F;
  for (const s of [-1, 1]) {
    g.fillStyle = mix(L.skin, '#3b2016', s < 0 ? 0.12 : 0.24);
    g.beginPath();
    g.ellipse(cx + s * fx * 0.98, hy + fy * 0.04, fx * 0.17, fy * 0.2, 0, 0, Math.PI * 2);
    g.fill();
    if (ring) {
      g.fillStyle = '#d8b25a';
      g.beginPath();
      g.arc(cx + s * fx * 0.99, hy + fy * 0.26, 0.0085, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** Calm, minimal features: brows, eyes, a nose shadow and the mouth. Skipped on small cells. */
function features(g: CanvasRenderingContext2D, F: Frame, L: Look, opts: { mouth: boolean; brow?: string | undefined }) {
  const { cx, hy, fx, fy } = F;
  const top = hy - fy;
  const h = fy * 2;
  const ey = top + h * 0.45;
  const by = top + h * 0.37;
  const ny = top + h * 0.645;
  const my = top + h * 0.795;
  const ex = fx * 0.43;
  g.lineCap = 'round';
  g.strokeStyle = opts.brow ?? (L.band === 'elder' ? mix(L.hair, '#3d3631', 0.45) : '#211a16');
  g.lineWidth = L.male ? 0.0105 : 0.0068;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + s * ex * 0.42, by + 0.005);
    g.quadraticCurveTo(cx + s * ex * 0.95, by - (L.male ? 0.006 : 0.011), cx + s * ex * 1.6, by + 0.004);
    g.stroke();
  }
  for (const s of [-1, 1]) {
    g.fillStyle = '#251915';
    g.beginPath();
    g.ellipse(cx + s * ex, ey, 0.0135, L.male ? 0.0068 : 0.0078, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.arc(cx + s * ex - 0.004, ey - 0.002, 0.0028, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = mix(L.skin, '#3a1b10', 0.5, 0.55);
  g.lineWidth = 0.0058;
  g.beginPath();
  g.moveTo(cx + 0.006, ey + 0.016);
  g.quadraticCurveTo(cx + 0.017, ny - 0.006, cx + 0.008, ny + 0.004);
  g.quadraticCurveTo(cx, ny + 0.009, cx - 0.011, ny + 0.003);
  g.stroke();
  if (!opts.mouth) return;
  g.strokeStyle = L.male ? mix(L.skin, '#5a2a22', 0.5) : mix(L.skin, '#9a3d45', 0.55);
  g.lineWidth = L.male ? 0.0065 : 0.0085;
  g.beginPath();
  g.moveTo(cx - 0.024, my);
  g.quadraticCurveTo(cx, my + 0.008, cx + 0.024, my);
  g.stroke();
}

/** Beard and moustache by age: none for boys, a shadow for young men, dark for men, grey to white for elders. */
function beard(g: CanvasRenderingContext2D, F: Frame, L: Look, full: boolean) {
  if (L.band === 'child') return;
  const { cx, hy, fx, fy } = F;
  const top = hy - fy;
  const h = fy * 2;
  const col = L.band === 'elder' ? L.hair : L.age >= 52 ? '#6b655f' : '#2a221e';
  const alpha = L.band === 'youth' ? 0.38 : 0.94;
  g.fillStyle = tint(col, alpha);
  if (full) {
    g.beginPath();
    g.moveTo(cx - fx * 0.98, hy + fy * 0.02);
    g.bezierCurveTo(cx - fx * 0.95, hy + fy * 0.75, cx - fx * 0.55, hy + fy * 1.14, cx, hy + fy * 1.16);
    g.bezierCurveTo(cx + fx * 0.55, hy + fy * 1.14, cx + fx * 0.95, hy + fy * 0.75, cx + fx * 0.98, hy + fy * 0.02);
    g.bezierCurveTo(cx + fx * 0.82, hy + fy * 0.32, cx + fx * 0.55, hy + fy * 0.5, cx + fx * 0.42, top + h * 0.77);
    g.quadraticCurveTo(cx, top + h * 0.7, cx - fx * 0.42, top + h * 0.77);
    g.bezierCurveTo(cx - fx * 0.55, hy + fy * 0.5, cx - fx * 0.82, hy + fy * 0.32, cx - fx * 0.98, hy + fy * 0.02);
    g.closePath();
    g.fill();
    // the lower lip shows through the beard
    g.fillStyle = mix(L.skin, '#6b2f28', 0.45);
    g.beginPath();
    g.ellipse(cx, top + h * 0.815, 0.02, 0.0075, 0, 0, Math.PI * 2);
    g.fill();
  }
  // moustache
  g.fillStyle = tint(col, alpha);
  g.beginPath();
  g.moveTo(cx - 0.04, top + h * 0.795);
  g.quadraticCurveTo(cx - 0.03, top + h * 0.72, cx, top + h * 0.735);
  g.quadraticCurveTo(cx + 0.03, top + h * 0.72, cx + 0.04, top + h * 0.795);
  g.quadraticCurveTo(cx, top + h * 0.765, cx - 0.04, top + h * 0.795);
  g.closePath();
  g.fill();
}

/** Soft fold lines on cloth. */
function folds(g: CanvasRenderingContext2D, color: string, width: number, lines: number[][]) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  for (const l of lines) {
    g.beginPath();
    g.moveTo(l[0] ?? 0, l[1] ?? 0);
    g.quadraticCurveTo(l[2] ?? 0, l[3] ?? 0, l[4] ?? 0, l[5] ?? 0);
    g.stroke();
  }
}

function gulfMan(g: CanvasRenderingContext2D, F: Frame, L: Look, detail: boolean) {
  const { cx, hy, fx, fy } = F;
  const kid = L.band === 'child';
  // kandura (white robe) with its high round neckline, cool shadow on the right
  const K = { ...F, sy: F.sy - 0.045 };
  torso(g, K, linear(g, cx - 0.36, K.sy - 0.05, cx + 0.4, 1, ['#fbfaf7', '#e9e8e3', '#c3c8d0']), 0.07);
  neck(g, K, L, 0.05);
  if (detail) {
    // collar and the tarboosha (the tasselled cord at the neckline)
    g.strokeStyle = 'rgba(116,122,134,0.6)';
    g.lineWidth = 0.0055;
    g.beginPath();
    g.ellipse(cx, K.sy - 0.036, 0.048, 0.018, 0, 0.1, Math.PI - 0.1);
    g.stroke();
    g.beginPath();
    g.moveTo(cx + 0.004, K.sy - 0.018);
    g.quadraticCurveTo(cx + 0.012, K.sy + 0.06, cx + 0.008, K.sy + 0.13);
    g.stroke();
    g.fillStyle = '#e4e3dd';
    g.beginPath();
    g.ellipse(cx + 0.008, K.sy + 0.15, 0.011, 0.024, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  // ghutra: crown, then two flaps falling over the shoulders around the face
  const top = hy - fy - (kid ? 0.105 : 0.13);
  const ghutra = new Path2D();
  ghutra.moveTo(cx, top);
  ghutra.bezierCurveTo(cx + 0.13, top, cx + 0.208, top + 0.05, cx + 0.218, top + 0.13);
  ghutra.bezierCurveTo(cx + 0.232, top + 0.24, cx + 0.248, top + 0.36, cx + 0.282, top + 0.5);
  ghutra.bezierCurveTo(cx + 0.31, top + 0.6, cx + 0.3, top + 0.7, cx + 0.272, top + 0.8);
  ghutra.lineTo(cx + 0.108, top + 0.8);
  ghutra.bezierCurveTo(cx + 0.112, top + 0.66, cx + 0.115, top + 0.52, cx + fx * 0.95, hy + fy * 0.7);
  ghutra.quadraticCurveTo(cx, hy + fy * 1.25, cx - fx * 0.95, hy + fy * 0.7);
  ghutra.bezierCurveTo(cx - 0.115, top + 0.52, cx - 0.112, top + 0.66, cx - 0.108, top + 0.8);
  ghutra.lineTo(cx - 0.272, top + 0.8);
  ghutra.bezierCurveTo(cx - 0.3, top + 0.7, cx - 0.31, top + 0.6, cx - 0.282, top + 0.5);
  ghutra.bezierCurveTo(cx - 0.248, top + 0.36, cx - 0.232, top + 0.24, cx - 0.218, top + 0.13);
  ghutra.bezierCurveTo(cx - 0.208, top + 0.05, cx - 0.13, top, cx, top);
  ghutra.closePath();
  const cloth = linear(g, cx - 0.22, top, cx + 0.26, top + 0.8, ['#ffffff', '#f1f0ec', '#c7ccd4']);
  g.fillStyle = cloth;
  g.fill(ghutra);
  if (detail)
    folds(g, 'rgba(118,126,140,0.28)', 0.0055, [
      [cx - 0.2, top + 0.3, cx - 0.225, top + 0.55, cx - 0.205, top + 0.78],
      [cx - 0.152, top + 0.42, cx - 0.162, top + 0.6, cx - 0.148, top + 0.78],
      [cx + 0.2, top + 0.3, cx + 0.228, top + 0.55, cx + 0.21, top + 0.78],
      [cx + 0.152, top + 0.44, cx + 0.165, top + 0.6, cx + 0.155, top + 0.78],
      [cx - 0.06, top + 0.03, cx - 0.14, top + 0.07, cx - 0.18, top + 0.16],
    ]);
  // inner shade where the cloth frames the face
  g.fillStyle = 'rgba(70,74,84,0.16)';
  egg(g, cx, hy + 0.004, fx * 1.18, fy * 1.1, 0.9);
  g.fill();
  face(g, F, L);
  beard(g, F, L, L.band !== 'youth' || (L.seed & 1) === 1);
  if (detail) features(g, F, L, { mouth: L.band === 'child' || L.band === 'youth' });
  // the ghutra's front edge across the forehead (inside the ghutra's outline), with its shadow
  const brow = hy - fy * 0.74;
  g.save();
  g.clip(ghutra);
  g.fillStyle = 'rgba(60,40,30,0.16)';
  g.beginPath();
  g.ellipse(cx, brow + 0.01, fx * 1.02, 0.026, 0, 0, Math.PI);
  g.fill();
  g.beginPath();
  g.moveTo(cx - fx * 1.22, hy + fy * 0.05);
  g.bezierCurveTo(cx - fx * 1.18, brow - 0.025, cx - fx * 0.7, brow + 0.004, cx, brow);
  g.bezierCurveTo(cx + fx * 0.7, brow + 0.004, cx + fx * 1.18, brow - 0.025, cx + fx * 1.22, hy + fy * 0.05);
  g.lineTo(cx + 0.3, top - 0.02);
  g.lineTo(cx - 0.3, top - 0.02);
  g.closePath();
  g.fillStyle = cloth;
  g.fill();
  // a soft fold line along the edge
  g.strokeStyle = 'rgba(118,126,140,0.3)';
  g.lineWidth = 0.005;
  g.beginPath();
  g.moveTo(cx - fx * 1.1, hy - fy * 0.3);
  g.bezierCurveTo(cx - fx * 1.0, brow - 0.012, cx - fx * 0.6, brow - 0.008, cx, brow - 0.008);
  g.bezierCurveTo(cx + fx * 0.6, brow - 0.008, cx + fx * 1.0, brow - 0.012, cx + fx * 1.1, hy - fy * 0.3);
  g.stroke();
  g.restore();
  if (kid) return;
  // agal: the black double cord around the crown
  const ay = top + 0.085;
  g.lineCap = 'round';
  for (const [dy, w] of [
    [0, 0.024],
    [0.027, 0.022],
  ] as const) {
    g.strokeStyle = '#18181c';
    g.lineWidth = w;
    g.beginPath();
    g.ellipse(cx, ay + dy + 0.04, 0.206, 0.052, 0, Math.PI * 1.06, Math.PI * 1.94);
    g.stroke();
    if (detail) {
      g.strokeStyle = 'rgba(150,150,165,0.45)';
      g.lineWidth = 0.004;
      g.beginPath();
      g.ellipse(cx, ay + dy + 0.034, 0.2, 0.05, 0, Math.PI * 1.15, Math.PI * 1.5);
      g.stroke();
    }
  }
}

function gulfWoman(g: CanvasRenderingContext2D, F: Frame, L: Look, detail: boolean) {
  const { cx, hy, fx, fy } = F;
  const kid = L.band === 'child';
  const cloth = pick(['#141418', '#141418', '#16161c', '#1a1620', '#121620'], L.seed, 23);
  const sheen = mix(cloth, '#8a8aa0', 0.22);
  // abaya
  torso(g, F, linear(g, F.cx - 0.36, F.sy - 0.05, F.cx + 0.38, 1, [sheen, cloth, mix(cloth, '#000000', 0.4)]));
  // shayla: wraps the head and falls over the shoulders
  const top = hy - fy - 0.075;
  const shayla = new Path2D();
  shayla.moveTo(cx, top);
  shayla.bezierCurveTo(cx + 0.125, top, cx + 0.19, top + 0.08, cx + 0.196, top + 0.19);
  shayla.bezierCurveTo(cx + 0.2, top + 0.3, cx + 0.205, top + 0.38, cx + 0.245, top + 0.47);
  shayla.bezierCurveTo(cx + 0.3, top + 0.56, cx + 0.36, top + 0.66, cx + 0.4, top + 0.8);
  shayla.lineTo(cx - 0.4, top + 0.8);
  shayla.bezierCurveTo(cx - 0.36, top + 0.66, cx - 0.3, top + 0.56, cx - 0.245, top + 0.47);
  shayla.bezierCurveTo(cx - 0.205, top + 0.38, cx - 0.2, top + 0.3, cx - 0.196, top + 0.19);
  shayla.bezierCurveTo(cx - 0.19, top + 0.08, cx - 0.125, top, cx, top);
  shayla.closePath();
  g.fillStyle = linear(g, cx - 0.2, top, cx + 0.24, top + 0.8, [sheen, cloth, mix(cloth, '#000000', 0.35)]);
  g.fill(shayla);
  // silk sheen on the crown
  const sh = g.createRadialGradient(cx - 0.08, top + 0.07, 0.005, cx - 0.06, top + 0.09, 0.15);
  sh.addColorStop(0, 'rgba(210,210,230,0.3)');
  sh.addColorStop(1, 'rgba(210,210,230,0)');
  g.fillStyle = sh;
  g.fillRect(cx - 0.25, top, 0.5, 0.3);
  if (detail)
    folds(g, 'rgba(170,170,190,0.13)', 0.006, [
      [cx - 0.17, top + 0.32, cx - 0.2, top + 0.5, cx - 0.27, top + 0.78],
      [cx + 0.17, top + 0.32, cx + 0.2, top + 0.5, cx + 0.27, top + 0.78],
      [cx - 0.1, top + 0.52, cx - 0.08, top + 0.66, cx - 0.12, top + 0.8],
      [cx + 0.1, top + 0.52, cx + 0.08, top + 0.66, cx + 0.12, top + 0.8],
    ]);
  // face, framed by the shayla (the cloth covers the forehead and wraps under the chin)
  g.save();
  egg(g, cx, hy + fy * 0.02, fx * 1.1, fy * 1.07, 0.82);
  g.clip();
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(cx - 0.2, hy - 0.2, 0.4, 0.4);
  face(g, F, L);
  if (detail) features(g, F, L, { mouth: true });
  g.restore();
  // front edge of the shayla over the forehead (kept inside the shayla's outline)
  const brow = hy - fy * 0.66;
  g.save();
  g.clip(shayla);
  g.beginPath();
  g.moveTo(cx - fx * 1.2, hy + fy * 0.1);
  g.bezierCurveTo(cx - fx * 1.15, brow - 0.01, cx - fx * 0.75, brow - 0.004, cx, brow - 0.004);
  g.bezierCurveTo(cx + fx * 0.75, brow - 0.004, cx + fx * 1.15, brow - 0.01, cx + fx * 1.2, hy + fy * 0.1);
  g.lineTo(cx + fx * 1.3, top + 0.02);
  g.lineTo(cx - fx * 1.3, top + 0.02);
  g.closePath();
  g.fillStyle = linear(g, cx - 0.14, top, cx + 0.14, hy, [sheen, cloth]);
  g.fill();
  g.restore();
  if (!detail) return;
  // fine trim along the opening (a beaded edge for girls, a soft sheen line otherwise)
  g.strokeStyle = kid ? 'rgba(214,190,130,0.75)' : 'rgba(150,150,170,0.32)';
  g.lineWidth = kid ? 0.007 : 0.0045;
  if (kid) g.setLineDash([0.004, 0.012]);
  g.beginPath();
  g.moveTo(cx - fx * 1.2, hy + fy * 0.1);
  g.bezierCurveTo(cx - fx * 1.15, brow - 0.01, cx - fx * 0.75, brow - 0.004, cx, brow - 0.004);
  g.bezierCurveTo(cx + fx * 0.75, brow - 0.004, cx + fx * 1.15, brow - 0.01, cx + fx * 1.2, hy + fy * 0.1);
  g.stroke();
  g.setLineDash([]);
}

const KURTA = ['#ece4d2', '#d8c6a2', '#5f7392', '#7b3139', '#6a6a3c', '#3c3e44', '#f1efe9', '#8a5a3a'] as const;
const SAREE = ['#7d2633', '#a8762c', '#a3405f', '#2f4f8f', '#4f6b3a', '#5b3f86', '#c06f4b', '#7a2f5a'] as const;

function southMan(g: CanvasRenderingContext2D, F: Frame, L: Look, detail: boolean) {
  const { cx, hy, fx, fy, sy } = F;
  const elder = L.band === 'elder';
  const cloth = elder ? pick(['#efe9dc', '#f2f0ea', '#e2d6bd'], L.seed, 5) : pick(KURTA, L.seed, 5);
  torso(
    g,
    F,
    linear(g, cx - 0.36, sy - 0.05, cx + 0.4, 1, [mix(cloth, '#ffffff', 0.18), cloth, mix(cloth, '#1a1a22', 0.35)]),
  );
  neck(g, F, L, 0.052);
  // band collar and placket
  const dark = mix(cloth, '#1a1a22', 0.28);
  g.fillStyle = linear(g, cx - 0.08, 0, cx + 0.08, 0, [mix(cloth, '#ffffff', 0.12), dark]);
  g.beginPath();
  g.moveTo(cx - 0.066, sy - 0.058);
  g.quadraticCurveTo(cx, sy - 0.03, cx + 0.066, sy - 0.058);
  g.lineTo(cx + 0.07, sy - 0.03);
  g.quadraticCurveTo(cx, sy + 0.0, cx - 0.07, sy - 0.03);
  g.closePath();
  g.fill();
  if (detail) {
    g.strokeStyle = dark;
    g.lineWidth = 0.005;
    g.beginPath();
    g.moveTo(cx, sy - 0.012);
    g.lineTo(cx, 1);
    g.stroke();
    g.fillStyle = mix(cloth, '#ffffff', 0.5);
    for (const y of [0.03, 0.08, 0.13]) {
      g.beginPath();
      g.arc(cx + 0.012, sy + y, 0.0065, 0, Math.PI * 2);
      g.fill();
    }
  }
  ears(g, F, L);
  face(g, F, L);
  // hair: volume on top, swept away from a side parting, short at the sides; elders recede, boys keep a fringe.
  // Drawn with the parting on the right, mirrored for half of the people.
  const flip = L.seed & 2 ? -1 : 1;
  const hl = hy - fy * (elder ? 0.74 : L.band === 'child' ? 0.5 : 0.6);
  const crown = hy - fy * (elder ? 1.24 : 1.4);
  g.save();
  g.translate(cx, 0);
  g.scale(flip, 1);
  g.translate(-cx, 0);
  g.fillStyle = linear(g, cx, crown, cx, hl, [mix(L.hair, '#ffffff', 0.14), L.hair]);
  g.beginPath();
  g.moveTo(cx - fx * 0.97, hy + fy * 0.04);
  g.lineTo(cx - fx * 1.07, hy - fy * 0.35);
  g.bezierCurveTo(cx - fx * 1.18, hy - fy * 1.05, cx - fx * 0.55, crown, cx + fx * 0.2, crown);
  g.bezierCurveTo(cx + fx * 0.85, crown + 0.006, cx + fx * 1.2, hy - fy * 0.98, cx + fx * 1.07, hy - fy * 0.35);
  g.lineTo(cx + fx * 0.97, hy + fy * 0.04);
  g.lineTo(cx + fx * 0.9, hy - fy * 0.28);
  g.bezierCurveTo(cx + fx * 0.86, hl - 0.012, cx + fx * 0.6, hl - 0.024, cx + fx * 0.4, hl - 0.024);
  g.bezierCurveTo(cx + fx * 0.05, hl - 0.01, cx - fx * 0.4, hl + 0.012, cx - fx * 0.62, hl + 0.004);
  g.bezierCurveTo(cx - fx * 0.82, hl - 0.002, cx - fx * 0.9, hy - fy * 0.45, cx - fx * 0.9, hy - fy * 0.28);
  g.closePath();
  g.fill();
  if (detail) {
    // the parting and a few strands sweeping across the top
    g.strokeStyle = mix(L.hair, '#ffffff', 0.32, 0.55);
    g.lineWidth = 0.0042;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx + fx * 0.4, hl - 0.024);
    g.quadraticCurveTo(cx + fx * 0.5, hy - fy * 1.05, cx + fx * 0.36, crown + 0.012);
    g.stroke();
    folds(g, mix(L.hair, '#ffffff', 0.22, 0.4), 0.0036, [
      [cx + fx * 0.25, crown + 0.02, cx - fx * 0.2, crown + 0.01, cx - fx * 0.75, hl - 0.03],
      [cx + fx * 0.3, hl - 0.04, cx - fx * 0.1, hl - 0.045, cx - fx * 0.55, hl - 0.006],
      [cx + fx * 0.6, crown + 0.03, cx + fx * 0.85, hy - fy * 0.9, cx + fx * 0.95, hy - fy * 0.5],
    ]);
  }
  g.restore();
  if (L.band === 'adult' || elder) beard(g, F, L, (L.seed & 12) === 0);
  if (detail) features(g, F, L, { mouth: true, brow: elder ? mix(L.hair, '#3d3631', 0.4) : undefined });
  // elders born before about 1935 wear the white Gandhi cap
  if (elder && L.age >= 75) {
    const ty = hy - fy * 1.08;
    g.fillStyle = linear(g, cx - 0.12, ty - 0.06, cx + 0.12, ty + 0.03, ['#ffffff', '#ecebe5', '#c9ccd2']);
    g.beginPath();
    g.moveTo(cx - fx * 1.12, ty + 0.03);
    g.lineTo(cx - fx * 1.0, ty - 0.055);
    g.quadraticCurveTo(cx, ty - 0.085, cx + fx * 1.0, ty - 0.055);
    g.lineTo(cx + fx * 1.12, ty + 0.03);
    g.quadraticCurveTo(cx, ty + 0.012, cx - fx * 1.12, ty + 0.03);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(120,124,134,0.45)';
    g.lineWidth = 0.004;
    g.beginPath();
    g.moveTo(cx - fx * 1.05, ty + 0.0);
    g.quadraticCurveTo(cx, ty - 0.02, cx + fx * 1.05, ty + 0.0);
    g.stroke();
  }
}

function southWoman(g: CanvasRenderingContext2D, F: Frame, L: Look, detail: boolean) {
  const { cx, hy, fx, fy, sy } = F;
  const kid = L.band === 'child';
  const elder = L.band === 'elder';
  const silk = elder ? pick(['#e6dcc6', '#c9b28a', '#7d2633', '#5b4a6e'], L.seed, 7) : pick(SAREE, L.seed, 7);
  const zari = '#d6b15e';
  // hair falling behind the shoulders
  g.fillStyle = L.hair;
  g.beginPath();
  g.ellipse(cx, hy + fy * 0.4, fx * 1.42, fy * 1.32, 0, 0, Math.PI * 2);
  g.fill();
  torso(
    g,
    F,
    linear(g, cx - 0.36, sy - 0.05, cx + 0.4, 1, [mix(silk, '#ffffff', 0.16), silk, mix(silk, '#14101a', 0.42)]),
  );
  neck(g, F, L, 0.05);
  if (!kid) {
    // the pallu crossing from the left shoulder, with its zari border
    g.fillStyle = linear(g, cx - 0.3, sy, cx + 0.3, 1, [mix(silk, '#ffffff', 0.08), mix(silk, '#14101a', 0.3)]);
    g.beginPath();
    g.moveTo(cx - 0.2, sy - 0.04);
    g.lineTo(cx - 0.05, sy - 0.03);
    g.lineTo(cx + 0.3, 1.02);
    g.lineTo(cx - 0.06, 1.02);
    g.closePath();
    g.fill();
    if (detail) {
      g.strokeStyle = zari;
      g.lineWidth = 0.009;
      g.beginPath();
      g.moveTo(cx - 0.05, sy - 0.03);
      g.lineTo(cx + 0.3, 1.02);
      g.stroke();
      // a fine chain at the neck
      g.strokeStyle = 'rgba(214,177,94,0.85)';
      g.lineWidth = 0.004;
      g.beginPath();
      g.ellipse(cx, sy - 0.07, 0.045, 0.04, 0, 0.15, Math.PI - 0.15);
      g.stroke();
    }
  }
  ears(g, F, L, detail && !kid);
  face(g, F, L);
  // hair: a centre parting, smooth over the temples
  const hl = hy - fy * 0.62;
  g.fillStyle = linear(g, cx - 0.1, hy - fy * 1.3, cx + 0.1, hl, [mix(L.hair, '#ffffff', 0.1), L.hair]);
  g.beginPath();
  g.moveTo(cx - fx * 1.1, hy + fy * 0.25);
  g.bezierCurveTo(cx - fx * 1.2, hy - fy * 1.0, cx - fx * 0.55, hy - fy * 1.3, cx, hy - fy * 1.28);
  g.bezierCurveTo(cx + fx * 0.55, hy - fy * 1.3, cx + fx * 1.2, hy - fy * 1.0, cx + fx * 1.1, hy + fy * 0.25);
  g.bezierCurveTo(cx + fx * 0.96, hy - fy * 0.1, cx + fx * 0.75, hl - 0.004, cx, hl - 0.012);
  g.bezierCurveTo(cx - fx * 0.75, hl - 0.004, cx - fx * 0.96, hy - fy * 0.1, cx - fx * 1.1, hy + fy * 0.25);
  g.closePath();
  g.fill();
  if (detail) {
    g.strokeStyle = mix(L.hair, '#c8a890', 0.45, 0.8);
    g.lineWidth = 0.004;
    g.beginPath();
    g.moveTo(cx, hl - 0.012);
    g.lineTo(cx, hy - fy * 1.26);
    g.stroke();
    features(g, F, L, { mouth: true });
    if (!kid) {
      g.fillStyle = '#9b1c2c';
      g.beginPath();
      g.arc(cx, hy - fy * 0.43, 0.0078, 0, Math.PI * 2);
      g.fill();
    }
  }
  // elders cover the head with the pallu
  if (elder) {
    const top = hy - fy - 0.06;
    g.fillStyle = linear(g, cx - 0.2, top, cx + 0.22, top + 0.5, [
      mix(silk, '#ffffff', 0.14),
      silk,
      mix(silk, '#14101a', 0.3),
    ]);
    g.beginPath();
    g.moveTo(cx - fx * 1.12, hy + fy * 0.3);
    g.bezierCurveTo(cx - fx * 1.1, hl - 0.02, cx - fx * 0.6, hl - 0.03, cx, hl - 0.03);
    g.bezierCurveTo(cx + fx * 0.6, hl - 0.03, cx + fx * 1.1, hl - 0.02, cx + fx * 1.12, hy + fy * 0.3);
    g.bezierCurveTo(cx + fx * 1.5, hy + fy * 0.9, cx + 0.2, sy - 0.02, cx + 0.24, sy + 0.04);
    g.lineTo(cx + 0.2, top + 0.06);
    g.bezierCurveTo(cx + 0.14, top - 0.01, cx - 0.14, top - 0.01, cx - 0.2, top + 0.06);
    g.lineTo(cx - 0.24, sy + 0.04);
    g.bezierCurveTo(cx - 0.2, sy - 0.02, cx - fx * 1.5, hy + fy * 0.9, cx - fx * 1.12, hy + fy * 0.3);
    g.closePath();
    g.fill();
    if (detail) {
      g.strokeStyle = zari;
      g.lineWidth = 0.007;
      g.beginPath();
      g.moveTo(cx - fx * 1.12, hy + fy * 0.3);
      g.bezierCurveTo(cx - fx * 1.1, hl - 0.02, cx - fx * 0.6, hl - 0.03, cx, hl - 0.03);
      g.bezierCurveTo(cx + fx * 0.6, hl - 0.03, cx + fx * 1.1, hl - 0.02, cx + fx * 1.12, hy + fy * 0.3);
      g.stroke();
    }
  }
}

/**
 * Placeholder portrait in the cell (x, y, s): an illustrated bust on a lit studio backdrop.
 * Gulf dress (ghutra and agal over a kandura, or shayla and abaya) by default; South Asian dress
 * (kurta, or saree with pallu) for people born in South Asia. Age shows in the proportions,
 * beard and hair; features are drawn only when the cell is large enough to show them.
 */
export function drawPortrait(g: CanvasRenderingContext2D, p: StudioPerson, x: number, y: number, s: number) {
  const L = lookOf(p);
  const F = frameOf(L);
  const detail = s >= 72;
  g.save();
  g.beginPath();
  g.rect(x, y, s, s);
  g.clip();
  g.translate(x, y);
  g.scale(s, s);
  g.lineJoin = 'round';
  backdrop(g, p.color);
  // the bust fills the disc: scale it up around the upper chest
  g.translate(0.5, 0.62);
  g.scale(1.13, 1.13);
  g.translate(-0.5, -0.62);
  if (L.south) (L.male ? southMan : southWoman)(g, F, L, detail);
  else (L.male ? gulfMan : gulfWoman)(g, F, L, detail);
  // a soft key light from the top left over the whole bust
  const key = g.createRadialGradient(0.3, 0.22, 0.02, 0.36, 0.3, 0.7);
  key.addColorStop(0, 'rgba(255,248,236,0.1)');
  key.addColorStop(1, 'rgba(255,248,236,0)');
  g.fillStyle = key;
  g.fillRect(0, 0, 1, 1);
  g.restore();
}

// ---------- atlas ----------

/** Texels the atlas may use (about 19 MB as RGBA, the size of the former 2048² atlas). */
const ATLAS_BUDGET = 4.8e6;
const ATLAS_MAX_SIDE = 4096;
const CELL_SIZES = [256, 224, 192, 160, 128, 112, 96, 80, 64, 48, 32] as const;
/** Share of the cell kept as a margin around the disc, so mipmaps do not bleed between neighbours. */
const GUTTER = 0.035;

export function atlasLayout(n: number) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cell =
    CELL_SIZES.find(
      (c) => cols * c <= ATLAS_MAX_SIDE && rows * c <= ATLAS_MAX_SIDE && cols * rows * c * c <= ATLAS_BUDGET,
    ) ?? 32;
  return { cols, rows, cell, width: cols * cell, height: rows * cell };
}

export class Atlas {
  readonly cv: HTMLCanvasElement;
  readonly tex: CanvasTexture;
  readonly uv: Float32Array;
  readonly cell: number;
  private readonly cells: Array<[number, number, number]> = [];
  private readonly thumbs = new Map<string, string>();
  private readonly images: HTMLImageElement[] = [];
  private uploadTimer = 0;
  private disposed = false;

  constructor(private readonly M: StudioModel) {
    const { cols, cell, width, height } = atlasLayout(M.n);
    this.cell = cell;
    this.cv = document.createElement('canvas');
    this.cv.width = width;
    this.cv.height = height;
    this.uv = new Float32Array(M.n * 4);
    const g = this.cv.getContext('2d');
    M.people.forEach((p, i) => {
      const x = (i % cols) * cell;
      const y = Math.floor(i / cols) * cell;
      if (g) drawPortrait(g, p, x, y, cell);
      this.uv.set([x / width, 1 - (y + cell) / height, cell / width, cell / height], i * 4);
      this.cells.push([x, y, cell]);
    });
    this.tex = new CanvasTexture(this.cv);
    this.tex.colorSpace = SRGBColorSpace;
    // billboards always face the camera, so anisotropic filtering would add cost and nothing else
    this.tex.anisotropy = 1;
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
          this.thumbs.delete(p.id);
          this.scheduleUpload();
        } catch {
          // keep the drawn portrait
        }
      };
      img.src = url;
      this.images.push(img);
    });
  }

  /** Photos arrive one by one; upload the (large) atlas once per burst instead of once per photo. */
  private scheduleUpload() {
    if (this.uploadTimer) return;
    this.uploadTimer = window.setTimeout(() => {
      this.uploadTimer = 0;
      if (!this.disposed) this.tex.needsUpdate = true;
    }, 120);
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
    clearTimeout(this.uploadTimer);
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

// ---------- medals ----------

/**
 * Display colours of the rim language per theme (sRGB). The shader undoes the tone mapping,
 * so they appear on screen as written whatever the scene's exposure.
 */
export const MEDAL_INK = {
  dark: {
    teal: '#4fd1bd',
    gold: '#e2b65a',
    rim: '#a2a2a2',
    dead: '#6e6e6e',
    star: '#f3efe7',
  },
  light: {
    teal: '#0f6b63',
    gold: '#b7862c',
    rim: '#f7f7f7',
    dead: '#b4b4b4',
    star: '#1b1b1b',
  },
} as const;

const v3 = (hex: string) => {
  const c = new Color(hex);
  return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
};
const m3 = (m: Matrix3) => `mat3(${m.elements.map((e) => e.toFixed(6)).join(', ')})`;
// Inverses of the matrices in three's ACESFilmicToneMapping (row-major here).
const ACES_IN_INV = m3(
  new Matrix3().set(0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777).invert(),
);
const ACES_OUT_INV = m3(
  new Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602).invert(),
);

/** Initial theme before the engine sets `uDark`: the document's theme attribute, else the OS setting. */
function documentDark(): boolean {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark' || t === 'light') return t === 'dark';
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
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
    /** Theme of the stage: 1 dark (black), 0 light (white). Set by the engine on creation, data reload and theme change. */
    uDark: { value: number };
  };
  from: InstancedBufferAttribute;
  to: InstancedBufferAttribute;
  birth: InstancedBufferAttribute;
  hi: InstancedBufferAttribute;
}

/** Size factor of one portrait relative to the scene size (founder larger, married-in smaller). */
export const sizeFactor = (p: StudioPerson) => (isRoot(p) ? 1.35 : p.mi ? 0.85 : 1);

const D = MEDAL_INK.dark;
const LT = MEDAL_INK.light;

const VERTEX = /* glsl */ `
  attribute vec3 aFrom; attribute vec3 aTo; attribute vec4 aUv; attribute float aSize; attribute float aBirth;
  attribute float aDeath; attribute float aHi; attribute float aMi;
  uniform float uMorph, uYear, uEnter, uMinYear, uScale, uLift, uTime, uViewH, uMinPx, uDark, uCalm;
  varying vec2 vQ; varying vec4 vUv; varying float vDead, vHi, vA, vMi;
  // per medal and constant over its quad: colours of the rim language, and motion
  varying vec3 vTeal, vGold, vRim, vStar, vMotion;
  void main() {
    float m = uMorph; m = m < .5 ? 4.*m*m*m : 1. - pow(-2.*m + 2., 3.) / 2.;
    vec3 p = mix(aFrom, aTo, m); p.y += sin(m * 3.14159) * uLift;
    float yr = mix(uMinYear - 3., uYear, uEnter);
    float app = smoothstep(aBirth, aBirth + .9, yr);
    vA = app; vDead = smoothstep(aDeath, aDeath + .6, yr); vHi = aHi; vMi = aMi; vUv = aUv; vQ = position.xy * 2.;
    p.y += sin(uTime * .8 + aBirth * 1.7) * .12;
    vec4 mv = modelViewMatrix * vec4(p, 1.);
    float s = aSize * uScale * (.35 + .65 * app) * (1. + .3 * step(1.5, aHi));
    // far away the disc keeps at least uMinPx pixels of radius, so it still reads as a person
    float ppu = projectionMatrix[1][1] * .5 * uViewH / max(-mv.z, 1e-3);
    s = max(s, uMinPx / max(ppu * 1.15 * .685, 1e-6));
    mv.xy += position.xy * s * 2.3;
    gl_Position = projectionMatrix * mv;
    // depth only: the medal counts as about one disc radius nearer, so leaves or edges just in front of a
    // person do not cut through the face, while real occluders further forward still hide it
    vec4 near = projectionMatrix * vec4(mv.xy, mv.z + min(s * .8, -mv.z * .5), 1.);
    gl_Position.z = near.z / near.w * gl_Position.w;

    float dk = clamp(uDark, 0., 1.);
    float lit = step(.5, aHi);
    vTeal = mix(${v3(LT.teal)}, ${v3(D.teal)}, dk);
    vGold = mix(${v3(LT.gold)}, ${v3(D.gold)}, dk);
    vec3 grey = mix(${v3(LT.dead)}, ${v3(D.dead)}, dk);
    // identity: neutral or gold, quieter when deceased; teal in the selected lineage
    vec3 idc = mix(mix(${v3(LT.rim)}, ${v3(D.rim)}, dk), vGold, aMi);
    idc = mix(idc, mix(grey, mix(vGold, grey, .5), aMi), vDead);
    vRim = mix(idc, mix(vTeal, grey, .25 * vDead), lit);
    vec3 sc = mix(mix(${v3(LT.star)}, ${v3(D.star)}, dk), vGold, aMi * .85);
    sc = mix(sc, grey, vDead * .75);
    vStar = mix(sc, vTeal, lit);
    // x: breathing of the selected glow, y: phase of the selection pulse, z: twinkle of stars on black
    float seed = fract(float(gl_InstanceID) * .61803 + .17);
    float calm = 1. - uCalm;
    vMotion = vec3(.8 + .2 * sin(uTime * 2.4) * calm, fract(uTime * .45),
      mix(1., .8 + .2 * sin(uTime * (1.2 + seed * 1.6) + seed * 40.), dk * calm));
  }`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uAtlas; uniform float uStyle, uFocus, uDark, uExpo, uCalm;
  varying vec2 vQ; varying vec4 vUv; varying float vDead, vHi, vA, vMi;
  varying vec3 vTeal, vGold, vRim, vStar, vMotion;
  const float R1 = .685;
  const float GUT = ${GUTTER.toFixed(3)};
  const mat3 IN_INV = ${ACES_IN_INV};
  const mat3 OUT_INV = ${ACES_OUT_INV};

  float luma(vec3 c) { return dot(c, vec3(.2126, .7152, .0722)); }
  // display colour -> scene colour, so that the ACES output pass shows the colour as designed
  vec3 untone(vec3 c) {
    c = clamp(OUT_INV * c, 0., .99);
    vec3 a = 1. - .983729 * c, b = .0245786 - .432951 * c, k = .000090537 + .238081 * c;
    vec3 v = (sqrt(b * b + 4. * a * k) - b) / (2. * a);
    return max(IN_INV * v, 0.) * (.6 / uExpo);
  }
  vec3 cap(vec3 c, float m) { return c * min(1., m / max(max(c.r, max(c.g, c.b)), 1e-4)); }
  vec4 over(vec4 dst, vec3 c, float a) {
    float o = a + dst.a * (1. - a);
    return vec4((c * a + dst.rgb * dst.a * (1. - a)) / max(o, 1e-5), o);
  }
  float ring(float r, float c, float w, float aa) { return 1. - smoothstep(w * .5 - aa * .5, w * .5 + aa * .5, abs(r - c)); }

  void main() {
    float u = max(length(vec2(dFdx(vQ.x), dFdy(vQ.x))), 1e-5); // one pixel, in quad units
    float aa = u;
    float r = length(vQ);
    float sel = step(1.5, vHi), line = step(.5, vHi) * (1. - sel), lit = max(sel, line);
    float dim = uFocus * (1. - step(.5, vHi));
    float star = step(.5, uStyle);
    float dk = clamp(uDark, 0., 1.);
    // rim width: wider when selected, thinner when deceased, never under ~1.3 px (2.2 px in teal)
    float w = mix(mix(mix(.074, .085, line), .052, vDead), .115, sel);
    w = mix(w, mix(.05, .07, sel), star);
    w = clamp(max(w, u * mix(1.3, 2.2, lit)), 0., .3);
    float R0 = mix(R1 - w, .44, star);
    vec2 q = vQ / R0;
    // atlas gradients from the (linear) quad coordinates, so the fetch below may sit in a branch
    vec2 dq = (.5 - GUT) * vUv.zw / R0;
    vec2 gx = dFdx(vQ) * dq, gy = dFdy(vQ) * dq;
    if (r > 1. || vA < .01) discard;

    // the picture, only on the disc: lit from the top left, shaded under the rim, quieter when deceased
    vec3 pic = vec3(.5);
    if (r < R0 + 2. * aa) {
      pic = textureGrad(uAtlas, vUv.xy + clamp(.5 + q * (.5 - GUT), 0., 1.) * vUv.zw, gx, gy).rgb;
      float pr = length(q);
      pic *= 1. + .1 * (1. - smoothstep(0., 1.1, length(q - vec2(-.45, .55))));
      pic *= 1. - .3 * smoothstep(.62, 1., pr) * (1. - .5 * smoothstep(-.6, .6, q.y));
      float gloss = (1. - smoothstep(0., .06, abs(pr - .87))) * smoothstep(.3, .9, dot(q / max(pr, 1e-4), vec2(-.5, .866)));
      pic = mix(pic, vec3(1.), .12 * gloss * smoothstep(18., 50., R0 / u));
      pic = mix(pic, vec3(luma(pic)), .55 * vDead) * (1. - .08 * vDead);
      pic *= mix(1., .85, dk); // keep whites under the bloom threshold on the black stage
    }

    vec4 acc = vec4(0.);
    float boost = 0.;
    float toLight = dot(vQ / max(r, 1e-4), vec2(-.6, .8));

    if (star < .5) {
      // ---- portrait medal ----
      if (r > R1 - aa) {
        // contact shadow below the medal on white, a dark separation halo all round on black
        float ds = length(vQ + vec2(0., mix(.075, 0., dk))) - R1;
        acc = over(acc, vec3(0.), (1. - smoothstep(-.03, mix(.2, .24, dk), ds)) * mix(.24, .5, dk));
        if (lit > .5) {
          float d = max(r - R1, 0.);
          // teal glow on black: strong for the selected person, soft for the lineage
          float glow = exp(-d / mix(.07, .1, sel)) * dk * (sel * .45 * vMotion.x + line * .26);
          acc = over(acc, vTeal, clamp(glow, 0., 1.));
          // on white there is no glow: a faint teal wash marks the selected person instead
          acc = over(acc, vTeal, exp(-d / .09) * (1. - dk) * sel * .2);
          // the selected person's pulse: a thin ring that expands and fades (a still ring with reduced motion)
          float rw = max(.024, aa * 1.6);
          float pulse = sel * (ring(r, R1 + .03 + .27 * vMotion.y, rw, aa) * pow(1. - vMotion.y, 1.4) * .9 * (1. - uCalm)
            + ring(r, R1 + .08, rw, aa) * .7 * uCalm);
          acc = over(acc, vTeal, pulse);
          boost = dk * sel * (glow + pulse) * 1.2;
        }
      }
      if (r < R1 + aa) {
        // rim: bevelled, brighter towards the light, with a fine chamfer at the outer edge
        float t = clamp((r - R0) / w, 0., 1.);
        vec3 rim = vRim * (.82 + .32 * (.5 + .5 * toLight));
        rim = mix(rim, min(rim * 1.3 + .05, vec3(1.)), smoothstep(.55, 1., t) * smoothstep(-.1, .9, toLight) * .55);
        rim *= 1. - .4 * (1. - smoothstep(0., max(.22, aa / w * 1.3), t));
        rim *= 1. - .22 * (1. - dk) * smoothstep(1. - max(.2, aa / w), 1., t); // hairline edge on white
        // married in and in the lineage: a fine gold line inside the teal keeps the marriage visible
        float gl = vMi * lit * smoothstep(.06, .06 + max(.06, aa / w), t) * (1. - smoothstep(.4, .4 + max(.06, aa / w), t));
        rim = mix(rim, vGold * (.88 + .24 * (.5 + .5 * toLight)), gl);
        float inDisc = 1. - smoothstep(R0 - aa * .5, R0 + aa * .5, r);
        float inMedal = 1. - smoothstep(R1 - aa * .5, R1 + aa * .5, r);
        acc = over(acc, mix(rim, pic, inDisc), inMedal);
        boost *= 1. - inMedal;
      }
    } else {
      // ---- star ----
      // a point of light (ink on white) with a soft halo and thin diffraction spikes; up close the
      // person's portrait opens at its heart inside a fine ring
      float k = smoothstep(8., 18., R0 / u);
      float tw = vMotion.z;
      // tiny (far) stars: shorter, fainter spikes and less glow, so a field of hundreds stays calm
      float far = 1. - smoothstep(2.5, 9., R0 / u);
      float halo = (exp(-r / .16) * .5 + exp(-r / .42) * .09 * (1. - .6 * k)) * mix(.55, 1., dk);
      float sw = max(mix(.009, .012, dk), u * .8);
      float sl = mix(.96, .74, far);
      vec2 aq = abs(vQ);
      float spikes = exp(-aq.y / sw) * (1. - smoothstep(.05, sl, aq.x)) + exp(-aq.x / sw) * (1. - smoothstep(.05, sl, aq.y));
      spikes *= mix(.75, .85, dk) * (1. - .55 * vDead) * (1. + .3 * lit) * (1. - .2 * far) * (1. - .6 * dim);
      spikes *= smoothstep(R0 * k, R0 * k + .1, r);
      acc = over(acc, vStar, clamp((halo + spikes) * tw, 0., 1.));
      // the point core, for small sizes: soft and white-hot on black, a crisp ink dot on white
      float cr = max(mix(.19, .12, dk), u * 1.7) * (1. - .25 * vDead);
      float core = mix(1. - smoothstep(cr - aa * .5, cr + aa * .5, r), exp(-r * r / (cr * cr)), dk);
      float inkRing = ring(r, cr + .11, max(.024, aa), aa) * (1. - dk) * .75;
      acc = over(acc, vStar, inkRing * (1. - k));
      acc = over(acc, mix(vStar, vec3(1.), .65 * dk), core * (1. - k));
      boost = dk * (core * (1. - k) * 2.2 + halo * .6) * tw * (1. - .65 * far);
      // pulse for the selected star
      float rw = max(.022, aa * 1.6);
      float base = mix(cr + .14, R0 + w + .05, k);
      float pulse = sel * (ring(r, base + .3 * vMotion.y, rw, aa) * pow(1. - vMotion.y, 1.4) * .9 * (1. - uCalm)
        + ring(r, base + .06, rw, aa) * .7 * uCalm);
      acc = over(acc, vTeal, pulse);
      boost += dk * pulse;
      // portrait inside a luminous (or ink) ring
      float inDisc = 1. - smoothstep(R0 - aa * .5, R0 + aa * .5, r);
      float inRing = 1. - smoothstep(R0 + w - aa * .5, R0 + w + aa * .5, r);
      vec3 rim = vStar * (.86 + .28 * (.5 + .5 * toLight));
      float ts = clamp((r - R0) / w, 0., 1.);
      float gl = vMi * lit * smoothstep(.06, .06 + max(.06, aa / w), ts) * (1. - smoothstep(.4, .4 + max(.06, aa / w), ts));
      rim = mix(rim, vGold, gl);
      acc = over(acc, mix(rim, pic, inDisc), inRing * k);
      boost *= 1. - inRing * k * inDisc;
    }

    // someone else is selected: grey out and step back
    acc.rgb = mix(acc.rgb, vec3(luma(acc.rgb)), .8 * dim);
    vec3 col = cap(acc.rgb, mix(.93, .74, dk));
    // pure shadow needs no inverse tone mapping (black stays black)
    vec3 hdr = max(col.r, max(col.g, col.b)) > .001 ? untone(col) : vec3(0.);
    // on black only the deliberate glow (boost) may reach the bloom threshold (0.9), whatever the exposure
    hdr = mix(hdr, cap(hdr, .85), dk);
    // a white-hot star still reads at 30 % on black, so dimmed stars step back further than medals
    float fade = mix(mix(.6, .7, dk), mix(.62, .84, dk), star);
    gl_FragColor = vec4(hdr * (1. + boost * (1. - dim)), acc.a * vA * (1. - fade * dim));
  }`;

export function createMedals(M: StudioModel, U: Shared, atlas: Atlas): Medals {
  const uni = {
    uAtlas: { value: atlas.tex as Texture },
    uMorph: { value: 1 },
    uScale: { value: 1 },
    uStyle: { value: 0 },
    uFocus: { value: 0 },
    uLift: { value: 6 },
    uDark: { value: documentDark() ? 1 : 0 },
  };
  // Kept up to date from the renderer just before the medals draw (see onBeforeRender below).
  const live = {
    uExpo: { value: 1 },
    uViewH: { value: 800 },
    uMinPx: { value: 2.6 },
    uCalm: {
      value: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0,
    },
  };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ...U, ...uni, ...live },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
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
  const sz = attr('aSize', 1);
  const birth = attr('aBirth', 1);
  const death = attr('aDeath', 1);
  const hi = attr('aHi', 1);
  const mi = attr('aMi', 1);
  const from = attr('aFrom', 3);
  const to = attr('aTo', 3);
  (uv.array as Float32Array).set(atlas.uv);
  M.people.forEach((p, i) => {
    sz.setX(i, sizeFactor(p));
    birth.setX(i, p.born);
    death.setX(i, p.died ?? 9999);
    mi.setX(i, p.marriedIn ? 1 : 0);
  });
  geo.instanceCount = n;
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.onBeforeRender = (renderer: WebGLRenderer) => {
    const rt = renderer.getRenderTarget();
    live.uViewH.value = rt ? rt.height : renderer.domElement.height;
    live.uMinPx.value = 2.6 * renderer.getPixelRatio();
    live.uExpo.value = renderer.toneMappingExposure || 1;
  };
  return { mesh, geo, mat, uni, from, to, birth, hi };
}
