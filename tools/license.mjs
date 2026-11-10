#!/usr/bin/env node
/* Offline license keys for the freemium pages.
 *
 * A key is `TW1-<CODE>-<KID>-<SIG>`, where SIG is an ECDSA P-256 / SHA-256
 * signature over `TW1-<CODE>-<KID>`, encoded as base64url of the raw IEEE
 * P1363 r||s pair (64 bytes -> 86 characters, no padding).
 *
 * The public key is embedded in assets/verify.js and assets/unlock.js, so a
 * browser verifies a key with crypto.subtle and no network at all. The private
 * key never leaves this machine and is stored as 0600 next to the key lists.
 *
 *   node tools/license.mjs init                 # create the key pair (once)
 *   node tools/license.mjs gen --count 200      # write license_keys/*.txt
 *   node tools/license.mjs verify TW1-ADS-0001-...
 *   node tools/license.mjs pubkey               # JWK literal for the site JS
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const subtle = crypto.webcrypto.subtle;
const OUT = path.resolve(os.homedir(), "gemini/agent1_out");
const KEYFILE = path.join(OUT, ".license_signing_key.json");

/* Product code -> public slug. The code is what goes in the key; the slug is
   what pages hand to data-product / localStorage. Keep both in one place. */
export const PRODUCTS = [
  { code: "AUDIO", slug: "audio-dub-studio", name: "Audio Dub Extractor Studio", price: "$7 / 299 ₽" },
  { code: "TG", slug: "tg-chats", name: "TG Chat Analytics", price: "$12 / 499 ₽" },
  { code: "DOC", slug: "docsearch", name: "DocSearch", price: "$9 / 399 ₽" },
  { code: "NEWS", slug: "newsflow", name: "NewsFlow", price: "$12 / 499 ₽" },
  { code: "RADAR", slug: "live-radar", name: "Live Radar", price: "$9 / 399 ₽" },
  { code: "CLIP", slug: "data-clipper", name: "Data Clipper", price: "$9 / 399 ₽" },
  { code: "TAX", slug: "base-tax-audit", name: "Base Tax Audit", price: "$29 / 1190 ₽" },
  { code: "ALGO", slug: "algo-tycoon", name: "Algo Tycoon Pro", price: "249 ₽" },
  { code: "SNI", slug: "sni-whitelist", name: "SNI White List LTE RU", price: "99 ₽" },
  { code: "ALL", slug: "all-in-one", name: "All Products (universal key)", price: "$49 / 1990 ₽" }
];

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function b64u(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64uDecode(text) {
  const pad = text.length % 4 ? "=".repeat(4 - (text.length % 4)) : "";
  return Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function readKeyFile() {
  if (!fs.existsSync(KEYFILE)) return null;
  return JSON.parse(fs.readFileSync(KEYFILE, "utf8"));
}

function writeKeyFile(data) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(KEYFILE, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(KEYFILE, 0o600);
}

async function init() {
  if (fs.existsSync(KEYFILE)) {
    const k = readKeyFile();
    console.log("Ключ уже есть: " + KEYFILE);
    console.log("Отпечаток SHA-256: " + fingerprint(k.publicKeyJwk));
    return;
  }
  const pair = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const privateKeyJwk = await subtle.exportKey("jwk", pair.privateKey);
  const publicKeyJwk = await subtle.exportKey("jwk", pair.publicKey);
  const data = {
    version: 1,
    alg: "ECDSA-P256-SHA256",
    createdAt: new Date().toISOString(),
    keyId: "tw-" + new Date().toISOString().slice(0, 7),
    note:
      "Приватный ключ подписи офлайн-лицензий TW1-*. Хранить только здесь, права 600. " +
      "Если файл утечёт — любой сможет печатать ключи; тогда перегенерируйте пару, " +
      "замените PUBLIC_KEY в assets/verify.js и assets/unlock.js и выпустите новые ключи.",
    privateKeyJwk: {
      kty: privateKeyJwk.kty,
      crv: privateKeyJwk.crv,
      x: privateKeyJwk.x,
      y: privateKeyJwk.y,
      d: privateKeyJwk.d
    },
    publicKeyJwk: {
      kty: publicKeyJwk.kty,
      crv: publicKeyJwk.crv,
      x: publicKeyJwk.x,
      y: publicKeyJwk.y
    }
  };
  writeKeyFile(data);
  console.log("Создан " + KEYFILE + " (права 600)");
  console.log("Отпечаток SHA-256: " + fingerprint(data.publicKeyJwk));
  console.log("Публичный ключ для assets/verify.js:\n" + publicKeyLiteral(data.publicKeyJwk));
}

function fingerprint(jwk) {
  const raw = Buffer.concat([b64uDecode(jwk.x), b64uDecode(jwk.y)]);
  return crypto.createHash("sha256").update(raw).digest("hex").replace(/(.{4})/g, "$1 ").trim();
}

export function publicKeyLiteral(jwk) {
  return (
    "  const LICENSE_PUBLIC_KEY = {\n" +
    '    kty: "EC",\n' +
    '    crv: "P-256",\n' +
    '    x: "' + jwk.x + '",\n' +
    '    y: "' + jwk.y + '"\n' +
    "  };"
  );
}

async function signKey(privateJwk, code, kid) {
  const payload = "TW1-" + code + "-" + kid;
  const key = await subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(payload)
  );
  return payload + "-" + b64u(new Uint8Array(sig));
}

function randomKid(used) {
  for (let i = 0; i < 5000; i++) {
    let s = "";
    for (let j = 0; j < 6; j++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!used.has(s)) { used.add(s); return s; }
  }
  throw new Error("cannot allocate a unique key id");
}

const HEADERS = {
  AUDIO: "Audio Dub Extractor Studio — Pro ($7 / 299 ₽)",
  TG: "TG Chat Analytics — Pro ($12 / 499 ₽)",
  DOC: "DocSearch — Pro ($9 / 399 ₽)",
  NEWS: "NewsFlow — Pro ($12 / 499 ₽)",
  RADAR: "Live Radar — Pro ($9 / 399 ₽)",
  CLIP: "Data Clipper — Pro ($9 / 399 ₽)",
  TAX: "Base Tax Audit — Pro ($29 / 1190 ₽)",
  SNI: "SNI White List LTE RU — Pro (99 ₽)",
  ALL: "Универсальный ключ — открывает все продукты ($49 / 1990 ₽)"
};

async function gen(count) {
  const k = readKeyFile();
  if (!k) throw new Error("Сначала запустите: node tools/license.mjs init");
  const outDir = path.join(OUT, "license_keys");
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = [];
  for (const p of PRODUCTS) {
    const used = new Set();
    const lines = [];
    for (let i = 0; i < count; i++) {
      const kid = randomKid(used);
      lines.push(await signKey(k.privateKeyJwk, p.code, kid));
    }
    const body = lines.join("\n");

    const doc = [
      "# " + HEADERS[p.code],
      "# Продукт (data-product): " + p.slug + "   Код в ключе: " + p.code,
      "# Формат: TW1-<PRODUCT>-<KEY_ID>-<SIGNATURE> — подпись ECDSA P-256 / SHA-256,",
      "#         проверяется в браузере через crypto.subtle, без сервера и интернета.",
      "# Как активировать: откройте страницу продукта → «Разблокировать Pro» →",
      "#   вставьте ключ в поле «Хеш транзакции или лицензионный ключ» → «Проверить».",
      "#   Доступ открывается мгновенно и остаётся в этом браузере (localStorage).",
      "# Один ключ = одна продажа. Ключ многоразовый в браузере покупателя (это офлайн-лицензия).",
      "# Ниже " + count + " ключей, по одному в строке. Файл не публиковать: это склад.",
      "#", ""
    ].join("\n") + body + "\n";

    const file = path.join(outDir, p.slug + ".txt");
    fs.writeFileSync(file, doc, "utf8");
    for (const line of lines) {
      const kid = line.split("-")[2];
      manifest.push({ key: line, product: p.slug, code: p.code, kid });
    }
    console.log(p.slug.padEnd(18) + " " + count + " ключей → " + file);
  }

  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(
      {
        alg: "ECDSA-P256-SHA256",
        format: "TW1-<PRODUCT>-<KEY_ID>-<SIGNATURE>",
        publicKeyFingerprint: fingerprint(k.publicKeyJwk),
        generatedAt: new Date().toISOString(),
        counts: Object.fromEntries(PRODUCTS.map(p => [p.code, count])),
        products: PRODUCTS,
        keys: manifest
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  fs.writeFileSync(
    path.join(outDir, "manifest.csv"),
    "product,code,key_id,license_key\n" +
      manifest.map(m => [m.product, m.code, m.kid, m.key].join(",")).join("\n") + "\n",
    "utf8"
  );

  const total = manifest.length;
  console.log("\nИтого: " + total + " ключей, " + PRODUCTS.length + " файлов + manifest.json/csv");
  console.log("Публичный ключ (тот же, что вшит в сайт):\n" + publicKeyLiteral(k.publicKeyJwk));
}

async function verify(key) {
  const re = /^(TW1)-([A-Z0-9]+)-([A-Z0-9]{6})-([A-Za-z0-9_-]{86})$/;
  const m = re.exec(String(key || "").trim());
  if (!m) { console.error("FAIL: формат не совпал с TW1-<CODE>-<KEYID>-<SIG>"); process.exit(1); }
  const k = readKeyFile();
  const pub = await subtle.importKey("jwk", k.publicKeyJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    pub,
    b64uDecode(m[4]),
    new TextEncoder().encode(m[1] + "-" + m[2] + "-" + m[3])
  );
  console.log((ok ? "OK  " : "FAIL") + "  " + m[2] + "  kid=" + m[3] + "  " + (ok ? "подпись верна" : "подпись неверна"));
  if (!ok) process.exit(1);
}

const [cmd, ...rest] = process.argv.slice(2);
const arg = name => {
  const i = rest.indexOf("--" + name);
  return i === -1 ? null : rest[i + 1];
};
if (cmd === "init") await init();
else if (cmd === "gen") await gen(Number(arg("count") || 200));
else if (cmd === "verify") await verify(rest[0]);
else if (cmd === "pubkey") {
  const k = readKeyFile();
  console.log(publicKeyLiteral(k.publicKeyJwk));
} else {
  console.log("usage: license.mjs init | gen --count N | verify <key> | pubkey");
  process.exit(1);
}
