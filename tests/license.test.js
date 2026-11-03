/* Offline licence keys: one signing key, three copies of the verifier.
 *
 * Everything here runs without a browser, so a broken key format fails in CI
 * before a buyer ever sees "подпись не сходится".
 *
 *   node tests/license.test.js
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.resolve(process.env.HOME, "gemini/agent1_out");
const KEYS = path.join(OUT, "license_keys");
const PRIVATE = path.join(OUT, ".license_signing_key.json");

const V = require(path.join(ROOT, "assets/verify.js"));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  → " + extra : "")); }
}

/* Pull the licence block out of unlock.js and run it in Node. The page file is
   one IIFE and needs a DOM, but this block is pure: window.crypto is the only
   external thing it touches. */
function loadUnlockLicense() {
  const src = fs.readFileSync(path.join(ROOT, "assets/unlock.js"), "utf8");
  const start = src.indexOf("var LICENSE_PUBLIC_KEY");
  const end = src.indexOf("function key(product)");
  if (start === -1 || end === -1) throw new Error("licence block not found in unlock.js");
  const block = src.slice(start, end);
  const factory = new Function(
    "window",
    block + "\nreturn { parseLicenseKey, verifyLicenseKey, isLicenseKey, licenseCovers, LICENSE_PRODUCTS, LICENSE_PUBLIC_KEY };"
  );
  return factory({ crypto: crypto.webcrypto });
}

const U = loadUnlockLicense();

function keysOf(product) {
  return fs.readFileSync(path.join(KEYS, product + ".txt"), "utf8").split("\n").filter(l => l.startsWith("TW1-"));
}

(async () => {
  console.log("ключ подписи");
  ok("приватный ключ на месте", fs.existsSync(PRIVATE));
  if (fs.existsSync(PRIVATE)) {
    const mode = fs.statSync(PRIVATE).mode & 0o777;
    ok("права 600", mode === 0o600, mode.toString(8));
    const k = JSON.parse(fs.readFileSync(PRIVATE, "utf8"));
    ok("в файле есть приватная часть d", typeof k.privateKeyJwk.d === "string" && k.privateKeyJwk.d.length > 20);
    ok("алгоритм ECDSA P-256", k.alg === "ECDSA-P256-SHA256" && k.publicKeyJwk.crv === "P-256");
    ok("публичный x из verify.js = x из ключа", V.LICENSE_PUBLIC_KEY.x === k.publicKeyJwk.x);
    ok("публичный y из verify.js = y из ключа", V.LICENSE_PUBLIC_KEY.y === k.publicKeyJwk.y);
    ok("публичный ключ в unlock.js совпадает с verify.js",
      U.LICENSE_PUBLIC_KEY.x === V.LICENSE_PUBLIC_KEY.x && U.LICENSE_PUBLIC_KEY.y === V.LICENSE_PUBLIC_KEY.y);
    ok("в verify.js не утекло d", !JSON.stringify(V.LICENSE_PUBLIC_KEY).includes('"d"'));
  }

  console.log("карта продуктов");
  ok("8 продуктов", Object.keys(V.LICENSE_PRODUCTS).length === 8);
  ok("audio-dub-studio = AUDIO", V.LICENSE_PRODUCTS["audio-dub-studio"] === "AUDIO");
  ok("unlock.js знает все продукты verify.js", Object.keys(V.LICENSE_PRODUCTS).every(slug => U.LICENSE_PRODUCTS[slug] === V.LICENSE_PRODUCTS[slug]),
    JSON.stringify(U.LICENSE_PRODUCTS));
  /* The modal may add slug aliases (e.g. "tgchats" for pages that were built
     with the short name). What it must not do is disagree on a shared slug. */
  const shared = Object.keys(U.LICENSE_PRODUCTS).filter(s => V.LICENSE_PRODUCTS[s]);
  ok("на общих слагах коды совпадают", shared.every(s => U.LICENSE_PRODUCTS[s] === V.LICENSE_PRODUCTS[s]),
    JSON.stringify(shared.map(s => [s, U.LICENSE_PRODUCTS[s], V.LICENSE_PRODUCTS[s]])));
  ok("ALL универсален", V.licenseCovers("ALL", "newsflow") && U.licenseCovers("ALL", "audio-dub-studio"));
  ok("чужой код не универсален", !V.licenseCovers("NEWS", "audio-dub-studio"));

  console.log("разбор ключа");
  const first = keysOf("audio-dub-studio")[0];
  const parsed = V.parseLicense(first);
  ok("parse ok", parsed.ok === true);
  ok("код AUDIO", parsed.code === "AUDIO", parsed.code);
  ok("id 6 символов", /^[A-Z0-9]{6}$/.test(parsed.kid), parsed.kid);
  ok("подпись 86 символов base64url", /^[A-Za-z0-9_-]{86}$/.test(parsed.signature));
  ok("payload = TW1-CODE-KID", parsed.payload === "TW1-" + parsed.code + "-" + parsed.kid);
  ok("мусор не парсится", V.parseLicense("TW1-AUDIO-ABC").ok === false);
  ok("обрезанный ключ не парсится", V.parseLicense(first.slice(0, -1)).ok === false);
  ok("пустая строка не парсится", V.parseLicense("").ok === false);
  ok("isLicenseKey по префиксу", V.isLicenseKey("TW1-…") && !V.isLicenseKey("0xabc"));
  ok("unlock.js разбирает так же", U.parseLicenseKey(first).kid === parsed.kid);

  console.log("полное хранилище ключей");
  const products = Object.keys(V.LICENSE_PRODUCTS);
  let total = 0, good = 0, foreign = 0, foreignRejected = 0, universalCross = 0;
  for (const slug of products) {
    const file = path.join(KEYS, slug + ".txt");
    if (!fs.existsSync(file)) { console.log("  (нет файла " + slug + ".txt — сгенерируйте: node tools/license.mjs gen)"); continue; }
    const list = keysOf(slug);
    total += list.length;
    ok(slug + ": 200 ключей", list.length === 200, list.length);
    for (const key of list) {
      const r = await V.verifyLicense(key, { product: slug });
      if (r.valid) good++;
      else console.log("    битый ключ " + slug + ": " + r.error);
      if (slug === "all-in-one") {
        // the universal key must pass anywhere
        if ((await V.verifyLicense(key, { product: "docsearch" })).valid) universalCross++;
      } else {
        foreign++;
        const wrong = await V.verifyLicense(key, { product: slug === "newsflow" ? "docsearch" : "newsflow" });
        if (!wrong.valid && wrong.error === "product") foreignRejected++;
      }
    }
  }
  ok("все ключи проверяются", good === total && total === 1600, good + "/" + total);
  ok("ключи не открывают чужой продукт", foreignRejected === foreign, foreignRejected + "/" + foreign);
  ok("универсальный ALL открывает любой продукт", universalCross === 200, universalCross);

  const tamper = k => k.slice(0, -1) + (k.slice(-1) === "A" ? "B" : "A");
  const tampered = await V.verifyLicense(tamper(first), { product: "audio-dub-studio" });
  ok("подмена подписи отклонена", !tampered.valid && tampered.error === "signature");
  const spliced = first.replace(/-([A-Z0-9]{6})-/, "-ZZZZZZ-");
  const splicedRes = await V.verifyLicense(spliced, { product: "audio-dub-studio" });
  ok("подмена KEY_ID отклонена", !splicedRes.valid && splicedRes.error === "signature");
  const swapped = keysOf("newsflow")[0].replace(/^TW1-NEWS-/, "TW1-AUDIO-");
  const swappedRes = await V.verifyLicense(swapped, { product: "audio-dub-studio" });
  ok("переклеенный код продукта отклонён", !swappedRes.valid);

  console.log("совместимость двух реализаций");
  let diff = 0;
  for (const key of [first, keysOf("all-in-one")[0], tamper(first), "TW1-AUDIO-ABC"]) {
    const a = await V.verifyLicense(key, { product: "audio-dub-studio" });
    const b = await U.verifyLicenseKey(key, { product: "audio-dub-studio" });
    if (a.valid !== b.valid || a.error !== b.error) diff++;
  }
  ok("verify.js и unlock.js дают одинаковый вердикт", diff === 0, diff);

  console.log("производительность");
  const t0 = process.hrtime.bigint();
  await V.verifyLicense(first, { product: "audio-dub-studio" });
  const cold = Number(process.hrtime.bigint() - t0) / 1e6;
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < 50; i++) await V.verifyLicense(first, { product: "audio-dub-studio" });
  const warm = Number(process.hrtime.bigint() - t1) / 1e6 / 50;
  ok("проверка ключа укладывается в 10 мс (после импорта ключа)", warm < 10, warm.toFixed(3) + " мс (" + cold.toFixed(1) + " мс холодная)");

  console.log("\n" + pass + " ok, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
