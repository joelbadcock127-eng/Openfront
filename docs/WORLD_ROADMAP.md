# World map roadmap

Honest status of the continuous-world system against the staged plan.
Nothing below disguises a prototype as the completed game.

## Implemented (working, tested)

- **Stage 1 — technical world prototype: complete.**
  - Continuous global camera (one transform from ~10 km across to the full
    Earth; wheel/trackpad/pinch, zoom-to-cursor, drag pan; world bounds).
  - Chunk streaming (HTTP Range into per-LOD packs, LRU cache + eviction,
    predictive prefetch, async decode; no full-map load).
  - Five global LOD levels (LOD 2–6) + two detail LODs (0–1) in the Bass
    Strait region; chunk-fallback rendering ⇒ no blank areas.
  - Real-world coastline data (Natural Earth 10m, Equal Earth projection).
  - Full-world zoom ↔ local zoom in one match, no transitions.
  - Chunk seam validation (build-time + unit tests on shipped packs).
  - Basic territory rendering across scales (game render inside the
    window at every zoom).
- **Stage 2 — playable high-detail test region: functional.**
  - Bass Strait window (Tasmania, King Island, Furneaux Group, Bass
    Strait, southern Victoria; 4096×2048 at ~0.61 km/cell) is fully
    playable with the unmodified OpenFront ruleset: expansion, combat, AI
    (bots + real-city nations incl. Melbourne/Hobart/Launceston/Devonport
    area), buildings, ships, borders, camera transitions, performance.
  - The full globe exists around it as a continuous lower-detail world —
    the window is NOT a separate selectable map experience; you zoom out
    of the battle to the whole Earth mid-match.
  - Spawn near Devonport: click northern Tasmania during spawn selection.

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

- **Stage 3 — full-world terrain at LOD 0/1** via the same pipeline
  (`npm run gen-world` is region-parameterised; needs distributed/beefier
  generation + pack sharding, est. ~2–4 GB LOD-0 data worldwide).
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
