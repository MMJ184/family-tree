import { Color } from 'three';

// Scene palette carried over from the accepted prototype, plus small maths helpers.

export const NOW = new Date().getFullYear();

/**
 * Colours for people who married in, keyed by their birth family. Muted mid tones (lightness about
 * 0.45 to 0.6) that read on the black and on the white stage. No teal or cyan (teal marks the
 * selection) and no gold (gold marks marriages); the slate is the quiet neutral of the set.
 */
export const PORTRAIT_COLOURS = [
  '#c0504d', // brick
  '#c97a45', // burnt orange
  '#8f9a48', // olive
  '#5f9a5c', // moss
  '#4f84c4', // steel blue
  '#6672cc', // indigo
  '#8a66c4', // violet
  '#b05fae', // orchid
  '#c75a86', // rose
  '#8a96a8', // slate
];

export interface Pal {
  top: string;
  hor: string;
  ground: string;
  ring: string;
  barkA: string;
  barkB: string;
  glow: string;
  fog: string;
  skyL: string;
  groundL: string;
  leaf: string;
  autumn: string;
  bloom: number;
  exposure: number;
  fire: string;
  plate: string;
  fogNear: number;
  fogFar: number;
}

export const PAL: { dark: Pal; light: Pal } = {
  dark: {
    top: '#02060a',
    hor: '#0b2427',
    ground: '#071012',
    ring: '#1d4f4b',
    barkA: '#3a2819',
    barkB: '#8a6644',
    glow: '#3fd0bd',
    fog: '#0a1e21',
    skyL: '#a9bcb6',
    groundL: '#2b1f16',
    leaf: '#3f9d6a',
    autumn: '#d4902f',
    bloom: 0.75,
    exposure: 1.1,
    fire: '#ffd27a',
    plate: '#9fe3da',
    fogNear: 140,
    fogFar: 600,
  },
  light: {
    top: '#9fc3d2',
    hor: '#efe8dc',
    ground: '#d6cbb9',
    ring: '#b9c9c2',
    barkA: '#4a3726',
    barkB: '#86674b',
    glow: '#0e8f80',
    fog: '#e9e2d5',
    skyL: '#fdf8ef',
    groundL: '#8a7660',
    leaf: '#3f8f57',
    autumn: '#c47a1c',
    bloom: 0.14,
    exposure: 0.92,
    fire: '#f2b64a',
    plate: '#d7efeb',
    fogNear: 180,
    fogFar: 800,
  },
};

/** sRGB hex to a (linear) three.js colour. */
export const lin = (hex: string) => new Color(hex);

export const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/** Small seeded PRNG (mulberry32) so layouts are stable between visits. */
export function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
