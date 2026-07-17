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
- **Stage 2 — playable high-detail regions: functional, extended to
  Oceania.**
  - LOD 0/1 terrain (~0.61 km / ~1.2 km cells) now covers the whole
    Oceania region (lon 110°E–180°, lat 48.5°S–8°N): Australia, New
    Zealand, New Guinea, and the Melanesian island arcs (New Caledonia,
    Vanuatu, Fiji, Solomons) — everywhere you zoom in inside that box you
    see full-detail coastline.
  - Five playable windows are cut from that same LOD-0 grid, each near
    the engine's proven scale (8.4–12.6M tiles): **Bass Strait**
    (4096×2048, the original window and default map), **New Zealand
    South** and **New Zealand North** (4096×3072 each, Cook Strait open
    in both), **Torres Strait / New Guinea** (3072×3072), and **East
    Australia** (4096×3072, Brisbane–Sydney–Canberra). All run the
    unmodified OpenFront ruleset: expansion, combat, AI (bots +
    real-city nations with national flags), buildings, ships, borders.
  - The full globe exists around every window as a continuous
    lower-detail world — a window is NOT a separate map experience; you
    zoom out of the battle to the whole Earth mid-match.
  - Spawn near Devonport: click northern Tasmania during spawn selection
    on the Bass Strait window.

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
- More playable windows outside Oceania as detail coverage grows (the
  window list is data-driven: one pipeline entry + map registration).
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
