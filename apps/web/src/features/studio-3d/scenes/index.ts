import { banyanScene } from './banyan.ts';
import { bonsaiScene } from './bonsai.ts';
import { cityScene } from './city.ts';
import { deltaScene } from './delta.ts';
import { galaxyScene } from './galaxy.ts';
import { glassScene } from './glass.ts';
import { helixScene } from './helix.ts';
import { hourScene } from './hour.ts';
import { lanternScene } from './lantern.ts';
import { mandalaScene } from './mandala.ts';
import { metroScene } from './metro.ts';
import { palmScene } from './palm.ts';
import { paperScene } from './paper.ts';
import { riverScene } from './river.ts';
import { skyScene } from './sky.ts';
import { terrainScene } from './terrain.ts';
import { treeScene } from './tree.ts';
import type { SceneBuilder, SceneKey } from './types.ts';

export const BUILD: Record<SceneKey, SceneBuilder> = {
  tree: treeScene,
  bonsai: bonsaiScene,
  helix: helixScene,
  lantern: lanternScene,
  metro: metroScene,
  paper: paperScene,
  terrain: terrainScene,
  banyan: banyanScene,
  delta: deltaScene,
  palm: palmScene,
  galaxy: galaxyScene,
  river: riverScene,
  hour: hourScene,
  city: cityScene,
  mandala: mandalaScene,
  sky: skyScene,
  glass: glassScene,
};

export { SCENES, type SceneDef, type SceneKey } from './types.ts';
