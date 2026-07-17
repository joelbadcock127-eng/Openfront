/**
 * Espionage operations against a rival player:
 *
 *  - "steal": agents siphon a share of the target's treasury.
 *  - "incite": agents foment unrest — a pocket of the target's border
 *    territory defects to neutral (the engine's relinquish primitive).
 *
 * Operations cost gold, share a per-player cooldown, and can fail (the
 * chance is drawn from the deterministic game PRNG, so replays match).
 * Failed operations still cost the fee and reveal the plot to the target.
 */
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import {
  Execution,
  Game,
  Gold,
  MessageType,
  Player,
  PlayerID,
} from "../game/Game";
import { TileRef } from "../game/GameMap";

export type SpyOperation = "steal" | "incite";

export const SPY_COOLDOWN_TICKS = 300;
export const SPY_COSTS: Record<SpyOperation, Gold> = {
  steal: 25_000n,
  incite: 50_000n,
};
const STEAL_SHARE = 0.08;
const STEAL_SUCCESS = 0.7;
const INCITE_SUCCESS = 0.6;
const INCITE_MAX_TILES = 400;

export class SpyExecution implements Execution {
  private mg!: Game;
  private random!: PseudoRandom;
  private active = true;

  constructor(
    private gameID: string,
    private requestor: Player,
    private operation: SpyOperation,
    private targetID: PlayerID,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(
      simpleHash(this.gameID) + simpleHash(this.requestor.id()) + ticks,
    );
  }

  tick(ticks: number): void {
    this.active = false;
    if (!this.mg.hasPlayer(this.targetID)) return;
    const target = this.mg.player(this.targetID);
    if (!this.requestor.isAlive() || !target.isAlive()) return;
    if (target === this.requestor) return;
    if (ticks - this.requestor.lastSpyOpTick() < SPY_COOLDOWN_TICKS) return;
    const cost = SPY_COSTS[this.operation];
    if (this.requestor.gold() < cost) return;

    this.requestor.removeGold(cost);
    this.requestor.recordSpyOp();
    // Espionage sours relations whether or not it succeeds.
    target.updateRelation(this.requestor, -40);

    if (this.operation === "steal") {
      if (this.random.chance(1 / STEAL_SUCCESS)) {
        const stolen =
          (target.gold() * BigInt(Math.round(STEAL_SHARE * 100))) / 100n;
        target.removeGold(stolen);
        this.requestor.addGold(stolen);
        this.mg.displayMessage(
          "events_display.spy_steal_success",
          MessageType.SPY_OPERATION,
          this.requestor.id(),
          stolen,
          { target: target.name() },
        );
        this.mg.displayMessage(
          "events_display.spy_steal_victim",
          MessageType.SPY_OPERATION,
          target.id(),
          undefined,
          { attacker: this.requestor.name() },
        );
      } else {
        this.fail(target);
      }
      return;
    }

    // incite: a pocket of the target's border territory defects to neutral.
    if (this.random.chance(1 / INCITE_SUCCESS)) {
      let freed = 0;
      const toFree: TileRef[] = [];
      for (const tile of target.borderTiles()) {
        toFree.push(tile);
        if (++freed >= INCITE_MAX_TILES) break;
      }
      for (const tile of toFree) {
        target.relinquish(tile);
      }
      this.mg.displayMessage(
        "events_display.spy_incite_success",
        MessageType.SPY_OPERATION,
        this.requestor.id(),
        undefined,
        { target: target.name() },
      );
      this.mg.displayMessage(
        "events_display.spy_incite_victim",
        MessageType.SPY_OPERATION,
        target.id(),
        undefined,
        { attacker: this.requestor.name() },
      );
    } else {
      this.fail(target);
    }
  }

  private fail(target: Player): void {
    this.mg.displayMessage(
      "events_display.spy_failed",
      MessageType.SPY_OPERATION,
      this.requestor.id(),
      undefined,
      { target: target.name() },
    );
    this.mg.displayMessage(
      "events_display.spy_caught",
      MessageType.SPY_OPERATION,
      target.id(),
      undefined,
      { attacker: this.requestor.name() },
    );
  }

  isActive(): boolean {
    return this.active;
  }
}
