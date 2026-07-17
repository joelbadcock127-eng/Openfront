# World map roadmap

Honest status of the continuous-world system against the staged plan.
Nothing below disguises a prototype as the completed game.

## Implemented (working, tested)

- **Stage 1 — technical world prototype: complete.**
  - Continuous global camera (one transform from ~10 km across to the full
    Earth; wheel/trackpad/pinch, zoom-to-cursor, drag pan; world bounds).
  - Chunk streaming (HTTP Range into per-LOD packs, LRU cache + eviction,
    predictive prefetch, async decode; no full-map load).
  - Five global LOD levels (LOD 2–6) + two detail LODs (0–1) across all
    of Oceania; chunk-fallback rendering ⇒ no blank areas.
  - Real-world coastline data (Natural Earth 10m, Equal Earth projection).
  - Full-world zoom ↔ local zoom in one match, no transitions.
  - Chunk seam validation (build-time + unit tests on shipped packs).
  - Basic territory rendering across scales (game render inside the
    window at every zoom).
- **Stage 2 — one playable Oceania inside the streamed Earth:
  functional.**
  - LOD 0/1 terrain (~0.61 km / ~1.2 km cells) covers the whole Oceania
    region (lon 110°E–180°, lat 48.5°S–8°N): Australia, New Zealand, New
    Guinea, and the Melanesian island arcs (New Caledonia, Vanuatu,
    Fiji, Solomons).
  - The playable map is **all of Oceania merged into ONE map — one
    match, one continuous territorial state**: the entire Australian
    continent (Western Australia, the Northern Territory, South
    Australia included), Tasmania, both New Zealand islands, New Guinea
    and the island arcs, 8192×7168 = 58.7M tiles at ~1.2 km per tile.
    That is 7× the largest upstream map; ~1.2 km is the highest
    resolution that measurably runs lag-free today (a ~0.61 km Oceania
    map would be 235M tiles — see WORLD_PERFORMANCE.md for the
    measurements and the resolution ladder). The full OpenFront ruleset
    runs unmodified: expansion, combat, AI (bots + 24 real-city nations
    across 7 countries with national flags), buildings, ships, borders.
  - The full globe exists around the map as a continuous lower-detail
    world — you zoom out of the battle to the whole Earth mid-match, no
    transition.
  - Bass Strait, Cook Strait and Torres Strait are open water on the
    playable map: naval movement connects every theatre in one ocean.

## Functional but incomplete

- Scale-dependent presentation: terrain LODs and the km-across indicator
  adapt to zoom, and game labels/units fade naturally with the window
  scale, but there is no dedicated aggregated-label system for
  national/continental zoom yet.
- Terrain magnitude is distance-to-coast (visually plausible bands, slows
  inland attacks) rather than real elevation.
- Window boundary rendering: visible resolution seam at far zoom (WebGL
  minification instead of ownership summaries).

## Prototype only

- Save/load of world matches (upstream solo has no saves either); the
  data layout already keeps static terrain out of any future save.

## Planned (not started)

- **Stage 3 — full-world terrain at LOD 0/1** via the same pipeline.
  Oceania (≈235M LOD-0 cells) is generated and shipped, proving the
  region-parameterised path; extending the box worldwide needs pack
  sharding and beefier generation (est. ~2–4 GB LOD-0 data worldwide).
- Growing the playable map beyond Oceania toward the whole Earth (the
  window config is data-driven: widen the bbox, re-run the pipeline).
  Resolution and extent trade off against the lag budget; raising the
  playable resolution back toward ~0.61 km as engine optimisations land
  is part of the same ladder (see WORLD_PERFORMANCE.md).
- **Stage 4 — global playable simulation**: hierarchical AI over regional
  summaries, worldwide expansion/victory, chunk-level ownership
  summaries + run-length interior compression, dirty-region simulation,
  world-scale save/load.
- Worldwide spawn search UI (country/city search, AI-density preview).
- Gameplay pacing mechanics for world scale (supply distance, capital
  distance, attrition, regional administration) — deliberately deferred
  per the plan ("first preserve the recognisable OpenFront gameplay
  loop").

## Not currently supported

- Horizontal world wrap (trans-Pacific travel across the ±180° edge);
  the camera clamps at world bounds instead.
- Multiplayer on the world map (out of scope for this solo derivative).
- Rivers as gameplay features; administrative-region metadata.
