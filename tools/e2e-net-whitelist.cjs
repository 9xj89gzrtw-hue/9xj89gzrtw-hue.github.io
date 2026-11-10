/* End-to-end check of /net-whitelist/ — the SNI white-list page.
 *
 * What a buyer must get, checked in a real browser against shipped files:
 *
 *   1. the page opens clean, renders the 25 demo domains and opens the pay modal;
 *   2. the free tester really measures the demo nodes from the browser
 *      (requests intercepted here, so the test is offline and deterministic);
 *   3. the local generator swaps in a new SNI without any network request;
 *   4. a TG Pro key with &pack=sni-whitelist&download=xlsx unlocks Pro,
 *      decrypts sni-pack.json.enc and downloads sni-whitelist-500-rf-nov2026.xlsx;
 *   5. a key for another product does NOT unlock the pack and downloads nothing.
 *
 *   node tools/e2e-net-whitelist.cjs [--shots <dir>]
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("/Users/evgenijdanilov/.npm/_npx/13ab0715f9f30c2e/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8824;
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
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".enc": "application/octet-stream"
};

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + extra : "")); }
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
      "content-length": String(fs.statSync(file).size)
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(PORT, "127.0.0.1", () => r(server)));
}

function keysOf(product) {
  return fs.readFileSync(path.join(KEYS, product + ".txt"), "utf8").split("\n").filter(l => l.startsWith("TW1-"));
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const BASE = "http://127.0.0.1:" + PORT;
  const TG_KEY = keysOf("tg-chats")[0];
  const NEWS_KEY = keysOf("newsflow")[0];

  /* ---------- 1: clean page, 25 demo rows, pay modal ---------- */
  console.log("\n1. страница и бесплатная выжимка");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, deviceScaleFactor: 2, locale: "ru-RU", acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    const external = [];
    page.on("pageerror", e => errors.push(String(e.message)));
    page.on("request", r => { if (!r.url().startsWith(BASE)) external.push(r.url()); });
    await page.goto(`${BASE}/net-whitelist/index.html`, { waitUntil: "load" });
    ok("HTTP 200 и без JS-ошибок", errors.length === 0, errors.join(" | ").slice(0, 300));

    const meta = await page.evaluate(() => window.SNI_META || {});
    ok("мета базы: 1 369 доменов", Number(meta.total) >= 500, JSON.stringify(meta.total));
    const rows = await page.$$eval("#tbl-body tr", els => els.length);
    ok("в таблице 25 демо-доменов", rows === 25, rows);
    const opts = await page.$$eval("#filter-cat option", els => els.map(e => e.textContent));
    ok("фильтр категорий собран из базы", opts.length > 3 && opts[0] === "Все", opts.join(","));
    ok("на загрузке нет внешних запросов", external.length === 0, external.slice(0, 3).join(" | "));

    await page.click('[data-unlock][data-product="sni-whitelist"]');
    const modal = await page.evaluate(() => {
      const m = document.querySelector(".modal-backdrop");
      return { present: !!m, visible: m ? !m.hidden : false, field: !!document.getElementById("unlock-hash") };
    });
    ok("модалка оплаты открылась", modal.visible && modal.field, JSON.stringify(modal));
    const cardVisible = await page.isVisible("#unlock-card").catch(() => false);
    ok("карта РФ скрыта: лот Digiseller ещё не заведён", cardVisible === false, String(cardVisible));
    ok("50 профилей спрятаны до оплаты", (await page.isVisible("#btn-batch").catch(() => false)) === false);
    await page.screenshot({ path: path.join(SHOTS, "net-whitelist-free.png") });
    await ctx.close();
  }

  /* ---------- 2: live tester, offline interception ---------- */
  console.log("\n2. живой тестер из браузера");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, deviceScaleFactor: 2, locale: "ru-RU" });
    const page = await ctx.newPage();
    let probed = 0;
    await page.route(/^https:\/\/[^/]+\/favicon\.ico\?snit=/, route => {
      probed++;
      const host = new URL(route.request().url()).host;
      /* first three answer instantly, the rest are slower, all answer */
      const delay = ["nalog.gov.ru", "mos.ru", "sberbank.ru"].includes(host) ? 5 : 120;
      setTimeout(() => route.fulfill({ status: 200, contentType: "image/x-icon", body: "" }), delay);
    });
    await page.goto(`${BASE}/net-whitelist/index.html`, { waitUntil: "load" });
    await page.click("#run-tester");
    await page.waitForFunction(() => /Отвечают/.test(document.querySelector("#tester-status").textContent), null, { timeout: 15000 });
    const status = (await page.textContent("#tester-status")).trim();
    ok("тестер опросил все 25 доменов", probed === 25, probed);
    ok("отчёт: отвечают 25/25", /Отвечают\s*25\/25/.test(status.replace(/\s+/g, " ")), status.replace(/\s+/g, " ").slice(0, 120));
    const cells = await page.$$eval("#tbl-body tr", els => els.map(tr => tr.textContent));
    ok("в строках появились миллисекунды", cells.every(t => /\d+\s*ms|нет ответа/.test(t)) && cells.some(t => /\d+\s*ms/.test(t)));
    await page.screenshot({ path: path.join(SHOTS, "net-whitelist-tester.png") });
    await ctx.close();
  }

  /* ---------- 3: local VLESS build with a new SNI, no network ---------- */
  console.log("\n3. генератор VLESS без сети");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, deviceScaleFactor: 2, locale: "ru-RU" });
    const page = await ctx.newPage();
    const requests = [];
    page.on("request", r => { if (!r.url().startsWith(BASE) && !r.url().startsWith("data:")) requests.push(r.url()); });
    await page.goto(`${BASE}/net-whitelist/index.html`, { waitUntil: "load" });
    const before = requests.length;
    await page.fill("#gen-input", "vless://11111111-2222-3333-4444-555555555555@edge.example.net:443?type=tcp&security=reality&pbk=pubkey123&sid=ab12#old-tag");
    await page.selectOption("#gen-sni", "sberbank.ru");
    await page.click("#gen-run");
    const link = (await page.textContent("#out-link")).trim();
    ok("ссылка собрана", /^vless:\/\/11111111-2222-3333-4444-555555555555@edge\.example\.net:443\?/.test(link), link.slice(0, 90));
    ok("SNI подставлен: sni=sberbank.ru", /[?&]sni=sberbank\.ru(&|$)/.test(link), link);
    ok("host совпадает с SNI", /[?&]host=sberbank\.ru(&|$)/.test(link), link);
    ok("Reality-ключ и fp сохранены", /pbk=pubkey123/.test(link) && /fp=chrome/.test(link) && /security=reality/.test(link), link);
    ok("новый тег = SNI", /#sberbank\.ru-tlsv13-h2$/.test(link), link);
    ok("QR и файл появились", await page.isVisible("#qr-holder svg") && await page.isVisible("#dl-link"));
    ok("генератор не ходил в сеть", requests.length === before, requests.slice(0, 3).join(" | "));
    await page.screenshot({ path: path.join(SHOTS, "net-whitelist-generator.png") });
    await ctx.close();
  }

  /* ---------- 4: TG key + pack=sni-whitelist&download=xlsx ---------- */
  console.log("\n4. чек-ссылка открывает Pro и качает Excel");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, deviceScaleFactor: 2, locale: "ru-RU", acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e.message)));
    const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
    await page.goto(`${BASE}/net-whitelist/index.html?key=${encodeURIComponent(TG_KEY)}&pack=sni-whitelist&download=xlsx`, { waitUntil: "load" });
    const download = await downloadPromise;
    ok("файл называется sni-whitelist-500-rf-nov2026.xlsx", download.suggestedFilename() === "sni-whitelist-500-rf-nov2026.xlsx", download.suggestedFilename());
    const state = await page.evaluate(() => ({
      pro: window.Unlock.isPro("sni-whitelist"),
      loaded: window.SNIPack.isLoaded()
    }));
    ok("ключ TW1-TG открыл SNI Pro", state.pro === true, JSON.stringify(state));
    ok("пакет расшифрован в браузере", state.loaded === true, JSON.stringify(state));
    const pack = await page.evaluate(() => window.SNIPack.get());
    const total = pack ? pack.total || (pack.domains || []).length : 0;
    ok("в расшифрованном пакете ≥ 500 доменов", total >= 500, total);
    const status = (await page.textContent("#pro-status")).trim();
    ok("на странице подтверждение Pro", /открыта|открыт/i.test(status), status.slice(0, 100));
    ok("без JS-ошибок на чек-ссылке", errors.length === 0, errors.join(" | ").slice(0, 300));

    /* 50 reserve profiles: one buyer key, 50 different white SNI. */
    await page.fill("#gen-input", "vless://99999999-8888-7777-6666-555555555555@edge.example.org:443?type=tcp&security=reality&pbk=pubkey999&sid=cd34#src");
    const batchPromise = page.waitForEvent("download", { timeout: 20000 });
    await page.click("#btn-batch");
    const batch = await batchPromise;
    ok("файл 50 резервных профилей", batch.suggestedFilename() === "sni-whitelist-50-reserve-profiles-nov2026.txt", batch.suggestedFilename());
    const batchPath = await batch.path();
    const batchBody = fs.readFileSync(batchPath, "utf8");
    const links = batchBody.split("\n").filter(l => l.startsWith("vless://"));
    ok("в файле ровно 50 vless-ссылок", links.length === 50, links.length);
    ok("у каждой ссылки свой SNI", new Set(links.map(l => (l.match(/[?&]sni=([^&]+)/) || [])[1])).size === 50, "уникальных: " + new Set(links.map(l => (l.match(/[?&]sni=([^&]+)/) || [])[1])).size);
    ok("сервер покупателя сохранён", links.every(l => l.includes("@edge.example.org:443")), links[0].slice(0, 80));
    await page.screenshot({ path: path.join(SHOTS, "net-whitelist-pro.png") });
    await ctx.close();
  }

  /* ---------- 5: foreign key is refused, nothing downloads ---------- */
  console.log("\n5. чужой ключ не открывает базу");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, deviceScaleFactor: 2, locale: "ru-RU", acceptDownloads: true });
    const page = await ctx.newPage();
    let downloaded = false;
    page.on("download", () => { downloaded = true; });
    await page.goto(`${BASE}/net-whitelist/index.html?key=${encodeURIComponent(NEWS_KEY)}&pack=sni-whitelist&download=xlsx`, { waitUntil: "load" });
    await page.waitForTimeout(1800);
    const state = await page.evaluate(() => ({
      pro: window.Unlock.isPro("sni-whitelist"),
      loaded: window.SNIPack.isLoaded()
    }));
    ok("ключ NEWSF не открыл SNI Pro", state.pro === false, JSON.stringify(state));
    ok("пакет остался зашифрован", state.loaded === false, JSON.stringify(state));
    ok("скачивания не было", downloaded === false);
    await ctx.close();
  }

  /* ---------- 6: the same pack is the 5th quick pack on /tg-chats/ ---------- */
  console.log("\n6. tg-chats: пятый быстрый пак (SNI) отдаёт тот же Excel");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, deviceScaleFactor: 2, locale: "ru-RU", acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e.message)));
    const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
    await page.goto(`${BASE}/tg-chats/index.html?key=${encodeURIComponent(TG_KEY)}&pack=sni-whitelist&download=xlsx`, { waitUntil: "load" });
    const download = await downloadPromise;
    ok("tg-chats скачал sni-whitelist-500-rf-nov2026.xlsx", download.suggestedFilename() === "sni-whitelist-500-rf-nov2026.xlsx", download.suggestedFilename());
    const state = await page.evaluate(() => ({
      pro: !!(window.Unlock && window.Unlock.isPro("tgchats")),
      loaded: !!(window.ChatPack && window.ChatPack.isSNILoaded()),
      has: !!(window.ChatPack && window.ChatPack.ensureSNI)
    }));
    ok("SNI-пакет в tg-chats расшифрован", state.pro && state.loaded && state.has, JSON.stringify(state));
    ok("без JS-ошибок на чек-ссылке tg-chats", errors.length === 0, errors.join(" | ").slice(0, 300));
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log("\n" + pass + " ok, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
