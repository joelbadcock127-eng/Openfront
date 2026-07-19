/**
 * Develop a resource site you own: pay gold to raise its level (1–3),
 * multiplying its output (see WorldExecution). The intent carries the
 * clicked tile; the nearest owned site within range is developed.
 */
import { Execution, Game, Gold, MessageType, Player } from "../game/Game";
import { TileRef } from "../game/GameMap";

export const DEVELOP_RANGE = 40;
export const MAX_SITE_LEVEL = 3;

export function developCost(level: number): Gold {
  return 250_000n * BigInt(level);
}

export class DevelopSiteExecution implements Execution {
  private mg!: Game;
  private active = true;

  constructor(
    private requestor: Player,
    private tile: TileRef,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(): void {
    this.active = false;
    if (!this.requestor.isAlive()) return;
    const extras = this.mg.mapExtras();
    const levels = extras.siteLevels;
    if (levels === undefined || extras.resources.length === 0) return;
    const tx = this.mg.x(this.tile);
    const ty = this.mg.y(this.tile);
    let best = -1;
    let bestDist = DEVELOP_RANGE + 1;
    for (let i = 0; i < extras.resources.length; i++) {
      const site = extras.resources[i];
      const d = Math.max(Math.abs(site.x - tx), Math.abs(site.y - ty));
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best < 0) return;
    const site = extras.resources[best];
    if (!this.mg.isValidCoord(site.x, site.y)) return;
    const owner = this.mg.owner(this.mg.ref(site.x, site.y));
    if (!owner.isPlayer() || owner !== this.requestor) return;
    const level = levels[best] ?? 1;
    if (level >= MAX_SITE_LEVEL) return;
    const cost = developCost(level);
    if (this.requestor.gold() < cost) return;
    this.requestor.removeGold(cost);
    levels[best] = level + 1;
    this.mg.displayMessage(
      "events_display.site_developed",
      MessageType.SITE_DEVELOPED,
      this.requestor.id(),
      undefined,
      { site: site.name, level: level + 1 },
    );
  }

  isActive(): boolean {
    return this.active;
  }
}
