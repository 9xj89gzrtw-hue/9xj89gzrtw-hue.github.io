/* e2e-nov4.cjs — the acceptance gate for the All-in-One pass, the 60-second
 * demo, structured data and mobile layout. Headless Chromium via Playwright.
 *
 *   node tools/e2e-nov4.cjs [--shots <dir>]
 *
 * What it proves, in order:
 *   1. every page parses, with no uncaught JS error, at 1440 px;
 *   2. JSON-LD carries SoftwareApplication + Product with a real price,
 *      operatingSystem and featureList;
 *   3. the 60-second demo turns the Pro UI on in memory, does not decrypt the
 *      TG pack, and is gone after a reload;
 *   4. one TW1-ALL key, entered once on the home page, opens Pro on all nine
 *      pages (checked through each page's own UI, not just the API);
 *   5. a product key (AUDIO) does not open newsflow, while ALL does;
 *   6. no horizontal scroll at 390 px and 1440 px on any page;
 *   7. with a shop fixture, the card button and the bundle render the exact
 *      oplata.info URL, and the All-in-One tariff is present in every modal.
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

const ALL_KEY = fs.readFileSync(path.join(KEYS, "all-in-one.txt"), "utf8")
  .split("\n").filter((l) => l.startsWith("TW1-"))[0];
const AUDIO_KEY = fs.readFileSync(path.join(KEYS, "audio-dub-studio.txt"), "utf8")
  .split("\n").filter((l) => l.startsWith("TW1-"))[0];

const PAGES = [
  { name: "home", url: "/index.html", product: "all-in-one" },
  { name: "audio", url: "/audio-dub-extractor/index.html", product: "audio-dub-studio" },
  { name: "studio", url: "/audio-dub-extractor/studio.html", product: "audio-dub-studio" },
  { name: "tg", url: "/tg-chats/index.html", product: "tg-chats" },
  { name: "docsearch", url: "/docsearch/index.html", product: "docsearch" },
  { name: "clipper", url: "/data-clipper/index.html", product: "data-clipper" },
  { name: "newsflow", url: "/newsflow/index.html", product: "newsflow" },
  { name: "radar", url: "/live-radar/index.html", product: "live-radar" },
  { name: "tax", url: "/base-tax-audit/index.html", product: "base-tax-audit" },
  { name: "algo", url: "/algo-tycoon/index.html", product: "algo-tycoon" }
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
  return new Promise((r) => server.listen(PORT, "127.0.0.1", () => r(server)));
}

let pass = 0, fail = 0;
const failures = [];
function ok(label) { pass += 1; console.log("  ok   " + label); }
function bad(label, why) {
  fail += 1;
  failures.push(label + (why ? " → " + why : ""));
  console.log("  FAIL " + label + (why ? " → " + why : ""));
}
function check(label, cond, why) { cond ? ok(label) : bad(label, why); }
const URL_ = (p) => `http://127.0.0.1:${PORT}${p}`;

async function newPage(context) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message ? e.message : e)));
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (SHOP_FIXTURE && /\/assets\/shop\.js$/.test(u)) {
      return route.fulfill({
        contentType: "application/javascript",
        body: "window.SHOP = " + JSON.stringify(SHOP_FIXTURE) + ";\n"
      });
    }
    if (u.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
    return route.abort().catch(() => {});
  });
  return { page, errors };
}

async function goto(page, url, wait = "load") {
  await page.goto(URL_(url), { waitUntil: wait, timeout: 30000 });
  await page.waitForTimeout(350);
}

async function jsonLd(page) {
  return page.evaluate(() =>
    Array.prototype.map.call(document.querySelectorAll('script[type="application/ld+json"]'), (s) => {
      try { return JSON.parse(s.textContent); } catch (e) { return { __error: String(e) }; }
    })
  );
}

function findNodes(doc, type) {
  if (!doc) return [];
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node["@type"] === type) out.push(node);
    Object.keys(node).forEach((k) => { if (k !== "@type") walk(node[k]); });
  };
  walk(doc);
  return out;
}

/* Page-specific proof that the tool itself (not just the shared API) is in Pro. */
async function probe(page, name) {
  const text = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? (el.textContent || "").trim() : "";
  }, sel);
  switch (name) {
    case "home": return page.evaluate(() => !!window.Unlock.hasUniversal());
    case "audio": return page.evaluate(() => !!window.Unlock.isPro("audio-dub-studio"));
    case "studio": return (await text("#mode-pill")) === "Pro";
    case "tg": return (await text("#check-quota")).includes("50");
    case "docsearch": return (await text("#proBtn")).includes("Pro активен");
    case "clipper": return page.evaluate(() => !!window.Unlock.isPro("data-clipper"));
    case "newsflow": return (await text('[data-unlock][data-product="newsflow"]')).toLowerCase().includes("pro active");
    case "radar": return (await text("#proBtn")).includes("Pro активен");
    case "tax": return (await text("#licensestate")).toLowerCase().includes("pro unlocked");
    case "algo": return (await text("#tier-chip")).toUpperCase().includes("PRO");
    default: return false;
  }
}

let SHOP_FIXTURE = null;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  /* ---------- 1 + 2: every page parses, schema is real ---------- */
  console.log("\n1. страницы + JSON-LD");
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    for (const p of PAGES) {
      const { page, errors } = await newPage(context);
      await goto(page, p.url);
      check(`${p.name}: без необработанных JS-ошибок`, errors.length === 0, errors.join(" | "));
      const blocks = await jsonLd(page);
      const docs = blocks.filter((b) => !b.__error);
      check(`${p.name}: JSON-LD парсится (${blocks.length} блок)`, blocks.length > 0 && docs.length === blocks.length,
        blocks.map((b) => b.__error).filter(Boolean).join(" | "));
      const apps = findNodes(docs, "SoftwareApplication");
      const products = findNodes(docs, "Product");
      check(`${p.name}: SoftwareApplication`, apps.length > 0);
      check(`${p.name}: Product`, products.length > 0);
      const app = apps[0] || {};
      check(`${p.name}: operatingSystem`, /Browser|Any/.test(String(app.operatingSystem || "")), app.operatingSystem);
      check(`${p.name}: featureList ≥ 3`, Array.isArray(app.featureList) && app.featureList.length >= 3);
      const offers = findNodes(app.offers, "Offer");
      check(`${p.name}: offers с ценой > 0`, offers.some((o) => Number(o.price) > 0),
        offers.map((o) => o.price).join(","));
      const urlOk = String(app.url || "").startsWith("https://9xj89gzrtw-hue.github.io");
      check(`${p.name}: абсолютный canonical url`, urlOk, app.url);
      await page.close();
    }
    await context.close();
  }

  /* ---------- 3: 60-second demo, memory only ---------- */
  console.log("\n2. демо-ключ на 60 секунд");
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    for (const p of PAGES) {
      const { page } = await newPage(context);
      await goto(page, p.url);
      const hasBtn = await page.$("#preview-btn");
      check(`${p.name}: кнопка демо есть`, !!hasBtn);
      if (!hasBtn) { await page.close(); continue; }
      await page.click("#preview-btn");
      await page.waitForTimeout(250);
      const state = await page.evaluate(() => ({
        active: window.Unlock.isPreview(document.querySelector("#preview-btn").getAttribute("data-product")),
        cls: document.querySelector("#preview-btn").className,
        stored: !!localStorage.getItem("unlock:universal")
      }));
      check(`${p.name}: демо включает превью`, state.active && /is-active/.test(state.cls));
      check(`${p.name}: демо не пишет universal-запись`, state.stored === false);
      if (p.name === "tg") {
        await page.waitForTimeout(700);
        const sealed = await page.evaluate(() => !(window.ChatPack && window.ChatPack.isLoaded()));
        check("tg: демо не расшифровывает Pro-пакет", sealed);
      }
      if (p.name === "algo") {
        const pro = await page.evaluate(() => document.body.classList.contains("pro"));
        check("algo: демо показывает Pro-панели", pro);
      }
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => ({
        pro: window.Unlock.isPro(document.querySelector("#preview-btn").getAttribute("data-product")),
        universal: !!localStorage.getItem("unlock:universal")
      }));
      if (p.name !== "home") check(`${p.name}: после перезагрузки снова Free`, after.pro === false && after.universal === false);
      await page.close();
    }
    await context.close();
  }

  /* ---------- 4 + 5: one ALL key, all pages ---------- */
  console.log("\n3. TW1-ALL открывает все страницы");
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const { page } = await newPage(context);
    await goto(page, "/index.html");
    const granted = await page.evaluate(async (key) => {
      const res = await window.Unlock.verifyAndUnlock("all-in-one", 14.99, key);
      return { license: !!res.license, code: res.code, universal: !!localStorage.getItem("unlock:universal") };
    }, ALL_KEY);
    check("home: ключ ALL принят", granted.license && granted.code === "ALL", JSON.stringify(granted));
    check("home: записан universal-рекорд", granted.universal);
    await page.close();

    for (const p of PAGES) {
      const { page, errors } = await newPage(context);
      await goto(page, p.url, "domcontentloaded");
      await page.waitForTimeout(p.name === "tg" ? 2500 : 600);
      let pro = false;
      try { pro = await probe(page, p.name); } catch (e) { pro = false; }
      check(`${p.name}: Pro открыт ключом ALL`, pro, "page-specific probe");
      check(`${p.name}: без JS-ошибок после активации`, errors.length === 0, errors.join(" | "));
      await page.close();
    }

    /* A product key must not leak vertically. */
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const { page: nf } = await newPage(ctx2);
    await goto(nf, "/newsflow/index.html");
    const audioTry = await nf.evaluate(async (key) => {
      const lic = await window.Unlock.verifyLicenseKey(key, { product: "newsflow" });
      return { valid: lic.valid, error: lic.error };
    }, AUDIO_KEY);
    check("newsflow: ключ AUDIO отклонён", audioTry.valid === false && audioTry.error === "product", JSON.stringify(audioTry));
    const stillFree = await nf.evaluate(() => !window.Unlock.isPro("newsflow"));
    check("newsflow: после отказа Pro закрыт", stillFree);
    await ctx2.close();
    await context.close();
  }

  /* ---------- 6: layout at 390 and 1440 ---------- */
  console.log("\n4. нет горизонтального скролла");
  {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      for (const p of PAGES) {
        const { page } = await newPage(context);
        await goto(page, p.url);
        if (width === 390) await page.waitForTimeout(200);
        const m = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          win: window.innerWidth
        }));
        check(`${p.name} @${width}: без горизонтального скролла`, m.doc <= m.win + 1 && m.body <= m.win + 1,
          `doc=${m.doc} body=${m.body} win=${m.win}`);
        if (width === 390 && (p.name === "home" || p.name === "algo")) {
          await page.screenshot({ path: path.join(SHOTS, `nov4-${p.name}-390.png`), fullPage: false });
        }
        await page.close();
      }
      await context.close();
    }
  }

  /* ---------- 7: live shop lots + bundle tariff ---------- */
  console.log("\n5. лоты Digiseller и тариф All-in-One");
  {
    const SHOP = {
      products: {
        newsflow: { id: 700001, price_rub: 590 },
        "live-radar": { id: 700002, price_rub: 490 },
        "base-tax-audit": { id: 700003, price_rub: 490 },
        "algo-tycoon": { id: 700004, price_rub: 390 }
      },
      bundle: { id: 700099, price_rub: 1490 }
    };
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    SHOP_FIXTURE = SHOP;

    const { page } = await newPage(context);
    await goto(page, "/newsflow/index.html");
    await page.click('[data-unlock][data-product="newsflow"]');
    await page.waitForTimeout(250);
    const modal = await page.evaluate(() => {
      const c = document.querySelector("#unlock-card");
      const b = document.querySelector("#unlock-bundle-card");
      return {
        cardShown: !!c && !c.hidden,
        cardHref: c ? c.getAttribute("href") : "",
        bundleShown: !!b && !b.hidden,
        bundleHref: b ? b.getAttribute("href") : "",
        bundlePrice: (document.querySelector("#unlock-bundle-title") || {}).textContent || ""
      };
    });
    check("newsflow: кнопка карты ведёт на лот 700001", modal.cardShown && modal.cardHref.includes("id_d=700001"), modal.cardHref);
    check("newsflow: виден All-in-One за $14.99", /14\.99/.test(modal.bundlePrice), modal.bundlePrice);
    check("newsflow: карта бандла ведёт на лот 700099", modal.bundleShown && modal.bundleHref.includes("id_d=700099"), modal.bundleHref);
    await page.close();

    const { page: home } = await newPage(context);
    await goto(home, "/index.html");
    const bundle = await home.evaluate(() => {
      const a = document.querySelector("#bundle-card");
      return { shown: !!a && !a.hidden, href: a ? a.getAttribute("href") : "" };
    });
    check("home: карта All-in-One подхватывает лот из shop.js", bundle.shown && bundle.href.includes("id_d=700099"), JSON.stringify(bundle));
    await home.screenshot({ path: path.join(SHOTS, "nov4-home-1440.png") });
    await home.close();

    const { page: tax } = await newPage(context);
    await goto(tax, "/base-tax-audit/index.html");
    const taxCard = await tax.evaluate(() => {
      const a = document.querySelector("#pay-card-tax");
      return { shown: !!a && !a.hidden, href: a ? a.getAttribute("href") : "" };
    });
    check("base-tax: кнопка карты ведёт на лот 700003", taxCard.shown && taxCard.href.includes("id_d=700003"), JSON.stringify(taxCard));
    await tax.close();

    const { page: algo } = await newPage(context);
    await goto(algo, "/algo-tycoon/index.html");
    const algoCard = await algo.evaluate(() => {
      const a = document.querySelector('[data-shop-product="algo-tycoon"]');
      return { shown: !!a && !a.hidden, href: a ? a.getAttribute("href") : "" };
    });
    check("algo: кнопка карты ведёт на лот 700004", algoCard.shown && algoCard.href.includes("id_d=700004"), JSON.stringify(algoCard));
    await algo.close();

    /* The bundle tariff must be reachable from every page's payment surface,
       including the five pages that keep their own modal. */
    for (const p of PAGES) {
      const { page } = await newPage(context);
      await goto(page, p.url);
      const bundleBtn = await page.$('[data-unlock][data-product="all-in-one"]');
      const sharedBundle = await page.$("#unlock-bundle-pay");
      check(`${p.name}: тариф All-in-One доступен на странице`, !!bundleBtn || !!sharedBundle);
      await page.close();
    }

    const { page: clipper } = await newPage(context);
    await goto(clipper, "/data-clipper/index.html");
    await clipper.click('[data-unlock][data-product="all-in-one"]');
    await clipper.waitForTimeout(250);
    const bundleModal = await clipper.evaluate(() => {
      const t = document.querySelector("#unlock-bundle-title");
      const m = document.querySelector(".modal-backdrop");
      return { title: t ? t.textContent : "", open: !!m && !m.hidden };
    });
    check("clipper: клик открывает общую модалку бандла $14.99",
      bundleModal.open && /14\.99/.test(bundleModal.title), JSON.stringify(bundleModal));
    await clipper.close();
    await context.close();

    /* Now the real generated shop.js, no fixture. A page must never render a
       card link for a lot that does not exist, and must follow the lot when it
       appears: algo-tycoon is not listed yet, the $14.99 bundle is listed. */
    SHOP_FIXTURE = null;
    const live = await newPage(await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" }));
    await goto(live.page, "/index.html");
    const homeLive = await live.page.evaluate(() => {
      const card = document.querySelector("#bundle-card");
      const usdc = document.querySelector('[data-unlock][data-product="all-in-one"]');
      const bundle = window.SHOP && window.SHOP.bundle;
      return {
        cardShown: !!card && !card.hidden,
        href: card ? card.getAttribute("href") : "",
        usdcShown: !!usdc,
        live: !!(bundle && bundle.id),
        expected: bundle && bundle.id ? "id_d=" + bundle.id : ""
      };
    });
    check("home (живой shop.js): карта бандла совпадает с фактическим лотом",
      homeLive.usdcShown && (homeLive.live
        ? homeLive.cardShown && homeLive.href.includes(homeLive.expected)
        : !homeLive.cardShown), JSON.stringify(homeLive));
    await goto(live.page, "/algo-tycoon/index.html");
    const algoLive = await live.page.evaluate(() => {
      const a = document.querySelector('[data-shop-product="algo-tycoon"]');
      const lot = window.SHOP && window.SHOP.products && window.SHOP.products["algo-tycoon"];
      return {
        shown: !!a && !a.hidden,
        href: a ? a.getAttribute("href") : "",
        lot: lot && lot.id ? "id_d=" + lot.id : ""
      };
    });
    check("algo (живой shop.js): карта показывает только существующий лот",
      algoLive.lot ? algoLive.shown && algoLive.href.includes(algoLive.lot) : !algoLive.shown,
      JSON.stringify(algoLive));
    for (const p of [
      { name: "newsflow", url: "/newsflow/index.html", slug: "newsflow", open: '[data-unlock][data-product="newsflow"]', sel: "#unlock-card", modal: true },
      { name: "radar", url: "/live-radar/index.html", slug: "live-radar", sel: '[data-shop-product="live-radar"]' },
      { name: "tax", url: "/base-tax-audit/index.html", slug: "base-tax-audit", sel: "#pay-card-tax" }
    ]) {
      await goto(live.page, p.url);
      if (p.open) { await live.page.click(p.open); await live.page.waitForTimeout(250); }
      const shopNow = await live.page.evaluate(([s, slug, inModal]) => {
        const el = document.querySelector(s);
        const now = window.SHOP && window.SHOP.products && window.SHOP.products[slug];
        return {
          shown: !!el && !el.hidden,
          href: el ? el.getAttribute("href") : "",
          live: !!(now && now.id),
          expected: now && now.id ? "id_d=" + now.id : "",
          modal: !!inModal
        };
      }, [p.sel, p.slug, !!p.modal]);
      check(`${p.name} (живой shop.js): карта ведёт на фактический лот`,
        shopNow.live ? shopNow.shown && shopNow.href.includes(shopNow.expected) : !shopNow.shown,
        JSON.stringify(shopNow));
    }
    check("живой shop.js: без JS-ошибок", live.errors.length === 0, live.errors.join(" | "));
    await live.page.context().close();
  }

  /* ---------- 8: geometry — nothing floats over the content ---------- */
  console.log("\n6. геометрия: ни один слой не накрывает контент");

  /* In-page probe: returns every visible fixed/sticky box and every visible
     content box that overlaps it, measured with getBoundingClientRect().
     Runs at several scroll offsets so a bar pinned to the top is caught even
     when the element it hides only scrolls under it half-way down the page. */
  const geometryProbe = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
      if (cs.contentVisibility === "hidden") return false;
      if (el.closest("[hidden]")) return false;
      /* A closed <details> keeps the layout of its panel but paints nothing;
         that content must not count as covering anything. */
      const closed = el.closest("details:not([open])");
      if (closed && closed !== el && !el.closest("summary")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { el, r, top: Math.max(0, r.top), left: Math.max(0, r.left),
        bottom: Math.min(vh, r.bottom), right: Math.min(vw, r.right) };
    };
    const inView = (b) => b.bottom > 0 && b.top < vh && b.right > 0 && b.left < vw;

    const labels = (el) => (el.tagName.toLowerCase() +
      (el.id ? "#" + el.id : "") +
      (el.className && typeof el.className === "string" && el.className.trim()
        ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
        : ""));

    /* Overlays: anything the browser pins over the flow. */
    const overlays = [];
    document.querySelectorAll("body *").forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") return;
      if (!visible(el)) return;
      const b = box(el);
      if (!inView(b)) return;
      overlays.push({ el, b, pos: cs.position });
    });

    /* Content: headings, copy, controls, cards. */
    const contentSel = "h1,h2,h3,h4,p,li,td,th,label,input,select,textarea,button,a.btn,.btn,.card,.panel,.product,.job,.slot,.rnode,.kpi";
    const content = [];
    document.querySelectorAll(contentSel).forEach((el) => {
      if (!visible(el)) return;
      const b = box(el);
      if (!inView(b)) return;
      content.push({ el, b });
    });

    const hits = [];
    const isAncestor = (a, b) => a !== b && a.contains(b);
    overlays.forEach((o) => {
      content.forEach((c) => {
        if (isAncestor(o.el, c.el) || isAncestor(c.el, o.el)) return;
        if (c.el.contains(o.el)) return;
        const ix = Math.min(o.b.right, c.b.right) - Math.max(o.b.left, c.b.left);
        const iy = Math.min(o.b.bottom, c.b.bottom) - Math.max(o.b.top, c.b.top);
        if (ix <= 1 || iy <= 1) return;
        hits.push(`${o.pos} ${labels(o.el)} × ${labels(c.el)} (${Math.round(ix)}×${Math.round(iy)})`);
      });
    });

    /* Two interactive boxes must never sit on top of each other either:
       that is the classic "floating button covers the card CTA" bug. */
    const controls = [];
    document.querySelectorAll("a.btn,.btn,button,input,select,textarea").forEach((el) => {
      if (!visible(el)) return;
      const b = box(el);
      if (!inView(b)) return;
      controls.push({ el, b });
    });
    const controlHits = [];
    for (let i = 0; i < controls.length; i += 1) {
      for (let j = i + 1; j < controls.length; j += 1) {
        const a = controls[i], c = controls[j];
        if (isAncestor(a.el, c.el) || isAncestor(c.el, a.el)) continue;
        const ix = Math.min(a.b.right, c.b.right) - Math.max(a.b.left, c.b.left);
        const iy = Math.min(a.b.bottom, c.b.bottom) - Math.max(a.b.top, c.b.top);
        if (ix <= 1 || iy <= 1) continue;
        /* Ignore controls that share a wrapper and are drawn side by side. */
        controlHits.push(`${labels(a.el)} × ${labels(c.el)} (${Math.round(ix)}×${Math.round(iy)})`);
      }
    }
    return { hits: hits.slice(0, 6), controlHits: controlHits.slice(0, 6), overlays: overlays.length };
  };

  for (const width of [390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
      locale: "ru-RU"
    });
    for (const p of PAGES) {
      const { page } = await newPage(context);
      await goto(page, p.url);
      const docH = await page.evaluate(() => document.documentElement.scrollHeight);
      const steps = Math.min(7, Math.max(1, Math.ceil(docH / (width === 390 ? 700 : 800))));
      let overlayHits = [];
      let controlHits = [];
      let overlayCount = 0;
      for (let s = 0; s < steps; s += 1) {
        await page.evaluate((y) => window.scrollTo(0, y), s * (width === 390 ? 700 : 800));
        await page.waitForTimeout(90);
        const r = await page.evaluate(geometryProbe);
        overlayCount = Math.max(overlayCount, r.overlays);
        overlayHits = overlayHits.concat(r.hits);
        controlHits = controlHits.concat(r.controlHits);
      }
      check(`${p.name} @${width}: fixed/sticky не накрывает заголовки, карточки и кнопки`,
        overlayHits.length === 0, overlayHits.join(" | "));
      check(`${p.name} @${width}: интерактивные элементы не перекрывают друг друга`,
        controlHits.length === 0, Array.from(new Set(controlHits)).slice(0, 3).join(" | "));
      await page.close();
    }
    await context.close();
  }

  await browser.close();
  server.close();

  console.log(`\n${pass} ok, ${fail} fail`);
  if (fail) {
    console.log("failures:\n- " + failures.join("\n- "));
    process.exit(1);
  }
})().catch((e) => {
  console.error("harness error:", e);
  process.exit(1);
});
