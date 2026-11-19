export * from './GraveThemeBlocks.js';
export * from './TreasureAndMazeBlocks.js';
export * from './DragonAndHomeBlocks.js';
export * from './OpenAndEnclosedBlocks.js';
export * from './ItemClusterBlocks.js';

import { ALL_GRAVE_BLOCKS } from './GraveThemeBlocks.js';
import { ALL_TREASURE_AND_MAZE_BLOCKS } from './TreasureAndMazeBlocks.js';
import { ALL_DRAGON_AND_HOME_BLOCKS } from './DragonAndHomeBlocks.js';
import { ALL_OPEN_AND_ENCLOSED_BLOCKS, ALL_PILLAR_BLOCKS } from './OpenAndEnclosedBlocks.js';
import { ALL_ITEM_CLUSTER_BLOCKS } from './ItemClusterBlocks.js';
import { ThemeBlockTemplate } from '../ThemeBlockTypes.js';

export const ALL_THEME_BLOCKS: ThemeBlockTemplate[] = [
  ...ALL_GRAVE_BLOCKS,
  ...ALL_TREASURE_AND_MAZE_BLOCKS,
  ...ALL_DRAGON_AND_HOME_BLOCKS,
  ...ALL_OPEN_AND_ENCLOSED_BLOCKS,
  ...ALL_PILLAR_BLOCKS,
  ...ALL_ITEM_CLUSTER_BLOCKS,
];
