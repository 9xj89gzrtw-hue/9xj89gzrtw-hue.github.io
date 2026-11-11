#!/usr/bin/env node
/*
 * sync-shop.mjs — turn Agent 2's Digiseller stock file into data the static
 * pages can use without a build server.
 *
 * Source (first that exists):
 *   $SHOP_SOURCE
 *   ~/gemini/agent2_out/digiseller_tw1_stock.json
 *   data/shop.json                      (checked-in fallback)
 *
 * Outputs:
 *   assets/shop.js   window.SHOP = {...}   <- loaded by every page
 *   data/shop.json   same object, machine-readable
 *   shop.json        same object at the site root, for agents/crawlers
 *
 * A lot with no id stays `null`: the page then hides the card button instead
 * of linking to a checkout that would 404. Re-running this file is the whole
 * deployment step for a new lot.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOME = os.homedir();

const SOURCES = [
  process.env.SHOP_SOURCE,
  path.join(HOME, "gemini/agent2_out/digiseller_tw1_stock.json"),
  path.join(ROOT, "data/shop.json")
].filter(Boolean);

/* Product codes used inside TW1 keys and on Digiseller -> page slugs. */
const SLUG_BY_CODE = {
  AUDIO: "audio-dub-studio",
  AUDIODUB: "audio-dub-studio",
  TG: "tg-chats",
  TGCHATS: "tg-chats",
  DOC: "docsearch",
  DOCSEARCH: "docsearch",
  CLIP: "data-clipper",
  CLIPPER: "data-clipper",
  NEWS: "newsflow",
  NEWSFLOW: "newsflow",
  RADAR: "live-radar",
  LIVERADAR: "live-radar",
  TAX: "base-tax-audit",
  TAXAUDIT: "base-tax-audit",
  ALL: "all-in-one",
  ALLINONE: "all-in-one",
  BUNDLE: "all-in-one"
};

const SLUG_ALIAS = {
  "audio-dub-extractor": "audio-dub-studio",
  "audio": "audio-dub-studio",
  tgchats: "tg-chats",
  "tg-chat": "tg-chats",
  "archive-studio": "docsearch",
  archive: "docsearch",
  clipper: "data-clipper",
  "live-radar-pro": "live-radar",
  radar: "live-radar",
  tax: "base-tax-audit",
  "base-tax": "base-tax-audit",
  algo: "algo-tycoon",
  "algo-tycoon": "algo-tycoon",
  allinone: "all-in-one",
  bundle: "all-in-one",
  /* Digiseller lot slugs of the November 2026 batch (deploy_tw1_lineup.py) ->
     storefront shop keys (assets/unlock.js LICENSE_PRODUCTS / shop cards). */
  "sni-whitelist-pro": "sni-whitelist",
  "wb-ozon-extension-pro": "wb-ozon-extension-pro",
  "wb-ozon": "wb-ozon-extension-pro"
};

function slugFor(product, key) {
  const raw = String(product || key || "").trim().toLowerCase();
  if (SLUG_ALIAS[raw]) return SLUG_ALIAS[raw];
  if (SLUG_BY_CODE[raw.toUpperCase()]) return SLUG_BY_CODE[raw.toUpperCase()];
  return raw;
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function first(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return null;
}

function readSource() {
  for (const file of SOURCES) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return { file, parsed };
    } catch (err) {
      console.error(`skip ${file}: ${err.message}`);
    }
  }
  return { file: null, parsed: {} };
}

function normalize(parsed) {
  const products = {};
  const bundle = {};

  function put(entry, key) {
    if (!entry || typeof entry !== "object") return;
    const slug = slugFor(first(entry, ["slug", "product", "code", "name"]), key);
    if (!slug) return;
    const id = num(first(entry, ["id", "lot_id", "lotId", "product_id", "productId", "digiseller_id", "lot"]));
    const rub = num(first(entry, ["price_rub", "priceRub", "rub", "buyer_rub", "price_RUB", "price"]));
    const usd = num(first(entry, ["price_usd", "priceUsd", "usd"]));
    const target = slug === "all-in-one" ? bundle : products;
    target[slug] = {
      id: id || null,
      price_rub: rub || null,
      price_usd: usd || null,
      stocked: num(first(entry, ["stocked", "stock", "quantity"])) || 0,
      pay_url: first(entry, ["pay_url", "payUrl", "url"]) || null,
      card_url: first(entry, ["card_url", "cardUrl"]) || null,
      title: first(entry, ["title", "name"]) || null
    };
  }

  const root = parsed || {};
  if (root.products && !Array.isArray(root.products)) {
    for (const [k, v] of Object.entries(root.products)) put(v, k);
  } else if (Array.isArray(root.products)) {
    root.products.forEach((v) => put(v));
  }
  if (root.bundle) put(root.bundle, "ALL");
  if (Array.isArray(root.lots)) root.lots.forEach((v) => put(v));
  if (Array.isArray(root)) root.forEach((v) => put(v));
  if (!Object.keys(products).length && !Object.keys(bundle).length) {
    for (const [k, v] of Object.entries(root)) {
      if (v && typeof v === "object" && (v.id || v.lot_id)) put(v, k);
    }
  }
  /* flat code -> id map: {"NEWS": 1234} */
  for (const [k, v] of Object.entries(root)) {
    if (typeof v !== "number") continue;
    const known = SLUG_ALIAS[k.toLowerCase()] || SLUG_BY_CODE[k.toUpperCase()];
    if (known) put({ id: v }, k);
  }
  return { products, bundle };
}

const { file, parsed } = readSource();
const { products, bundle } = normalize(parsed);

const KNOWN = {
  "audio-dub-studio": { id: 6354599, price_rub: 299 },
  "tg-chats": { id: 6354600, price_rub: 490 },
  docsearch: { id: 6354601, price_rub: 690 },
  "data-clipper": { id: 6354602, price_rub: 390 },
  newsflow: { id: null, price_rub: null },
  "live-radar": { id: null, price_rub: null },
  "base-tax-audit": { id: null, price_rub: null },
  "algo-tycoon": { id: null, price_rub: null }
};

/* Storefront prices. price_rub is the exact cash-desk total (it moves with the
   rouble rate); display_rub is the number printed on cards, the catalog and
   the CTA. Keeping both means a 492,74 ₽ charge no longer turns "490 ₽" into
   "493 ₽" on the page, and e2e-card-pay can assert the printed value. */
const DISPLAY_RUB = {
  "audio-dub-studio": 199,
  "tg-chats": 490,
  docsearch: 690,
  "data-clipper": 299,
  newsflow: 390,
  "live-radar": 390,
  "base-tax-audit": 490,
  "algo-tycoon": 149,
  "wb-sellers-chats": 149,
  "b2b-stores-leads": 249,
  "freelance-it-chats": 149,
  "realty-jk-chats": 149,
  "all-in-one": 1290,
  "sni-whitelist": 99,
  "wb-ozon-extension-pro": 199
};

/* Listing titles are public metadata and must match the live Digiseller lot
   name, so the site never advertises a headline the lot does not have. The
   old "860 stores" headline on lot 6379842 was fixed on the lot itself; the
   override that papered over it is gone. */

const merged = {};
for (const [slug, def] of Object.entries(KNOWN)) {
  const got = products[slug] || {};
  merged[slug] = {
    id: got.id != null ? got.id : def.id,
    price_rub: got.price_rub != null ? got.price_rub : def.price_rub,
    display_rub: DISPLAY_RUB[slug] != null ? DISPLAY_RUB[slug] : null,
    price_usd: got.price_usd != null ? got.price_usd : null,
    stocked: got.stocked || 0,
    pay_url: got.pay_url || null,
    card_url: got.card_url || null,
    title: got.title || null
  };
}
for (const [slug, got] of Object.entries(products)) {
  if (!merged[slug]) {
    merged[slug] = Object.assign({ display_rub: DISPLAY_RUB[slug] != null ? DISPLAY_RUB[slug] : null }, got);
  }
}

/* Product sold on the site without a Digiseller lot yet: the card renders the
   price, the modal hides the card button (id: null) instead of linking to a
   checkout that does not exist. */
if (!merged["sni-whitelist"]) {
  merged["sni-whitelist"] = {
    id: null,
    price_rub: 99,
    display_rub: 99,
    price_usd: 0.99,
    stocked: 0,
    pay_url: null,
    card_url: null,
    title: "Белые списки SNI (LTE РФ) + генератор VLESS / Reality / Happ / AmneziaWG"
  };
}

const out = {
  source: file ? path.relative(HOME, file) : null,
  updated: new Date().toISOString(),
  seller_id: 1481449,
  currency_note: "price_rub is what the checkout shows; price_usd is what the page charges in USDC on Base",
  products: merged,
  bundle: (() => {
    const b = bundle["all-in-one"] || {};
    return {
      id: b.id || null,
      price_rub: b.price_rub || (b.id ? 1490 : null),
      display_rub: DISPLAY_RUB["all-in-one"],
      price_usd: b.price_usd || 14.99,
      stocked: b.stocked || 0,
      pay_url: b.pay_url || null,
      card_url: b.card_url || null,
      title: "All-in-One Pro Pass — все 9 инструментов, один ключ TW1-ALL-…"
    };
  })()
};

fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
const json = JSON.stringify(out, null, 2) + "\n";
fs.writeFileSync(path.join(ROOT, "data/shop.json"), json);
fs.writeFileSync(path.join(ROOT, "shop.json"), json);
fs.writeFileSync(
  path.join(ROOT, "assets/shop.js"),
  "/* generated by tools/sync-shop.mjs — do not edit by hand */\n" +
    "window.SHOP = " + JSON.stringify(out, null, 2) + ";\n"
);

const missing = Object.entries(merged).filter(([, v]) => !v.id).map(([k]) => k);
console.log("source:", out.source || "(none — fallback)");
console.log("listed:", Object.entries(merged).filter(([, v]) => v.id).map(([k]) => k).join(", ") || "—");
console.log("bundle:", out.bundle.id || "not listed yet");
console.log("waiting for lots:", missing.concat(out.bundle.id ? [] : ["all-in-one"]).join(", ") || "—");
