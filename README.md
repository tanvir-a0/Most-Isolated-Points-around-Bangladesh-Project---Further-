# Most remote point in Bangladesh

Finds the point in Bangladesh that is furthest from any building, using Google Earth Engine and the Open Buildings V3 dataset.

**Result: 9,552 m from the nearest building, at 21.96156° N, 89.29299° E** — in the Sundarbans mangrove forest, southwest Bangladesh.

For a country of ~148,000 km², that is a striking figure: nowhere in Bangladesh is more than about 10 km from a building.

---

## How it works

The problem is a *pole of inaccessibility* — the centre of the largest empty circle that fits between buildings. It is solved as a raster distance transform:

1. Mark every 100 m grid cell that contains a building.
2. For every unmarked cell, compute the distance to the nearest marked cell.
3. Discard cells that are outside Bangladesh, in permanent water, or inside a known data gap.
4. The survivor with the largest distance wins.

Two design decisions are worth stating up front.

**Buildings outside the border still count.** The building mask is built over Bangladesh plus a 30 km buffer, and the clip to the national boundary happens *after* the distance transform. A point 300 m from a village in West Bengal is not remote, and should not be scored as such.

**The mask is exported once.** Rasterizing 1.8 billion building footprints is the only expensive step. It is written to an Earth Engine asset, so the analysis scripts read a small raster and rerun in seconds.

---

## Scripts

Run them in order. Each is a standalone Earth Engine Code Editor script.

### `1_exporting_100m_grid.js`

Builds the building mask and exports it as an asset.

- Loads Bangladesh from `USDOS/LSIB_SIMPLE/2017` and buffers it by 30 km.
- Loads `GOOGLE/Research/open-buildings/v3/polygons`, filtered to `confidence >= 0.65`.
- Rasterizes with `reduceToImage`, then `.gt(0).unmask(0)` for a binary built/not-built mask at 100 m.
- Exports to an asset via the Tasks tab.

Rasterization is intersection-based: a cell is marked if any footprint overlaps it anywhere, so small rural buildings are not lost at coarse scale.

**Run this once and wait for the task to finish before continuing.**

### `2_country_level_remote_point.js`

Finds the single most remote point nationally.

- Loads the exported mask and runs `fastDistanceTransform` (400 px ≈ 40 km search cap).
- Converts squared pixel distance to metres: `.sqrt().multiply(100)`.
- Optionally masks permanent water (`WATER_MASK`).
- Clips to Bangladesh, then finds the maximum with `Reducer.max(3)` over the distance band plus `ee.Image.pixelLonLat()`, which recovers the winning pixel's coordinates.
- Draws a circle of the minimum radius and a line to the nearest building, and prints a Google Maps link.

The circle should be tangent to exactly one building — a visual proof that the answer is correct.

### `3_division_level_remote_point.js`

Repeats the analysis per division (ADM1).

- Uses `reduceRegions` over an upazila-level boundary collection, then keeps the best upazila in each division. This is much cheaper than dissolving polygons to division level, and gives upazila detail for free.
- Excludes known data gaps (see below) via `EXCLUDE_GAPS`.
- Draws a circle, a line and the nearest building for each division's winner.

---

## Requirements

- A Google Earth Engine account with a Cloud project.
- An admin boundary asset with `ADM1_EN`, `ADM2_EN` and `ADM3_EN` properties. The scripts were written against the Bangladesh OCHA COD administrative boundaries, uploaded as a personal asset.

Set `ASSET` and `ADM_ASSET` to your own project paths before running. The `xxxxxx` in the asset paths is a redacted Cloud project ID — replace it with your own.

---

## Known limitations

**This measures distance to the nearest *detected* building.** Where Open Buildings V3 has complete coverage, that equals distance to the nearest building. Where it does not, a detection gap is indistinguishable from genuine remoteness — and the method actively seeks out gaps, because a gap looks exactly like what it is searching for.

One tile-sized gap was found in Sunamganj (around 91.47–91.65° E, 25.08–25.14° N) during visual verification: a suspiciously smooth rectangular gradient over terrain that clearly contains villages in satellite imagery. Open Buildings V3 has no detections there, at any confidence threshold. The Open Buildings 2.5D Temporal dataset — derived from Sentinel-2, which has consistent global coverage — *does* show buildings at that location (presence 0.88, height 7.3 m).

That region is listed in `GAPS` and excluded from the division-level analysis. Attempts to patch it from the temporal dataset repeatedly hit Earth Engine's reprojection and pixel limits; excluding the region was chosen over an unreliable repair.

**Always verify winners against satellite imagery before quoting them.** Straight edges and right angles in the distance surface are the signature of a data gap, not of geography.

Other caveats:

- Distances are straight-line, not walkable. In the Sundarbans tidal channels the difference is large.
- The grid is EPSG:4326 at 100 m nominal. At 22° N a pixel is ~103 m east–west, so figures are accurate to a few percent, not to the metre. The scripts print a grid-free geodesic distance for comparison.
- `confidence >= 0.65` is Google's suggested high-precision threshold. Lowering it to 0.5 catches more marginal detections, especially in hill terrain and under canopy, and will tend to reduce the reported distances.
- `WATER_MASK` uses JRC occurrence > 80%, which only captures *permanent* water. Tidal channels that drain twice daily are not masked.

---

## Data sources

- [Open Buildings V3](https://sites.research.google/open-buildings/) — building footprints from 50 cm imagery.
- [Open Buildings 2.5D Temporal](https://sites.research.google/gr/open-buildings/temporal/) — Sentinel-2 derived building presence and height, used here for gap verification.
- `USDOS/LSIB_SIMPLE/2017` — international boundaries.
- `JRC/GSW1_4/GlobalSurfaceWater` — surface water occurrence.
