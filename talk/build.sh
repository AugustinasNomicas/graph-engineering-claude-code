#!/usr/bin/env bash
# Rebuild slides.html from slides.md.
#
#   ./build.sh
#
# Requires node (for npx) and python3. Marp is fetched on demand.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

SRC=slides.md
OUT=slides.html

# --html: the deck uses a few raw <br> tags on its statement slides.
# < /dev/null: REQUIRED. When stdin is neither a TTY nor closed (CI, an agent session, anything
#   driving this over a socket) marp-cli reads the deck FROM STDIN and blocks forever on an EOF that
#   never comes. Killing it mid-run truncates the HTML into a file that still looks plausible.
npx --yes @marp-team/marp-cli@4.5.0 "$SRC" -o "$OUT" --html < /dev/null

# Marp leaves local images as <img src="presentation-flow.svg">, which only resolves while the HTML
# sits next to the SVG. Inline it so slides.html is one self-contained file.
python3 - "$OUT" <<'PY'
import base64, pathlib, re, sys

out = pathlib.Path(sys.argv[1])
html = out.read_text(encoding="utf-8")


def inline(match):
    data = base64.b64encode((out.parent / match.group(1)).read_bytes()).decode("ascii")
    return f'src="data:image/svg+xml;base64,{data}"'


html, n = re.subn(r'src="([^":]+\.svg)"', inline, html)
if n == 0:
    sys.exit("no local SVG found to inline -- did the diagram markup change?")
out.write_text(html, encoding="utf-8")
print(f"inlined {n} diagram(s)")
PY

echo "wrote $OUT"
