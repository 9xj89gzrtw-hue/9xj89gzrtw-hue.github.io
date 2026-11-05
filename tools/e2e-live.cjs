#!/usr/bin/env node
/*
 * e2e-live.cjs — the checks in e2e-nov4.cjs, but against the deployed site.
 *
 * Local tests prove the tree is right; this proves GitHub Pages serves it.
 * It catches the class of failure where a build is green while the edge still
 * serves yesterday's copy (a project-site Pages deployment with the same
 * directory name shadows the user site, for example).
 *
 * Run: node tools/e2e-live.cjs
 *      node tools/e2e-live.cjs --base https://example.github.io
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("/Users/evgenijdanilov/.npm/_npx/13ab0715f9f30c2e/node_modules/playwright");

const argBase = process.argv.indexOf("--base");
const BASE = argBase === -1 ? "https://9xj89gzrtw-hue.github.io" : process.argv[argBase + 1];
const KEYS = path.join(process.env.HOME, "gemini/agent1_out/license_keys");

const PAGES = [
  { url: "/", slug: "all-in-one" },
  { url: "/audio-dub-extractor/", slug: "audio-dub-studio" },
  { url: "/audio-dub-extractor/studio.html", slug: "audio-dub-studio" },
  { url: "/tg-chats/", slug: "tg-chats" },
  { url: "/docsearch/", slug: "docsearch" },
  { url: "/data-clipper/", slug: "data-clipper" },
  { url: "/newsflow/", slug: "newsflow" },
  { url: "/live-radar/", slug: "live-radar" },
  { url: "/base-tax-audit/", slug: "base-tax-audit" },
  { url: "/algo-tycoon/", slug: "algo-tycoon" }
];

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; failures.push(name + " -> " + (extra || "")); console.log("  FAIL " + name + (extra ? "  -> " + extra : "")); }
}

const ALL_KEY = fs.readFileSync(path.join(KEYS, "all-in-one.txt"), "utf8")
  .split("\n").find((l) => l.startsWith("TW1-ALL"));

(async () => {
  const browser = await chromium.launch();

  for (const p of PAGES) {
    for (const width of [390, 1440]) {
      const ctx = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 900 },
        locale: "ru-RU"
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message)));
      const res = await page.goto(BASE + p.url, { waitUntil: "load", timeout: 45000 });
      const m = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        win: window.innerWidth,
        shop: !!(window.SHOP && window.SHOP.bundle),
        preview: !!document.querySelector("#preview-btn"),
        ld: document.querySelectorAll('script[type="application/ld+json"]').length
      }));
      ok(`${p.url} @${width}: 200 без горизонтального скролла`,
        res.status() === 200 && m.doc <= m.win + 1, JSON.stringify(m));
      ok(`${p.url} @${width}: shop.js + демо-ключ`, m.shop && m.preview, JSON.stringify(m));
      ok(`${p.url} @${width}: один блок JSON-LD`, m.ld === 1, String(m.ld));
      ok(`${p.url} @${width}: без JS-ошибок`, errors.length === 0, errors.join(" | "));
      await ctx.close();
    }

    /* The universal key must open Pro on this exact production page. */
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + p.url, { waitUntil: "load", timeout: 45000 });
    const pro = await page.evaluate(async ([key, slug]) => {
      if (!window.Unlock) return { u: false };
      const lic = await window.Unlock.verifyLicenseKey(key, { product: "all-in-one" });
      if (lic && lic.valid) window.Unlock.grantLicense(lic);
      return {
        u: true,
        valid: !!(lic && lic.valid),
        pro: window.Unlock.isPro(slug),
        universal: !!localStorage.getItem("unlock:universal")
      };
    }, [ALL_KEY, p.slug]);
    ok(`${p.url}: TW1-ALL открывает Pro`, pro.u && pro.valid && pro.pro && pro.universal, JSON.stringify(pro));
    await ctx.close();
  }

  /* Bundle checkout + the 60-second demo on the home page. */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 45000 });
  const card = await page.evaluate(() => {
    const a = document.querySelector("#bundle-card");
    return { shown: !!a && !a.hidden, href: a ? a.getAttribute("href") : "" };
  });
  ok("home: карта All-in-One ведёт на фактический лот", /id_d=\d+/.test(card.href) && card.shown, JSON.stringify(card));

  const demo = await page.evaluate(() => {
    localStorage.clear();
    window.PreviewDemo.start();
    return {
      active: window.PreviewDemo.isActive(),
      universal: localStorage.getItem("unlock:universal"),
      pro: window.Unlock.isPro("all-in-one")
    };
  });
  ok("home: демо 60с активно и не пишет universal", demo.active && !demo.universal && demo.pro, JSON.stringify(demo));
  await ctx.close();

  await browser.close();
  console.log(`\nLIVE ${BASE}: ${pass} ok, ${fail} fail`);
  if (fail) console.log("failures:\n" + failures.join("\n"));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
