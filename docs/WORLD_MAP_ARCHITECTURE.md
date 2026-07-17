# World map architecture

The defining feature of this project: **one continuous, massive real-world
map**. A match starts at a local scale, and the player can zoom out — with no
loading screen or match transition — until the whole Earth is on screen. All
gameplay happens on one continuous world with one territorial state.

Status per stage is tracked in [WORLD_ROADMAP.md](WORLD_ROADMAP.md); data
sources in [GEOGRAPHIC_DATA.md](GEOGRAPHIC_DATA.md); benchmarks in
[WORLD_PERFORMANCE.md](WORLD_PERFORMANCE.md).

## World coordinate system

- The authoritative grid is **LOD 0**: every base terrain cell has a stable
  integer `(x, y)` world coordinate in a `65536 × 32768` grid
  (~0.61 km per cell). Coordinates are independent of screen resolution,
  camera state and chunk layout (`src/core/world/WorldGrid.ts`).
- Camera zoom/projection are entirely separate from gameplay coordinates:
  the camera (`TransformHandler`) maps game/world cells to screen pixels via
  scale+offset and never feeds back into cell addressing.
- Geographic conversion is exact and bidirectional:
  `geoToWorld(lon, lat) ↔ worldToGeo(x, y)` (unit-tested roundtrip).

## Projection

**Equal Earth** (Šavrič–Patterson–Jenny 2018), implemented natively in
`src/core/world/EqualEarth.ts` and shared verbatim by the build pipeline and
the client (no drift possible).

Why not Web Mercator: Mercator inflates area toward the poles, so a square
kilometre of Scandinavia would be worth several times one of Indonesia.
Equal Earth is **equal-area** — gameplay territory is worth the same
everywhere — while still looking like a familiar world map.

Gameplay consequences (documented per the plan):

- Cell _area_ is uniform; local _shape_ is mildly stretched at mid/high
  latitudes (pseudocylindrical). Tasmania appears slightly taller than on a
  conformal map.
- Longitude ±180° is the map's outer edge (curved toward the poles).
  **The world does not wrap horizontally**; the camera clamps to world
  bounds (the plan explicitly allows "world bounds or controlled
  wrapping"). The international date line is therefore the map edge — there
  is no mid-map vertical seam. Wrap-around naval travel across the Pacific
  edge is a known limitation (see roadmap).

## Chunked world structure

- Chunks are **256 × 256 cells at every LOD**, addressed by integer chunk
  coordinates; the grid dimensions are exact chunk multiples at every LOD,
  so chunks align exactly — no cracks, no overlap, by construction (they are
  cut from one continuous array after all terrain processing).
- Chunk payload: 1 byte/cell in the engine's terrain layout (bit 7 land,
  bit 6 shoreline, bit 5 ocean, bits 0–4 magnitude), gzip-compressed.
- All chunks of a LOD are concatenated into one **pack file**
  (`resources/world/world-l{k}.pack`) with a JSON index
  (`world-index.json`: offsets/lengths, grid config, detail regions).
  Static terrain is fully separate from dynamic ownership.
- Terrain classification, coastline (shore bits), naval connectivity (ocean
  bits: ocean vs unreachable lake), traversability (magnitude 31 = engine
  impassable, never emitted) and spawn validity (land) are all derivable
  from the chunk bytes. City/settlement points feed nation placement in the
  pipeline. Integrity: format version in the index; chunk decode length is
  verified; encode/decode determinism is unit-tested.

## Level-of-detail hierarchy

| LOD | Grid        | Cell size | Coverage                                                    |
| --- | ----------- | --------- | ----------------------------------------------------------- |
| 0   | 65536×32768 | ~0.61 km  | detail regions (all of Oceania) — Stage 3 extends worldwide |
| 1   | 32768×16384 | ~1.2 km   | detail regions                                              |
| 2   | 16384×8192  | ~2.4 km   | **global** (base)                                           |
| 3   | 8192×4096   | ~4.9 km   | global                                                      |
| 4   | 4096×2048   | ~9.8 km   | global                                                      |
| 5   | 2048×1024   | ~19.6 km  | global                                                      |
| 6   | 1024×512    | ~39 km    | global (always resident: 8 chunks)                          |

- LOD k cell `(x,y)` covers LOD-0 cells `[x·2^k,(x+1)·2^k)²` — parent→child
  references are pure index arithmetic.
- Coarser LODs are **rendering/query accelerators only**. They are
  regenerated from the same source (majority-of-children downsampling with
  strait re-carving) and never become separate gameplay maps; the
  authoritative simulation state lives at the playable resolution.
- Zooming out combines detail visually (dominant terrain via majority rule;
  ownership via the scaled game render — chunk-level ownership summaries
  are the Stage-4 upgrade). Zooming in reveals the detailed data that
  already exists; cross-LOD consistency is unit-tested (≥99% majority-rule
  conformance, with strait carving the only exception).

## Loading and caching

`src/client/world/WorldChunkStore.ts`:

- Chunks are fetched individually with **HTTP Range requests** into the
  pack files — the map never has to be fully resident. Servers that ignore
  `Range` (returning 200) trigger a documented fallback: the pack is
  downloaded once and sliced locally.
- Decode via `DecompressionStream("gzip")`, off the critical path (async).
- Decoded chunks live in an **LRU cache (512 chunks ≈ 32 MiB terrain +
  bitmaps)**; least-recently-used (distant) chunks are evicted.
- The render loop requests visible chunks plus a one-chunk margin, plus an
  extra chunk in the camera's movement direction (**predictive loading**).
- A missing or corrupt chunk logs and leaves the coarser-LOD fallback
  visible — it cannot take down the render loop.

## Rendering strategy

`src/client/world/WorldBackdrop.ts` (canvas layered above the game's WebGL
canvas, below the HUD, pointer-events off):

- Shares the game's camera (`TransformHandler`) — world cells and game
  tiles are the same units, offset by the window origin, so the backdrop
  and the playable window can never disagree about position.
- Per frame, up to three passes coarse→fine: LOD 6 (always resident —
  guarantees **no blank areas during fast movement**), the zoom-appropriate
  LOD clamped to global coverage, and the detail-region LOD when zoomed in.
  Only chunks intersecting the viewport draw (typically 6–40 drawImage
  calls).
- Chunks are colorized with the game's own terrain palette
  (`encodeTerrainTile`), so backdrop and playable window match visually;
  bitmaps are cached per chunk.
- The playable window's screen rect is cleared each frame so the game's
  WebGL canvas shows through — ownership, borders, units and structures in
  the window are rendered by the **unmodified** game renderer at every zoom
  level.
- A scale indicator shows "≈ N km across"; `localStorage.worldDebug = "1"`
  adds loaded/pending chunk counts, fetch/decode timings, memory estimate
  and draw statistics.

## Camera and zoom

- `TransformHandler` gains optional **extended bounds**: in world mode the
  pan clamp covers the whole Earth and the minimum zoom extends until the
  full world fits on screen (classic maps keep the 0.2 floor). Zoom is
  continuous (wheel/trackpad/pinch, zoom-to-cursor) from ~44,000 km across
  down to ~10 km across.
- All existing camera affordances (drag pan, touch, `C` return-to-capital,
  double-click focus, minimap-free overview via zoom-out) work unchanged.

## Simulation strategy (hybrid, Stage 2)

- The **active simulation** runs on the playable window: ALL of Oceania
  as one map (8192×7168 = 58.7M tiles at ~1.2 km per tile — the whole
  Australian continent, New Zealand, New Guinea and the island arcs in a
  single match with a single territorial state), using the unmodified
  deterministic engine in a Web Worker: full OpenFront rules, AI, navy,
  structures. The map is cut from the same Oceania world grid (at LOD 1;
  one game tile = 2 LOD-0 cells per axis, recorded as `lod` in
  `world-index.json` `windows[]`) and land bits are unit-tested identical
  to the world packs. ~1.2 km/tile is the highest resolution that
  measurably runs lag-free at this extent; the LOD-0 data already exists
  for the day the engine can simulate 235M tiles.
- The window is cut from the same world data (land bits are
  unit-tested identical), placed at its world origin — territory, attacks
  and naval movement inside it cross chunk boundaries trivially because
  the simulation is not chunked; chunks are a storage/streaming concept.
- The rest of the Earth is **terrain-visible but not yet simulated** —
  aggregated regions in the plan's hybrid-simulation sense, with the
  world-scale simulation (global AI factions, worldwide expansion)
  scheduled as Stage 4 (see roadmap). Ownership is deterministic; zooming
  never alters it (the authoritative state lives in the engine).

## Ownership encoding

Inside the active window: the engine's existing per-tile ownership +
border sets (unchanged). At world scale the scaled-down WebGL render
provides the aggregate view today; per-chunk ownership summaries
(dominant owner + contested flag) are the planned Stage-4 representation
for territory outside loaded detail, alongside run-length interior
compression. This choice deliberately follows the plan's instruction to
profile before committing to a sparse structure.

## AI access

AI opponents run inside the active window through the normal intent
system (unchanged upstream hierarchy: per-nation behaviours making
strategic/tactical decisions against the fine grid). World-scale
hierarchical AI (strategic theatre selection over regional summaries) is
Stage 4; the chunk store's terrain queries (`has`/`get` by LOD) are the
intended data source for its regional layer.

## Save strategy

Not yet implemented (see roadmap). Design constraints already honoured by
the data layout: static terrain is never serialised into saves (chunks are
content-addressed by grid version); a save needs only dynamic state
(ownership deltas by chunk, structures, units, AI state, seed, versions).

## Known limitations

- LOD 0/1 coverage exists only inside the Oceania region (lon
  110°E–180°, lat 48.5°S–8°N) until Stage 3 generation runs worldwide;
  elsewhere the finest zoom shows 2.4 km cells.
- No horizontal world wrap: trans-Pacific naval travel around the ±180°
  edge is not possible; the date-line edge is visible at full-world zoom.
- The playable window boundary is visible as a resolution/render seam at
  high zoom-out (the window renders via WebGL minification rather than
  aggregated summaries). Inside the playable map the finest zoom shows
  the game's ~1.2 km tiles; the ~0.61 km world data refines the view
  only outside the playable rect until the playable resolution rises.
- Simulation outside the window (Stage 4) and world-scale saves are not
  implemented; a match's conquerable area today is the window.
- Terrain "elevation" is distance-to-coast, not real elevation data (no
  DEM dataset is integrated yet); it renders plausibly and slows inland
  attacks, but mountain ranges are not geographically real.
