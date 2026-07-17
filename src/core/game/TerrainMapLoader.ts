import {
  Chokepoint,
  GameMapSize,
  GameMapType,
  MapClimate,
  ResourceSite,
  TeamGameSpawnAreas,
} from "./Game";
import { GameMap, GameMapImpl } from "./GameMap";
import { GameMapLoader } from "./GameMapLoader";

export type TerrainMapData = {
  nations: Nation[];
  additionalNations: AdditionalNation[];
  gameMap: GameMap;
  miniGameMap: GameMap;
  teamGameSpawnAreas?: TeamGameSpawnAreas;
  /** Real-geography gameplay data (world-pipeline maps only). Coordinates
   * are already scaled to the loaded map size. */
  resources: ResourceSite[];
  chokepoints: Chokepoint[];
  climate?: MapClimate;
};

const loadedMaps = new Map<string, TerrainMapData>();

export interface MapMetadata {
  width: number;
  height: number;
  num_land_tiles: number;
}

export interface MapManifest {
  name: string;
  map: MapMetadata;
  map4x: MapMetadata;
  map16x: MapMetadata;
  nations: Nation[];
  // Optional pool of fallback nation names used when a game requests more
  // nations than the manifest defines. Picked at random; if still not enough,
  // the remainder is generated procedurally.
  additionalNations?: AdditionalNation[];
  teamGameSpawnAreas?: TeamGameSpawnAreas;
  // World-pipeline maps (scripts/world/build-world.ts) additionally carry
  // real-geography gameplay data. All optional — classic maps omit them.
  /** Real resource deposits; owning the site tile grants an economy bonus. */
  resources?: ResourceSite[];
  /** Strait chokepoints; holding the surrounding shores yields a naval toll. */
  chokepoints?: Chokepoint[];
  /** Climate bands in map rows (monsoon belt north of monsoonMaxY). */
  climate?: MapClimate;
}

export type { Chokepoint, MapClimate, ResourceSite };

export interface Nation {
  coordinates?: [number, number];
  flag?: string;
  name: string;
}

export interface AdditionalNation {
  coordinates?: [number, number];
  flag?: string;
  name: string;
}

export async function loadTerrainMap(
  map: GameMapType,
  mapSize: GameMapSize,
  terrainMapFileLoader: GameMapLoader,
): Promise<TerrainMapData> {
  const cacheKey = `${map}:${mapSize}`;
  const cached = loadedMaps.get(cacheKey);
  if (cached !== undefined) return cached;
  const mapFiles = terrainMapFileLoader.getMapData(map);
  const manifest = await mapFiles.manifest();

  const gameMap =
    mapSize === GameMapSize.Normal
      ? await genTerrainFromBin(manifest.map, await mapFiles.mapBin())
      : await genTerrainFromBin(manifest.map4x, await mapFiles.map4xBin());

  const miniMap =
    mapSize === GameMapSize.Normal
      ? await genTerrainFromBin(
          mapSize === GameMapSize.Normal ? manifest.map4x : manifest.map16x,
          await mapFiles.map4xBin(),
        )
      : await genTerrainFromBin(manifest.map16x, await mapFiles.map16xBin());

  if (mapSize === GameMapSize.Compact) {
    manifest.nations.forEach((nation) => {
      if (nation.coordinates !== undefined) {
        nation.coordinates = [
          Math.floor(nation.coordinates[0] / 2),
          Math.floor(nation.coordinates[1] / 2),
        ];
      }
    });
    manifest.additionalNations?.forEach((nation) => {
      if (nation.coordinates !== undefined) {
        nation.coordinates = [
          Math.floor(nation.coordinates[0] / 2),
          Math.floor(nation.coordinates[1] / 2),
        ];
      }
    });
  }

  // Scale spawn areas for compact maps
  let teamGameSpawnAreas = manifest.teamGameSpawnAreas;
  if (mapSize === GameMapSize.Compact && teamGameSpawnAreas) {
    const scaled: TeamGameSpawnAreas = {};
    for (const [key, areas] of Object.entries(teamGameSpawnAreas)) {
      scaled[key] = areas.map((a) => ({
        x: Math.floor(a.x / 2),
        y: Math.floor(a.y / 2),
        width: Math.max(1, Math.floor(a.width / 2)),
        height: Math.max(1, Math.floor(a.height / 2)),
      }));
    }
    teamGameSpawnAreas = scaled;
  }

  // Real-geography extras (world-pipeline maps); scale to compact size.
  const half = mapSize === GameMapSize.Compact;
  const resources = (manifest.resources ?? []).map((r) => ({
    ...r,
    x: half ? Math.floor(r.x / 2) : r.x,
    y: half ? Math.floor(r.y / 2) : r.y,
  }));
  const chokepoints = (manifest.chokepoints ?? []).map((c) => ({
    ...c,
    x: half ? Math.floor(c.x / 2) : c.x,
    y: half ? Math.floor(c.y / 2) : c.y,
    radius: half ? Math.max(2, Math.floor(c.radius / 2)) : c.radius,
  }));
  const climate = manifest.climate
    ? {
        monsoonMaxY: half
          ? Math.floor(manifest.climate.monsoonMaxY / 2)
          : manifest.climate.monsoonMaxY,
      }
    : undefined;

  const result = {
    nations: manifest.nations,
    additionalNations: manifest.additionalNations ?? [],
    gameMap: gameMap,
    miniGameMap: miniMap,
    teamGameSpawnAreas,
    resources,
    chokepoints,
    climate,
  };
  loadedMaps.set(cacheKey, result);
  return result;
}

export async function genTerrainFromBin(
  mapData: MapMetadata,
  data: Uint8Array,
): Promise<GameMap> {
  if (data.length !== mapData.width * mapData.height) {
    throw new Error(
      `Invalid data: buffer size ${data.length} incorrect for ${mapData.width}x${mapData.height} terrain plus 4 bytes for dimensions.`,
    );
  }

  return new GameMapImpl(
    mapData.width,
    mapData.height,
    data,
    mapData.num_land_tiles,
  );
}
