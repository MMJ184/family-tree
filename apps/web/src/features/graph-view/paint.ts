import { personName, personYears } from '#/lib/display.ts';
import { type GNode, type GraphStore, hasBizAt, isDeadAt, type PersonNode } from './model.ts';

// Canvas painting shared by the 2D canvas and the 3D card textures: theme colours,
// the placeholder portrait (same artwork as PersonAvatar) and the photo cards.

export interface Palette {
  fg: string;
  muted: string;
  border: string;
  card: string;
  deadFill: string;
  primary: string;
  gold: string;
  male: string;
  female: string;
}

/** Reads the theme tokens from the document; call again after a theme change. */
export function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement);
  const v = (k: string, fallback: string) => s.getPropertyValue(k).trim() || fallback;
  return {
    fg: v('--ft-foreground', '#0a0a0a'),
    muted: v('--ft-muted-foreground', '#666666'),
    border: v('--ft-border', 'rgba(0,0,0,0.1)'),
    card: v('--ft-card', '#ffffff'),
    deadFill: v('--ft-muted', '#efefef'),
    primary: v('--ft-primary', '#0f6b63'),
    gold: v('--ft-gold', '#8f6820'),
    male: v('--ft-male', '#2f7fb8'),
    female: v('--ft-female', '#c2577e'),
  };
}

/** `#rgb`, `#rrggbb` or `rgb()/rgba()` with a new alpha. */
export function withAlpha(color: string, a: number): string {
  const c = color.trim();
  if (c.startsWith('#')) {
    const hex = c.length === 4 ? [...c.slice(1)].map((ch) => ch + ch).join('') : c.slice(1, 7);
    const n = Number.parseInt(hex, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m?.[1]) {
    const [r, g, b] = m[1].split(',').map((x) => x.trim());
    return `rgba(${r},${g},${b},${a})`;
  }
  return c;
}

export interface PaintCtx {
  pal: Palette;
  lang: string;
  year: number | null;
  selectedId: string | null;
  hoverId: string | null;
  store: GraphStore;
  labels: { marriedIn: string; since: string };
}

export const fontStack = (lang: string) =>
  lang === 'ar'
    ? '"IBM Plex Sans Arabic", Manrope, system-ui, sans-serif'
    : 'Manrope, "IBM Plex Sans Arabic", system-ui, sans-serif';

// ---- Portraits ----

const photos = new Map<string, HTMLImageElement | 'loading' | 'failed'>();
let onPhotoLoaded: (() => void) | null = null;
/** Called when a photo finishes loading, so the view can repaint. */
export function setPhotoListener(fn: (() => void) | null) {
  onPhotoLoaded = fn;
}

function photoFor(url: string | null): HTMLImageElement | null {
  if (!url) return null;
  const hit = photos.get(url);
  if (hit instanceof HTMLImageElement) return hit;
  if (hit) return null;
  photos.set(url, 'loading');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    photos.set(url, img);
    avatars.clear();
    onPhotoLoaded?.();
  };
  img.onerror = () => photos.set(url, 'failed');
  img.src = url;
  return null;
}

// PersonAvatar's placeholder artwork (64×64 viewBox): white ghutra with black agal, or black shayla.
const MALE = {
  body: new Path2D('M8 64c0-15 10-24 24-24s24 9 24 24z'),
  ghutra: new Path2D('M14 40c0-17 8-28 18-28s18 11 18 28l-6 6H20z'),
  agal: new Path2D('M19 22c4-4 9-6 13-6s9 2 13 6'),
};
const FEMALE = {
  body: new Path2D('M8 64c0-16 10-26 24-26s24 10 24 26z'),
  shayla: new Path2D('M16 36c0-14 7-24 16-24s16 10 16 24c0 6-7 10-16 10s-16-4-16-10z'),
};

const avatars = new Map<string, HTMLCanvasElement>();
const AV = 128;

/** A round portrait (photo or placeholder) with a gender-coloured ring, cached per state. */
export function avatarCanvas(n: PersonNode, dead: boolean, pal: Palette): HTMLCanvasElement {
  const p = n.person;
  const photo = photoFor(p.photoUrl);
  const ring = dead ? pal.muted : p.gender === 'FEMALE' ? pal.female : p.gender === 'MALE' ? pal.male : pal.gold;
  const key = `${p.id}|${dead ? 1 : 0}|${ring}|${photo ? 1 : 0}`;
  const hit = avatars.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = AV;
  cv.height = AV;
  const g = cv.getContext('2d');
  if (!g) return cv;
  const r = AV / 2 - 5;
  g.save();
  g.beginPath();
  g.arc(AV / 2, AV / 2, r, 0, Math.PI * 2);
  g.clip();
  if (photo) {
    const k = Math.max(AV / photo.width, AV / photo.height);
    g.drawImage(photo, (AV - photo.width * k) / 2, (AV - photo.height * k) / 2, photo.width * k, photo.height * k);
  } else {
    g.scale(AV / 64, AV / 64);
    const female = p.gender === 'FEMALE';
    g.fillStyle = female ? '#f3dfe6' : '#dde9f1';
    g.fillRect(0, 0, 64, 64);
    if (female) {
      g.fillStyle = '#1d1d24';
      g.fill(FEMALE.body);
      g.fill(FEMALE.shayla);
      g.fillStyle = '#c99a78';
      g.beginPath();
      g.ellipse(32, 32, 9, 11, 0, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = '#f8f8f6';
      g.fill(MALE.body);
      g.fillStyle = '#ffffff';
      g.fill(MALE.ghutra);
      g.strokeStyle = '#d9dde0';
      g.lineWidth = 1;
      g.stroke(MALE.ghutra);
      g.fillStyle = '#c99a78';
      g.beginPath();
      g.ellipse(32, 32, 9, 11, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#1d1d24';
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.stroke(MALE.agal);
    }
  }
  if (dead) {
    // Deceased: greyscale, like PersonAvatar's `grayscale`.
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'saturation';
    g.fillStyle = '#888';
    g.fillRect(0, 0, AV, AV);
    g.globalCompositeOperation = 'source-over';
  }
  g.restore();
  g.lineWidth = 8;
  g.strokeStyle = ring;
  g.beginPath();
  g.arc(AV / 2, AV / 2, r, 0, Math.PI * 2);
  g.stroke();
  avatars.set(key, cv);
  return cv;
}

// ---- Cards ----

/** Card size in graph units. */
export const CARD = { p: [104, 32], b: [92, 26] } as const;
export const cardSize = (n: GNode): readonly [number, number] => CARD[n.kind];

const fitCache = new Map<string, string>();
/** Text shortened with an ellipsis to fit `maxW` in the current font (cached). */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  const key = `${ctx.font}|${maxW.toFixed(1)}|${text}`;
  const hit = fitCache.get(key);
  if (hit !== undefined) return hit;
  let out = text;
  if (ctx.measureText(text).width > maxW) {
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxW) lo = mid;
      else hi = mid - 1;
    }
    out = `${text.slice(0, lo).trimEnd()}…`;
  }
  if (fitCache.size > 5000) fitCache.clear();
  fitCache.set(key, out);
  return out;
}

export function nodeTitle(n: GNode, lang: string): string {
  if (n.kind === 'p') return personName(n.person, lang);
  return (lang === 'ar' ? n.biz.nameAr : null) || n.biz.name;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Paints one node as a photo card centred on (cx, cy): portrait at the start
 * side, name and years beside it. In Arabic the card is mirrored.
 */
export function paintCard(ctx: CanvasRenderingContext2D, n: GNode, cx: number, cy: number, pc: PaintCtx, on: boolean) {
  const { pal, lang } = pc;
  const rtl = lang === 'ar';
  const [w, h] = cardSize(n);
  const sel = pc.selectedId === n.id;
  const hov = pc.hoverId === n.id;
  const dead = n.kind === 'p' && isDeadAt(n, pc.year);
  const font = fontStack(lang);
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.save();
  ctx.globalAlpha = on ? 1 : 0.12;
  ctx.shadowColor = 'rgba(0,0,0,0.14)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 1.5;
  roundRect(ctx, x, y, w, h, 7);
  ctx.fillStyle = dead ? pal.deadFill : pal.card;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = sel || hov ? 1.6 : 0.6;
  ctx.strokeStyle = sel || hov ? pal.primary : n.kind === 'b' ? pal.gold : pal.border;
  ctx.stroke();
  if (sel) {
    roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 9);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = withAlpha(pal.primary, 0.45);
    ctx.stroke();
  }
  const ar = h / 2 - 4;
  const ax = rtl ? x + w - 4 - ar : x + 4 + ar;
  if (n.kind === 'p') ctx.drawImage(avatarCanvas(n, dead, pal), ax - ar, cy - ar, ar * 2, ar * 2);
  else {
    roundRect(ctx, ax - ar, cy - ar, ar * 2, ar * 2, 3);
    ctx.fillStyle = pal.gold;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${ar * 1.1}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      nodeTitle(n, lang)
        .replace(/^(Al |ال)/, '')
        .charAt(0),
      ax,
      cy + 0.5,
    );
  }
  const tx = rtl ? ax - ar - 5 : ax + ar + 5;
  const maxW = w - ar * 2 - 14;
  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = dead ? pal.muted : pal.fg;
  ctx.font = `600 ${n.kind === 'p' ? 8.6 : 8}px ${font}`;
  ctx.fillText(fitText(ctx, nodeTitle(n, lang), maxW), tx, cy - 1.5);
  ctx.font = `500 6.6px ${font}`;
  if (n.kind === 'p') {
    const years = personYears(n.person);
    ctx.fillStyle = pal.muted;
    // Years are digits: draw them LTR so "1950–2010" never flips in Arabic.
    ctx.direction = 'ltr';
    ctx.fillText(years, tx, cy + 8.5);
    ctx.direction = rtl ? 'rtl' : 'ltr';
    if (n.marriedIn) {
      const yw = years ? ctx.measureText(years).width + 4 : 0;
      ctx.fillStyle = pal.gold;
      ctx.fillText(fitText(ctx, pc.labels.marriedIn, maxW - yw), rtl ? tx - yw : tx + yw, cy + 8.5);
    }
    if (hasBizAt(pc.store, n.id, pc.year)) {
      ctx.fillStyle = pal.gold;
      roundRect(ctx, rtl ? x + 5 : x + w - 10, y + 5, 5, 5, 1.2);
      ctx.fill();
    }
  } else if (n.started != null) {
    ctx.fillStyle = pal.muted;
    ctx.fillText(`${pc.labels.since} ${n.started}`, tx, cy + 7.5);
  }
  ctx.restore();
}

/** Far-out level of detail: just the round portrait (or a gold square for a business). */
export function paintDot(
  ctx: CanvasRenderingContext2D,
  n: GNode,
  cx: number,
  cy: number,
  r: number,
  pc: PaintCtx,
  on: boolean,
) {
  const { pal } = pc;
  ctx.save();
  ctx.globalAlpha = on ? 1 : 0.12;
  if (n.kind === 'p') ctx.drawImage(avatarCanvas(n, isDeadAt(n, pc.year), pal), cx - r, cy - r, r * 2, r * 2);
  else {
    roundRect(ctx, cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6, r * 0.3);
    ctx.fillStyle = pal.gold;
    ctx.fill();
  }
  if (pc.selectedId === n.id || pc.hoverId === n.id) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2.5, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = pal.primary;
    ctx.stroke();
  }
  ctx.restore();
}
