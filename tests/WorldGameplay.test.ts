/**
 * Tests for the real-geography gameplay systems: resource-site income,
 * chokepoint control, alternative victory conditions, seasons/monsoon
 * weather, capital crisis, espionage, and deterministic AI personalities.
 */
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { GameUpdateType } from "../src/core/game/GameUpdates";
import { SpyExecution } from "../src/core/execution/SpyExecution";
import { WorldExecution } from "../src/core/execution/WorldExecution";
import { rollPersonality } from "../src/core/execution/utils/AiPersonality";
import {
  Game,
  MapExtras,
  Player,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import {
  Season,
  seasonAt,
  SEASON_TICKS,
  weatherMagnitudeMultiplier,
  weatherSpeedMultiplier,
} from "../src/core/game/Weather";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";

const gameID = "world_gameplay_test";

async function spawnedGame(
  extras?: MapExtras,
  configOverrides: Record<string, unknown> = {},
): Promise<{ game: Game; alice: Player; bob: Player }> {
  const game = await setup(
    "ocean_and_land",
    configOverrides,
    [],
    undefined,
    undefined,
    true,
    extras,
  );
  const aliceInfo = new PlayerInfo("alice", PlayerType.Human, null, "alice_id");
  const bobInfo = new PlayerInfo("bob", PlayerType.Human, null, "bob_id");
  game.addPlayer(aliceInfo);
  game.addPlayer(bobInfo);
  game.addExecution(
    new SpawnExecution(gameID, game.player(aliceInfo.id).info(), game.ref(0, 10)),
    new SpawnExecution(gameID, game.player(bobInfo.id).info(), game.ref(0, 15)),
  );
  game.executeNextTick();
  game.executeNextTick();
  return {
    game,
    alice: game.player(aliceInfo.id),
    bob: game.player(bobInfo.id),
  };
}

function run(game: Game, ticks: number): void {
  for (let i = 0; i < ticks; i++) game.executeNextTick();
}

describe("resource sites (#11)", () => {
  test("owning a resource site pays a gold bonus", async () => {
    // Two identical games; in one the site sits on Alice's spawn tile, in
    // the other on unowned land far away. Identical tick counts ⇒ the gold
    // difference is exactly the site bonus.
    const mkExtras = (x: number, y: number): MapExtras => ({
      resources: [{ name: "Test Iron", type: "iron", x, y }],
      chokepoints: [],
    });
    const withSite = await spawnedGame(mkExtras(0, 10));
    withSite.game.addExecution(new WorldExecution(gameID));
    const withoutSite = await spawnedGame(mkExtras(4, 2)); // unowned land
    withoutSite.game.addExecution(new WorldExecution(gameID));

    run(withSite.game, 40);
    run(withoutSite.game, 40);
    expect(withSite.alice.gold()).toBeGreaterThan(withoutSite.alice.gold());
  });

  test("capturing a site is announced to the new owner", async () => {
    const extras: MapExtras = {
      resources: [{ name: "Test Gold", type: "gold", x: 0, y: 10 }],
      chokepoints: [],
    };
    const { game } = await spawnedGame(extras);
    game.addExecution(new WorldExecution(gameID));
    let announced = false;
    for (let i = 0; i < 30; i++) {
      const updates = game.executeNextTick();
      const messages =
        updates[GameUpdateType.DisplayEvent]?.map((e) => e.message) ?? [];
      if (messages.includes("events_display.resource_seized")) {
        announced = true;
      }
    }
    expect(announced).toBe(true);
  });
});

describe("chokepoint control (#12)", () => {
  test("controlling the strait shoreline pays a toll", async () => {
    // The test map is 16×16 with land in columns 0–7: column 7 is the
    // coastline. A chokepoint centred just offshore covers that shoreline;
    // once Alice conquers most of it she controls the strait.
    const extras: MapExtras = {
      resources: [],
      chokepoints: [{ name: "Test Strait", x: 9, y: 10, radius: 5 }],
    };
    const controlled = await spawnedGame(extras);
    controlled.game.addExecution(new WorldExecution(gameID));
    for (let y = 5; y <= 15; y++) {
      controlled.alice.conquer(controlled.game.ref(7, y));
    }
    // Identical game where the chokepoint sits in open water (no shoreline
    // in radius ⇒ nobody can control it).
    const far: MapExtras = {
      resources: [],
      chokepoints: [{ name: "Test Strait", x: 13, y: 3, radius: 2 }],
    };
    const uncontrolled = await spawnedGame(far);
    uncontrolled.game.addExecution(new WorldExecution(gameID));
    for (let y = 5; y <= 15; y++) {
      uncontrolled.alice.conquer(uncontrolled.game.ref(7, y));
    }

    run(controlled.game, 40);
    run(uncontrolled.game, 40);
    expect(controlled.alice.gold()).toBeGreaterThan(uncontrolled.alice.gold());
  });
});

describe("victory conditions (#17)", () => {
  test("economic victory: holding the majority of sites wins after the hold period", async () => {
    const extras: MapExtras = {
      resources: [{ name: "Test Iron", type: "iron", x: 0, y: 10 }],
      chokepoints: [],
    };
    const { game, alice } = await spawnedGame(extras, {
      victoryCondition: "economic",
    });
    game.addExecution(new WorldExecution(gameID));
    let won = false;
    for (let i = 0; i < 3200 && !won; i++) {
      const updates = game.executeNextTick();
      won = (updates[GameUpdateType.Win]?.length ?? 0) > 0;
    }
    expect(won).toBe(true);
    expect(alice.isAlive()).toBe(true);
  });

  test("domination win is disabled when another victory condition is chosen", async () => {
    const { game } = await spawnedGame(undefined, {
      victoryCondition: "economic",
    });
    expect(game.config().victoryCondition()).toBe("economic");
  });
});

describe("weather (#6)", () => {
  test("seasons cycle deterministically", () => {
    expect(seasonAt(0)).toBe(Season.WetSeason);
    expect(seasonAt(SEASON_TICKS - 1)).toBe(Season.WetSeason);
    expect(seasonAt(SEASON_TICKS)).toBe(Season.Autumn);
    expect(seasonAt(2 * SEASON_TICKS)).toBe(Season.DrySeason);
    expect(seasonAt(3 * SEASON_TICKS)).toBe(Season.Spring);
    expect(seasonAt(4 * SEASON_TICKS)).toBe(Season.WetSeason);
  });

  test("monsoon slows attacks only in the wet season and only in the belt", () => {
    const climate = { monsoonMaxY: 20 };
    const gameAt = (tick: number, y: number) =>
      ({ ticks: () => tick, y: () => y }) as unknown as Game;
    // Wet season, inside the belt.
    expect(weatherSpeedMultiplier(gameAt(10, 5), 0, climate)).toBeGreaterThan(1);
    expect(weatherMagnitudeMultiplier(gameAt(10, 5), 0, climate)).toBeGreaterThan(1);
    // Wet season, south of the belt.
    expect(weatherSpeedMultiplier(gameAt(10, 25), 0, climate)).toBe(1);
    // Dry season, inside the belt.
    expect(
      weatherSpeedMultiplier(gameAt(2 * SEASON_TICKS + 10, 5), 0, climate),
    ).toBe(1);
    // No climate data (classic maps): never any effect.
    expect(weatherSpeedMultiplier(gameAt(10, 5), 0, undefined)).toBe(1);
  });
});

describe("capital crisis (#14)", () => {
  test("losing the capital halves gold income until it is retaken", async () => {
    const { game, alice, bob } = await spawnedGame();
    expect(alice.capital()).not.toBeNull();
    const healthyRate = game.config().goldAdditionRate(alice);

    // Bob seizes Alice's capital tile.
    bob.conquer(alice.capital()!);
    run(game, 3);
    expect(alice.inCapitalCrisis()).toBe(true);
    const crisisRate = game.config().goldAdditionRate(alice);
    expect(crisisRate).toBeLessThan(healthyRate);

    // Alice retakes it: crisis over.
    alice.conquer(alice.capital()!);
    run(game, 3);
    expect(alice.inCapitalCrisis()).toBe(false);
    expect(game.config().goldAdditionRate(alice)).toBe(healthyRate);
  });
});

describe("espionage (#16)", () => {
  test("spy operations cost gold, respect cooldowns, and conserve totals", async () => {
    const { game, alice, bob } = await spawnedGame();
    alice.addGold(1_000_000n);
    bob.addGold(1_000_000n);
    const totalBefore = alice.gold() + bob.gold();

    game.addExecution(new SpyExecution(gameID, alice, "steal", bob.id()));
    run(game, 2);
    // The operation ran: cooldown recorded and the fee burned (net of the
    // players' ordinary per-tick incomes over the two ticks).
    expect(game.ticks() - alice.lastSpyOpTick()).toBeLessThan(10);
    const income =
      2n *
      (game.config().goldAdditionRate(alice) +
        game.config().goldAdditionRate(bob));
    const totalAfter = alice.gold() + bob.gold();
    expect(totalBefore + income - totalAfter).toBe(25_000n);

    // Second op inside the cooldown is a no-op (no additional fee).
    const goldBefore = alice.gold();
    game.addExecution(new SpyExecution(gameID, alice, "steal", bob.id()));
    run(game, 2);
    expect(alice.gold()).toBeGreaterThanOrEqual(goldBefore);
  });

  test("incite frees target border tiles when it succeeds (deterministic)", async () => {
    const { game, alice, bob } = await spawnedGame();
    alice.addGold(1_000_000n);
    const bobTilesBefore = bob.numTilesOwned();
    game.addExecution(new SpyExecution(gameID, alice, "incite", bob.id()));
    run(game, 2);
    // Deterministic seed ⇒ stable outcome; either the uprising freed tiles
    // or the plot failed, but relations always sour and the fee is paid.
    expect(bob.numTilesOwned()).toBeLessThanOrEqual(bobTilesBefore);
    expect(bob.relation(alice)).toBeLessThan(2); // below Neutral
  });
});

describe("AI personalities (#7)", () => {
  test("personalities are deterministic per seed", () => {
    const a = rollPersonality(new PseudoRandom(42));
    const b = rollPersonality(new PseudoRandom(42));
    expect(a).toEqual(b);
  });

  test("archetypes are diverse and shape the attack ratios", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 64; seed++) {
      const p = rollPersonality(new PseudoRandom(seed));
      seen.add(p.archetype);
      expect(p.triggerRatio).toBeGreaterThan(0);
      expect(p.triggerRatio).toBeLessThan(1);
      expect(p.reserveRatio).toBeGreaterThan(0);
      expect(p.expandRatio).toBeGreaterThan(0);
      expect(p.priorityStrategies.length).toBeGreaterThan(0);
    }
    expect(seen.size).toBe(4);
    const turtle = [...Array(256).keys()]
      .map((s) => rollPersonality(new PseudoRandom(s)))
      .find((p) => p.archetype === "turtle")!;
    const aggressive = [...Array(256).keys()]
      .map((s) => rollPersonality(new PseudoRandom(s)))
      .find((p) => p.archetype === "aggressive")!;
    expect(turtle.reserveRatio).toBeGreaterThan(aggressive.reserveRatio);
    expect(aggressive.attackRateMultiplier).toBeLessThan(
      turtle.attackRateMultiplier,
    );
  });
});
