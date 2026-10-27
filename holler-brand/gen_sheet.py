#!/usr/bin/env python3
"""Builds the evidence artefacts: busy-frame test still, comparison sheet,
social banner and the mockup page. All rendered with headless Chrome."""
from __future__ import annotations

import pathlib
import subprocess
import tempfile

HERE = pathlib.Path(__file__).parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

INK = "#070b14"
AZURE = "#0a9bff"
MAGENTA = "#ff2bd6"
YELLOW = "#ffd60a"
GREEN = "#39ff6a"


def shot(html: str, out: pathlib.Path, w: int, h: int):
    with tempfile.TemporaryDirectory() as td:
        p = pathlib.Path(td) / "page.html"
        p.write_text(html, encoding="utf-8")
        (pathlib.Path(td) / "assets").symlink_to(HERE)
        try:
            p = pathlib.Path(td) / "page.html"
            p.write_text(html.replace("__BASE__", f"file://{td}/assets/"), encoding="utf-8")
        except Exception:
            pass
        subprocess.run(
            [
                CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                "--force-device-scale-factor=1", "--default-background-color=00000000",
                f"--window-size={w},{h}", f"--screenshot={out}", f"file://{p}",
            ],
            check=True,
            capture_output=True,
        )


# ---------------------------------------------------------------- busy still
def video_still() -> str:
    """A deliberately hostile background: bright, saturated, full of small
    competing elements (chat, kill feed, HUD), like a real stream frame."""
    import random
    random.seed(7)
    chat = []
    words = ["LFG", "clutch!!", "no way", "GG", "clip it", "2hp", "again", "LET'S GO",
             "insane", "peek left", "healing", "rotate", "KEKW", "one more"]
    colors = ["#ffffff", "#ffd60a", "#39ff6a", "#0a9bff", "#ff2bd6"]
    for i in range(14):
        chat.append(
            f'<text x="1180" y="{150 + i * 46}" font-size="22" font-weight="700" '
            f'fill="{random.choice(colors)}" opacity="{random.uniform(.65, .95):.2f}">'
            f'{random.choice(words)}</text>'
        )
    feed = "".join(
        f'<rect x="{i * 190 + 40}" y="780" width="170" height="56" rx="12" fill="#ffffff" opacity="0.14"/>'
        f'<circle cx="{i * 190 + 72}" cy="808" r="13" fill="{c}" opacity="0.9"/>'
        for i, c in enumerate(["#ff2bd6", "#0a9bff", "#39ff6a", "#ffd60a"])
    )
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#1a0f2e"/><stop offset="0.5" stop-color="#2a1140"/><stop offset="1" stop-color="#060810"/>
</linearGradient>
<linearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#0a9bff"/><stop offset="0.55" stop-color="#ff2bd6"/><stop offset="1" stop-color="#ffd60a"/>
</linearGradient>
</defs>
<rect width="1600" height="900" fill="url(#sky)"/>
<g opacity="0.55">
  <rect x="-120" y="180" width="900" height="120" fill="#ff2bd6" transform="rotate(-14 0 0)"/>
  <rect x="120" y="560" width="1200" height="90" fill="#0a9bff" transform="rotate(-14 0 0)"/>
  <rect x="700" y="-60" width="240" height="1000" fill="#39ff6a" opacity="0.55" transform="rotate(18 700 0)"/>
</g>
<g opacity="0.9">
  <path d="M300 720 L340 420 L420 330 L520 330 L600 420 L640 720 Z" fill="url(#hero)" opacity="0.9"/>
  <circle cx="470" cy="300" r="72" fill="#ffd60a"/>
  <rect x="250" y="180" width="440" height="26" rx="13" fill="#ff2b4a" opacity="0.85"/>
  <rect x="250" y="180" width="300" height="26" rx="13" fill="#39ff6a"/>
</g>
<g font-family="Helvetica Neue, Arial, sans-serif">
  <rect x="40" y="46" width="150" height="54" rx="27" fill="#ff2b4a"/>
  <circle cx="74" cy="73" r="9" fill="#fff"/><text x="94" y="81" font-size="26" font-weight="800" fill="#fff">LIVE</text>
  <text x="40" y="150" font-size="54" font-weight="800" fill="#fff" opacity="0.95">GRAND FINAL</text>
  <text x="40" y="196" font-size="26" fill="#fff" opacity="0.6">2 431 908 watching</text>
  <rect x="1150" y="70" width="410" height="740" rx="18" fill="#05070d" opacity="0.42"/>
  {''.join(chat)}
  <text x="480" y="620" font-size="120" font-weight="900" fill="#fff" opacity="0.18">CLUTCH</text>
</g>
{feed}
</svg>'''


# ---------------------------------------------------------------- sheet
def sheet(files: list[pathlib.Path]) -> str:
    base = "__BASE__"
    rows = []
    for f in files:
        rows.append(f"<tr><td>{f.as_posix().split('holler-brand/')[-1]}</td><td>{_kb(f)}</td></tr>")
    half = (len(rows) + 1) // 2
    left = "".join(rows[:half])
    right = "".join(rows[half:])

    def cell(src, w, label, style=""):
        return (
            f'<figure class="cell"><div class="art" style="{style}">'
            f'<img src="{base}{src}" style="width:{w}px"></div>'
            f'<figcaption>{label}</figcaption></figure>'
        )

    def band(bg, title, note, cells, fg, rule):
        return f'''<section class="band" style="background:{bg};color:{fg};border-color:{rule}">
  <div class="bhead"><h2>{title}</h2><span>{note}</span></div>
  <div class="row">{''.join(cells)}</div>
</section>'''

    light = band(
        "#ffffff", "Light surface", "acceptance sizes, colour mark + lockup", [
            cell("favicon/favicon.svg", 16, "mark 16 px (favicon cut)"),
            cell("svg/A-mark-color.svg", 32, "mark 32 px"),
            cell("svg/A-mark-color.svg", 48, "mark 48 px"),
            cell("svg/A-lockup-color.svg", 160, "lockup 160 px wide"),
            cell("svg/A-lockup-color.svg", 360, "lockup 360 px"),
        ], INK, "#e6e8ef")

    dark = band(
        "#070b14", "Dark surface", "reversed artwork on the product background", [
            cell("favicon/favicon.svg", 16, "mark 16 px (favicon cut)"),
            cell("svg/A-mark-reversed.svg", 32, "mark 32 px"),
            cell("svg/A-mark-reversed.svg", 48, "mark 48 px"),
            cell("svg/A-lockup-reversed.svg", 160, "lockup 160 px wide"),
            cell("svg/A-lockup-reversed.svg", 360, "lockup 360 px"),
        ], "#f4f6fb", "#1b2233")

    busy = f'''<section class="band busy" style="border-color:#e6e8ef">
  <img class="still" src="{base}assets/video-still.svg">
  <div class="overlay">
    <div class="bhead" style="color:#fff"><h2>Busy video background</h2><span>on top of a saturated, moving frame</span></div>
    <div class="row" style="position:relative">
      {cell("svg/A-mark-color.svg", 32, "mark 32 px")}
      {cell("svg/A-mark-color.svg", 80, "mark 80 px")}
      {cell("svg/A-lockup-color.svg", 210, "lockup 210 px")}
      {cell("svg/B-lockup-color.svg", 200, "alt B, 200 px")}
      {cell("svg/C-lockup-color.svg", 200, "alt C, 200 px")}
    </div>
  </div>
</section>'''

    alts = f'''<section class="band" style="background:#f5f6fa;color:{INK};border-color:#e2e5ee">
  <div class="bhead"><h2>Alternates</h2><span>concepts B and C, shown for range — A is the recommendation</span></div>
  <div class="row">
    {cell("svg/B-mark-color.svg", 88, "B mark")}
    {cell("svg/B-lockup-color.svg", 300, "B lockup")}
    {cell("svg/C-mark-color.svg", 88, "C mark")}
    {cell("svg/C-lockup-color.svg", 300, "C lockup")}
  </div>
</section>'''

    html = f'''<!doctype html><meta charset="utf-8">
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin:0; background:#fff; color:{INK};
         font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; }}
  .sheet {{ width:1600px; }}
  header {{ padding:56px 64px 40px; border-bottom:1px solid #e6e8ef; display:flex; align-items:flex-end; justify-content:space-between; }}
  header h1 {{ margin:0; font-size:44px; letter-spacing:-1.5px; }}
  header p {{ margin:8px 0 0; font-size:17px; color:#5a6172; }}
  .stamp {{ font-size:13px; color:#5a6172; text-align:right; line-height:1.7; }}
  .band {{ padding:34px 64px 26px; border-bottom:1px solid; }}
  .band.busy {{ position:relative; padding:0; height:420px; overflow:hidden; }}
  .still {{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }}
  .overlay {{ position:absolute; inset:0; padding:34px 64px; background:linear-gradient(180deg, rgba(4,6,12,.30), rgba(4,6,12,.62)); }}
  .busy figcaption {{ opacity:1; background:rgba(0,0,0,.62); color:#fff; display:inline-block;\n      padding:5px 9px; border-radius:6px; }}
  .busy .row {{ gap:46px; }}
  .bhead {{ display:flex; align-items:baseline; gap:18px; margin-bottom:26px; }}
  .bhead h2 {{ margin:0; font-size:22px; letter-spacing:-.3px; }}
  .bhead span {{ font-size:14px; opacity:.62; }}
  .row {{ display:flex; align-items:flex-end; gap:56px; min-height:190px; }}
  .cell {{ margin:0; }}
  .art {{ display:flex; align-items:flex-end; justify-content:flex-start; min-height:74px; }}
  .art img {{ display:block; }}
  figcaption {{ margin-top:12px; font-size:12px; letter-spacing:.3px; text-transform:uppercase; opacity:.55; }}
  .files {{ padding:34px 64px 48px; }}
  .cols {{ display:flex; gap:64px; }}
  table {{ border-collapse:collapse; font-size:13px; width:50%; }}
  td {{ padding:5px 0; border-bottom:1px solid #eef0f6; color:#3a4152; }}
  td:last-child {{ text-align:right; color:#8a90a0; width:80px; }}
  h2.ft {{ font-size:22px; margin:0 0 20px; }}
</style>
<div class="sheet">
<header>
  <div>
    <h1>Holler — logo system</h1>
    <p>Primary lockup + standalone mark. Evidence sheet: acceptance sizes, surfaces, states.</p>
  </div>
  <div class="stamp">all artwork drawn as vector paths<br>no fonts, no stock, no templates<br>rev A · 2026-10-27</div>
</header>
{light}
{dark}
{busy}
{alts}
<section class="files">
  <h2 class="ft">File list ({len(files)} vector + raster files)</h2>
  <div class="cols">
    <table>{left}</table>
    <table>{right}</table>
  </div>
</section>
</div>'''
    return html


def _kb(p: pathlib.Path) -> str:
    n = p.stat().st_size
    return f"{n / 1024:.1f} KB" if n > 1024 else f"{n} B"


def collect() -> list[pathlib.Path]:
    out = []
    for sub in ("svg", "favicon", "png/512", "png/1024", "png/2048"):
        out += sorted((HERE / sub).glob("*"))
    return out


def main():
    files = collect()
    still = video_still()
    (HERE / "assets").mkdir(exist_ok=True)
    (HERE / "assets" / "video-still.svg").write_text(still, encoding="utf-8")

    # sheet height is fixed by layout; verified visually after render
    h = 170 + 300 + 330 + 420 + 300 + 60 + 26 * ((len(files) + 1) // 2) + 110
    shot(sheet(files), HERE / "sheet.png", 1600, h)
    print("sheet.png", h)

    banner = f'''<!doctype html><meta charset="utf-8">
<style>html,body{{margin:0}} .b{{width:1500px;height:500px;background:
radial-gradient(900px 500px at 88% 12%, {MAGENTA}55, transparent 60%),
radial-gradient(700px 420px at 4% 96%, {AZURE}44, transparent 60%), {INK};
display:flex;align-items:center;justify-content:space-between;padding:0 84px;overflow:hidden;
font-family:-apple-system,"Helvetica Neue",Arial,sans-serif}}
.b img{{width:760px}}
.tag{{color:#fff;text-align:right;font-size:30px;line-height:1.25;letter-spacing:-.4px}}
.tag b{{display:block;font-size:15px;letter-spacing:2.6px;color:{YELLOW};margin-bottom:14px}}</style>
<div class="b"><img src="__BASE__svg/A-lockup-reversed.svg">
<div class="tag"><b>INTERNET FAN CULTURE</b>the loudest voice<br>in the crowd</div></div>'''
    shot(banner, HERE / "banner-1500x500.png", 1500, 500)
    print("banner done")


if __name__ == "__main__":
    main()
