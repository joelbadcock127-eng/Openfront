/**
 * Invest in restive territories: pay gold (scaled to empire size) to
 * reduce unrest — the economic counterplay to overextension (see the
 * unrest handling in PlayerExecution).
 */
import { Execution, Game, Gold, MessageType, Player } from "../game/Game";

export const STABILIZE_UNREST_RELIEF = 60;

export function stabilizeCost(player: Player): Gold {
  const scaled = BigInt(player.numTilesOwned()) * 40n;
  return scaled > 50_000n ? scaled : 50_000n;
}

export class StabilizeExecution implements Execution {
  private mg!: Game;
  private active = true;

  constructor(private requestor: Player) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(): void {
    this.active = false;
    if (!this.requestor.isAlive()) return;
    if (this.requestor.unrest() <= 0) return;
    const cost = stabilizeCost(this.requestor);
    if (this.requestor.gold() < cost) return;
    this.requestor.removeGold(cost);
    this.requestor.addUnrest(-STABILIZE_UNREST_RELIEF);
    this.mg.displayMessage(
      "events_display.stabilized",
      MessageType.UNREST,
      this.requestor.id(),
      cost,
    );
  }

  isActive(): boolean {
    return this.active;
  }
}
