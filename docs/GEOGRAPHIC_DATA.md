# Geographic data sources

All datasets used by the world map pipeline, their licences, and the
processing applied. Raw downloads live in `map-generator/world-data/`
(git-ignored); fetch them with `bash scripts/world/fetch-data.sh` and build
with `npm run gen-world`.

## Source datasets

| Dataset                          | Provider                                                                                               | Version                     | Licence           | Downloaded | Used for                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------- | ----------------- | ---------- | -------------------------------------------------------------------------- |
| `ne_10m_land`                    | Natural Earth (naturalearthdata.com), GeoJSON mirror: github.com/nvkelso/natural-earth-vector (master) | 5.x (10m, master @ 2026-07) | **Public domain** | 2026-07-11 | Land polygons incl. major islands                                          |
| `ne_10m_minor_islands`           | Natural Earth (same mirror)                                                                            | 5.x                         | Public domain     | 2026-07-11 | Small islands complementing the land layer                                 |
| `ne_10m_lakes`                   | Natural Earth (same mirror)                                                                            | 5.x                         | Public domain     | 2026-07-11 | Lakes (rasterised back to water; Caspian, Great Lakes, Baikal…)            |
| `ne_10m_populated_places_simple` | Natural Earth (same mirror)                                                                            | 5.x                         | Public domain     | 2026-07-11 | City points → nation names/positions/flags (ISO code) for playable windows |
| `ne_10m_rivers_lake_centerlines` | Natural Earth (same mirror)                                                                            | 5.x                         | Public domain     | 2026-07-17 | Major rivers painted as thin water with fords (gameplay)                   |
| `etopo1_ice_g_i2`                | NOAA NCEI ETOPO1 (ngdc.noaa.gov), 1 arc-minute global relief, ice surface                              | ETOPO1 (2009)               | **Public domain** | 2026-07-17 | Real elevation → land terrain bands; bathymetry → water shading            |

Natural Earth's terms: _"All versions of Natural Earth raster + vector map
data found on this website are in the public domain."_ No attribution is
legally required; we credit Natural Earth here and in CREDITS.md as a
courtesy. Redistribution of the generated artifacts is unrestricted by the
data licence (the repository's own licences still apply to code/assets).

## Processing performed (scripts/world/build-world.ts)

1. Parse GeoJSON land + minor-island + lake polygons.
2. Project every vertex with **Equal Earth** (documented in
   [WORLD_MAP_ARCHITECTURE.md](WORLD_MAP_ARCHITECTURE.md)).
3. Rasterise polygons into gameplay cells (even-odd scanline fill; holes
   handled by the fill rule; lakes rasterised back to water).
4. Invalid/degenerate ring segments are neutralised by the fill rule
   (horizontal edges skipped; unclosed rings implicitly closed).
5. **Strait preservation**: a curated list of strategic chokepoints
   (Gibraltar, Bosporus, Dardanelles, Øresund, Great Belt, Messina, Dover,
   Bab-el-Mandeb, Hormuz, Singapore, Bering, Cook, Torres) is re-carved as water after
   every downsample so they can never silt shut; Suez and Panama isthmuses
   are re-filled as land. These are gameplay-scale adjustments, documented
   here per the plan's requirement.
6. Ocean flood fill from a single mid-Atlantic seed distinguishes
   navigable ocean from land-locked lakes; shoreline bits computed per LOD.
   **Terrain magnitude comes from real elevation** (ETOPO1, forward-projected
   into an Equal Earth raster, max-accumulated): plains ≤150 m, highland
   150–600 m, low mountains 600–1500 m, high mountains above — so the Great
   Dividing Range, the Southern Alps and the New Guinea highlands are real.
   Water magnitude is real depth (bathymetric shading). If the DEM file is
   absent the pipeline falls back to distance-to-coast bands.
   6b. **Rivers**: major Natural Earth rivers (scalerank ≤ 5) are painted as
   1-cell water with a 2-cell land ford roughly every 30 km, so rivers
   channel and slow land expansion without ever splitting a continent
   (unit-tested: Sydney→Perth stays land-connected).
   6c. **Gameplay sites**: each playable window's manifest carries real
   resource deposits (Pilbara iron, Kalgoorlie gold, …), strait chokepoints
   (Bass/Cook/Torres/…, with control radii) and a monsoon-belt row bound
   used by the in-game weather system.
7. LOD pyramid: 2× majority downsampling per level (ties toward land to
   retain islands), then per-LOD re-carving and reclassification.
8. Chunking into 256² tiles, gzip, concatenation into per-LOD packs +
   JSON index; encode/decode roundtrip verified during the build.
9. Validation gates (build fails otherwise): 32 island checks (incl.
   New Guinea, New Britain, New Caledonia, Fiji, Vanuatu, Guadalcanal),
   14 ocean/lake classification checks (incl. Cook/Torres straits, Coral
   and Tasman seas), 6 BFS strait-navigability probes.
10. Diagnostic PNG previews (world overview + Tasmania/Bass Strait, Italy,
    Britain, Japan, Indonesia/Malacca, Panama, Bosporus, Bering/date line)
    written to `map-generator/world-data/diagnostics/`.

## Generated output files (committed)

| File                                 | Content                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `resources/world/world-index.json`   | Grid config, LOD/chunk index, detail region + playable windows                                                                |
| `resources/world/world-l{0..6}.pack` | Gzipped 256² terrain chunks per LOD; LOD 0/1 cover all of Oceania                                                             |
| `resources/maps/worldoceania/`       | The playable one-world Oceania map in OpenFront map format (all of Oceania at ~1.2 km/tile), emitted from the same world data |

## Not yet integrated (candidates for later stages)

- Country/administrative boundaries (`ne_10m_admin_0/1`) — region metadata.
- Rivers (`ne_10m_rivers_lake_centerlines`).
- Elevation (e.g. GLOBE/ETOPO, public domain) to replace distance-to-coast
  as the magnitude source.
