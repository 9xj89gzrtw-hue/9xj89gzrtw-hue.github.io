#!/bin/sh
# SVG -> transparent PNG via headless Chrome.
# The SVG is inlined into a viewport-sized HTML wrapper so the raster is exactly
# the requested width (a bare SVG document renders at its intrinsic size and
# gets cropped by the window).
set -eu
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
render() { # $1 src, $2 out, $3 width
  src="$1"; out="$2"; w="$3"
  h=$(python3 - "$src" "$w" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
m = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', s)
print(round(float(m.group(2)) / float(m.group(1)) * int(sys.argv[2])))
PY
)
  tmp=$(mktemp -d)
  python3 - "$src" "$tmp/page.html" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
s = re.sub(r'(<svg[^>]*?)width="[\d.]+" height="[\d.]+"', r'\1width="100%" height="100%"', s, count=1)
html = ('<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}'
        'svg{display:block;width:100vw;height:100vh}</style>' + s)
open(sys.argv[2], "w").write(html)
PY
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$w,$h" \
    --screenshot="$out" "file://$tmp/page.html" 2>/dev/null
  rm -rf "$tmp"
}
mkdir -p png/512 png/1024 png/2048
for c in A B C; do
  for v in mark lockup; do
    for sz in 512 1024 2048; do
      render "svg/$c-$v-color.svg" "png/$sz/$c-$v.png" "$sz"
    done
  done
done
