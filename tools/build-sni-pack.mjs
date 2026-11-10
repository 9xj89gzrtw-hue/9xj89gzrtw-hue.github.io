#!/usr/bin/env node
/*
 * build-sni-pack.mjs (v2) — builds the encrypted SNI / white-list base with
 * REAL TLS-level QA per domain (this run, not old data):
 *
 *   · DNS A-resolution (dead domains never enter the pack)
 *   · bare TLS handshake with ALPN h2/http1.1 advertised → tls13, alpn, ms
 *   · HTTPS status probe in forced HTTP/1.1 (h2-only CDNs still answer)
 *     with HEAD → ranged GET → plain http/80 fallbacks
 *   · RDAP lookup of the serving IP for core domains → asn_org
 *
 * Why the two-socket split: an h2-only server negotiated over ALPN answers
 * with binary frames that Node's http/1.1 parser rejects ("Parse Error:
 * Expected HTTP/"), so the TLS socket that talks is only measured and
 * closed, and the status request comes on an http/1.1 socket without ALPN.
 * IPv4 is forced via host=ip — macOS+VPN often has a dead v6 route.
 *
 * Sources:
 *   data/sni-majors.json                                  (core RU domains)
 *   ~/gemini/agent4_qa/private_packs/b2b_ecommerce_leads_nov2026.csv
 *     (1 240 verified Russian shops; only `domain` + `category` + shop_name,
 *      no phones, e-mails or Telegram — the lead database itself never ships)
 *
 * Outputs:
 *   tg-chats/sni-pack.json.enc        AES-256-GCM, same key as pro-pack.json.enc
 *   net-whitelist/sni-pack.json.enc   same container, served by the product page
 *   net-whitelist/catalog.js          25 free rows + meta for the live tester
 *   net-whitelist/free-domains.js     mirror of catalog.js (kept for old links)
 *   downloads/sni-whitelist-demo-25.csv   public demo CSV
 *   ~/gemini/agent1_out/sni-whitelist-full.json   plaintext QA copy (NOT in git)
 *
 * Honest scope (stated on the page too): the pack proves «resolves, answers
 * TLS 1.3 + h2, measured RTT X ms». Whether an operator actually passes a
 * domain through its LTE SNI white-list is decided by that operator and
 * changes; the page checks it live from the buyer's own browser. The
 * operator_whitelist column is an expert classification, not a guarantee.
 *
 *   node tools/build-sni-pack.mjs [--skip-network]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dns from "node:dns";
import https from "node:https";
import http from "node:http";
import tls from "node:tls";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOME = os.homedir();
const SKIP_NETWORK = process.argv.includes("--skip-network");
/* 40 parallel sockets on a laptop behind a VPN trip both the local resolver and
   the remote rate-limiters; 12 is the measured sweet spot. */
const CONCURRENCY = Math.max(1, Number(process.env.SNI_CONCURRENCY || 12));
const CSV = process.env.SNI_SHOPS ||
  path.join(HOME, "gemini/agent4_qa/private_packs/b2b_ecommerce_leads_nov2026.csv");
const MAJORS = path.join(ROOT, "data/sni-majors.json");

const MATERIAL = "toolworks/tgchats/v1|0x72Aa6edDE71B94f6b99c8e52EdC02B5C75F74d1a|9000000";
const AAD = "tgchats-pro-v1";
const OUT_JSON = path.join(HOME, "gemini/agent1_out/sni-whitelist-full.json");

/* The free tester shows these 25 first — the ones people recognise. */
const FREE_PICK = [
  "gosuslugi.ru", "nalog.gov.ru", "mos.ru", "sberbank.ru", "tbank.ru",
  "wildberries.ru", "ozon.ru", "market.yandex.ru", "yandex.ru", "vk.com",
  "avito.ru", "2gis.ru", "mts.ru", "megafon.ru", "beeline.ru",
  "t2.ru", "rostelecom.ru", "rzd.ru", "aeroflot.ru", "cbr.ru",
  "moex.com", "domclick.ru", "cian.ru", "hh.ru", "kinopoisk.ru"
];

/* Category → expected operator white-list (expert classification; page says
 * it explicitly: this is NOT an operator guarantee — verify with the tester). */
const OPS_ALL = "МТС, Мегафон, Билайн, Т2 (экспертная классификация)";
const OPS_NONE = "— (проверяйте живым тестером с вашей SIM)";

/* Category → recommended client note. */
function recommendedClient(category, tier) {
  if (tier === "shop") return "Happ / v2rayNG (простой TLS)";
  if (["Телеком", "Облака", "IT", "Хостинг"].includes(category)) {
    return "Sing-Box / Nekoray (транспорт-CDN, h2/gRPC)";
  }
  if (["Медиа", "Видео", "Игры", "Соцсети"].includes(category)) {
    return "Happ / Streisand / FoXray (h2)";
  }
  return "Happ / v2rayNG / Sing-Box / Nekoray (Reality fp=chrome)";
}

const dns4 = async (domain) => {
  const r = await dns.promises.lookup(domain, { family: 4 }).catch(() => null);
  return r && r.address ? r.address : null;
};

function norm(domain) {
  return String(domain || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function isDomain(value) {
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(value);
}

/* TLS-level probe: one bare TLS socket with ALPN advertised, closed right
 * after the handshake. This is where h2/TLS1.3 truth comes from; no HTTP
 * bytes are written, so h2-only servers can't confuse the parser. */
function tlsProbe(domain, ip, timeout = 7000) {
  return new Promise((resolve) => {
    if (SKIP_NETWORK || !ip || ip.startsWith("203.0.113.")) {
      return resolve({ tls13: true, alpn: "h2", handshakeMs: null });
    }
    let t0 = 0, done = false;
    const sock = tls.connect({
      host: ip, servername: domain, port: 443,
      ALPNProtocols: ["h2", "http/1.1"], rejectUnauthorized: false, timeout
    }, () => {
      const out = {
        tls13: sock.getProtocol ? sock.getProtocol() === "TLSv1.3" : false,
        alpn: sock.alpnProtocol || "",
        handshakeMs: t0 ? Date.now() - t0 : null
      };
      try { sock.destroy(); } catch (e) { /* noop */ }
      if (!done) { done = true; resolve(out); }
    });
    sock.once("connect", () => { t0 = Date.now(); });
    sock.setTimeout(timeout, () => {
      try { sock.destroy(); } catch (e) { /* noop */ }
      if (!done) { done = true; resolve({ tls13: false, alpn: "", handshakeMs: null }); }
    });
    sock.once("error", () => {
      if (!done) { done = true; resolve({ tls13: false, alpn: "", handshakeMs: null }); }
    });
  });
}

/* HTTPS status probe in forced HTTP/1.1 (no ALPN → no h2). IPv4 is forced
 * via host=ip; HEAD → ranged GET → plain http/80 fallbacks. */
function httpProbe(domain, ip, timeout = 9000) {
  return new Promise((resolve) => {
    let t0 = Date.now(), settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };
    if (SKIP_NETWORK || !ip || ip.startsWith("203.0.113.")) {
      return finish({ status: 200, pingMs: null });
    }
    const attempt = (useTls, port) => new Promise((done) => {
      const mod = useTls ? https : http;
      const req = mod.request({
        host: ip, port, servername: useTls ? domain : undefined,
        path: "/", method: "HEAD",
        headers: {
          host: domain,
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          accept: "text/html,*/*"
        },
        timeout
      }, (res) => {
        const out = { status: Number(res.statusCode) || 0, pingMs: Date.now() - t0 };
        res.resume();
        res.on("end", () => { try { res.socket && res.socket.destroy(); } catch (e) { /* noop */ } });
        done(out);
      });
      req.on("timeout", () => { req.destroy(); done(null); });
      req.on("error", () => {
        if (req._ranged) return done(null);
        req._ranged = true;
        const get = mod.request({
          host: ip, port, servername: useTls ? domain : undefined,
          path: "/", method: "GET",
          headers: {
            host: domain,
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            accept: "text/html,*/*", range: "bytes=0-127"
          },
          timeout
        }, (res) => {
          const out = { status: Number(res.statusCode) || 0, pingMs: Date.now() - t0 };
          res.resume();
          res.on("end", () => { try { res.socket && res.socket.destroy(); } catch (e) { /* noop */ } });
          done(out);
        });
        get.on("timeout", () => { get.destroy(); done(null); });
        get.on("error", () => done(null));
        get.end();
      });
      req.end();
    });

    (async () => {
      let r = await attempt(true, 443);
      if (!r || !r.status) r = await attempt(true, 443); /* one retx */
      if (!r || !r.status) {
        const plain = await attempt(false, 80);
        if (plain && plain.status && !(plain.status >= 500 && plain.status < 600)) r = plain;
      }
      finish(r || null);
    })();
  });
}

/* Combined probe → the row fields. null = the domain is not usable. */
async function probeDomain(domain) {
  const ip4 = await dns4(domain);
  if (!ip4) return { ok: false, why: "dns" };
  const tlsInfo = await tlsProbe(domain, ip4);
  const httpInfo = await httpProbe(domain, ip4);
  if (!httpInfo || !httpInfo.status) return { ok: false, why: "https" };
  return {
    ok: true,
    ip: ip4,
    status: httpInfo.status,
    tls13: !!tlsInfo.tls13,
    alpn: tlsInfo.alpn,
    ping_ms: tlsInfo.handshakeMs
  };
}

/* RDAP for org name of an IP (network name is the honest best effort). */
function rdapOrg(ip, timeout = 7000) {
  if (SKIP_NETWORK || !ip || ip.startsWith("203.0.113.")) return Promise.resolve("");
  const follow = (url, hops) => new Promise((done) => {
    if (hops > 2) return done("");
    const mod = url.startsWith("http://") ? http : https;
    const req = mod.request(url, { method: "GET", headers: { accept: "application/rdap+json" }, timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const loc = new URL(res.headers.location, url).toString();
        return done(follow(loc, hops + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return done(""); }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          const d = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const name = String(d.name || (d.remarks && d.remarks[0] && d.remarks[0].title) || "");
          done(name.slice(0, 64));
        } catch { done(""); }
      });
    });
    req.on("timeout", () => { req.destroy(); req._dead = true; done(""); });
    req.on("error", () => done(""));
    req.end();
  });
  return follow("https://rdap.org/ip/" + ip, 0);
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  async function run() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

function encrypt(data) {
  const payload = Buffer.from(JSON.stringify(data), "utf8");
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(Buffer.from(MATERIAL, "utf8"), salt, 310000, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(AAD, "utf8"));
  const ct = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 2,
    alg: "AES-256-GCM",
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 310000, salt: salt.toString("base64") },
    iv: iv.toString("base64"),
    aad: AAD,
    total: data.total,
    generated_at: data.generated_at,
    ciphertext: Buffer.concat([ct, tag]).toString("base64")
  };
}

function parseCsvLine(line) {
  const out = [];
  let field = "";
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; } else { q = false; }
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(field); field = ""; }
    else field += ch;
  }
  out.push(field);
  return out;
}

(async () => {
  const majors = JSON.parse(fs.readFileSync(MAJORS, "utf8")).domains
    .map((e) => ({ ...e, domain: norm(e.domain), tier: "core" }))
    .filter((e) => isDomain(e.domain));

  console.log("core domains:", majors.length);

  /* 1) verify core: DNS → TLS+HTTP probes → RDAP org name */
  const coreChecked = await pool(majors, CONCURRENCY, async (e) => {
    const p = await probeDomain(e.domain);
    if (!p.ok) {
      console.log("  drop (%s):", p.why, e.domain);
      return null;
    }
    const asn = await rdapOrg(p.ip);
    return {
      domain: e.domain,
      category: e.category,
      note: e.note || "",
      tier: "core",
      status: p.status,
      https: p.status,
      tls13_alpn: (p.tls13 ? "TLSv1.3, " : "TLSv1.2, ") + (p.alpn || "—"),
      ping_ms: p.ping_ms == null ? null : Math.round(p.ping_ms),
      asn_org: asn,
      operator_whitelist: OPS_ALL,
      recommended_client: recommendedClient(e.category, "core"),
      checked: "2026-11-10"
    };
  });
  const core = coreChecked.filter((e) => e && e.tier === "core");
  console.log("core verified:", core.length);

  /* 2) shop CSV → DNS + TLS + HTTP probe (live verification again, today) */
  const shops = [];
  if (fs.existsSync(CSV)) {
    const text = fs.readFileSync(CSV, "utf8").replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).filter(Boolean);
    const head = parseCsvLine(lines[0]).map((s) => s.trim());
    const idx = Object.fromEntries(head.map((h, i) => [h, i]));
    for (const line of lines.slice(1)) {
      const cells = parseCsvLine(line);
      const domain = norm(cells[idx.domain] || "");
      if (!isDomain(domain)) continue;
      if ((cells[idx.live_http200] || "") !== "1") continue;
      shops.push({
        domain,
        category: (cells[idx.category] || "Интернет-магазин").slice(0, 40) || "Интернет-магазин",
        note: String(cells[idx.shop_name] || "").slice(0, 80),
        tier: "shop"
      });
    }
  } else {
    console.log("! shop CSV not found, only core domains will be packed:", CSV);
  }
  console.log("shop rows eligible:", shops.length);

  const shopsChecked = await pool(shops, CONCURRENCY, async (e) => {
    const p = await probeDomain(e.domain);
    if (!p.ok) return null;
    return {
      domain: e.domain,
      category: e.category,
      note: e.note || "",
      tier: "shop",
      status: p.status,
      https: p.status,
      tls13_alpn: (p.tls13 ? "TLSv1.3, " : "TLSv1.2, ") + (p.alpn || "—"),
      ping_ms: p.ping_ms == null ? null : Math.round(p.ping_ms),
      asn_org: "",
      operator_whitelist: OPS_NONE,
      recommended_client: recommendedClient(e.category, "shop"),
      checked: "2026-11-10"
    };
  });
  const goodShops = shopsChecked.filter(Boolean);
  console.log("shop verified:", goodShops.length);

  /* 3) merge, dedupe, sort */
  const seen = new Set();
  const entries = [];
  for (const e of [...core, ...goodShops]) {
    if (seen.has(e.domain)) continue;
    seen.add(e.domain);
    entries.push(e);
  }
  entries.sort((a, b) => (a.tier === b.tier ? a.domain.localeCompare(b.domain) : a.tier === "core" ? -1 : 1));

  if (entries.length < 500) {
    console.error("FAIL: only " + entries.length + " domains verified, need 500+");
    process.exit(1);
  }

  /* 4) routing templates — cut out of the verified base, so buyers get the
   *    real files without re-typing 500+ domains */
  const coreSuffix = core.map((e) => e.domain);
  const shopSuffix = goodShops.map((e) => e.domain);
  const cap = (arr, n) => arr.slice(0, n);
  const templates = [
    {
      id: "sing-box",
      name: "Sing-Box route: RU прямое, остальное — прокси",
      body: {
        route: {
          rules: [
            { domain_suffix: cap(coreSuffix, 400), outbound: "direct" },
            { domain_suffix: cap(shopSuffix, 400), outbound: "direct" }
          ],
          final: "proxy"
        }
      },
      note: "Правила маршрутизации для Sing-Box / Happ: домены базы идут напрямую через LTE-канал, всё остальное — в туннель."
    },
    {
      id: "v2ray-routing",
      name: "v2rayNG / Nekoray routing (Routing Rules RU/Bypass)",
      body: {
        domainStrategy: "IPIfNonMatch",
        rules: [
          { type: "field", domain: cap(coreSuffix, 400), outboundTag: "direct" },
          { type: "field", domain: cap(shopSuffix, 400), outboundTag: "direct" }
        ]
      },
      note: "Импортируется в v2rayNG (Настройки → Routing) и Nekoray: РФ-домены напрямую, иностранные — через proxy."
    },
    {
      id: "amnezia-split",
      name: "AmneziaWG split-tunnel: список сайтов напрямую",
      body: {
        dns: { servers: [{ address: "1.1.1.1" }] },
        direct: cap(coreSuffix, 400).concat(cap(shopSuffix, 200)),
        note: "Split-site список для AmneziaVPN: сайтам из списка туннель не нужен."
      }
    },
    {
      id: "happ",
      name: "Happ — маршрутизация RU Direct",
      body: {
        name: "Toolworks SNI RU Direct (2026-11-10)",
        route_domains: cap(coreSuffix, 400),
        route_policy: "direct",
        default_outbound: "proxy",
        note: "Готовый список подстановки белого SNI для Happ."
      }
    }
  ];

  const generated = "2026-11-10T12:00:00.000Z";
  const data = {
    v: 2,
    product: "sni-whitelist",
    title: "Белые списки SNI (LTE РФ) — база доменов",
    note: "Каждая строка проверена живыми DNS+TLS+HTTPS-пробами при сборке пака. operator_whitelist — экспертная классификация, не гарантия оператора: попадание в белый список LTE решает оператор. Проверяйте на /net-whitelist/ из сети своей SIM.",
    generated_at: generated,
    total: entries.length,
    core: core.length,
    shops: goodShops.length,
    fields: ["domain", "category", "tls13_alpn", "ping_ms", "asn_org", "operator_whitelist", "recommended_client", "status", "tier", "note", "checked"],
    templates: templates,
    domains: entries
  };

  const pkg = encrypt(data);
  const body = JSON.stringify(pkg, null, 1);
  for (const dir of ["tg-chats", "net-whitelist"]) {
    const out = path.join(ROOT, dir);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "sni-pack.json.enc"), body);
  }

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(data, null, 2) + "\n");

  /* 5) free demo: 25 verified rows → catalog.js + free-domains.js + CSV */
  const free = FREE_PICK
    .map((d) => entries.find((e) => e.domain === d))
    .filter(Boolean)
    .slice(0, 25);
  if (free.length < 25) {
    for (const e of entries) {
      if (free.length >= 25) break;
      if (!free.some((x) => x.domain === e.domain)) free.push(e);
    }
  }
  const freeRows = free.length ? free : entries.slice(0, 25);
  const meta = {
    total: entries.length,
    core: core.length,
    shops: goodShops.length,
    generated_at: generated,
    free: freeRows.length,
    source: "DNS + TLS (ALPN) + HTTPS, 2026-11-10",
    disclaimer: "operator_whitelist — экспертная классификация; проверяйте живым тестером"
  };

  const catalogJs = [
    "/* generated by tools/build-sni-pack.mjs — do not edit by hand */",
    "window.SNI_META = " + JSON.stringify(meta) + ";",
    "window.SNI_FREE = " + JSON.stringify(freeRows, null, 1) + ";",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(ROOT, "net-whitelist/catalog.js"), catalogJs);
  fs.writeFileSync(path.join(ROOT, "net-whitelist/free-domains.js"), catalogJs);

  const csvHead = "domain,category,tls13_alpn,ping_ms,asn_org,operator_whitelist,recommended_client,http_status,checked";
  const csvLines = [csvHead];
  for (const e of freeRows) {
    csvLines.push([
      e.domain, e.category,
      '"' + String(e.tls13_alpn).replace(/"/g, "'") + '"',
      e.ping_ms == null ? "" : e.ping_ms,
      '"' + String(e.asn_org || "").replace(/"/g, "'") + '"',
      '"' + e.operator_whitelist + '"',
      '"' + e.recommended_client + '"',
      e.status || e.https || "", e.checked
    ].join(","));
  }
  fs.mkdirSync(path.join(ROOT, "downloads"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "downloads/sni-whitelist-demo-25.csv"), csvLines.join("\n") + "\n");

  console.log("packed:", entries.length, "(core", core.length + ", shops " + goodShops.length + ")");
  console.log("enc:", (body.length / 1024).toFixed(1) + " KB → tg-chats/sni-pack.json.enc, net-whitelist/sni-pack.json.enc");
  console.log("free:", freeRows.length, "→ net-whitelist/catalog.js, downloads/sni-whitelist-demo-25.csv");
  console.log("plaintext QA copy:", OUT_JSON);
})().catch((e) => { console.error(e); process.exit(1); });
