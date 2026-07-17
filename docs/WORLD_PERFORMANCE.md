# World map performance

Measured budgets and benchmark results for the continuous-world system.
Re-run with `node scripts` equivalents or the in-game overlay
(`localStorage.worldDebug = "1"` shows live chunk/fetch/decode/draw stats).

## Budgets (initial desktop targets)

| Budget                       | Target                 | Status                                                |
| ---------------------------- | ---------------------- | ----------------------------------------------------- |
| Backdrop draw cost per frame | < 2 ms                 | ✅ 0.1–0.4 ms measured                                |
| Chunks drawn per frame       | bounded (≤ ~60)        | ✅ 4–14 typical, 3 LOD passes                         |
| Detailed chunks resident     | bounded                | ✅ LRU cap 512 (≈32 MiB terrain)                      |
| Decoded-terrain memory       | < 64 MiB               | ✅ 6.8–23 MiB across a full session                   |
| Chunk boundary crossing      | no multi-second pauses | ✅ async streaming + coarse-LOD fallback; no blocking |
| Distant world rendering      | from aggregated data   | ✅ LOD 4–6 packs (aggregates), never fine data        |
| Simulation while zooming     | unaffected             | ✅ sim runs in the Web Worker; camera is render-only  |
| Full-map memory              | never fully loaded     | ✅ world = ~8 MB packs on disk, streamed on demand    |

## Benchmark (2026-07-11)

Method: Playwright-driven Chromium, 1440×900, software WebGL
(`allowSoftwareGL`, GPU-less container), dev server. Live match on the Bass
Strait window (400 bots), rapid drag-pans at each zoom band and a
continuous local↔global zoom cycle. Stats read from the world layer's
introspection hook.

| Scenario                    | LOD   | chunks drawn | backdrop draw | cached chunks | terrain mem |
| --------------------------- | ----- | ------------ | ------------- | ------------- | ----------- |
| Local pan (~50 km view)     | 0     | 5            | 0.2 ms        | 108           | 6.8 MB      |
| Regional pan (~500 km view) | 0–2   | 14           | 0.4 ms        | 132           | 8.3 MB      |
| Continental pan             | 3     | 9            | 0.1 ms        | 237           | 14.8 MB     |
| Global sweep (whole Earth)  | 6     | 6            | 0.2 ms        | 309           | 19.3 MB     |
| Continuous zoom cycle       | 0→6→0 | 4–14         | 0.2 ms        | 368           | 23.0 MB     |

- **Range requests**: supported end-to-end (dev server and static hosts);
  the store never downloaded a full pack in any run.
- **Fetch/decode**: per-chunk wall times in this environment average ~3 s
  because ~100 concurrent requests queue through the dev middleware and
  each pending request's queue wait is counted; chunk gunzip itself is
  sub-millisecond (64 KiB payloads, typically 1–8 KiB compressed). The
  coarse-LOD fallback hides all of it — no blank areas were observed at
  any point.
- **Frame rate caveat**: total rAF frame times in this container are
  dominated by the _game's_ WebGL renderer running on SwiftShader
  (software GL) with an 8.4M-tile map — that is the harness, not the
  world layer (which contributes < 0.5 ms). On GPU hardware the game
  renderer is the same code that ships upstream at 60 fps; the world
  backdrop's cost is unchanged by GPU availability (Canvas2D blits).
- **Large wars / many AI factions**: the Bass Strait window ran with 400
  bots + 10 nations (the engine's GiantWorldMap scale); simulation load is
  identical to upstream since the engine is unmodified.

## Oceania windows benchmark (2026-07-17)

Same method as above, driven once per new playable window: select map,
spawn, expand, zoom local → whole Earth. The three 4096×3072 windows
(12.6M tiles, ~1.5× the largest upstream map but with far lower land
fractions) show no regression versus the 8.4M Bass Strait window:

| Window (tiles)            | backdrop draw | cached chunks | terrain mem | console errors |
| ------------------------- | ------------- | ------------- | ----------- | -------------- |
| New Zealand South (12.6M) | 0.2 ms        | 315           | 20.6 MB     | none           |
| New Zealand North (12.6M) | 0.2 ms        | 271           | 17.8 MB     | none           |
| Torres Strait (9.4M)      | 0.2 ms        | 330           | 21.6 MB     | none           |
| East Australia (12.6M)    | 0.3 ms        | 301           | 19.7 MB     | none           |

Range requests were used end-to-end in every run (no full-pack
downloads); the LOD0/LOD1 packs now cover all of Oceania and total
~8 MB on disk.

## Instrumentation available

The `worldDebug` overlay reports, live: current LOD, chunks drawn, draw
ms, cached chunk count, pending fetches, total fetch/decode ms, terrain
memory estimate, and Range-support status. `WorldChunkStore.getStats()` /
`WorldBackdrop.getStats()` expose the same programmatically (used by the
benchmark).

## Known gaps

- Save/load benchmarks: n/a until world saves exist (see roadmap).
- Stage-3 full-world LOD-0 data will multiply pack sizes (~2–4 GB); the
  Range-streaming design is built for it but has only been validated with
  the current ~8 MB dataset (global LOD 2–6 plus LOD 0/1 across all of
  Oceania — 3,584 LOD-0 chunks).
- No dedicated numbers yet for "many simultaneous attacks across the
  window boundary" — the boundary is not a simulation boundary (the sim is
  unchunked inside the window), so no cliff is expected.
