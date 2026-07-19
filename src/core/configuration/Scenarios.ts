/**
 * Scenario start presets: named one-click setups for the solo modal.
 *
 * A scenario is just a bundle of existing config (map, difficulty, bots,
 * victory condition, weather) — picking one fills the setup form, then the
 * match starts through the normal flow, so replays/records stay ordinary
 * GameConfigs. Names/descriptions live in en.json under `scenario.*`.
 */
import { Difficulty, GameMapType } from "../game/Game";

export interface Scenario {
  id: string;
  map: GameMapType;
  difficulty: Difficulty;
  bots: number;
  victoryCondition: "domination" | "economic" | "straits";
  weatherEnabled: boolean;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    // The flagship: all of Oceania, classic conquest.
    id: "battle_for_oceania",
    map: GameMapType.WorldOceania,
    difficulty: Difficulty.Medium,
    bots: 600,
    victoryCondition: "domination",
    weatherEnabled: true,
  },
  {
    // Race for the mines: economy wins, not conquest.
    id: "outback_rush",
    map: GameMapType.WorldOceania,
    difficulty: Difficulty.Hard,
    bots: 300,
    victoryCondition: "economic",
    weatherEnabled: true,
  },
  {
    // Navy-first: control every strait in the theatre.
    id: "master_of_straits",
    map: GameMapType.WorldOceania,
    difficulty: Difficulty.Hard,
    bots: 300,
    victoryCondition: "straits",
    weatherEnabled: true,
  },
  {
    // The new theatre: all of Southeast Asia — monsoon warfare from the
    // Irrawaddy to Luzon, with Malacca as the prize.
    id: "dragons_of_the_mekong",
    map: GameMapType.WorldSoutheastAsia,
    difficulty: Difficulty.Medium,
    bots: 500,
    victoryCondition: "domination",
    weatherEnabled: true,
  },
  {
    // The drilled-down intro theatre at ~0.61 km/tile.
    id: "tasmanian_campaign",
    map: GameMapType.BassStrait,
    difficulty: Difficulty.Easy,
    bots: 200,
    victoryCondition: "domination",
    weatherEnabled: true,
  },
  {
    // Aotearoa, whole-country war.
    id: "long_white_cloud",
    map: GameMapType.NewZealand,
    difficulty: Difficulty.Hard,
    bots: 250,
    victoryCondition: "domination",
    weatherEnabled: true,
  },
  {
    // Monsoon warfare in the tropics: weather decides campaigns.
    id: "coral_sea_theatre",
    map: GameMapType.TorresStrait,
    difficulty: Difficulty.Hard,
    bots: 300,
    victoryCondition: "domination",
    weatherEnabled: true,
  },
  {
    // The gauntlet: the eastern seaboard against impossible odds.
    id: "impossible_australia",
    map: GameMapType.EastAustralia,
    difficulty: Difficulty.Impossible,
    bots: 400,
    victoryCondition: "domination",
    weatherEnabled: true,
  },
];
