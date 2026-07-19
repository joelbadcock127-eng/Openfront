/**
 * Real-geography gameplay on world-pipeline maps, in one deterministic
 * execution:
 *
 *  - RESOURCES: owning the tile of a real deposit (Pilbara iron,
 *    Kalgoorlie gold, …) pays a per-tick gold bonus; captures are
 *    announced.
 *  - CHOKEPOINTS: controlling the majority of the shoreline around a real
 *    strait (Bass, Cook, Torres, …) pays a naval toll; control changes are
 *    announced.
 *  - VICTORY CONDITIONS: when the game is configured for an "economic" or
 *    "straits" victory, holding the majority of resource sites (or every
 *    chokepoint) for a sustained period wins the match.
 *  - SEASONS: announces season changes (the monsoon slowdown itself is a
 *    pure function — see game/Weather.ts).
 *  - WORLD EVENTS: seeded, deterministic events — gold rushes at a real
 *    site, trade booms, plagues — announced and applied for a duration.
 *
 * Determinism: all randomness uses PseudoRandom seeded from the game ID;
 * everything else is a function of tick and game state.
 */
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import {
  Chokepoint,
  Execution,
  Game,
  Gold,
  MessageType,
  Player,
  PlayerID,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { seasonAt, seasonKey } from "../game/Weather";

/** How often (in ticks) sites/chokepoints are re-evaluated and paid. */
const CHECK_EVERY = 10;
/** Checks a victory condition must hold consecutively to win (~5 min). */
const VICTORY_HOLD_CHECKS = 300;
/** Gold per tick for an owned resource site (level 1), by type. Sites are
 * meant to be worth fighting over: a site rivals the base worker income. */
const RESOURCE_GOLD: Record<string, bigint> = {
  gold: 160n,
  oil: 140n,
  gas: 140n,
  iron: 100n,
  coal: 100n,
  copper: 100n,
  bauxite: 80n,
  silver: 80n,
};
const RESOURCE_GOLD_DEFAULT = 80n;
/** One-time windfall for seizing a site. */
const CAPTURE_BONUS: Gold = 75_000n;
/** Gold per tick for a controlled chokepoint. */
const CHOKEPOINT_GOLD = 50n;
/** Shore ownership share required to control a chokepoint. */
const CONTROL_SHARE = 0.6;

/** World events (deterministic schedule). */
const EVENT_MIN_GAP = 2400;
const EVENT_MAX_GAP = 4200;
const EVENT_DURATION = 600;
const GOLD_RUSH_MULTIPLIER = 4n;
const TRADE_BOOM_GOLD = 60n;
const PLAGUE_TROOP_LOSS_RATE = 0.002;

type WorldEvent =
  | { kind: "gold_rush"; site: number; until: number }
  | { kind: "trade_boom"; until: number }
  | { kind: "plague"; until: number };

export class WorldExecution implements Execution {
  private mg!: Game;
  private random!: PseudoRandom;
  private active = true;

  private resourceTiles: TileRef[] = [];
  private resourceOwners: (PlayerID | null)[] = [];
  private chokepointShores: TileRef[][] = [];
  private chokepointControllers: (PlayerID | null)[] = [];

  private victoryHold = 0;
  private victoryHolder: PlayerID | null = null;

  private lastSeason = -1;
  private event: WorldEvent | null = null;
  private nextEventAt = 0;

  constructor(private gameID: string) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(simpleHash(this.gameID) + 1337);
    this.nextEventAt =
      ticks + this.random.nextInt(EVENT_MIN_GAP, EVENT_MAX_GAP);
    const extras = mg.mapExtras();
    // Site development levels (1–3) live on mapExtras so the
    // DevelopSiteExecution can raise them.
    extras.siteLevels = extras.resources.map(() => 1);
    for (const site of extras.resources) {
      if (!mg.isValidCoord(site.x, site.y)) continue;
      this.resourceTiles.push(mg.ref(site.x, site.y));
      this.resourceOwners.push(null);
    }
    for (const cp of extras.chokepoints) {
      this.chokepointShores.push(this.shoreTilesAround(cp));
      this.chokepointControllers.push(null);
    }
    this.lastSeason = seasonAt(ticks);
  }

  /** Shoreline land tiles within the chokepoint's control radius. */
  private shoreTilesAround(cp: Chokepoint): TileRef[] {
    const tiles: TileRef[] = [];
    const r = cp.radius;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const x = cp.x + dx;
        const y = cp.y + dy;
        if (!this.mg.isValidCoord(x, y)) continue;
        const ref = this.mg.ref(x, y);
        if (this.mg.isLand(ref) && this.mg.isShore(ref)) {
          tiles.push(ref);
        }
      }
    }
    return tiles;
  }

  tick(ticks: number): void {
    if (this.mg.inSpawnPhase()) return;

    // Season announcements (weather effect itself is pure — Weather.ts).
    if (this.mg.config().weatherEnabled()) {
      const season = seasonAt(ticks);
      if (season !== this.lastSeason) {
        this.lastSeason = season;
        this.mg.displayMessage(
          seasonKey(season),
          MessageType.SEASON_CHANGE,
          null,
        );
      }
    }

    // World events.
    this.tickEvents(ticks);

    if (ticks % CHECK_EVERY !== 0) return;
    this.payResources(ticks);
    this.payChokepoints();
    this.checkVictory();
  }

  private tickEvents(ticks: number): void {
    const extras = this.mg.mapExtras();
    if (this.event !== null && ticks >= this.event.until) {
      this.event = null;
      this.nextEventAt =
        ticks + this.random.nextInt(EVENT_MIN_GAP, EVENT_MAX_GAP);
    }
    if (this.event === null && ticks >= this.nextEventAt) {
      const kinds: Array<WorldEvent["kind"]> = ["trade_boom", "plague"];
      if (extras.resources.length > 0) kinds.push("gold_rush");
      const kind = kinds[this.random.nextInt(0, kinds.length)];
      const until = ticks + EVENT_DURATION;
      if (kind === "gold_rush") {
        const site = this.random.nextInt(0, extras.resources.length);
        this.event = { kind, site, until };
        this.mg.displayMessage(
          "events_display.gold_rush",
          MessageType.WORLD_EVENT,
          null,
          undefined,
          { site: extras.resources[site].name },
        );
      } else if (kind === "trade_boom") {
        this.event = { kind, until };
        this.mg.displayMessage(
          "events_display.trade_boom",
          MessageType.WORLD_EVENT,
          null,
        );
      } else {
        this.event = { kind: "plague", until };
        this.mg.displayMessage(
          "events_display.plague",
          MessageType.WORLD_EVENT,
          null,
        );
      }
    }
    if (this.event?.kind === "trade_boom") {
      for (const p of this.mg.players()) {
        if (p.isAlive()) p.addGold(TRADE_BOOM_GOLD);
      }
    } else if (this.event?.kind === "plague") {
      for (const p of this.mg.players()) {
        if (p.isAlive()) {
          p.removeTroops(p.troops() * PLAGUE_TROOP_LOSS_RATE);
        }
      }
    }
  }

  private payResources(ticks: number): void {
    const extras = this.mg.mapExtras();
    for (let i = 0; i < this.resourceTiles.length; i++) {
      const owner = this.mg.owner(this.resourceTiles[i]);
      const player = owner.isPlayer() ? (owner as Player) : null;
      const prev = this.resourceOwners[i];
      const id = player?.id() ?? null;
      if (id !== prev) {
        this.resourceOwners[i] = id;
        if (player !== null) {
          // Seizing a site pays an immediate windfall on top of the
          // ongoing income — capturing a gold mine should feel like one.
          player.addGold(CAPTURE_BONUS);
          this.mg.displayMessage(
            "events_display.resource_seized",
            MessageType.RESOURCE_SEIZED,
            player.id(),
            CAPTURE_BONUS,
            { site: extras.resources[i].name },
          );
        }
      }
      if (player !== null && player.isAlive()) {
        const level = BigInt(extras.siteLevels?.[i] ?? 1);
        let gold: Gold =
          (RESOURCE_GOLD[extras.resources[i].type] ?? RESOURCE_GOLD_DEFAULT) *
          BigInt(CHECK_EVERY) *
          level;
        if (this.event?.kind === "gold_rush" && this.event.site === i) {
          gold *= GOLD_RUSH_MULTIPLIER;
        }
        player.addGold(gold);
      }
    }
  }

  private payChokepoints(): void {
    const extras = this.mg.mapExtras();
    for (let i = 0; i < this.chokepointShores.length; i++) {
      const shores = this.chokepointShores[i];
      if (shores.length === 0) continue;
      const counts = new Map<PlayerID, number>();
      for (const t of shores) {
        const o = this.mg.owner(t);
        if (o.isPlayer()) {
          const id = (o as Player).id();
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
      let controller: PlayerID | null = null;
      for (const [id, n] of counts) {
        if (n / shores.length >= CONTROL_SHARE) {
          controller = id;
          break;
        }
      }
      if (controller !== this.chokepointControllers[i]) {
        this.chokepointControllers[i] = controller;
        if (controller !== null) {
          this.mg.displayMessage(
            "events_display.chokepoint_controlled",
            MessageType.CHOKEPOINT_CONTROLLED,
            controller,
            undefined,
            { strait: extras.chokepoints[i].name },
          );
        }
      }
      if (controller !== null) {
        const p = this.mg.player(controller);
        if (p.isAlive()) p.addGold(CHOKEPOINT_GOLD * BigInt(CHECK_EVERY));
      }
    }
  }

  /** Economic / strait-supremacy victories (WinCheckExecution keeps
   * domination and the time limit). */
  private checkVictory(): void {
    const condition = this.mg.config().victoryCondition();
    if (condition === "domination") return;
    let holder: PlayerID | null = null;
    if (condition === "economic") {
      if (this.resourceOwners.length > 0) {
        const counts = new Map<PlayerID, number>();
        for (const id of this.resourceOwners) {
          if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        for (const [id, n] of counts) {
          if (n / this.resourceOwners.length > 0.5) holder = id;
        }
      }
    } else if (condition === "straits") {
      if (
        this.chokepointControllers.length > 0 &&
        this.chokepointControllers.every(
          (c) => c !== null && c === this.chokepointControllers[0],
        )
      ) {
        holder = this.chokepointControllers[0];
      }
    }
    if (holder === null || holder !== this.victoryHolder) {
      this.victoryHolder = holder;
      this.victoryHold = 0;
      return;
    }
    this.victoryHold++;
    if (this.victoryHold >= VICTORY_HOLD_CHECKS) {
      const winner = this.mg.player(holder);
      this.mg.setWinner(winner, this.mg.stats().stats());
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }
}
