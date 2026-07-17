#!/usr/bin/env bash
# Download the Natural Earth 10m datasets (public domain) used by the world
# map build pipeline. See docs/GEOGRAPHIC_DATA.md for dataset details.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/../.." && pwd)/map-generator/world-data"
mkdir -p "$DIR"
BASE="https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson"

for f in ne_10m_land ne_10m_minor_islands ne_10m_lakes ne_10m_populated_places_simple ne_10m_rivers_lake_centerlines; do
    if [ ! -f "$DIR/$f.geojson" ]; then
        echo "downloading $f.geojson…"
        curl -sSL --fail -o "$DIR/$f.geojson" "$BASE/$f.geojson"
    else
        echo "$f.geojson already present"
    fi
done
# ETOPO1 global relief (NOAA, public domain) — real elevation + bathymetry.
if [ ! -f "$DIR/etopo1_ice_g_i2.bin" ]; then
    echo "downloading ETOPO1 (~310 MB)…"
    curl -sSL --fail -o "$DIR/etopo1_ice_g_i2.zip" \
        "https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO1/data/ice_surface/grid_registered/binary/etopo1_ice_g_i2.zip"
    (cd "$DIR" && unzip -o -q etopo1_ice_g_i2.zip)
else
    echo "etopo1_ice_g_i2.bin already present"
fi
echo "done. run: npm run gen-world"
