/* End-to-end check of the offline TW1 licence in a real browser.
 *
 * Starts a static server on 127.0.0.1 (crypto.subtle needs a secure context,
 * and localhost counts as one), then proves four things:
 *   1. a real key from license_keys/opens Studio Pro in the site modal;
 *   2. the entitlement survives a reload and reaches studio.html;
 *   3. a tampered signature is refused with a readable error and sets nothing;
 *   4. a key for another product is refused as well.
 *
 *   node tools/e2e-license.cjs [--shots <dir>]
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("/Users/evgenijdanilov/.npm/_npx/13ab0715f9f30c2e/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8817;
const AGENT_OUT = path.resolve(process.env.HOME, "gemini/agent1_out");
const KEYS = path.join(AGENT_OUT, "license_keys");
const shotsArg = process.argv.indexOf("--shots");
const SHOTS = shotsArg === -1 ? path.join(AGENT_OUT, "screenshots") : process.argv[shotsArg + 1];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
  ".zip": "application/zip",
  ".txt": "text/plain; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8"
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let file = path.join(ROOT, url);
    if (file.endsWith("/")) file = path.join(file, "index.html");
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(PORT, "127.0.0.1", () => r(server)));
}

function keysOf(product) {
  const f = path.join(KEYS, product + ".txt");
  return fs.readFileSync(f, "utf8").split("\n").filter(l => l.startsWith("TW1-"));
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + extra : "")); }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2, locale: "ru-RU" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

  const BASE = "http://127.0.0.1:" + PORT;
  const home = BASE + "/audio-dub-extractor/index.html";
  await page.goto(home, { waitUntil: "load" });

  console.log("модалка");
  /* The buyer path, not the pay button: "Уже есть ключ TW1" must open the
     modal too, and its handler is bound on DOMContentLoaded because unlock.js
     is deferred. */
  await page.click("#key-cta");
  await page.waitForSelector(".modal-backdrop:not([hidden])", { timeout: 5000 });
  const placeholder = await page.getAttribute("#unlock-hash", "placeholder");
  ok("поле принимает оба формата", /0x/.test(placeholder) && /TW1/.test(placeholder), placeholder);
  ok("мертвых ссылок на Telegram нет", !(await page.content()).includes("Shop010_bot"));
  await page.screenshot({ path: path.join(SHOTS, "tw1-01-modal-empty.png") });

  console.log("валидный ключ");
  const good = keysOf("audio-dub-studio")[0];
  await page.fill("#unlock-hash", good);
  const t0 = Date.now();
  await page.click("#unlock-go");
  await page.waitForFunction(
    () => {
      try { return !!JSON.parse(localStorage.getItem("unlock:audio-dub-studio") || "null"); } catch (e) { return false; }
    },
    null,
    { timeout: 5000 }
  );
  const ms = Date.now() - t0;
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem("unlock:audio-dub-studio")));
  ok("Pro записан", !!rec && /^license:TW1-/.test(rec.hash), JSON.stringify(rec));
  ok("тип записи license", rec.kind === "license" && rec.code === "AUDIO", rec.code);
  ok("активация быстрее 1 с", ms < 1000, ms + " ms");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, "tw1-02-unlocked.png") });

  console.log("живучесть и Studio");
  await page.reload({ waitUntil: "load" });
  const afterReload = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("unlock:audio-dub-studio") || "null"); } catch (e) { return null; }
  });
  ok("лицензия пережила перезагрузку", !!afterReload);
  await page.goto(BASE + "/audio-dub-extractor/studio.html", { waitUntil: "load" });
  const pill = (await page.textContent("#mode-pill")).trim();
  ok("Studio показывает Pro", pill === "Pro", pill);
  await page.screenshot({ path: path.join(SHOTS, "tw1-03-studio-pro.png") });

  console.log("отказы");
  /* A separate context: localStorage is per origin, and the main context is
     already unlocked — a shared one would make the negative test meaningless. */
  const badCtx = await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2, locale: "ru-RU" });
  const bad = await badCtx.newPage();
  await bad.goto(home, { waitUntil: "load" });
  const tampered = good.slice(0, -1) + (good.slice(-1) === "A" ? "B" : "A");
  await bad.click('[data-unlock][data-product="audio-dub-studio"]');
  await bad.fill("#unlock-hash", tampered);
  await bad.click("#unlock-go");
  await bad.waitForSelector("#unlock-error:not([hidden])");
  const errText = (await bad.textContent("#unlock-error")).trim();
  ok("подпись не сходится -> понятная ошибка", /подпис/i.test(errText), errText);
  const leaked = await bad.evaluate(() => localStorage.getItem("unlock:audio-dub-studio"));
  ok("при отказе Pro не выдан", leaked === null, leaked);
  await bad.screenshot({ path: path.join(SHOTS, "tw1-04-bad-signature.png") });

  const other = keysOf("newsflow")[0];
  await bad.fill("#unlock-hash", other);
  await bad.click("#unlock-go");
  await bad.waitForFunction(() => {
    const el = document.getElementById("unlock-error");
    return el && !el.hidden && /продукт/i.test(el.textContent || "");
  }, null, { timeout: 5000 });
  ok("ключ другого продукта отклонен", true);

  const all = keysOf("all-in-one")[0];
  const uni = await badCtx.newPage();
  await uni.goto(home, { waitUntil: "load" });
  await uni.click('[data-unlock][data-product="audio-dub-studio"]');
  await uni.fill("#unlock-hash", all);
  await uni.click("#unlock-go");
  await uni.waitForFunction(() => !!localStorage.getItem("unlock:audio-dub-studio"), null, { timeout: 5000 });
  ok("универсальный ALL открывает Studio", true);

  console.log("старый путь 0x…");
  const legacy = await ctx.newPage();
  await legacy.goto(home, { waitUntil: "load" });
  await legacy.click('[data-unlock][data-product="audio-dub-studio"]');
  await legacy.fill("#unlock-hash", "0x" + "ab".repeat(32));
  await legacy.click("#unlock-go");
  await legacy.waitForSelector("#unlock-error:not([hidden])", { timeout: 20000 });
  const lerr = (await legacy.textContent("#unlock-error")).trim();
  ok("хеш все еще проверяется в Base (ошибка сети/чека, не падение)", lerr.length > 10, lerr.slice(0, 90));

  ok("нет JS-ошибок на странице", errors.filter(e => !/Failed to load|net::|RPC|fetch/i.test(e)).length === 0, errors.join(" | "));

  await browser.close();
  server.close();
  console.log("\n" + pass + " ok, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
