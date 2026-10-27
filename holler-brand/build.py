#!/usr/bin/env python3
"""Holler logo system — vector source generator.

Everything here is drawn from primitives (rects, arcs, polygons). No fonts are
used for the wordmark: the letterforms are custom geometry, so the logo is
font-independent and fully editable.
"""
from __future__ import annotations

import os
import pathlib

OUT = pathlib.Path(__file__).parent

# ---------------------------------------------------------------- palette
AZURE = "#0a9bff"
MAGENTA = "#ff2bd6"
YELLOW = "#ffd60a"
GREEN = "#39ff6a"
INK = "#070b14"
PAPER = "#ffffff"

# ---------------------------------------------------------------- helpers


_DX = 0.0
_DY = 0.0


def rr(x: float, y: float, w: float, h: float, r: float) -> str:
    """Rounded rectangle as a path with arc corners, in current user space."""
    r = min(r, w / 2, h / 2)
    x += _DX
    y += _DY
    return (
        f"M{x + r:.2f},{y:.2f}H{x + w - r:.2f}"
        f"A{r:.2f},{r:.2f} 0 0 1 {x + w:.2f},{y + r:.2f}"
        f"V{y + h - r:.2f}A{r:.2f},{r:.2f} 0 0 1 {x + w - r:.2f},{y + h:.2f}"
        f"H{x + r:.2f}A{r:.2f},{r:.2f} 0 0 1 {x:.2f},{y + h - r:.2f}"
        f"V{y + r:.2f}A{r:.2f},{r:.2f} 0 0 1 {x + r:.2f},{y:.2f}Z"
    )


def rr_ccw(x: float, y: float, w: float, h: float, r: float) -> str:
    """Same rounded rect, wound counter-clockwise (used for counters, so that
    fill-rule:nonzero subtracts it instead of unioning)."""
    r = min(r, w / 2, h / 2)
    x += _DX
    y += _DY
    return (
        f"M{x:.2f},{y + r:.2f}"
        f"V{y + h - r:.2f}A{r:.2f},{r:.2f} 0 0 0 {x + r:.2f},{y + h:.2f}"
        f"H{x + w - r:.2f}A{r:.2f},{r:.2f} 0 0 0 {x + w:.2f},{y + h - r:.2f}"
        f"V{y + r:.2f}A{r:.2f},{r:.2f} 0 0 0 {x + w - r:.2f},{y:.2f}"
        f"H{x + r:.2f}A{r:.2f},{r:.2f} 0 0 0 {x:.2f},{y + r:.2f}Z"
    )


def polygon(points, r: float = 0.0) -> str:
    """Closed polygon, optionally with rounded corners (quadratic joins)."""
    points = [(x + _DX, y + _DY) for x, y in points]
    if r <= 0:
        return "M" + "L".join(f"{x:.2f},{y:.2f}" for x, y in points) + "Z"
    import math

    n = len(points)
    d = ""
    for i in range(n):
        p0 = points[(i - 1) % n]
        p1 = points[i]
        p2 = points[(i + 1) % n]
        v1 = (p0[0] - p1[0], p0[1] - p1[1])
        v2 = (p2[0] - p1[0], p2[1] - p1[1])
        l1 = math.hypot(*v1) or 1
        l2 = math.hypot(*v2) or 1
        k = min(r, l1 / 2, l2 / 2)
        a = (p1[0] + v1[0] / l1 * k, p1[1] + v1[1] / l1 * k)
        b = (p1[0] + v2[0] / l2 * k, p1[1] + v2[1] / l2 * k)
        d += ("M" if i == 0 else "L")
        d += f"{a[0]:.2f},{a[1]:.2f}Q{p1[0]:.2f},{p1[1]:.2f} {b[0]:.2f},{b[1]:.2f}"
    return d + "Z"


def svg(w: int, h: int, body: str, defs: str = "", label: str = "") -> str:
    desc = f"<title>{label}</title>" if label else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'width="{w}" height="{h}" role="img" aria-label="{label}">'
        f"{desc}<defs>{defs}</defs>{body}</svg>"
    )


# ---------------------------------------------------------------- letterforms
# Heavy monoline grotesque, custom geometry. Cap height 200, stem 54 (~27%),
# soft 8-unit corners. Drawn as raw paths so nothing depends on a font file.
CAP = 200.0
STEM = 54.0
RAD = 8.0
TRACK = 34.0


def letter_h():
    parts = [
        rr(0, 0, STEM, CAP, RAD),
        rr(116, 0, STEM, CAP, RAD),
        rr(0, 78, 170, 46, RAD),
    ]
    return "".join(parts), 170.0


def letter_o():
    outer = rr(0, 0, 186, CAP, 72)
    inner = rr_ccw(STEM, STEM, 186 - 2 * STEM, CAP - 2 * STEM, 26)
    return outer + inner, 186.0


def letter_l():
    return rr(0, 0, STEM, CAP, RAD) + rr(0, CAP - 46, 152, 46, RAD), 152.0


def letter_e():
    parts = [
        rr(0, 0, STEM, CAP, RAD),
        rr(0, 0, 156, 46, RAD),
        rr(0, 77, 124, 46, RAD),
        rr(0, CAP - 46, 156, 46, RAD),
    ]
    return "".join(parts), 156.0


def letter_r():
    # Half-capsule bowl (outer) with a punched counter, plus a diagonal leg.
    bowl = (
        f"M{_DX:.2f},{_DY:.2f}H{_DX + 104:.2f}"
        f"A66,60 0 0 1 {_DX + 104:.2f},{_DY + 120:.2f}"
        f"H{_DX:.2f}Z"
        # counter, wound the other way
        f"M{_DX + 54:.2f},{_DY + 74:.2f}"
        f"H{_DX + 100:.2f}"
        f"A20,24 0 0 0 {_DX + 100:.2f},{_DY + 46:.2f}"
        f"H{_DX + 54:.2f}Z"
    )
    leg = polygon([(92, 112), (146, 112), (176, CAP), (120, CAP)], 6)
    return rr(0, 0, STEM, CAP, RAD) + bowl + leg, 176.0


LETTERS = [
    ("H", letter_h),
    ("O", letter_o),
    ("L", letter_l),
    ("L", letter_l),
    ("E", letter_e),
    ("R", letter_r),
]


def wordmark_paths():
    """Glyphs baked into absolute word coordinates (no per-glyph transforms,
    so one userSpaceOnUse gradient can span the whole word)."""
    global _DX
    out = []
    x = 0.0
    for name, fn in LETTERS:
        _DX = x
        d, w = fn()
        out.append((name, d, x, w))
        x += w + TRACK
    _DX = 0.0
    return out, x - TRACK


def wordmark(fill: str):
    items, total = wordmark_paths()
    body = ""
    for name, d, x, w in items:
        body += f'<path d="{d}" fill="{fill}"/>'
    return body, total


def word_defs(span: float, stops: str) -> str:
    """Gradient that runs across the whole word (userSpaceOnUse), not per glyph."""
    return (
        f'<linearGradient id="wordg" gradientUnits="userSpaceOnUse" '
        f'x1="0" y1="0" x2="{span:.0f}" y2="70">{stops}</linearGradient>'
    )


STOPS_NEON = (
    f'<stop offset="0" stop-color="{AZURE}"/>'
    f'<stop offset="0.55" stop-color="{MAGENTA}"/>'
    f'<stop offset="1" stop-color="{MAGENTA}"/>'
)
STOPS_TRIPLE = (
    f'<stop offset="0" stop-color="{AZURE}"/>'
    f'<stop offset="0.52" stop-color="{MAGENTA}"/>'
    f'<stop offset="1" stop-color="{YELLOW}"/>'
)


# ---------------------------------------------------------------- concept A
def concept_a_mark(tile: str | None, letter: str, crossbar: str, compact: bool = False) -> str:
    """H monogram. Optional tile behind, 1000x1000 grid."""
    body = ""
    if tile:
        body += f'<path d="{rr(0, 0, 1000, 1000, 230)}" fill="{tile}"/>'
    # H built on a 1000 grid, sheared 6 deg for motion. `compact` is the optical
    # size for 16-32 px: thicker bars, smaller gap, shallower shear, so the
    # letter survives one-pixel stems on a 16 px favicon.
    if compact:
        lx, rx, top, bot, bw = 236.0, 588.0, 214.0, 786.0, 158.0
        bar_y, bar_h, shear, shift, rad = 421.0, 158.0, -3, 29, 14
    else:
        lx, rx, top, bot, bw = 290.0, 590.0, 250.0, 750.0, 120.0
        bar_y, bar_h, shear, shift, rad = 445.0, 118.0, -6, 58, 10
    body += f'<g transform="translate({shift},0) skewX({shear})">'
    body += f'<path d="{rr(lx, top, bw, bot - top, rad)}" fill="{letter}"/>'
    body += f'<path d="{rr(rx, top, bw, bot - top, rad)}" fill="{letter}"/>'
    body += f'<path d="{rr(lx - 24, bar_y, (rx + bw) - lx + 48, bar_h, rad)}" fill="{crossbar}"/>'
    body += "</g>"
    return body


# ---------------------------------------------------------------- concept B
def concept_b_mark(bubble: str, mouth: str, teeth: str) -> str:
    """Shout bubble: speech bubble + open mouth + two teeth. 1000x1000 grid."""
    tail = polygon([(205, 650), (445, 650), (300, 936)], 40)
    body = (
        f'<path d="{rr(110, 140, 780, 580, 180)}" fill="{bubble}"/>'
        f'<path d="{tail}" fill="{bubble}"/>'
        f'<path d="{rr(296, 292, 408, 300, 118)}" fill="{mouth}"/>'
        f'<path d="{rr(330, 312, 152, 42, 12)}" fill="{teeth}"/>'
        f'<path d="{rr(518, 312, 152, 42, 12)}" fill="{teeth}"/>'
    )
    return body


# ---------------------------------------------------------------- concept C
def concept_c_mark(stroke: str, arc: str) -> str:
    """Echo H: monogram + radiating arcs. 1000x1000 grid."""
    lx, rx, top, bot = 200.0, 470.0, 260.0, 740.0
    bw = 110.0
    body = (
        f'<path d="{rr(lx, top, bw, bot - top, 14)}" fill="{stroke}"/>'
        f'<path d="{rr(rx, top, bw, bot - top, 14)}" fill="{stroke}"/>'
        f'<path d="{rr(lx, 435, (rx + bw) - lx, 130, 14)}" fill="{stroke}"/>'
    )
    for i, (cx, wgt, op) in enumerate([(760, 26, 1.0), (820, 20, 0.62), (880, 15, 0.34)]):
        r = 70 + i * 58
        body += (
            f'<path d="M{cx - 20:.0f},{500 - r:.0f}a{r:.0f},{r:.0f} 0 0 1 0,{2 * r:.0f}" '
            f'fill="none" stroke="{arc}" stroke-width="{wgt}" stroke-linecap="round" opacity="{op}"/>'
        )
    return body


# ---------------------------------------------------------------- defs
DEFS_DIAG = (
    f'<linearGradient id="neon" x1="0" y1="0" x2="1" y2="0.35">'
    f'<stop offset="0" stop-color="{AZURE}"/>'
    f'<stop offset="0.55" stop-color="{MAGENTA}"/>'
    f'<stop offset="1" stop-color="{MAGENTA}"/></linearGradient>'
    f'<linearGradient id="tileg" x1="0" y1="0" x2="1" y2="1">'
    f'<stop offset="0" stop-color="{AZURE}"/>'
    f'<stop offset="0.6" stop-color="{MAGENTA}"/>'
    f'<stop offset="1" stop-color="{MAGENTA}"/></linearGradient>'
    f'<linearGradient id="bubg" gradientUnits="userSpaceOnUse" x1="120" y1="150" x2="880" y2="880">'
    f'<stop offset="0" stop-color="{AZURE}"/>'
    f'<stop offset="0.55" stop-color="{MAGENTA}"/>'
    f'<stop offset="1" stop-color="{MAGENTA}"/></linearGradient>'
    f'<linearGradient id="echog" x1="0" y1="0" x2="1" y2="1">'
    f'<stop offset="0" stop-color="{AZURE}"/>'
    f'<stop offset="1" stop-color="{MAGENTA}"/></linearGradient>'
)


def write(name: str, content: str):
    p = OUT / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return p


# ---------------------------------------------------------------- builds
def build():
    made = []

    def put(name, content):
        made.append(write(name, content))

    # ============================== concept A — H tile (geometric)
    A_MARK = concept_a_mark("url(#tileg)", PAPER, YELLOW)
    put("svg/A-mark-color.svg", svg(1000, 1000, A_MARK, DEFS_DIAG, "Holler mark — H tile, full colour"))
    put("svg/A-mark-mono.svg", svg(1000, 1000, concept_a_mark(INK, PAPER, INK), "", "Holler mark — H tile, single colour"))
    put("svg/A-mark-reversed.svg", svg(1000, 1000, concept_a_mark(PAPER, INK, PAPER), "", "Holler mark — H tile, reversed"))

    def lockup_a(tile, letter, bar, word_fill, stops, label, tag):
        wm, ww = wordmark(word_fill)
        pad = 90
        wx = 1000 + 150
        h = 1000
        body = f'<g>{concept_a_mark(tile, letter, bar)}</g>'
        body += f'<g transform="translate({wx},{int((h - CAP) / 2)})">{wm}</g>'
        d = DEFS_DIAG + word_defs(ww, stops) if word_fill.startswith("url") else DEFS_DIAG
        return svg(int(wx + ww + pad), h, body, d, label)

    put("svg/A-lockup-color.svg", lockup_a("url(#tileg)", PAPER, YELLOW, "url(#wordg)", STOPS_TRIPLE, "Holler lockup — full colour", "color"))
    put("svg/A-lockup-mono.svg", lockup_a(INK, PAPER, INK, INK, "", "Holler lockup — single colour", "mono"))
    put("svg/A-lockup-reversed.svg", lockup_a(PAPER, INK, PAPER, PAPER, "", "Holler lockup — reversed", "rev"))

    # ============================== concept B — shout bubble (mascot-ish)
    put(
        "svg/B-mark-color.svg",
        svg(1000, 1000, concept_b_mark("url(#bubg)", INK, PAPER), DEFS_DIAG, "Holler mark — shout bubble, full colour"),
    )
    put("svg/B-mark-mono.svg", svg(1000, 1000, concept_b_mark(INK, PAPER, INK), "", "Holler mark — shout bubble, single colour"))
    put("svg/B-mark-reversed.svg", svg(1000, 1000, concept_b_mark(PAPER, INK, PAPER), "", "Holler mark — shout bubble, reversed"))

    def lockup_b(bubble, mouth, teeth, word_fill, stops, label):
        wm, ww = wordmark(word_fill)
        sx, sy = 0.62, 0.62
        wx = 620 + 130
        body = f'<g transform="translate(0,{int((1000 - 1000 * sy) / 2)}) scale({sx})">{concept_b_mark(bubble, mouth, teeth)}</g>'
        body += f'<g transform="translate({wx},{int((1000 - CAP) / 2)})">{wm}</g>'
        d = DEFS_DIAG + word_defs(ww, stops) if word_fill.startswith("url") else DEFS_DIAG
        return svg(int(wx + ww + 90), 1000, body, d, label)

    put("svg/B-lockup-color.svg", lockup_b("url(#bubg)", INK, PAPER, "url(#wordg)", STOPS_TRIPLE, "Holler lockup (B) — full colour"))
    put("svg/B-lockup-mono.svg", lockup_b(INK, PAPER, INK, INK, "", "Holler lockup (B) — single colour"))
    put("svg/B-lockup-reversed.svg", lockup_b(PAPER, INK, PAPER, PAPER, "", "Holler lockup (B) — reversed"))

    # ============================== concept C — echo H (web3 modern)
    put("svg/C-mark-color.svg", svg(1000, 1000, concept_c_mark("url(#echog)", GREEN), DEFS_DIAG, "Holler mark — echo H, full colour"))
    put("svg/C-mark-mono.svg", svg(1000, 1000, concept_c_mark(INK, INK), "", "Holler mark — echo H, single colour"))
    put("svg/C-mark-reversed.svg", svg(1000, 1000, concept_c_mark(PAPER, PAPER), "", "Holler mark — echo H, reversed"))

    def lockup_c(stroke, arc, word_fill, stops, label):
        wm, ww = wordmark(word_fill)
        s = 0.66
        wx = 660 + 120
        body = f'<g transform="translate(0,{int((1000 - 1000 * s) / 2)}) scale({s})">{concept_c_mark(stroke, arc)}</g>'
        body += f'<g transform="translate({wx},{int((1000 - CAP) / 2)})">{wm}</g>'
        d = DEFS_DIAG + word_defs(ww, stops) if word_fill.startswith("url") else DEFS_DIAG
        return svg(int(wx + ww + 90), 1000, body, d, label)

    put("svg/C-lockup-color.svg", lockup_c("url(#echog)", GREEN, "url(#wordg)", STOPS_TRIPLE, "Holler lockup (C) — full colour"))
    put("svg/C-lockup-mono.svg", lockup_c(INK, INK, INK, "", "Holler lockup (C) — single colour"))
    put("svg/C-lockup-reversed.svg", lockup_c(PAPER, PAPER, PAPER, "", "Holler lockup (C) — reversed"))

    # ============================== wordmark only (bonus: header/nav use)
    for tag, fill, stops in (
        ("color", "url(#wordg)", STOPS_TRIPLE),
        ("mono", INK, ""),
        ("reversed", PAPER, ""),
    ):
        wm, ww = wordmark(fill)
        d = word_defs(ww, stops) if fill.startswith("url") else ""
        doc = svg(int(ww + 4), int(CAP + 4), wm, d, f"Holler wordmark — {tag}")
        made.append(write(f"svg/A-wordmark-{tag}.svg", doc))

    # ============================== favicon / app icon
    for px in (64, 192, 512):
        name = "favicon/favicon.svg" if px == 64 else f"favicon/icon-{px}.svg"
        doc = svg(px, px, concept_a_mark("url(#tileg)", PAPER, YELLOW, compact=True), DEFS_DIAG, f"Holler app icon {px}")
        doc = doc.replace(f'viewBox="0 0 {px} {px}"', 'viewBox="0 0 1000 1000"')
        put(name, doc)

    return made


if __name__ == "__main__":
    files = build()
    print(f"wrote {len(files)} svg files")
    for f in files:
        print(" ", f.relative_to(OUT), f.stat().st_size)
