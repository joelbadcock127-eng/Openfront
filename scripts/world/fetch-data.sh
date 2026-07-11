#!/usr/bin/env bash
# Download the Natural Earth 10m datasets (public domain) used by the world
# map build pipeline. See docs/GEOGRAPHIC_DATA.md for dataset details.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/../.." && pwd)/map-generator/world-data"
mkdir -p "$DIR"
BASE="https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson"

for f in ne_10m_land ne_10m_minor_islands ne_10m_lakes ne_10m_populated_places_simple; do
  if [ ! -f "$DIR/$f.geojson" ]; then
    echo "downloading $f.geojson…"
    curl -sSL --fail -o "$DIR/$f.geojson" "$BASE/$f.geojson"
  else
    echo "$f.geojson already present"
  fi
done
echo "done. run: npm run gen-world"
