/* Smoke test: every page that sells something must load without a JS error and
 * open its unlock modal. Run after touching unlock.js / verify.js, because a
 * single broken page is a lost sale and a 404 nobody notices.
 *
 *   node tools/smoke-pages.cjs [--shots <dir>]
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("/Users/evgenijdanilov/.npm/_npx/13ab0715f9f30c2e/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8816;
const AGENT_OUT = path.resolve(process.env.HOME, "gemini/agent1_out");
const shotsArg = process.argv.indexOf("--shots");
const SHOTS = shotsArg === -1 ? path.join(AGENT_OUT, "screenshots") : process.argv[shotsArg + 1];

const PAGES = [
  ["home", "/index.html"],
  ["audio-dub", "/audio-dub-extractor/index.html"],
  ["studio", "/audio-dub-extractor/studio.html"],
  ["audio-tools", "/audio-tools/index.html"],
  ["live-radar", "/live-radar/index.html"],
  ["docsearch", "/docsearch/index.html"],
  ["tg-chats", "/tg-chats/index.html"],
  ["data-clipper", "/data-clipper/index.html"],
  ["base-tax-audit", "/base-tax-audit/index.html"],
  ["fee-audit", "/fee-audit/index.html"]
];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".zip": "application/zip",
  ".txt": "text/plain; charset=utf-8",
  ".enc": "application/octet-stream"
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let file = path.join(ROOT, url);
    if (file.endsWith("/")) file = path.join(file, "index.html");
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const size = fs.statSync(file).size;
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "content-length": String(size)
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(PORT, "127.0.0.1", () => r(server)));
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + extra : "")); }
};

/* No network here: the site is proxied so that stray RPC/CDN calls stay out of
   the error list, and only real page errors are reported. */
const IGNORE = /Failed to load resource|net::ERR|ERR_NAME_NOT_RESOLVED|net::ERR_INTERNET/i;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2, locale: "ru-RU" });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());

  for (const [name, url] of PAGES) {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e.message)));
    page.on("console", m => { if (m.type() === "error" && !IGNORE.test(m.text())) errors.push(m.text()); });

    let status = null;
    try {
      const res = await page.goto("http://127.0.0.1:" + PORT + url, { waitUntil: "load", timeout: 30000 });
      status = res && res.status();
    } catch (e) {
      ok(name + ": страница открылась", false, e.message.split("\n")[0]);
      await page.close();
      continue;
    }

    ok(name + ": HTTP 200", status === 200, status);
    const real = errors.filter(e => !IGNORE.test(e));
    ok(name + ": без JS-ошибок", real.length === 0, real.join(" | ").slice(0, 300));

    /* Pages with a pay/keys button must actually open the modal. */
    const hasTrigger = await page.evaluate(() =>
      !!(document.getElementById("key-cta") || document.getElementById("key-cta-at") ||
         document.querySelector("[data-key-cta]") || document.querySelector("[data-unlock]"))
    );
    if (hasTrigger) {
      const opened = await page.evaluate(() => {
        const el = document.getElementById("key-cta") || document.getElementById("key-cta-at") ||
          document.querySelector("[data-key-cta]") || document.querySelector("[data-unlock]");
        el.click();
        const modal = document.querySelector(".modal-backdrop");
        return { present: !!modal, visible: modal ? !modal.hidden : false, hasField: !!document.getElementById("unlock-hash") };
      });
      await page.waitForTimeout(200);
      ok(name + ": модалка открылась", opened.visible && opened.hasField, JSON.stringify(opened));
      const ph = await page.getAttribute("#unlock-hash", "placeholder").catch(() => null);
      ok(name + ": поле ждёт 0x… и TW1-…", !!ph && /0x/.test(ph) && /TW1/.test(ph), ph);
      await page.screenshot({ path: path.join(SHOTS, "smoke-" + name + ".png") });
    }
    await page.close();
  }

  await browser.close();
  server.close();
  console.log("\n" + pass + " ok, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
