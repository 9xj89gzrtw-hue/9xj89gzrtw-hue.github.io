#!/usr/bin/env node
/* Build downloads/algo-tycoon-itch-web.zip — a standalone HTML5 upload.
 *
 * itch.io and any static host expect index.html at the zip root, with assets
 * next to it. So the page is copied with `../assets/` rewritten to `assets/`,
 * the dev test harness is dropped, and only the files the page actually uses
 * go in. The Pro button, the TW1-ALGO/TW1-ALL key check and the card link are
 * the same code as the live site, so the zip cannot drift from it.
 *
 *   node tools/build-itch-zip.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "algo-tycoon");
const STAGE = path.join(ROOT, "build", "itch", "algo-tycoon");
const OUT = path.join(ROOT, "downloads", "algo-tycoon-itch-web.zip");

const ASSETS = ["verify.js", "unlock.js", "shop.js", "preview.js", "mark.svg"];

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, "assets"), { recursive: true });
fs.mkdirSync(path.join(STAGE, "js"), { recursive: true });

let html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
const before = html;
html = html
  .replaceAll("../assets/", "assets/")
  .replace('href="../"', 'href="https://9xj89gzrtw-hue.github.io/"')
  .replace(/\s*<script src="tests\.js" defer><\/script>/, "");
if (html === before) throw new Error("index.html: nothing was rewritten — check the paths");
fs.writeFileSync(path.join(STAGE, "index.html"), html, "utf8");

fs.copyFileSync(path.join(SRC, "style.css"), path.join(STAGE, "style.css"));

for (const f of fs.readdirSync(path.join(SRC, "js"))) {
  if (!f.endsWith(".js")) continue;
  fs.copyFileSync(path.join(SRC, "js", f), path.join(STAGE, "js", f));
}
for (const f of ASSETS) {
  const src = path.join(ROOT, "assets", f);
  if (!fs.existsSync(src)) throw new Error("missing asset: " + src);
  fs.copyFileSync(src, path.join(STAGE, "assets", f));
}

fs.writeFileSync(
  path.join(STAGE, "README.txt"),
  [
    "AI & Market Tycoon — standalone browser build",
    "",
    "Open index.html in any modern browser, or upload this zip to itch.io",
    "(Kind: HTML, \"This file will be played in the browser\").",
    "",
    "Start: 1 000 RUB and one server rack. Take orders in one click, buy racks,",
    "grow from freelance to the quantum cluster.",
    "Free: chapters 1-2 (16 orders, 4 upgrades, reputation).",
    "Pro: chapter 3 \"Wall Street & Quantum Cluster\", $1 000 000 sandbox,",
    "x5/x10 speed, crisis constructor and a report export.",
    "Unlock with a TW1-ALGO-... or TW1-ALL-... key, or buy by card/SBP:",
    "https://plati.market/itm/algo-tycoon-pro-algo-trading-and-pipeline-simulator-with-sandbox/6365339",
    "",
    "No network calls, no telemetry, progress stays in localStorage.",
    ""
  ].join("\n"),
  "utf8"
);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
/* itch.io wants index.html at the zip root, not inside a folder. */
execFileSync("zip", ["-r", "-X", "-q", OUT, "."], { cwd: STAGE });

const stat = fs.statSync(OUT);
console.log("zip         " + path.relative(ROOT, OUT) + "  " + (stat.size / 1024).toFixed(1) + " KB");
const listing = execFileSync("unzip", ["-l", OUT]).toString().split("\n").slice(3, -2);
console.log(listing.join("\n"));
