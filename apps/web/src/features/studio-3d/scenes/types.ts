import type { BufferGeometry, Group, Vector3 } from 'three';
import type { Shared } from '../gl.ts';
import type { StudioModel, StudioPerson } from '../model.ts';
import type { Pal } from '../palette.ts';

export const SCENES = [
  'tree',
  'bonsai',
  'helix',
  'lantern',
  'metro',
  'paper',
  'terrain',
  'banyan',
  'delta',
  'palm',
  'galaxy',
  'river',
  'hour',
  'city',
  'mandala',
  'sky',
  'glass',
] as const;
export type SceneKey = (typeof SCENES)[number];

/** What a scene builder may read from the engine. Getters, so tint() always sees the current theme and language. */
export interface SceneCtx {
  M: StudioModel;
  U: Shared;
  big: boolean;
  pal(): Pal;
  dark(): boolean;
  rtl(): boolean;
  lang(): string;
  /** Sets bloom strength and tone-mapping exposure for the active scene. */
  look(bloom: number, exposure: number): void;
  /** The year the scene shows, including the opening "growth" animation. */
  effYear(): number;
  /** Person the hourglass is centred on. */
  focusId(): string;
}

export interface SceneDef {
  key: SceneKey;
  group: Group;
  /** Target portrait position per person (x, y, z). */
  pos: Float32Array;
  size: number;
  /** 0: portrait medal, 1: star glow. */
  style: number;
  lift: number;
  tint(): void;
  hiTargets: Array<{ geo: BufferGeometry; perPerson?: boolean }>;
  /** uFocus uniforms to dim everything outside the lineage. */
  focus: Array<{ value: number }>;
  view: { target: Vector3; cam: Vector3 };
  follow: number;
  /**
   * Extra room in world units kept around every portrait when the camera frames a selected lineage or the
   * whole family (default 0). For scenes whose highlighted structure reaches past the portraits.
   */
  framePad?: number;
  labelUp?: boolean;
  /** Name pills are drawn at this scale (default 1); compact scenes use smaller labels. */
  labelScale?: number;
  yearHook?(yr: number): void;
  update?(): void;
  relang?(): void;
  /** Year each portrait appears (Time River shows it when the "now" curtain reaches it). */
  appear?: Float32Array;
  /** Hourglass: who sits at the waist. */
  centre?: string;
  /** The Time River's direction is baked into its geometry; rebuild when it changes. */
  dir?: number;
}

export type SceneBuilder = (ctx: SceneCtx) => SceneDef;

export const isRoot = (p: StudioPerson) => p.gen === 0 && !p.mi;
