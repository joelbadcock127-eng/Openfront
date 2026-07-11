import { GameMapType, MapInfo, maps } from "../game/Game";

/**
 * Maps enabled for solo play.
 *
 * This derivative ships a single polished map. The full upstream map
 * registry (src/core/game/Maps.gen.ts + resources/maps/<id>/) is retained,
 * so adding another map later is a one-line change here — see
 * docs/MAP_GUIDE.md for the full map interface.
 *
 * "World" is the flagship upstream map: large land masses, navigable
 * oceans, coastal areas, islands and chokepoints, so every gameplay system
 * (land expansion, naval invasions, ports/trade, missiles) can be exercised.
 */
export const ENABLED_SOLO_MAPS: readonly GameMapType[] = [GameMapType.World];

export const DEFAULT_SOLO_MAP: GameMapType = ENABLED_SOLO_MAPS[0];

/** MapInfo entries for the enabled maps, in ENABLED_SOLO_MAPS order. */
export const soloMaps: MapInfo[] = ENABLED_SOLO_MAPS.map((type) => {
  const info = maps.find((m) => m.type === type);
  if (!info) {
    throw new Error(`Enabled solo map ${type} is missing from map registry`);
  }
  return info;
});
