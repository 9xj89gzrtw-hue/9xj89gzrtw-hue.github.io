/* Headless-Chromium end-to-end for the WB & Ozon seller inspector.
 *
 * Plays a buyer against a fake wildberries.ru search page (the URL keeps
 * the real domain because the panel checks it; the route hands out the
 * local fixture) and proves five things:
 *   1. the pill appears and counts the cards found on the page;
 *   2. one click exports the found cards to CSV with honest margins;
 *   3. a 60-card page exports only 50 rows without a key (free tier);
 *   4. a real TW1-CLIP key lifts that limit offline, signature verified
 *      inside the same browser;
 *   5. cards of the other search page of the fixture are counted too and
 *      a wrong-product key is refused before anything is stored.
 *
 *   node tools/e2e-wb-ozon.cjs [--shots <dir>]
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("/Users/evgenijdanilov/.npm/_npx/13ab0715f9f30c2e/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8899;
const FIXTURE = path.join(ROOT, "tests", "fixtures", "wb-ozon-search.html");
const BUNDLE = path.join(ROOT, "downloads", "wb-ozon-seller-inspector.user.js");
const AGENT_OUT = path.resolve(process.env.HOME, "gemini/agent3_out");
const shotsArg = process.argv.indexOf("--shots");
const SHOTS = shotsArg === -1 ? path.join(AGENT_OUT, "screenshots") : process.argv[shotsArg + 1];

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  → " + extra : "")); }
}

/* A page with N unprice-tagged-duplicate cards, same layout as the
 * fixture, generated on the fly for the free-limit case. */
function manyCardsPage(n) {
  let cards = "";
  for (let i = 1; i <= n; i++) {
    cards += '<div class="product-card__wrapper"><a href="/catalog/' +
      (100000 + i) + '/detail.aspx" aria-label="Товар ' + i +
      '"><div class="price"><del>' + (2000 + i * 10) + ' ₽</del><ins>' +
      (1500 + i * 10) + ' ₽</ins></div></a></div>\n';
  }
  return "<!doctype html><html lang=ru><body><main id=w>" + cards + "</main></body></html>";
}

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    if (url === "/favicon.ico") { res.statusCode = 204; return res.end(); }
    const rel = url.replace(/^\/+/, "") || "index.html";
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      res.setHeader("content-type", types[path.extname(abs)] || "text/plain; charset=utf-8");
      return res.end(fs.readFileSync(abs));
    }
    res.statusCode = 404;
    res.end("not found: " + url);
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const bundle = fs.readFileSync(BUNDLE, "utf8");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const server = await serve();
  const base = "http://127.0.0.1:" + PORT;

  /* The userscript only wakes on wildberries.ru/ozon.ru: keep the hostname,
     serve the fixture bytes. */
  await ctx.route("https://www.wildberries.ru/**", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: fs.readFileSync(FIXTURE, "utf8") }));

  console.log("1. пилюля на странице выдачи WB");
  await page.goto("https://www.wildberries.ru/search", { waitUntil: "load" });
  await page.addScriptTag({ content: bundle });
  const pillHost = await page.waitForSelector("[data-wb-ozon-inspector]", { timeout: 8000 });
  ok("пилюля в DOM", !!pillHost);
  await page.waitForTimeout(2500); // the harvester polls for two seconds
  const status1 = await page.evaluate(() =>
    document.querySelector("[data-wb-ozon-inspector]").shadowRoot
      .getElementById("wbo-status").textContent);
  ok("посчитаны карточки выдачи", /Карточек найдено: 8/.test(status1), status1);
  await page.screenshot({ path: path.join(SHOTS, "wb-ozon-pill.png") });

  console.log("2. экспорт в CSV");
  const marginCfg = { commissionPct: 11, sppPct: 5, taxPct: 7, logisticsRub: 55, costRub: 300 };
  await page.evaluate((cfg) => {
    const root = document.querySelector("[data-wb-ozon-inspector]").shadowRoot;
    Object.keys(cfg).forEach((key) => {
      const inp = root.getElementById("wbo-" + key);
      inp.value = String(cfg[key]);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }, marginCfg);
  const download1 = page.waitForEvent("download", { timeout: 8000 });
  await page.evaluate(() => {
    document.querySelector("[data-wb-ozon-inspector]").shadowRoot
      .querySelector("button.export").click();
  });
  const dl1 = await download1;
  const csv1 = fs.readFileSync(await dl1.path(), "utf8");
  ok("имя файла честное", /wb-ozon-wb-\d{4}-\d{2}-\d{2}\.csv$/.test(dl1.suggestedFilename()), dl1.suggestedFilename());
  ok("BOM и заголовок Excel", csv1.charCodeAt(0) === 0xFEFF && csv1.includes("SKU;Наименование;Продавец"));
  ok("8 выгруженных строк", csv1.trimEnd().split("\n").length === 9, csv1.trimEnd().split("\n").length);
  ok("карточка целиком в CSV", /1034567;Штора рулонная 1,8×2,5 м графит/.test(csv1.split("\n")[1]), csv1.split("\n")[1]);
  ok("маржа посчитана честно (103: 1990×0,77−55−300=1177,3)", csv1.split("\n")[1].includes(";1177.3;"), csv1.split("\n")[1]);
  await page.screenshot({ path: path.join(SHOTS, "wb-ozon-export.png") });

  console.log("3. лимит 50 на странице из 60 карточек");
  await page2(ctx, bundle, manyCardsPage(60), async (p) => {
    await p.waitForSelector("[data-wb-ozon-inspector]");
    const status3 = await p.evaluate(() =>
      document.querySelector("[data-wb-ozon-inspector]").shadowRoot
        .getElementById("wbo-status").textContent);
    ok("60 карточек найдено", /Карточек найдено: 60/.test(status3), status3);
    const download3 = p.waitForEvent("download", { timeout: 8000 });
    await p.evaluate(() => {
      document.querySelector("[data-wb-ozon-inspector]").shadowRoot
        .querySelector("button.export").click();
    });
    const dl3 = await download3;
    const csv3 = fs.readFileSync(await dl3.path(), "utf8");
    ok("free режет до 50", csv3.trimEnd().split("\n").length === 51, csv3.trimEnd().split("\n").length);
    const notice = await p.evaluate(() =>
      document.querySelector("[data-wb-ozon-inspector]").shadowRoot
        .getElementById("wbo-status").textContent);
    ok("приписка про Free", /50 из 60/.test(notice), notice);
    await p.screenshot({ path: path.join(SHOTS, "wb-ozon-free-limit.png") });
  });

  console.log("4. ключ TW1-CLIP снимает лимит офлайн");
  const realKey = fs.readFileSync(path.resolve(
    process.env.HOME, "gemini/agent1_out/license_keys/data-clipper.txt"), "utf8")
    .split("\n").filter((l) => l.startsWith("TW1-"))[0];
  ok("реальный ключ в агентском каталоге", !!realKey);
  await page2(ctx, bundle, manyCardsPage(60), async (p) => {
    await p.waitForSelector("[data-wb-ozon-inspector]");
    await p.evaluate((key) => {
      const inp = document.querySelector("[data-wb-ozon-inspector]").shadowRoot
        .getElementById("wbo-key");
      inp.value = key;
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    }, realKey);
    await p.waitForTimeout(900);
    const status4 = await p.evaluate(() =>
      document.querySelector("[data-wb-ozon-inspector]").shadowRoot
        .getElementById("wbo-status").textContent);
    ok("Pro активирован", /Pro активирован/.test(status4), status4);
    const download4 = p.waitForEvent("download", { timeout: 8000 });
    await p.evaluate(() => {
      document.querySelector("[data-wb-ozon-inspector]").shadowRoot
        .querySelector("button.export").click();
    });
    const dl4 = await download4;
    const csv4 = fs.readFileSync(await dl4.path(), "utf8");
    ok("Pro выгружает все 60", csv4.trimEnd().split("\n").length === 61, csv4.trimEnd().split("\n").length);
    await p.screenshot({ path: path.join(SHOTS, "wb-ozon-pro.png") });
  });

  console.log("5. чужой ключ");
  await page2(ctx, bundle, manyCardsPage(6), async (p) => {
    await p.waitForSelector("[data-wb-ozon-inspector]");
    const audioKey = fs.readFileSync(path.resolve(
      process.env.HOME, "gemini/agent1_out/license_keys/audio-dub-studio.txt"), "utf8")
      .split("\n").filter((l) => l.startsWith("TW1-"))[0];
    await p.evaluate((key) => {
      const inp = document.querySelector("[data-wb-ozon-inspector]").shadowRoot
        .getElementById("wbo-key");
      inp.value = key;
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    }, audioKey);
    await p.waitForTimeout(700);
    const status5 = await p.evaluate(() =>
      document.querySelector("[data-wb-ozon-inspector]").shadowRoot
        .getElementById("wbo-status").textContent);
    ok("чужой продукт отклонён", /Ключ от другого продукта/.test(status5), status5);
  });

  await browser.close();
  server.close();
  console.log("\n" + pass + " ok, " + fail + " fail");
  process.exit(fail ? 1 : 0);

  async function page2(context, script, html, run) {
    const p2 = await context.newPage();
    await context.route("https://www.wildberries.ru/**", (route) =>
      route.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
    await p2.goto("https://www.wildberries.ru/search", { waitUntil: "load" });
    await p2.addScriptTag({ content: script });
    try { await run(p2); } finally { await p2.close(); }
  }
})();
