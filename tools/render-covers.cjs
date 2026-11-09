/* render-covers.cjs — real cover images, not stock art.
 *
 *   node tools/render-covers.cjs            # writes assets/covers/*.png + assets/og/*.png
 *   node tools/render-covers.cjs --only tg-chats
 *
 * For each product the script:
 *   1. serves the repo on 127.0.0.1 and photographs the real tool UI in
 *      headless Chromium (1280×860, top of the page);
 *   2. composes an 800×800 cover — big Russian benefit line, the screenshot
 *      inside a frame, the honest offer badge and the price;
 *   3. composes the 1200×630 social card with the same parts.
 *
 * Everything is rendered by the browser, so there is no image library to
 * install and no invented artwork: what a buyer sees on the cover is what the
 * page actually renders.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("/Users/evgenijdanilov/.npm/_npx/13ab0715f9f30c2e/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT_COVERS = path.join(ROOT, "assets", "covers");
const OUT_OG = path.join(ROOT, "assets", "og");
const TMP = path.join(ROOT, "tools", ".cover-shots");
const PORT = 8831;

/* Live total from Agent 4's catalog — the cover headline, the tg-chats h1
   and the "Все (N)" chip all read the same number. */
function tgTotal() {
  try {
    const src = fs.readFileSync(path.join(ROOT, "tg-chats", "catalog.js"), "utf8");
    const m = src.match(/"total"\s*:\s*(\d+)/);
    if (m) return Number(m[1]).toLocaleString("ru-RU");
  } catch (e) { /* fallback below */ }
  return "1 515";
}
const TG_TOTAL = tgTotal();

const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx === -1 ? null : process.argv[onlyIdx + 1];

/* Product copy. `headline` is the benefit, `sub` the one supporting line,
   `price` the real checkout figure (shop.json is the source of truth). */
const ITEMS = [
  {
    slug: "all-in-one",
    url: "/index.html",
    kicker: "ALL-IN-ONE PRO PASS",
    headline: "8 продуктов. Один ключ. Без подписки.",
    sub: "Telegram, звук, таблицы, рынки, игра — всё в браузере",
    price: "1 290 ₽",
    priceAlt: "$14.99 · USDC на Base",
    scrollY: 0,
    clip: { x: 0, y: 0, width: 1280, height: 860 }
  },
  {
    slug: "audio-dub-studio",
    url: "/audio-dub-extractor/index.html",
    kicker: "AUDIO DUB STUDIO",
    headline: "Озвучка и клипы видео — прямо в браузере",
    sub: "Дорожки по ролям, таймкод, BWF/ID3-метки, очередь до 200 файлов",
    price: "199 ₽",
    priceAlt: "$1.99 · USDC на Base",
    scrollY: 150
  },
  {
    slug: "tg-chats",
    url: "/tg-chats/index.html",
    kicker: "TG CHAT VALIDATOR",
    headline: `${TG_TOTAL} живых открытых чатов Telegram в Excel`,
    sub: "Селлеры WB/Ozon, закупки, карго, ИТ, недвижимость — пишите бесплатно без заявок",
    price: "490 ₽",
    priceAlt: "$9 · USDC на Base",
    scrollToSelector: "#catalog",
    /* Filter to marketplace sellers before the shot so the table is rich & clean */
    clickChips: "Селлеры WB/Ozon"
  },
  {
    slug: "b2b-stores-leads",
    url: "/tg-chats/index.html",
    kicker: "B2B LEADS & STORES 2026",
    headline: "1 200+ интернет-магазинов и оптовиков РФ",
    sub: "Телефоны, Email, Telegram, VK и CMS — выгрузка в Excel в 1 клик",
    price: "249 ₽",
    priceAlt: "$2.49 · USDC на Base",
    scrollToSelector: "#b2b"
  },
  {
    slug: "wb-sellers-chats",
    url: "/tg-chats/index.html",
    kicker: "WB & OZON SELLERS CHATS",
    headline: "240+ чатов селлеров Wildberries, Ozon и Карго",
    sub: "Поставщики, опт, склады и фуры — открытые группы без заявок",
    price: "149 ₽",
    priceAlt: "$1.49 · USDC на Base",
    scrollToSelector: ".result-head",
    clickChips: "Селлеры WB/Ozon"
  },
  {
    slug: "freelance-it-chats",
    url: "/tg-chats/index.html",
    kicker: "IT & FREELANCE CHATS",
    headline: "400+ чатов IT, фриланса и удалённой работы",
    sub: "Разработчики, дизайнеры, SMM, заказы и проекты в Telegram",
    price: "149 ₽",
    priceAlt: "$1.49 · USDC на Base",
    scrollToSelector: ".result-head",
    clickChips: "IT и Фриланс"
  },
  {
    slug: "realty-jk-chats",
    url: "/tg-chats/index.html",
    kicker: "REALTY & JK CHATS",
    headline: "210+ чатов ЖК, новостроек и недвижимости РФ",
    sub: "Москва, СПб и регионы: жильцы, ремонт, сдача и приёмка",
    price: "149 ₽",
    priceAlt: "$1.49 · USDC на Base",
    scrollToSelector: ".result-head",
    clickChips: "Недвижимость и ЖК"
  },
  {
    slug: "docsearch",
    url: "/docsearch/index.html",
    kicker: "ARCHIVE STUDIO DOCSEARCH",
    headline: "Поиск по архиву писем без облака",
    sub: "ИНН, договоры, суммы и даты — точная цитата со ссылкой на файл",
    price: "690 ₽",
    priceAlt: "$15 · USDC на Base",
    scrollY: 0
  },
  {
    slug: "data-clipper",
    url: "/data-clipper/index.html",
    kicker: "TABLE & TG-CHANNEL CLIPPER",
    headline: "Калькулятор маржи 11.11 и таблицы в Excel",
    sub: "Стресс-тест 120 товаров WB, выгрузка сайтов и Telegram",
    price: "299 ₽",
    priceAlt: "$2.99 · USDC на Base",
    scrollY: 0
  },
  {
    slug: "newsflow",
    url: "/newsflow/index.html",
    kicker: "NEWSFLOW STUDIO",
    headline: "Дайджест из RSS и Telegram в один пост",
    sub: "Дедупликация, расписание, экспорт в VK и Shorts",
    price: "390 ₽",
    priceAlt: "$12 · USDC на Base",
    scrollY: 60
  },
  {
    slug: "live-radar",
    url: "/live-radar/index.html",
    kicker: "LIVE RADAR",
    headline: "Рынки, спред и импульс — одним экраном",
    sub: "Скор, ликвидность и сигналы без API-ключей",
    price: "390 ₽",
    priceAlt: "$14 · USDC на Base",
    scrollY: 60
  },
  {
    slug: "base-tax-audit",
    url: "/base-tax-audit/index.html",
    kicker: "BASE WALLET GUARD & TAX",
    headline: "Аудит approvals и налоговый CSV по Base",
    sub: "Бессрочные approve, FIFO-себестоимость, Koinly и XTracker",
    price: "490 ₽",
    priceAlt: "$9 · USDC на Base",
    scrollY: 0
  },
  {
    slug: "algo-tycoon",
    url: "/algo-tycoon/index.html",
    kicker: "AI & MARKET TYCOON",
    headline: "Симулятор ИИ-стартапа и алго-биржи",
    sub: "1 000 ₽ и одна стойка на старте: заказы, серверы, квантовый кластер",
    price: "149 ₽",
    priceAlt: "$1.49 · USDC на Base",
    scrollY: 0
  }
];

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
  ".txt": "text/plain; charset=utf-8"
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
  return new Promise((r) => server.listen(PORT, "127.0.0.1", () => r(server)));
}

/* One browser-side template, two canvases. The screenshot is passed as a data
   URI so the composed page needs no network at all. */
function coverHtml(item, shot, w, h) {
  const wide = w > h;
  const pad = wide ? 56 : 52;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{width:${w}px;height:${h}px;overflow:hidden}
    body{
      background:#f7f8fa;
      font:400 16px/1.4 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;
      color:#0f172a;
      display:flex;flex-direction:column;
      padding:${pad}px;
      background-image:radial-gradient(760px 420px at 88% -12%,#e8f1ff 0%,rgba(232,241,255,0) 62%);
    }
    .top{display:flex;align-items:center;gap:10px;font-weight:700;font-size:${wide ? 19 : 20}px;letter-spacing:-.01em}
    .mark{width:${wide ? 22 : 24}px;height:${wide ? 22 : 24}px;background:#2563eb;border-radius:6px;position:relative;flex:none}
    .mark::after{content:"";position:absolute;inset:${wide ? 6 : 7}px;border:2px solid #fff;border-radius:2px}
    .brand{color:#0f172a}
    .brand span{color:#64748b;font-weight:500}
    .kicker{margin-top:${wide ? 26 : 30}px;font-size:${wide ? 12 : 12.5}px;font-weight:700;letter-spacing:.14em;color:#2563eb}
    h1{
      margin-top:${wide ? 12 : 14}px;
      font-size:${wide ? 46 : 44}px;line-height:1.06;letter-spacing:-.035em;font-weight:780;
      max-width:${wide ? 720 : 660}px;
    }
    .sub{margin-top:${wide ? 14 : 16}px;font-size:${wide ? 17 : 17}px;line-height:1.45;color:#475569;max-width:${wide ? 660 : 600}px}
    .shot{
      margin-top:${wide ? 26 : 28}px;
      flex:1;min-height:0;
      border:1px solid #dbe4ef;border-radius:14px;overflow:hidden;background:#fff;
      box-shadow:0 30px 60px -34px rgba(15,23,42,.45),0 2px 6px rgba(15,23,42,.06);
      position:relative;
    }
    .shot img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center}
    .shot::after{content:"";position:absolute;inset:0;box-shadow:inset 0 0 0 1px rgba(15,23,42,.04);border-radius:14px}
    .bottom{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:${wide ? 22 : 24}px}
    .badge{
      display:inline-flex;align-items:center;gap:8px;
      padding:${wide ? 9 : 10}px ${wide ? 13 : 14}px;border-radius:999px;
      background:#ecfdf5;border:1px solid #bde5d2;color:#14532d;
      font-size:${wide ? 13.5 : 13.5}px;font-weight:600;line-height:1.2;
    }
    .badge b{font-weight:800}
    .price{text-align:right;flex:none}
    .price b{display:block;font-size:${wide ? 30 : 34}px;letter-spacing:-.03em;line-height:1}
    .price span{display:block;margin-top:5px;font-size:${wide ? 12.5 : 13}px;color:#64748b}
  </style></head><body>
    <div class="top"><span class="mark"></span><span class="brand">Toolworks <span>· 8 продуктов</span></span></div>
    <div class="kicker">${item.kicker}</div>
    <h1>${item.headline}</h1>
    <div class="sub">${item.sub}</div>
    <div class="shot"><img src="${shot}" alt=""></div>
    <div class="bottom">
      <div class="badge"><b>Бесплатная версия</b> + мгновенный ключ TW1</div>
      <div class="price"><b>${item.price}</b><span>${item.priceAlt}</span></div>
    </div>
  </body></html>`;
}

async function shoot(browser, item) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message ? e.message : e)));
  try {
    await page.goto(`http://127.0.0.1:${PORT}${item.url}`, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(900);
    if (item.clickChips) {
      const picked = await page.evaluate((needle) => {
        const chips = Array.from(document.querySelectorAll(".chip"));
        const btn = chips.find((b) => (b.textContent || "").indexOf(needle) !== -1);
        if (btn) { btn.click(); return true; }
        return false;
      }, item.clickChips);
      if (picked) await page.waitForTimeout(550);
    }
    if (item.scrollToSelector) {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.scrollIntoView({ block: "start" });
      }, item.scrollToSelector);
      await page.waitForTimeout(420);
    }
    if (item.scrollY) {
      await page.evaluate((y) => window.scrollTo(0, y), item.scrollY);
      await page.waitForTimeout(420);
    }
    const buf = await page.screenshot({ fullPage: false, type: "png" });
    return { buf, errors };
  } finally {
    await page.close();
  }
}

async function compose(browser, item, shotDataUri, width, height, outFile) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(coverHtml(item, shotDataUri, width, height), { waitUntil: "load" });
  await page.waitForTimeout(220);
  /* The headline must never be clipped at the top or spill past the canvas. */
  const overflow = await page.evaluate(() => ({
    h: document.documentElement.scrollHeight,
    clipped: document.documentElement.scrollHeight > window.innerHeight + 1
  }));
  if (overflow.clipped) console.log(`  ! ${item.slug} ${width}x${height}: content overflows canvas (${overflow.h}px > ${height}px)`);
  await page.screenshot({ path: outFile, type: "png" });
  await page.close();
}

(async () => {
  fs.mkdirSync(OUT_COVERS, { recursive: true });
  fs.mkdirSync(OUT_OG, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  const server = await serve();
  const browser = await chromium.launch();
  const items = ONLY ? ITEMS.filter((i) => i.slug === ONLY) : ITEMS;
  let made = 0;
  const problems = [];

  try {
    for (const item of items) {
      const { buf, errors } = await shoot(browser, item);
      if (errors.length) problems.push(`${item.slug}: ${errors[0]}`);
      fs.writeFileSync(path.join(TMP, item.slug + ".png"), buf);
      const uri = "data:image/png;base64," + buf.toString("base64");
      await compose(browser, item, uri, 800, 800, path.join(OUT_COVERS, item.slug + ".png"));
      await compose(browser, item, uri, 1200, 630, path.join(OUT_OG, item.slug + ".png"));
      made += 1;
      console.log(`  ok   ${item.slug} → assets/covers/${item.slug}.png · assets/og/${item.slug}.png`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`render-covers: ${made} products`);
  if (problems.length) {
    console.log("page errors while shooting:");
    problems.forEach((p) => console.log("  ! " + p));
  }
})();
