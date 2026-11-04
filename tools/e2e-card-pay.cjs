/* End-to-end check of the rouble cash desk: the "card / SBP" path.
 *
 * Two things have to be true for a buyer from Russia, and both are checked in a
 * real browser against the same files the site ships:
 *
 *   1. next to the USDC one-click there is a card button whose href is the live
 *      Plati.Market checkout for the right listing, and whose label carries the
 *      rouble price that checkout actually charges;
 *   2. a key from the shop stock — the same file the auto-delivery uploads from —
 *      unlocks that very page, and a key for another product does not.
 *
 * The four products have two different checkout UIs (a shared modal and two
 * page-specific ones), so each case carries its own open/submit selectors.
 *
 *   node tools/e2e-card-pay.cjs [--shots <dir>]
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("/Users/evgenijdanilov/.npm/_npx/13ab0715f9f30c2e/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8823;
const AGENT_OUT = path.resolve(process.env.HOME, "gemini/agent1_out");
const KEYS = path.join(AGENT_OUT, "license_keys");
const shotsArg = process.argv.indexOf("--shots");
const SHOTS = shotsArg === -1 ? path.join(AGENT_OUT, "screenshots") : process.argv[shotsArg + 1];

/* Must match CARD_SHOP in assets/unlock.js and the live listings. */
const CASES = [
  {
    page: "audio-dub-extractor", product: "audio-dub-studio", id: 6354599, rub: 299,
    keys: "audio-dub-studio", code: "AUDIO",
    open: '[data-unlock][data-product="audio-dub-studio"]',
    card: "#unlock-card", cardLabel: "#unlock-card-label", cardHint: "#unlock-card-hint",
    field: "#unlock-hash", submit: "#unlock-go", error: "#unlock-error",
    storage: "unlock:audio-dub-studio"
  },
  {
    page: "tg-chats", product: "tgchats", id: 6354600, rub: 490,
    keys: "tg-chats", code: "TG",
    open: '[data-unlock][data-product="tgchats"]',
    card: "#unlock-card", cardLabel: "#unlock-card-label", cardHint: "#unlock-card-hint",
    field: "#unlock-hash", submit: "#unlock-go", error: "#unlock-error",
    storage: "unlock:tg-chats"
  },
  {
    page: "docsearch", product: "archive-studio", id: 6354601, rub: 690,
    keys: "docsearch", code: "DOC",
    open: "#proBtn", card: "#payCard", cardLabel: "#payCard span", cardHint: "#payCardHint",
    field: "#txHash", submit: "#verifyBtn", error: "#payStatus",
    storage: "archive-studio:pro"
  },
  {
    page: "data-clipper", product: "data-clipper", id: 6354602, rub: 390,
    keys: "data-clipper", code: "CLIP",
    open: null, card: "#pay-card", cardLabel: "#pay-card span", cardHint: null,
    field: "#key-in", submit: "#buy-verify-key", error: "#tx-status",
    storage: "unlock:data-clipper"
  }
];

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json",
  ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp3": "audio/mpeg",
  ".zip": "application/zip", ".txt": "text/plain; charset=utf-8",
  ".enc": "application/octet-stream", ".ico": "image/x-icon"
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

function keysOf(name) {
  return fs.readFileSync(path.join(KEYS, name + ".txt"), "utf8")
    .split("\n").filter(l => l.startsWith("TW1-"));
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + extra : "")); }
}

/* The label must print the price the cash desk actually charges, so the
   expected value comes from the generated shop file, not from a constant. */
const SHOP = (() => {
  try {
    const src = fs.readFileSync(path.join(ROOT, "assets", "shop.js"), "utf8");
    return JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));
  } catch (e) { return null; }
})();
function liveRub(c) {
  const alias = { tgchats: "tg-chats", "archive-studio": "docsearch" };
  const slug = alias[c.product] || c.product;
  const entry = SHOP && SHOP.products ? SHOP.products[slug] : null;
  const rub = entry && Number(entry.price_rub) ? Number(entry.price_rub) : c.rub;
  /* The cash desk may charge kopecks while the label prints whole rubles,
     so both spellings of the same live price are acceptable. */
  const forms = [Number.isInteger(rub) ? String(rub) : rub.toFixed(2)];
  const rounded = String(Math.round(rub));
  if (!forms.includes(rounded)) forms.push(rounded);
  return forms;
}

async function unlocked(ctx, storage) {
  return ctx.pages()[0].evaluate(k => localStorage.getItem(k), storage).catch(() => null);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const BASE = "http://127.0.0.1:" + PORT;

  for (const c of CASES) {
    console.log("\n" + c.page + "  (listing " + c.id + ", " + c.rub + " ₽)");
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 950 }, deviceScaleFactor: 2, locale: "ru-RU" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e.message)));

    await page.goto(`${BASE}/${c.page}/index.html`, { waitUntil: "load" });
    if (c.open) await page.click(c.open);
    await page.waitForSelector(c.card, { state: "visible", timeout: 15000 });

    const href = await page.getAttribute(c.card, "href");
    ok("кнопка карты видна рядом с однокликом",
      href === `https://oplata.info/asp2/pay_wm.asp?id_d=${c.id}&ai=1481449&lang=ru-RU`, href);
    const label = (await page.textContent(c.cardLabel)).trim();
    ok("в подписи ровно та цена, что берёт касса", liveRub(c).some(v => label.includes(v + " ₽")), label);
    if (c.cardHint) {
      const hint = (await page.textContent(c.cardHint)).trim();
      ok("подсказка про автоматическую выдачу ключа", /ключ/i.test(hint) && /TW1|автомат/i.test(hint), hint.slice(0, 80));
    }
    await page.screenshot({ path: path.join(SHOTS, `card-${c.page}.png`) });

    /* First line of the file the stock upload reads = a key a buyer can receive. */
    const key = keysOf(c.keys)[0];
    await page.fill(c.field, key);
    await page.click(c.submit);
    await page.waitForFunction(
      k => !!localStorage.getItem(k), c.storage, { timeout: 8000 }
    ).catch(() => {});
    const rec = await page.evaluate(k => localStorage.getItem(k), c.storage);
    ok("ключ из стока открывает этот продукт",
      !!rec && (c.page === "docsearch" ? rec === "1" : /license:TW1-/.test(rec)),
      String(rec).slice(0, 90));

    /* A key for another product must not open this page. */
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "load" });
    if (c.open) await page.click(c.open);
    await page.waitForSelector(c.card, { state: "visible", timeout: 15000 });
    const other = CASES.find(x => x.code !== c.code).keys;
    await page.fill(c.field, keysOf(other)[0]);
    await page.click(c.submit);
    await page.waitForTimeout(1200);
    const err = (await page.textContent(c.error)).trim();
    ok("чужой ключ отклонён с внятной причиной", /продукт|подпис/i.test(err), err.slice(0, 90));
    const after = await page.evaluate(k => localStorage.getItem(k), c.storage);
    ok("после отказа Pro не выдан", !after || after === "null", String(after));
    ok("нет JS-ошибок", errors.filter(e => !/Failed to load|net::|RPC|fetch/i.test(e)).length === 0,
      errors.join(" | "));

    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log("\n" + pass + " ok, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
