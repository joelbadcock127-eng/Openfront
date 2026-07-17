/**
 * Deterministic seasons and monsoon weather.
 *
 * Everything here is a pure function of the game tick (and static map
 * climate data), so the simulation stays fully deterministic and
 * replayable: no state, no randomness.
 *
 * The year is four seasons; during the wet season, attacks inside the
 * map's monsoon belt (rows north of `climate.monsoonMaxY` on
 * world-pipeline maps) are slower and costlier — campaigning through a
 * tropical wet season is hard.
 */
import { Game, MapClimate } from "./Game";
import { TileRef } from "./GameMap";

/** Ticks per season (~3 minutes at 10 ticks/s). */
export const SEASON_TICKS = 1800;

export enum Season {
  WetSeason = 0,
  Autumn = 1,
  DrySeason = 2,
  Spring = 3,
}

export function seasonAt(tick: number): Season {
  return (Math.floor(tick / SEASON_TICKS) % 4) as Season;
}

/** Translation key for a season (resources/lang/en.json `weather.*`). */
export function seasonKey(season: Season): string {
  switch (season) {
    case Season.WetSeason:
      return "weather.wet_season";
    case Season.Autumn:
      return "weather.autumn";
    case Season.DrySeason:
      return "weather.dry_season";
    case Season.Spring:
      return "weather.spring";
  }
}

/** Attack `speed` multiplier (tile cost) for weather; 1 = no effect. */
export function weatherSpeedMultiplier(
  game: Game,
  tile: TileRef,
  climate: MapClimate | undefined,
): number {
  if (climate === undefined) return 1;
  if (seasonAt(game.ticks()) !== Season.WetSeason) return 1;
  if (game.y(tile) >= climate.monsoonMaxY) return 1;
  return 1.35;
}

/** Attack troop-loss multiplier for weather; 1 = no effect. */
export function weatherMagnitudeMultiplier(
  game: Game,
  tile: TileRef,
  climate: MapClimate | undefined,
): number {
  if (climate === undefined) return 1;
  if (seasonAt(game.ticks()) !== Season.WetSeason) return 1;
  if (game.y(tile) >= climate.monsoonMaxY) return 1;
  return 1.15;
}
