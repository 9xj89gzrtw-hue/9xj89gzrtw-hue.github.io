/* e2e-unitcalc.cjs — runs the data-clipper in-page battery (?test=1) headless
 * via Playwright and exits non-zero on any failed assertion.
 *
 *   node tools/e2e-unitcalc.cjs
 */
const http = require("http");
const path = require("path");
const fs = require("fs");
const { chromium } = require("/Users/evgenijdanilov/.npm/_npx/13ab0715f9f30c2e/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8857;

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".zip": "application/zip", ".md": "text/markdown"
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const filePath = path.join(ROOT, urlPath);
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end("nf"); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/data-clipper/index.html?test=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__RESULTS__, null, { timeout: 60000 });
  const r = await page.evaluate(() => window.__RESULTS__);
  console.log(`assertions: ${r.total} · passed: ${r.passed} · failed: ${r.failed} · ${r.durationMs}ms`);
  if (r.failed) {
    r.cases.filter((c) => !c.ok).forEach((c) => console.log("FAIL:", c.msg));
  }
  const uc = await page.evaluate(() => window.__UNITCALC__ || null);
  console.log("window.__UNITCALC__:", uc ? "present" : "MISSING");
  const shot = path.join(ROOT, "..", "screenshots");
  fs.mkdirSync(path.join(shot), { recursive: true });
  await page.screenshot({ path: path.join(shot, "unitcalc-tests.png"), fullPage: false });
  await browser.close();
  server.close();
  if (errors.length) console.log("page errors:", errors.slice(0, 5));
  process.exit(r.failed || errors.length ? 1 : 0);
})().catch((e) => { console.error("harness error:", e); process.exit(1); });
