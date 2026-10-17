import { cityScene } from './city.ts';
import { glassScene } from './glass.ts';
import { hourScene } from './hour.ts';
import { mandalaScene } from './mandala.ts';
import { riverScene } from './river.ts';
import { skyScene } from './sky.ts';
import { treeScene } from './tree.ts';
import type { SceneBuilder, SceneKey } from './types.ts';

export const BUILD: Record<SceneKey, SceneBuilder> = {
  tree: treeScene,
  river: riverScene,
  hour: hourScene,
  city: cityScene,
  mandala: mandalaScene,
  sky: skyScene,
  glass: glassScene,
};

export { SCENES, type SceneDef, type SceneKey } from './types.ts';
