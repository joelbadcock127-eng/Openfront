import { Config } from "../configuration/Config";
import {
  Cell,
  Execution,
  Game,
  MessageType,
  Player,
  PlayerInfo,
  PlayerType,
  Structures,
  UnitType,
} from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import {
  bumpTraversalGeneration,
  tileTraversalScratch,
  TileTraversalScratch,
} from "../game/TileTraversalScratch";
import { calculateBoundingBox, getMode, inscribed, simpleHash } from "../Util";
import { TribeExecution } from "./TribeExecution";

export class PlayerExecution implements Execution {
  private readonly ticksPerClusterCalc = 20;

  private config: Config;
  private lastCalc = 0;
  private mg: Game;
  // Direct GameMap reference to skip the Game delegation hop in hot loops.
  private map: GameMap;
  private active = true;
  // Reusable neighbor buffer to avoid closures/allocation in cluster checks.
  private nbuf: TileRef[] = [0, 0, 0, 0];

  constructor(private player: Player) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    this.mg = mg;
    this.map = mg.map();
    this.config = mg.config();
    this.lastCalc =
      ticks + (simpleHash(this.player.id()) % this.ticksPerClusterCalc);
  }

  tick(ticks: number) {
    this.player.decayRelations();
    for (const u of this.player.units()) {
      if (!Structures.has(u.type())) {
        continue;
      }

      const owner = this.mg!.owner(u.tile());
      if (!owner?.isPlayer()) {
        u.delete();
        continue;
      }
      if (owner === this.player) {
        continue;
      }

      const captor = this.mg!.player(owner.id());
      if (u.type() === UnitType.DefensePost) {
        u.delete(true, captor);
      } else {
        captor.captureUnit(u);
      }
    }

    if (!this.player.isAlive()) {
      this.removeOnDeath();
      this.active = false;
      this.mg.stats().playerKilled(this.player, ticks);
      return;
    }

    const troopInc = this.config.troopIncreaseRate(this.player);
    this.player.addTroops(troopInc);
    const goldFromWorkers = this.config.goldAdditionRate(this.player);
    this.player.addGold(goldFromWorkers);

    // Record stats
    this.mg.stats().goldWork(this.player, goldFromWorkers);

    for (const alliance of this.player.alliances()) {
      if (alliance.expiresAt() <= this.mg.ticks()) {
        alliance.expire();
      }
    }

    this.handleCapital(ticks);
    this.handleUnrest(ticks);

    for (const embargo of this.player.getEmbargoes()) {
      if (
        embargo.isTemporary &&
        this.mg.ticks() - embargo.createdAt >
          this.mg.config().temporaryEmbargoDuration()
      ) {
        this.player.stopEmbargo(embargo.target);
      }
    }

    if (
      ticks - this.lastCalc > this.ticksPerClusterCalc ||
      this.player.numTilesOwned() < 100
    ) {
      if (this.player.lastTileChange() >= this.lastCalc) {
        this.lastCalc = ticks;
        const start = performance.now();
        this.removeClusters();
        const end = performance.now();
        if (end - start > 1000) {
          console.log(`player ${this.player.name()}, took ${end - start}ms`);
        }
      }
    }
  }

  private removeClusters() {
    const clusters = this.calculateClusters();

    if (clusters.length === 0) {
      this.player.largestClusterBoundingBox = null;
      return;
    }

    // Find the largest cluster with a single linear scan (O(n)).
    let largestIndex = 0;
    let largestSize = clusters[0].length;
    for (let i = 1; i < clusters.length; i++) {
      const size = clusters[i].length;
      if (size > largestSize) {
        largestSize = size;
        largestIndex = i;
      }
    }

    const largestCluster = clusters[largestIndex];
    if (largestCluster === undefined) throw new Error("No clusters");

    const largestClusterBox = calculateBoundingBox(this.mg, largestCluster);
    this.player.largestClusterBoundingBox = largestClusterBox;
    const surroundedBy = this.surroundedBySamePlayer(
      largestCluster,
      largestClusterBox,
    );
    if (surroundedBy && !surroundedBy.isFriendly(this.player)) {
      this.removeCluster(largestCluster);
    }

    // Process remaining clusters
    for (let i = 0; i < clusters.length; i++) {
      if (i === largestIndex) continue;
      const cluster = clusters[i];
      if (this.isSurrounded(cluster)) {
        this.removeCluster(cluster);
      }
    }
  }

  private surroundedBySamePlayer(
    cluster: readonly TileRef[],
    clusterBox: { min: Cell; max: Cell },
  ): false | Player {
    const enemies = new Set<number>();

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    const map = this.map;
    const mySmallID = this.player.smallID();
    for (const tile of cluster) {
      if (map.isOceanShore(tile) || map.isOnEdgeOfMap(tile)) {
        return false;
      }
      const numNeighbors = map.neighbors4(tile, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        const n = this.nbuf[i];
        const ownerId = map.ownerID(n);
        if (ownerId === 0) {
          // Unowned neighbor: the cluster is not fully surrounded.
          return false;
        }
        if (ownerId !== mySmallID) {
          enemies.add(ownerId);
          const px = map.x(n);
          const py = map.y(n);
          minX = Math.min(minX, px);
          minY = Math.min(minY, py);
          maxX = Math.max(maxX, px);
          maxY = Math.max(maxY, py);
        }
      }
      if (enemies.size !== 1) {
        return false;
      }
    }
    if (enemies.size !== 1) {
      return false;
    }

    const enemy = this.mg.playerBySmallID(Array.from(enemies)[0]) as Player;
    const localEnemyBox = {
      min: new Cell(minX, minY),
      max: new Cell(maxX, maxY),
    };
    if (inscribed(localEnemyBox, clusterBox)) {
      return enemy;
    }
    return false;
  }

  private isSurrounded(cluster: readonly TileRef[]): boolean {
    let hasEnemy = false;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const map = this.map;
    const mySmallID = this.player.smallID();
    for (const tr of cluster) {
      if (map.isShore(tr) || map.isOnEdgeOfMap(tr)) {
        return false;
      }
      const numNeighbors = map.neighbors4(tr, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        const n = this.nbuf[i];
        const ownerId = map.ownerID(n);
        if (ownerId !== 0 && ownerId !== mySmallID) {
          hasEnemy = true;
          const x = map.x(n);
          const y = map.y(n);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (!hasEnemy) {
      return false;
    }
    const clusterBox = calculateBoundingBox(this.mg, cluster);
    const enemyBox = { min: new Cell(minX, minY), max: new Cell(maxX, maxY) };
    return inscribed(enemyBox, clusterBox);
  }

  private removeCluster(cluster: readonly TileRef[]) {
    for (const t of cluster) {
      if (this.mg?.ownerID(t) !== this.player?.smallID()) {
        // Other removeCluster operations could change tile owners,
        // so double check.
        return;
      }
    }

    const capturing = this.getCapturingPlayer(cluster);
    if (capturing === null) {
      return;
    }

    const firstTile = cluster[0];
    if (firstTile === undefined) {
      return;
    }

    const tiles = this.floodFillWithGen(
      this.bumpGeneration(),
      this.traversalState().visited,
      [firstTile],
      (tile, cb) => this.mg.forEachNeighbor(tile, cb),
      (tile) => this.mg.ownerID(tile) === this.player.smallID(),
    );

    if (this.player.numTilesOwned() === tiles.length) {
      this.mg.conquerPlayer(capturing, this.player);
    }

    for (const tile of tiles) {
      capturing.conquer(tile);
    }
  }

  private getCapturingPlayer(cluster: readonly TileRef[]): Player | null {
    const neighbors = new Map<Player, number>();
    const map = this.map;
    const mySmallID = this.player.smallID();
    for (const t of cluster) {
      const numNeighbors = map.neighbors4(t, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        const ownerId = map.ownerID(this.nbuf[i]);
        if (ownerId === 0 || ownerId === mySmallID) {
          continue;
        }
        const owner = this.mg.playerBySmallID(ownerId) as Player;
        if (!owner.isFriendly(this.player)) {
          neighbors.set(owner, (neighbors.get(owner) ?? 0) + 1);
        }
      }
    }

    // If there are no enemies, return null
    if (neighbors.size === 0) {
      return null;
    }

    // Get the largest attack from the neighbors
    let largestNeighborAttack: Player | null = null;
    let largestTroopCount = 0;
    for (const [neighbor] of neighbors) {
      for (const attack of neighbor.outgoingAttacks()) {
        if (attack.target() === this.player) {
          if (attack.troops() > largestTroopCount) {
            largestTroopCount = attack.troops();
            largestNeighborAttack = neighbor;
          }
        }
      }
    }

    if (largestNeighborAttack !== null) {
      return largestNeighborAttack;
    }

    // There are no ongoing attacks, so find the enemy with the largest border.
    return getMode(neighbors);
  }

  private calculateClusters(): TileRef[][] {
    const borderTiles = this.player.borderTiles();
    if (borderTiles.size === 0) return [];

    const state = this.traversalState();
    const currentGen = this.bumpGeneration();
    const visited = state.visited;

    const clusters: TileRef[][] = [];

    // Set.forEach instead of for..of: iterating a large Set allocates an
    // iterator-result object per element, and border sets can be huge.
    const neighborFn = (tile: TileRef, cb: (neighbor: TileRef) => void) =>
      this.mg.forEachNeighborWithDiag(tile, cb);
    const includeFn = (tile: TileRef) => borderTiles.has(tile);
    borderTiles.forEach((startTile) => {
      if (visited[startTile] === currentGen) return;

      const cluster = this.floodFillWithGen(
        currentGen,
        visited,
        [startTile],
        neighborFn,
        includeFn,
      );
      clusters.push(cluster);
    });
    return clusters;
  }

  owner(): Player {
    if (this.player === null) {
      throw new Error("Not initialized");
    }
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  private traversalState(): TileTraversalScratch {
    return tileTraversalScratch(this.mg);
  }

  private bumpGeneration(): number {
    return bumpTraversalGeneration(this.traversalState());
  }

  private floodFillWithGen(
    currentGen: number,
    visited: Uint32Array,
    startTiles: TileRef[],
    neighborFn: (tile: TileRef, callback: (neighbor: TileRef) => void) => void,
    includeFn: (tile: TileRef) => boolean,
  ): TileRef[] {
    // The visited generation array already deduplicates, so the result can be
    // a plain array (in mark order) — far cheaper than a Set of the same
    // size. The DFS stack is reused across fills via the traversal state.
    const result: TileRef[] = [];
    const stack = this.traversalState().stack;
    stack.length = 0;

    for (const start of startTiles) {
      if (visited[start] === currentGen) continue;
      if (!includeFn(start)) continue;
      visited[start] = currentGen;
      result.push(start);
      stack.push(start);
    }

    const visit = (neighbor: TileRef) => {
      if (visited[neighbor] === currentGen) {
        return;
      }
      if (!includeFn(neighbor)) {
        return;
      }
      visited[neighbor] = currentGen;
      result.push(neighbor);
      stack.push(neighbor);
    };

    while (stack.length > 0) {
      const tile = stack.pop()!;
      neighborFn(tile, visit);
    }

    return result;
  }

  /** Ticks a capital crisis lasts before the capital relocates. */
  private static readonly CAPITAL_CRISIS_TICKS = 600;

  /**
   * Capital crisis: losing the capital tile halves gold income (see
   * Config.goldAdditionRate) until it is retaken, or until the crisis
   * runs its course and the capital relocates to a surviving city (or any
   * owned tile).
   */
  private handleCapital(ticks: number): void {
    const capital = this.player.capital();
    if (capital === null) return;
    const owner = this.mg.owner(capital);
    const holdsCapital = owner.isPlayer() && owner === this.player;
    if (holdsCapital) {
      if (this.player.inCapitalCrisis()) {
        this.player.clearCapitalCrisis();
        this.mg.displayMessage(
          "events_display.capital_recovered",
          MessageType.CAPITAL_RECOVERED,
          this.player.id(),
        );
      }
      return;
    }
    if (!this.player.inCapitalCrisis()) {
      this.player.startCapitalCrisis();
      this.mg.displayMessage(
        "events_display.capital_fallen",
        MessageType.CAPITAL_FALLEN,
        this.player.id(),
      );
      return;
    }
    if (
      ticks - this.player.capitalCrisisStartedAt() >=
      PlayerExecution.CAPITAL_CRISIS_TICKS
    ) {
      if (
        this.player.numTilesOwned() > this.mg.config().capitalShatterMinTiles()
      ) {
        this.shatterEmpire();
        return;
      }
      // Small realms relocate: prefer a standing city, else any owned tile.
      const city = this.player.units().find((u) => u.type() === UnitType.City);
      let newCapital: TileRef | null = city?.tile() ?? null;
      if (newCapital === null) {
        for (const t of this.player.tiles()) {
          newCapital = t;
          break;
        }
      }
      this.player.setCapital(newCapital);
      this.player.clearCapitalCrisis();
      if (newCapital !== null) {
        this.mg.displayMessage(
          "events_display.capital_relocated",
          MessageType.CAPITAL_RELOCATED,
          this.player.id(),
        );
      }
    }
  }

  /**
   * The dramatic fall of a great power: when a large empire loses its
   * capital and fails to retake it, the state collapses. A rump state
   * survives around a surviving city (or the densest remaining region);
   * everything else breaks away into independent AI successor tribes.
   */
  private shatterEmpire(): void {
    const player = this.player;
    // The rump survives around a remaining city, else the first owned tile.
    const city = player.units().find((u) => u.type() === UnitType.City);
    let center: TileRef | null = city?.tile() ?? null;
    if (center === null) {
      for (const t of player.tiles()) {
        center = t;
        break;
      }
    }
    if (center === null) return;
    const cx = this.mg.x(center);
    const cy = this.mg.y(center);
    const n = player.numTilesOwned();
    // Rump keeps ~20% of the empire: a square of side 2R has area ≈ 0.2n.
    const keepRadius = Math.max(8, Math.ceil(Math.sqrt(0.2 * n) / 2));

    // Successor states: 2–3 breakaway AI tribes split the rest by bearing
    // from the rump (deterministic float math; same-everywhere in V8).
    const numShards = n > 20_000 ? 3 : 2;
    const shards: Player[] = [];
    for (let i = 0; i < numShards; i++) {
      const info = new PlayerInfo(
        `${player.name()} Successors ${i + 1}`,
        PlayerType.Bot,
        null,
        `${player.id()}_successor_${i}`,
      );
      const shard = this.mg.addPlayer(info);
      shards.push(shard);
      this.mg.addExecution(new PlayerExecution(shard));
      this.mg.addExecution(new TribeExecution(shard));
    }

    const toTransfer: TileRef[] = [];
    for (const t of player.tiles()) {
      const dx = this.mg.x(t) - cx;
      const dy = this.mg.y(t) - cy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > keepRadius) {
        toTransfer.push(t);
      }
    }
    for (const t of toTransfer) {
      const angle = Math.atan2(this.mg.y(t) - cy, this.mg.x(t) - cx);
      const idx = Math.min(
        numShards - 1,
        Math.floor(((angle + Math.PI) / (2 * Math.PI)) * numShards),
      );
      shards[idx].conquer(t);
    }

    player.setCapital(center);
    player.clearCapitalCrisis();
    player.addUnrest(-120);
    this.mg.displayMessage(
      "events_display.empire_shattered",
      MessageType.EMPIRE_SHATTERED,
      player.id(),
    );
  }

  /**
   * Overextension: conquering much faster than the empire can absorb
   * raises unrest. High unrest triggers rebellions — border regions break
   * free to the wilderness. Counterplay: slow down, keep troop reserves
   * high (garrison), or invest gold to stabilise (StabilizeExecution).
   */
  private static readonly UNREST_WARN = 50;
  private static readonly UNREST_REBEL = 100;
  private lastUnrestTiles = -1;
  private lastUnrestTick = -1;
  private warnedUnrest = false;

  private handleUnrest(ticks: number): void {
    if (this.player.type() === PlayerType.Bot) return;
    const every = this.mg.config().unrestCheckTicks();
    if (this.lastUnrestTick < 0) {
      this.lastUnrestTick = ticks;
      this.lastUnrestTiles = this.player.numTilesOwned();
      return;
    }
    if (ticks - this.lastUnrestTick < every) return;
    this.lastUnrestTick = ticks;
    const tiles = this.player.numTilesOwned();
    const prev = this.lastUnrestTiles;
    this.lastUnrestTiles = tiles;
    const growth = (tiles - prev) / Math.max(500, prev);
    let gain: number;
    if (growth > 0.06) {
      gain = Math.min(45, growth * 400);
      // Garrison: large troop reserves keep new territories in line.
      const reserves =
        this.mg.config().maxTroops(this.player) > 0
          ? this.player.troops() / this.mg.config().maxTroops(this.player)
          : 0;
      if (reserves > 0.5) gain *= 0.5;
    } else {
      gain = -12;
    }
    this.player.addUnrest(gain);

    const unrest = this.player.unrest();
    if (unrest >= PlayerExecution.UNREST_REBEL) {
      this.rebellion();
      this.player.addUnrest(-60);
      this.warnedUnrest = false;
    } else if (unrest >= PlayerExecution.UNREST_WARN && !this.warnedUnrest) {
      this.warnedUnrest = true;
      this.mg.displayMessage(
        "events_display.unrest_rising",
        MessageType.UNREST,
        this.player.id(),
        undefined,
        { unrest: Math.round(unrest) },
      );
    } else if (unrest < PlayerExecution.UNREST_WARN) {
      this.warnedUnrest = false;
    }
  }

  /** A border region breaks free to the wilderness. */
  private rebellion(): void {
    const player = this.player;
    let seed: TileRef | null = null;
    // Rebel farthest from the capital — the least-integrated frontier.
    const capital = player.capital();
    let bestDist = -1;
    let i = 0;
    for (const t of player.borderTiles()) {
      if (capital !== null) {
        const d =
          Math.abs(this.mg.x(t) - this.mg.x(capital)) +
          Math.abs(this.mg.y(t) - this.mg.y(capital));
        if (d > bestDist) {
          bestDist = d;
          seed = t;
        }
      } else {
        seed = t;
        break;
      }
      if (++i >= 512) break; // bounded scan, deterministic order
    }
    if (seed === null) return;
    const limit = Math.max(
      50,
      Math.min(1500, Math.floor(player.numTilesOwned() * 0.04)),
    );
    const pocket: TileRef[] = [];
    const seen = new Set<TileRef>();
    let frontier: TileRef[] = [seed];
    seen.add(seed);
    while (frontier.length > 0 && pocket.length < limit) {
      const next: TileRef[] = [];
      for (const t of frontier) {
        if (pocket.length >= limit) break;
        pocket.push(t);
        for (const nb of this.mg.neighbors(t)) {
          if (seen.has(nb)) continue;
          seen.add(nb);
          const o = this.mg.owner(nb);
          if (o.isPlayer() && o === player) next.push(nb);
        }
      }
      frontier = next;
    }
    for (const t of pocket) {
      player.relinquish(t);
    }
    this.mg.displayMessage(
      "events_display.rebellion",
      MessageType.UNREST,
      player.id(),
      undefined,
      { tiles: pocket.length },
    );
  }

  private removeOnDeath(): void {
    // Player (bot, human, nation) has no tiles
    // Delete any remaining gold, non-nuke units and alliances
    const gold = this.player.gold();
    this.player.removeGold(gold);

    this.player.units().forEach((u) => {
      if (
        u.type() !== UnitType.AtomBomb &&
        u.type() !== UnitType.HydrogenBomb &&
        u.type() !== UnitType.MIRVWarhead &&
        u.type() !== UnitType.MIRV
      ) {
        u.delete();
      }
    });

    this.player.removeAllAlliances();
  }
}
