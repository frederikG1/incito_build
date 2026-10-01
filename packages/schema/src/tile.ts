/** The boxes a tile is made of — see `PartOverride` in ./catalog.js. */
export const TILE_PARTS = [
  'media', 'price', 'marks', 'brand', 'name',
  'quantity', 'description', 'meta', 'tags',
] as const;
export type TilePart = (typeof TILE_PARTS)[number];

/** How a several-product tile stands its products — see `PlacementOverrides.arrangement`. */
export const TILE_ARRANGEMENTS = ['row', 'stagger', 'grid', 'fan'] as const;
export type TileArrangement = (typeof TILE_ARRANGEMENTS)[number];
