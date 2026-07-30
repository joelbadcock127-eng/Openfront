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
export const ENABLED_SOLO_MAPS: readonly GameMapType[] = [
  // The continuous-world experience: ALL of Oceania — the whole Australian
  // continent, New Zealand, New Guinea and the Pacific island arcs — as one
  // playable map, one match, one territorial state, with the rest of the
  // streamed Earth visible around it.
  GameMapType.WorldOceania,
  // ONE map for the whole of Southeast Asia: Burma, Thailand, Indochina,
  // Malaya, Sumatra/Borneo and the entire Philippines.
  GameMapType.WorldSoutheastAsia,
  // The two theatres above JOINED into one map (~2.4 km/tile so the huge
  // extent stays lag-free): Indochina through the archipelago to Australia,
  // New Zealand and Fiji — one match, one territorial state.
  GameMapType.WorldIndoPacific,
  // Regional theatres cut from the same world grid (Bass Strait at maximum
  // ~0.61 km detail), plus the classic upstream World map.
  GameMapType.BassStrait,
  GameMapType.EastAustralia,
  GameMapType.NewZealand,
  GameMapType.TorresStrait,
  GameMapType.World,
];

export const DEFAULT_SOLO_MAP: GameMapType = ENABLED_SOLO_MAPS[0];

/** MapInfo entries for the enabled maps, in ENABLED_SOLO_MAPS order. */
export const soloMaps: MapInfo[] = ENABLED_SOLO_MAPS.map((type) => {
  const info = maps.find((m) => m.type === type);
  if (!info) {
    throw new Error(`Enabled solo map ${type} is missing from map registry`);
  }
  return info;
});
