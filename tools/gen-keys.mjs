#!/usr/bin/env node
/* Issue offline licence keys for one product without touching the others.
 *
 * tools/license.mjs `gen` regenerates every product file, which churns keys
 * that are already in stock. This script signs a single product and appends
 * the same records to the manifest, so an existing lot keeps its stock.
 *
 *   node tools/gen-keys.mjs --slug algo-tycoon --code ALGO --count 200 \
 *        --title "Algo Tycoon Pro — Симулятор алгоритмического трейдинга и пайплайнов"
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { webcrypto, randomInt } from "node:crypto";

const subtle = webcrypto.subtle;

/* Same encoding as tools/license.mjs. Inlined on purpose: that module runs
   its CLI on import, so importing it here would print usage and exit. */
function b64u(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const OUT = path.resolve(os.homedir(), "gemini/agent1_out");
const KEYS = path.join(OUT, "license_keys");
const KEYFILE = path.join(OUT, ".license_signing_key.json");
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const slug = arg("slug");
const code = arg("code");
const count = Number(arg("count", "200"));
const title = arg("title", slug);
const price = arg("price", "");

if (!slug || !code || !Number.isFinite(count) || count < 1) {
  console.error("usage: node tools/gen-keys.mjs --slug <slug> --code <CODE> --count <n> [--title ...] [--price ...]");
  process.exit(2);
}
if (!/^[A-Z]{2,8}$/.test(code)) {
  console.error("code must be 2-8 uppercase letters");
  process.exit(2);
}
if (!fs.existsSync(KEYFILE)) {
  console.error("missing signing key: " + KEYFILE + " (run: node tools/license.mjs init)");
  process.exit(2);
}

const key = JSON.parse(fs.readFileSync(KEYFILE, "utf8"));
const privateKey = await subtle.importKey(
  "jwk",
  key.privateKeyJwk,
  { name: "ECDSA", namedCurve: "P-256" },
  false,
  ["sign"]
);

async function signKey(kid) {
  const payload = "TW1-" + code + "-" + kid;
  const sig = await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(payload)
  );
  return payload + "-" + b64u(new Uint8Array(sig));
}

function randomKid(used) {
  for (let i = 0; i < 5000; i++) {
    let s = "";
    for (let j = 0; j < 6; j++) s += ALPHABET[randomInt(ALPHABET.length)];
    if (!used.has(s)) {
      used.add(s);
      return s;
    }
  }
  throw new Error("cannot allocate a unique key id");
}

const used = new Set();
const lines = [];
for (let i = 0; i < count; i++) lines.push(await signKey(randomKid(used)));

const header = [
  "# " + title + " — Pro" + (price ? " (" + price + ")" : ""),
  "# Продукт (data-product): " + slug + "   Код в ключе: " + code,
  "# Формат: TW1-<PRODUCT>-<KEY_ID>-<SIGNATURE> — подпись ECDSA P-256 / SHA-256,",
  "#         проверяется в браузере через crypto.subtle, без сервера и интернета.",
  "# Как активировать: откройте страницу продукта → «Разблокировать Pro» →",
  "#   вставьте ключ в поле «Хеш транзакции или лицензионный ключ» → «Проверить».",
  "#   Доступ открывается мгновенно и остаётся в этом браузере (localStorage).",
  "# Один ключ = одна продажа. Ключ многоразовый в браузере покупателя (это офлайн-лицензия).",
  "# Ниже " + count + " ключей, по одному в строке. Файл не публиковать: это склад.",
  "#",
  ""
].join("\n");

fs.mkdirSync(KEYS, { recursive: true });
const file = path.join(KEYS, slug + ".txt");
fs.writeFileSync(file, header + lines.join("\n") + "\n", "utf8");
console.log(slug + "  " + count + " keys -> " + path.relative(OUT, file));

/* Manifest: keep one record per key so a delivered key can be traced. */
const manifestJson = path.join(KEYS, "manifest.json");
if (fs.existsSync(manifestJson)) {
  const m = JSON.parse(fs.readFileSync(manifestJson, "utf8"));
  m.keys = (m.keys || []).filter((r) => r.product !== slug);
  for (const line of lines) {
    m.keys.push({ key: line, product: slug, code, kid: line.split("-")[2] });
  }
  m.counts = m.counts || {};
  m.counts[code] = count;
  m.products = (m.products || []).filter((p) => p.code !== code);
  m.products.push({ code, slug, name: title, price });
  m.updatedAt = new Date().toISOString();
  fs.writeFileSync(manifestJson, JSON.stringify(m, null, 2) + "\n");
  console.log("manifest.json updated");
}

const manifestCsv = path.join(KEYS, "manifest.csv");
if (fs.existsSync(manifestCsv)) {
  const others = fs
    .readFileSync(manifestCsv, "utf8")
    .split("\n")
    .filter((ln) => ln && !ln.startsWith("product,") && !ln.startsWith(slug + ","));
  const rows = ["product,code,key_id,license_key", ...others];
  for (const line of lines) {
    rows.push([slug, code, line.split("-")[2], line].join(","));
  }
  fs.writeFileSync(manifestCsv, rows.join("\n") + "\n");
  console.log("manifest.csv updated");
}
