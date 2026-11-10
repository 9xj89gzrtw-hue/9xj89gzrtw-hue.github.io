/* Shared on-chain unlock for static freemium pages.
 * No backend: a Base mainnet USDC transfer to PAY_TO is the entitlement.
 * The page stores the redeemed hash in localStorage; the same hash cannot
 * unlock twice in one browser. Verification is a plain eth_getTransactionReceipt
 * against four public RPCs. */
(function (root) {
  "use strict";

  const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const PAY_TO = "0x72Aa6edDE71B94f6b99c8e52EdC02B5C75F74d1a";
  const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const RPCS = [
    "https://mainnet.base.org",
    "https://base-rpc.publicnode.com",
    "https://base.llamarpc.com",
    "https://1rpc.io/base"
  ];
  const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

  const pad32 = h => "0x" + h.replace(/^0x/, "").toLowerCase().padStart(64, "0");

  async function rpc(method, params) {
    let last;
    for (const url of RPCS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
        });
        const j = await res.json();
        if (j.error) throw new Error(j.error.message);
        return j.result;
      } catch (e) { last = e; }
    }
    throw last || new Error("RPC unavailable");
  }

  function sumUsdc(receipt, to) {
    const want = pad32(to);
    let total = 0n;
    for (const l of receipt.logs || []) {
      if (String(l.address).toLowerCase() !== USDC) continue;
      if (String(l.topics && l.topics[0]).toLowerCase() !== TRANSFER) continue;
      if (String(l.topics[2]).toLowerCase() !== want) continue;
      total += BigInt(l.data);
    }
    return total;
  }

  function create(opts) {
    const price = BigInt(opts.priceUnits);
    const key = opts.storageKey;
    const usedKey = key + ":used";

    function used() {
      try { return JSON.parse(localStorage.getItem(usedKey) || "[]"); }
      catch (e) { return []; }
    }
    function markUsed(h) {
      try {
        const list = used();
        if (!list.includes(h)) list.push(h);
        localStorage.setItem(usedKey, JSON.stringify(list.slice(-100)));
      } catch (e) { /* private mode: degrade replay protection, still unlocks */ }
    }
    function isPro() {
      try { return localStorage.getItem(key) === "1"; } catch (e) { return false; }
    }
    function grant() {
      try { localStorage.setItem(key, "1"); } catch (e) { /* ignore */ }
    }

    async function verify(hash) {
      const clean = String(hash || "").trim();
      if (!HASH_RE.test(clean)) throw new Error("Это не хеш транзакции: нужно 0x и 64 шестнадцатеричных символа.");
      const h = clean.toLowerCase();
      if (used().includes(h)) throw new Error("Этот хеш уже использован в этом браузере.");
      const receipt = await rpc("eth_getTransactionReceipt", [h]);
      if (!receipt) throw new Error("Транзакция не найдена. Подождите подтверждения в сети и попробуйте снова.");
      if (receipt.status !== "0x1") throw new Error("Транзакция отменена — оплата не прошла.");
      const received = sumUsdc(receipt, PAY_TO);
      if (received === 0n) throw new Error("В транзакции нет перевода USDC на адрес " + PAY_TO.slice(0, 6) + "…" + PAY_TO.slice(-4) + ".");
      if (received < price) throw new Error("Получено " + (Number(received) / 1e6).toFixed(2) + " USDC — меньше цены Pro.");
      markUsed(h);
      grant();
      return { received, hash: h };
    }

    function reset() {
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    }

    /* Grant from a verification done elsewhere (the one-click flow checks the
       chain itself and hands the hash back). Keeps the entitlement in the same
       storage key this page already reads. */
    function activate(hash) {
      if (hash) markUsed(String(hash).toLowerCase());
      grant();
    }

    return { isPro, verify, activate, reset, PAY_TO, priceUnits: price };
  }

  root.ProUnlock = { create, PAY_TO, USDC, RPCS };
})(window);

/* --- second entry point ------------------------------------------------
   The NewsFlow and TG Chat pages use a richer API: a product registry, a
   modal that shows the address and the price, and verifyAtLeast() from
   verify.js. Same address, same receipt logic, separate storage keys, so the
   two APIs can coexist without touching each other's entitlements. */
/* Freemium unlock: reads a Base transaction, confirms the USDC transfer, and
 * stores the entitlement in this browser. No server, no account, no email. */
(function () {
  "use strict";

  var PAY_TO = "0x72Aa6edDE71B94f6b99c8e52EdC02B5C75F74d1a";
  var USDC_DECIMALS = 6;

  /* --- offline license keys (TW1-…), verified in the browser -------------
   *
   * Card / SBP buyers get a key from the shop's auto-delivery: TW1-<CODE>-
   * <KEY_ID>-<SIGNATURE>. SIGNATURE is an ECDSA P-256 / SHA-256 signature over
   * "TW1-<CODE>-<KEY_ID>", base64url of the raw 64-byte r||s pair. The public
   * key below checks it with crypto.subtle, so Pro opens in ~10 ms with no
   * network, no bot and no one reading screenshots of receipts.
   *
   * The private key never ships: it stays offline, see tools/license.mjs.
   * CODE "ALL" is universal. Same constants live in assets/verify.js — a test
   * asserts the two copies and the signing key agree.
   */
  var LICENSE_PUBLIC_KEY = {
    kty: "EC",
    crv: "P-256",
    x: "YVH3fyYkuivpkuKQjUqw02XxX3mO5FadXsxijuK52so",
    y: "POqoRl3cMmg1UUxmwpCDBj2q3kVqwuH-EySTT3zcefQ"
  };

  var LICENSE_PRODUCTS = {
    "audio-dub-studio": "AUDIO",
    "tg-chats": "TG",
    "tgchats": "TG",
    "docsearch": "DOC",
    "archive-studio": "DOC",
    "newsflow": "NEWS",
    "live-radar": "RADAR",
    "data-clipper": "CLIP",
    "base-tax-audit": "TAX",
    "algo-tycoon": "ALGO",
    "sni-whitelist": "SNI",
    "all-in-one": "ALL"
  };

  /* --- card / SBP checkout, for buyers who have no USDC -------------------
   *
   * Live listings on Plati.Market (Digiseller, seller 1481449). `id` is the
   * listing number; `rub` is the rouble price the checkout page shows, read
   * back from the shop API — not the USD price converted at an invented rate.
   * Auto-delivery hands over a TW1-… key the second the payment clears, and
   * the field in this modal accepts it.
   *
   * The table below is the shipped fallback. `assets/shop.js` (generated by
   * tools/sync-shop.mjs from agent2_out/digiseller_tw1_stock.json) overrides
   * it, so a new lot goes live without touching page code. `id: null` means
   * "not listed yet": the button is not rendered instead of pointing at a 404.
   */
  var SHOP_DEFAULTS = {
    "audio-dub-studio": { id: 6354599, rub: 199.04, display: 199 },
    "tgchats": { id: 6354600, rub: 490.44, display: 490 },
    "tg-chats": { id: 6354600, rub: 490.44, display: 490 },
    "docsearch": { id: 6354601, rub: 690.46, display: 690 },
    "archive-studio": { id: 6354601, rub: 690.46, display: 690 },
    "data-clipper": { id: 6354602, rub: 299.51, display: 299 },
    "newsflow": { id: 6358143, rub: 390.42, display: 390 },
    "live-radar": { id: 6358155, rub: 390.42, display: 390 },
    "base-tax-audit": { id: 6358164, rub: 490.44, display: 490 },
    "algo-tycoon": { id: 6365339, rub: 148.79, display: 149 },
    "all-in-one": { id: 6326936, rub: 1289.55, display: 1290 }
  };
  var SELLER_ID = 1481449;
  var BUNDLE_PRICE_USD = 14.99;
  var BUNDLE_PRICE_RUB = 1289.55;

  function has(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }

  function shopEntry(product) {
    var slug = String(product || "").toLowerCase();
    var ext = (typeof window !== "undefined" && window.SHOP) || null;
    if (ext) {
      var src = ext.products || ext;
      if (src && has(src, slug) && src[slug]) {
        var e = src[slug];
        return {
          id: Number(e.id) || null,
          rub: Number(e.price_rub || e.rub) || null,
          /* price_rub is the exact cash-desk total (with kopecks, follows the
             rouble rate); display_rub is the rounded price printed on the
             storefront. Both are shown, so 490 ₽ never turns into 493 ₽. */
          display: Number(e.display_rub) || Number(e.price_rub || e.rub) || null,
          note: e.note || ""
        };
      }
      var b = ext.bundle;
      if (slug === "all-in-one" && b) {
        return {
          id: Number(b.id) || null,
          rub: Number(b.price_rub || b.rub) || null,
          display: Number(b.display_rub) || Number(b.price_rub || b.rub) || null,
          note: b.note || ""
        };
      }
    }
    return has(SHOP_DEFAULTS, slug) ? SHOP_DEFAULTS[slug] : null;
  }

  function cardUrl(id) {
    return "https://oplata.info/asp2/pay_wm.asp?id_d=" + id + "&ai=" + SELLER_ID + "&lang=ru-RU";
  }

  /* Rounded storefront price: 490 ₽ while the cash desk may charge 492,74 ₽. */
  function rubDisplay(shop) {
    var n = Number(shop && (shop.display || shop.rub));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  var LICENSE_CODE_SLUG = (function () {
    var out = {};
    for (var slug in LICENSE_PRODUCTS) {
      if (Object.prototype.hasOwnProperty.call(LICENSE_PRODUCTS, slug)) out[LICENSE_PRODUCTS[slug]] = slug;
    }
    return out;
  })();
  var UNIVERSAL_CODE = "ALL";
  var UNIVERSAL_STORE = "unlock:universal";
  var ALL_SLUG = "all-in-one";

  /* The same product appears under two ids in the wild (the TG page says
     "tgchats", the archive page says "archive-studio"). One canonical slug
     keeps a single entitlement from splitting in two. */
  var PRODUCT_ALIAS = {
    tgchats: "tg-chats",
    "archive-studio": "docsearch"
  };
  function canon(product) {
    var p = String(product || "").toLowerCase();
    return has(PRODUCT_ALIAS, p) ? PRODUCT_ALIAS[p] : p;
  }

  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }

  /* Universal entitlement: written once when a TW1-ALL key (or the $14.99
     All-in-One pass) is accepted. Every page asks the same record, so one key
     opens all eight tools without per-product re-activation. */
  function universalRecord() {
    var rec = null;
    try { rec = JSON.parse(lsGet(UNIVERSAL_STORE) || "null"); } catch (e) { return null; }
    if (!rec) return null;
    if (rec.expires && Number(rec.expires) < Date.now()) return null;
    return rec;
  }
  function hasUniversal() { return !!universalRecord(); }

  /* 60-second demo. Memory only: it never touches unlock:* records, so a
     reload returns the page to Free and no encrypted pack can be decrypted
     because the key material was never entered. */
  var PREVIEW = { slug: "", until: 0, timer: null };
  function previewActive(product) {
    if (!PREVIEW.until) return false;
    if (Date.now() >= PREVIEW.until) { stopPreview(); return false; }
    if (!product) return true;
    if (PREVIEW.slug === ALL_SLUG) return true;
    return canon(product) === PREVIEW.slug;
  }
  function previewRemaining() {
    return PREVIEW.until ? Math.max(0, Math.ceil((PREVIEW.until - Date.now()) / 1000)) : 0;
  }
  function fireChanged(extra) {
    try {
      document.dispatchEvent(new CustomEvent("unlock:changed", {
        detail: Object.assign({ product: PREVIEW.slug || null }, extra || {})
      }));
    } catch (e) { /* very old browser: the page still re-reads on next paint */ }
  }
  function startPreview(product, seconds) {
    PREVIEW.slug = canon(product || ALL_SLUG);
    PREVIEW.until = Date.now() + Math.max(5, Number(seconds) || 60) * 1000;
    if (PREVIEW.timer) clearTimeout(PREVIEW.timer);
    PREVIEW.timer = setTimeout(function () {
      PREVIEW.until = 0;
      PREVIEW.timer = null;
      fireChanged({ preview: false });
    }, Math.max(5, Number(seconds) || 60) * 1000);
    fireChanged({ preview: true, seconds: Math.max(5, Number(seconds) || 60) });
    return PREVIEW.until;
  }
  function stopPreview() {
    if (PREVIEW.timer) clearTimeout(PREVIEW.timer);
    PREVIEW.timer = null;
    PREVIEW.until = 0;
    PREVIEW.slug = "";
    fireChanged({ preview: false });
  }

  function b64uToBytes(text) {
    var b64 = String(text).replace(/-/g, "+").replace(/_/g, "/");
    var pad = b64.length % 4 ? new Array(5 - (b64.length % 4)).join("=") : "";
    var bin = atob(b64 + pad);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* The signature is case-sensitive base64url and may contain "-", so the key
     is cut from the left by shape, never by lastIndexOf("-"). */
  function parseLicenseKey(text) {
    var clean = String(text == null ? "" : text).trim().replace(/\s+/g, "");
    var m = /^(TW1)-([A-Z0-9]{2,8})-([A-Z0-9]{6})-(.+)$/i.exec(clean);
    if (!m) return { ok: false, error: "format", key: clean };
    if (!/^[A-Za-z0-9_-]{86}$/.test(m[4])) return { ok: false, error: "format", key: clean };
    var code = m[2].toUpperCase();
    var kid = m[3].toUpperCase();
    return {
      ok: true,
      code: code,
      kid: kid,
      payload: "TW1-" + code + "-" + kid,
      signature: m[4],
      key: "TW1-" + code + "-" + kid + "-" + m[4]
    };
  }

  function isLicenseKey(text) {
    return /^TW1-/i.test(String(text == null ? "" : text).trim());
  }

  function licenseCovers(code, product) {
    if (!product) return true;
    var slug = String(product).toLowerCase();
    /* The SNI/white-list pack is bundled with TG Pro: buyers who already hold
       a TW1-TG key must not need a second purchase. A dedicated TW1-SNI key
       (issued later) is accepted too, so the pack can also be sold alone. */
    if (slug === "sni-whitelist" && (code === "SNI" || code === "TG")) return true;
    var want = LICENSE_PRODUCTS[slug] || (/^[A-Z0-9]{2,8}$/i.test(product) ? String(product).toUpperCase() : null);
    if (!want) return false;
    return code === UNIVERSAL_CODE || code === want;
  }

  var licenseKeyPromise = null;
  function licenseCryptoKey() {
    if (!licenseKeyPromise) {
      var subtle = window.crypto && window.crypto.subtle;
      if (!subtle) return Promise.reject(new Error("crypto.subtle unavailable"));
      licenseKeyPromise = subtle.importKey("jwk", LICENSE_PUBLIC_KEY,
        { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    }
    return licenseKeyPromise;
  }

  /* Never rejects: resolves {valid, code, kid, slug, key, error?}. */
  async function verifyLicenseKey(text, opts) {
    var o = opts || {};
    var parsed = parseLicenseKey(text);
    if (!parsed.ok) return { valid: false, error: "format", key: parsed.key };
    var product = o.product == null ? null : String(o.product).toLowerCase();
    try {
      var key = await licenseCryptoKey();
      var sig = b64uToBytes(parsed.signature);
      if (sig.length !== 64) return { valid: false, error: "signature", code: parsed.code, kid: parsed.kid };
      var ok = await window.crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig,
        new TextEncoder().encode(parsed.payload));
      if (!ok) return { valid: false, error: "signature", code: parsed.code, kid: parsed.kid };
    } catch (e) {
      return { valid: false, error: "crypto", code: parsed.code, kid: parsed.kid, message: String((e && e.message) || e) };
    }
    var slug = LICENSE_CODE_SLUG[parsed.code] || null;
    if (!licenseCovers(parsed.code, product)) {
      return { valid: false, error: "product", code: parsed.code, kid: parsed.kid, slug: slug, key: parsed.key };
    }
    var verdict = {
      valid: true, code: parsed.code, kid: parsed.kid, slug: slug, key: parsed.key,
      universal: parsed.code === UNIVERSAL_CODE
    };
    /* Verification and entitlement are one step: a page that checks a key in
       its own modal must grant exactly what the shared modal would, including
       the all-products grant for TW1-ALL. */
    if (o.grant !== false) {
      try { grantLicense(verdict); } catch (e) { /* storage full: page still opens */ }
    }
    return verdict;
  }

  function canonSlug(product) {
    var p = canon(product);
    if (has(LICENSE_PRODUCTS, p)) return p;
    var up = String(product || "").toUpperCase();
    if (has(LICENSE_CODE_SLUG, up)) return LICENSE_CODE_SLUG[up];
    return p;
  }

  function key(product) { return "unlock:" + canonSlug(product); }
  function usedKey() { return "unlock:used"; }

  function readJSON(k, fallback) {
    try { return JSON.parse(localStorage.getItem(k)) || fallback; } catch (e) { return fallback; }
  }

  /* Old pages stored the entitlement under the raw id ("unlock:tgchats"), so a
     canonical read falls back to it; nothing already sold stops working. */
  function readState(product) {
    var direct = readJSON(key(product), null);
    if (direct) return direct;
    return readJSON("unlock:" + String(product || "").toLowerCase(), null);
  }

  function isPro(product) {
    var rec = readState(product);
    if (rec && rec.hash) return true;
    if (hasUniversal()) return true;
    return previewActive(product);
  }

  function state(product) { return readState(product); }

  /* Write the one universal record plus a per-product mirror. The mirror is
     what keeps pages that predate this file (and the legacy ProUnlock keys) in
     step: one ALL key, every tool, no second activation. */
  function grantAll(data) {
    var rec = {
      hash: data.hash,
      received: String(data.received == null ? 0 : data.received),
      at: new Date().toISOString(),
      price: data.price == null ? BUNDLE_PRICE_USD : data.price,
      kind: data.kind || "license",
      code: data.code || UNIVERSAL_CODE,
      kid: data.kid || null
    };
    var blob = JSON.stringify(rec);
    lsSet(UNIVERSAL_STORE, blob);
    for (var slug in LICENSE_PRODUCTS) {
      if (has(LICENSE_PRODUCTS, slug)) lsSet("unlock:" + slug, blob);
    }
    /* Storage keys read by pages that have their own gate. */
    lsSet("archive-studio:pro", "1");
    lsSet("live-radar:pro", "1");
    lsSet("algo_tycoon_pro_v1", "1");
    return rec;
  }

  function activate(product, data) {
    var slug = canonSlug(product);
    var rec = {
      hash: data.hash,
      received: String(data.received),
      at: new Date().toISOString(),
      price: data.price,
      kind: data.kind || "chain",
      code: data.code || null,
      kid: data.kid || null
    };
    lsSet(key(slug), JSON.stringify(rec));
    var used = readJSON(usedKey(), []);
    if (used.indexOf(data.hash) === -1) used.push(data.hash);
    lsSet(usedKey(), JSON.stringify(used));
    if (slug === ALL_SLUG || data.code === UNIVERSAL_CODE || data.universal) grantAll(rec);
    fireChanged({ product: slug });
    return rec;
  }

  /* Everything a verified key implies, in one place: a product key opens its
     own tool, an ALL key opens all eight. Called by verifyLicenseKey() so every
     page's own verification path (not just the shared modal) lands here. */
  function grantLicense(lic) {
    if (!lic || !lic.valid) return null;
    if (lic.code === UNIVERSAL_CODE) {
      return grantAll({
        hash: "license:" + lic.key,
        kind: "license",
        code: UNIVERSAL_CODE,
        kid: lic.kid,
        price: BUNDLE_PRICE_USD
      });
    }
    var slug = lic.slug || LICENSE_CODE_SLUG[lic.code] || null;
    if (slug) {
      activate(slug, {
        hash: "license:" + lic.key,
        received: 0,
        kind: "license",
        code: lic.code,
        kid: lic.kid,
        price: 0
      });
    }
    return slug;
  }

  function deactivate(product) {
    try { localStorage.removeItem(key(product)); } catch (e) { /* ignore */ }
    fireChanged({ product: canonSlug(product) });
  }

  function short(addr) { return addr.slice(0, 6) + "…" + addr.slice(-4); }

  function toast(message, bad) {
    var zone = document.querySelector(".toast-zone");
    if (!zone) {
      zone = document.createElement("div");
      zone.className = "toast-zone";
      document.body.appendChild(zone);
    }
    var el = document.createElement("div");
    el.className = "toast" + (bad ? " bad" : "");
    el.setAttribute("role", "status");
    el.textContent = message;
    zone.appendChild(el);
    setTimeout(function () { el.remove(); }, bad ? 7000 : 3400);
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { toast("Copied"); },
        function () { fallbackCopy(text); });
    }
    fallbackCopy(text);
    return Promise.resolve();
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast(T.copied); } catch (e) { toast(T.copyFailed, true); }
    ta.remove();
  }

  var modalEl = null;

  /* The modal is shared by every tool page; two pages are Russian, the rest are
     English, so the copy follows <html lang>. */
  var RU = document.documentElement.lang === "ru";
  var T = RU ? {
    title: "Разблокировать ",
    sub: "Оплата один раз. Работает в этом браузере.",
    onBase: "в USDC на Base",
    copy: "Копировать",
    steps: [
      "Переведите точную сумму USDC в сети Base на адрес выше.",
      "Скопируйте хеш транзакции из кошелька.",
      "Вставьте его ниже. Страница читает Base напрямую и включает инструменты в этом браузере."
    ],
    hash: "Хеш транзакции или лицензионный ключ",
    exchange: "Если платили переводом, хеш транзакции тоже подходит: страница сама прочитает квитанцию в Base.",
    placeholder: "TW1-… (ключ) или 0x… (хеш Base)",
    cancel: "Отмена",
    verify: "Проверить оплату",
    checking: "Проверяем в Base…",
    copied: "Скопировано",
    copyFailed: "Не удалось скопировать — выделите адрес вручную",
    unlocked: "Pro открыт. Подтверждено в Base: ",
    confirmed: " USDC.",
    close: "Закрыть",
    noReceipt: "Платежа пока нет: транзакция неизвестна или ещё не подтверждена. Подождите и повторите.",
    reverted: "Транзакция отменена (status 0). Перевода не было, доступ не открывается.",
    noTransfer: "В транзакции нет перевода USDC на наш адрес. Если платили с биржи, хеш вывода — это хеш биржи: найдите перевод, который он создал.",
    redeemed: "Этот хеш уже использован в этом браузере.",
    badHash: "Это не хеш транзакции: нужны 0x и 64 шестнадцатеричных символа.",
    oneClick: "Оплатить в 1 клик Base USDC",
    oneClickHint: "MetaMask · Rabby · Base Wallet — кошелёк сам переключится на Base и подтвердит перевод",
    noWallet: "Кошелёк в браузере не найден. Оплатите картой или ключом выше — или откройте страницу в MetaMask, Rabby или Base Wallet.",
    connecting: "Подключаем кошелёк…",
    switching: "Переключаемся на Base…",
    sending: "Подтвердите перевод в кошельке…",
    waiting: "Ждём подтверждение в Base…",
    verifying: "Проверяем перевод…",
    rejected: "Вы отклонили транзакцию в кошельке. Ничего не отправлено.",
    pending: "Транзакция ещё не подтверждена. Хеш сохранён — вставьте его ниже через минуту.",
    orManual: "Перевод USDC на Base вручную",
    manualTitle: "Хеш транзакции или уже купленный ключ",
    oneClickUnlocked: "Pro открыт в 1 клик. Подтверждено в Base: ",
    licenseUnlocked: "Ключ принят. Pro открыт офлайн, без запросов к сети: ",
    licenseErrorFormat: "Это не ключ TW1: нужен формат TW1-<КОД>-<ID>-<ПОДПИСЬ>. Проверьте, что строка скопирована целиком.",
    licenseErrorSignature: "Подпись ключа не сходится — вероятно, ключ скопирован не полностью или изменён. Скопируйте его из письма ещё раз.",
    licenseErrorProduct: "Ключ выпущен для другого продукта. Для этого инструмента нужен свой ключ или универсальный ALL.",
    licenseErrorCrypto: "Браузер не дал проверить подпись (crypto.subtle). Откройте страницу по https и повторите.",
    cardPay: "Купить Pro — Карта РФ / СБП",
    cardHint: "Карта РФ, СБП или СберБанк Онлайн на Plati.Market. Ключ TW1-… выдаётся автоматически сразу после оплаты: вернитесь сюда, вставьте его ниже — Pro включится без переписки.",
    human: "Мгновенная автовыдача: сразу после оплаты СБП/картой или USDC вы получаете бессрочный ключ вида TW1-…, который открывает полную версию прямо в браузере — без регистрации, подписок и установки.",
    keyTitle: "Уже есть ключ?",
    keyHint: "Вставьте ключ TW1-… или хеш перевода USDC — Pro включится в этом браузере.",
    keyBtn: "Активировать ключ",
    cardNote: "Ключ действует бессрочно. Он привязан к вашему заказу — не публикуйте его.",
    cardPending: "Оплата картой для этого инструмента ещё не открыта. USDC на Base и ключ TW1-… работают уже сейчас.",
    bundleTitle: "All-in-One Pro Pass — $14.99",
    bundleSub: "Все 9 инструментов одним ключом TW1-ALL-…, бессрочно. Один платёж вместо девяти.",
    bundlePay: "Всё за $14.99 в 1 клик",
    bundleCard: "Карта РФ / СБП",
    bundleSoon: "Лот бандла ещё не открыт. Base USDC в 1 клик работает уже сейчас, ключ TW1-ALL-… принимается на любой странице.",
    bundleDone: "All-in-One Pro Pass активирован: все 8 инструментов открыты в этом браузере."
  } : {
    title: "Unlock ",
    sub: "One payment. Keeps working in this browser.",
    onBase: "in USDC on Base",
    copy: "Copy",
    steps: [
      "Send the exact amount of USDC on the Base network to the address above.",
      "Copy the transaction hash from your wallet.",
      "Paste it below. This page reads Base directly and unlocks the tools in this browser."
    ],
    hash: "Transaction hash or license key",
    exchange: "If you paid by transfer, the transaction hash works too: this page reads the Base receipt itself.",
    placeholder: "TW1-… (key) or 0x… (Base hash)",
    cancel: "Cancel",
    verify: "Verify payment",
    checking: "Checking Base\u2026",
    copied: "Copied",
    copyFailed: "Copy failed \u2014 select the text manually",
    unlocked: "Pro unlocked. ",
    confirmed: " USDC confirmed on Base.",
    close: "Close",
    noReceipt: "",
    reverted: "",
    noTransfer: "",
    redeemed: "",
    badHash: "",
    oneClick: "Pay in 1 Click — Base USDC",
    oneClickHint: "MetaMask · Rabby · Base Wallet — the wallet switches to Base and confirms the transfer itself",
    noWallet: "No browser wallet found. Pay by card or with a key above, or open this page inside MetaMask, Rabby or Base Wallet.",
    connecting: "Connecting wallet…",
    switching: "Switching to Base…",
    sending: "Confirm the transfer in your wallet…",
    waiting: "Waiting for a Base confirmation…",
    verifying: "Checking the transfer…",
    rejected: "You rejected the transaction in your wallet. Nothing was sent.",
    pending: "The transaction is not confirmed yet. The hash is kept — paste it below in a minute.",
    orManual: "USDC transfer on Base, manually",
    manualTitle: "Transaction hash or a key you already bought",
    oneClickUnlocked: "Pro unlocked in one click. Confirmed on Base: ",
    licenseUnlocked: "Key accepted. Pro unlocked offline, with zero network calls: ",
    licenseErrorFormat: "That is not a TW1 key. The format is TW1-<CODE>-<ID>-<SIGNATURE>; make sure the whole line is pasted.",
    licenseErrorSignature: "The key signature does not match — it was probably copied partially or edited. Paste it again from the mail.",
    licenseErrorProduct: "This key is issued for another product. Use that product's key, or a universal ALL key.",
    licenseErrorCrypto: "The browser refused to check the signature (crypto.subtle). Open the page over https and retry.",
    cardPay: "Buy Pro — card / instant transfer",
    cardHint: "Card or instant bank transfer on Plati.Market. The TW1-… key is delivered automatically right after checkout: come back here, paste it below, and Pro opens with no back-and-forth.",
    human: "Instant delivery: right after a card, bank-transfer or USDC payment you get a lifetime TW1-… key that opens the full version in this browser — no account, no subscription, no install.",
    keyTitle: "Already have a key?",
    keyHint: "Paste a TW1-… key or a USDC transfer hash — Pro opens in this browser.",
    keyBtn: "Activate key",
    cardNote: "The key never expires. It is tied to your order, so keep it private.",
    cardPending: "This card listing is not live yet. Base USDC in one click and a TW1-… key work right now.",
    bundleTitle: "All-in-One Pro Pass — $14.99",
    bundleSub: "All eight tools with one TW1-ALL-… key, forever. One payment instead of eight.",
    bundlePay: "Get everything for $14.99",
    bundleCard: "Pay by card",
    bundleSoon: "The bundle listing is not live yet. Base USDC in one click already works, and a TW1-ALL-… key is accepted on every page.",
    bundleDone: "All-in-One Pro Pass active: all eight tools are unlocked in this browser."
  };

  /* verify.js speaks English because it is also a Node module under test; the
     Russian pages translate the four messages a buyer can actually hit. */
  function localize(message) {
    var m = String(message || "");
    if (!RU) return m;
    if (/not a transaction hash/i.test(m)) return T.badHash;
    if (/already redeemed/i.test(m)) return T.redeemed;
    if (/No receipt yet/i.test(m)) return T.noReceipt;
    if (/reverted/i.test(m)) return T.reverted;
    if (/^No USDC transfer to/i.test(m)) return T.noTransfer;
    var low = m.match(/^This transaction carried ([\d.]+) USDC, and the price is ([\d.]+)/);
    if (low) return "В транзакции " + low[1] + " USDC, а цена " + low[2] + ". Доплатите разницу и проверьте второй хеш.";
    return m;
  }

  /* A failed TW1 check never reaches the chain: the reason is local and short. */
  function licenseMessage(lic) {
    var map = {
      format: T.licenseErrorFormat,
      signature: T.licenseErrorSignature,
      product: T.licenseErrorProduct,
      crypto: T.licenseErrorCrypto
    };
    return map[lic && lic.error] || T.licenseErrorFormat;
  }

  /* Base mainnet, in the shape wallet_addEthereumChain expects. A wallet that
     has never seen Base answers 4902 to the switch, so we add it and switch
     again — the buyer never has to leave the modal. */
  var BASE_CHAIN = {
    chainId: "0x2105",
    chainName: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.base.org"],
    blockExplorerUrls: ["https://basescan.org"]
  };

  /* EIP-6963 wallets expose window.ethereum.providers; plain MetaMask does not. */
  function wallet() {
    var injected = window.ethereum;
    if (!injected) return null;
    if (Array.isArray(injected.providers) && injected.providers.length) {
      for (var i = 0; i < injected.providers.length; i += 1) {
        if (injected.providers[i] && typeof injected.providers[i].request === "function") return injected.providers[i];
      }
    }
    return typeof injected.request === "function" ? injected : null;
  }

  function walletError(e) {
    var code = e && (e.code || (e.data && e.data.originalError && e.data.originalError.code));
    if (code === 4001 || /rejected|denied/i.test(String(e && e.message))) return T.rejected;
    return String((e && e.message) || e);
  }

  async function switchToBase(provider) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN.chainId }] });
    } catch (e) {
      var code = e && e.code;
      if (code !== 4902 && !/Unrecognized chain|not added|try adding/i.test(String(e && e.message))) throw e;
      await provider.request({ method: "wallet_addEthereumChain", params: [BASE_CHAIN] });
    }
  }

  function buildModal() {
    var wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.hidden = true;
    wrap.innerHTML = [
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="unlock-title">',
      '  <div class="modal-head">',
      '    <div>',
      '      <h3 id="unlock-title"></h3>',
      '      <p class="small muted" id="unlock-sub" style="margin-top:2px"></p>',
      '    </div>',
      '    <button class="close-x" type="button" data-close aria-label="' + T.close + '">',
      '      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M18 6 6 18M6 6l12 12"/></svg>',
      '    </button>',
      '  </div>',
      '  <div class="modal-body">',
      '    <div class="pay-price"><b id="unlock-price"></b><span id="unlock-price-alt" class="pay-price-alt"></span></div>',
      '    <p class="pay-human" id="unlock-human">' + T.human + '</p>',
      '    <a class="btn pay-primary" id="unlock-card" href="#" target="_blank" rel="noopener" hidden>',
      '      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></svg>',
      '      <span id="unlock-card-label">' + T.cardPay + '</span>',
      '    </a>',
      '    <p class="tiny muted pay-card-hint" id="unlock-card-hint" hidden>' + T.cardHint + '</p>',
      '    <div class="pay-or"><span>' + T.orManual + '</span></div>',
      '    <button class="btn pay-usdc" type="button" id="unlock-1click" data-method="eth_sendTransaction">',
      '      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z"/></svg>',
      '      <span id="unlock-1click-label">' + T.oneClick + '</span>',
      '    </button>',
      '    <p class="tiny muted pay-1click-hint" id="unlock-1click-hint">' + T.oneClickHint + '</p>',
      '    <div class="pay-bundle" id="unlock-bundle" hidden>',
      '      <b id="unlock-bundle-title" class="pay-bundle-title">' + T.bundleTitle + '</b>',
      '      <span class="tiny muted" id="unlock-bundle-sub">' + T.bundleSub + '</span>',
      '      <a class="btn pay-bundle-card" id="unlock-bundle-card" href="#" target="_blank" rel="noopener" hidden>',
      '        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></svg>',
      '        <span id="unlock-bundle-card-label">' + T.bundleCard + '</span>',
      '      </a>',
      '      <button class="btn pay-bundle-usdc" type="button" id="unlock-bundle-pay">',
      '        <span id="unlock-bundle-pay-label">' + T.bundlePay + '</span>',
      '      </button>',
      '      <p class="tiny muted" id="unlock-bundle-note" hidden>' + T.bundleSoon + '</p>',
      '    </div>',
      '    <div class="pay-key">',
      '      <label class="pay-key-title" for="unlock-hash">' + T.keyTitle + '</label>',
      '      <p class="tiny muted pay-key-hint">' + T.keyHint + '</p>',
      '      <div class="pay-key-row">',
      '        <input class="field mono" id="unlock-hash" placeholder="' + T.placeholder + '" autocomplete="off" spellcheck="false">',
      '        <button class="btn" type="button" id="unlock-go">' + T.keyBtn + '</button>',
      '      </div>',
      '      <p class="unlock-error small" id="unlock-error" role="alert" hidden></p>',
      '    </div>',
      '    <details class="pay-manual" id="unlock-manual">',
      '      <summary>' + T.orManual + '</summary>',
      '      <div class="pay-address">',
      '        <code class="mono" id="unlock-addr"></code>',
      '        <button class="btn btn-ghost btn-sm" type="button" data-copy-addr>' + T.copy + '</button>',
      '      </div>',
      '      <ol class="pay-steps">',
      '        <li>' + T.steps[0] + '</li>',
      '        <li>' + T.steps[1] + '</li>',
      '        <li>' + T.steps[2] + '</li>',
      '      </ol>',
      '      <p class="tiny muted" style="margin-top:8px">' + T.exchange + '</p>',
      '    </details>',
      '  </div>',
      '  <div class="modal-foot">',
      '    <button class="btn btn-ghost" type="button" data-close>' + T.close + '</button>',
      '  </div>',
      '</div>'
    ].join("");
    document.body.appendChild(wrap);
    return wrap;
  }

  var current = null;

  function open(opts) {
    current = opts;
    if (!modalEl) modalEl = buildModal();
    modalEl.querySelector("#unlock-title").textContent = T.title + (opts.name || "Pro");
    modalEl.querySelector("#unlock-sub").textContent = opts.sub || T.sub;

    /* Rouble price first for a buyer with a Russian card; the USDC figure is
       the same purchase, not a footnote. Falls back to dollars when the lot is
       not live, so the two never disagree. */
    var slug = String(opts.product || "").toLowerCase();
    var shop = shopEntry(slug);
    var priceNode = modalEl.querySelector("#unlock-price");
    var priceAlt = modalEl.querySelector("#unlock-price-alt");
    if (RU && shop && shop.rub) {
      priceNode.textContent = rubDisplay(shop) + " ₽";
      priceAlt.textContent = "$" + opts.price + " · USDC на Base";
    } else {
      priceNode.textContent = "$" + opts.price;
      priceAlt.textContent = T.onBase;
    }

    modalEl.querySelector("#unlock-addr").textContent = PAY_TO;
    modalEl.querySelector("#unlock-hash").value = "";
    modalEl.querySelector("#unlock-error").hidden = true;
    var manual = modalEl.querySelector("#unlock-manual");
    if (manual) manual.open = false;

    var one = modalEl.querySelector("#unlock-1click");
    var hint = modalEl.querySelector("#unlock-1click-hint");
    var oneLabel = modalEl.querySelector("#unlock-1click-label");
    one.disabled = !wallet();
    one.classList.toggle("is-unavailable", !wallet());
    oneLabel.textContent = T.oneClick + " ($" + opts.price + ")";
    hint.textContent = wallet() ? T.oneClickHint : T.noWallet;

    /* Card / SBP path — the primary button for a Russian-speaking buyer. Only
       products with a live listing render it; the label carries the rouble
       price the checkout shows. A missing lot is stated, never faked. */
    var card = modalEl.querySelector("#unlock-card");
    var cardHint = modalEl.querySelector("#unlock-card-hint");
    var cardLabel = modalEl.querySelector("#unlock-card-label");
    if (shop && shop.id) {
      card.href = cardUrl(shop.id);
      card.hidden = false;
      cardHint.hidden = true;
      cardLabel.textContent = T.cardPay +
        (shop.rub ? " (" + rubDisplay(shop) + " ₽ · ключ TW1 сразу на экране)" : "");
      card.setAttribute("data-license-code", slug);
    } else {
      card.hidden = true;
      cardHint.hidden = false;
      cardHint.textContent = T.cardPending;
      card.removeAttribute("href");
    }

    /* All-in-One Pro Pass: the one tariff that fits every page. Hidden on the
       bundle's own dialog, where the whole modal is already that offer. */
    var bundle = modalEl.querySelector("#unlock-bundle");
    if (slug === ALL_SLUG) {
      bundle.hidden = true;
    } else {
      bundle.hidden = false;
      var bcard = modalEl.querySelector("#unlock-bundle-card");
      var bnote = modalEl.querySelector("#unlock-bundle-note");
      var bshop = shopEntry(ALL_SLUG);
      if (bshop && bshop.id) {
        bcard.href = cardUrl(bshop.id);
        bcard.hidden = false;
        bnote.hidden = true;
        modalEl.querySelector("#unlock-bundle-card-label").textContent =
          T.bundleCard + (bshop.rub ? " · " + rubDisplay(bshop) + " ₽" : "");
      } else {
        bcard.hidden = true;
        bnote.hidden = false;
      }
    }

    modalEl.hidden = false;
    document.body.style.overflow = "hidden";
    /* Without a wallet the only actionable path is the key field: put the
       cursor there, but never force a hidden details block open. */
    setTimeout(function () {
      var target = wallet() ? one : modalEl.querySelector("#unlock-hash");
      if (target) target.focus();
    }, 30);
  }

  function close() {
    if (!modalEl) return;
    modalEl.hidden = true;
    document.body.style.overflow = "";
  }

  async function verifyAndUnlock(product, price, hash) {
    var input = String(hash == null ? "" : hash).trim();

    /* Licence key first: it is a local signature check, so the buyer sees Pro
       without a round-trip and the page never touches the network. */
    if (isLicenseKey(input)) {
      var lic = await verifyLicenseKey(input, { product: product });
      if (!lic.valid) throw new Error(licenseMessage(lic));
      activate(product, {
        hash: "license:" + lic.key,
        received: 0,
        price: price,
        kind: "license",
        code: lic.code,
        kid: lic.kid
      });
      return { license: true, code: lic.code, kid: lic.kid, slug: lic.slug, received: 0n, hash: lic.key };
    }

    if (!window.DefiAudit) {
      throw new Error("Проверка оплаты в Base не загрузилась. Обновите страницу или вставьте лицензионный ключ TW1-…");
    }
    var used = readJSON(usedKey(), []);
    var res = await window.DefiAudit.verifyAtLeast(input, price, {
      usedHashes: used,
      config: { PAY_TO: PAY_TO }
    });
    activate(product, { hash: res.hash, received: res.received, price: price, kind: "chain" });
    return res;
  }

  /**
   * The one-click flow itself, shared by the built-in modal and by the pages
   * that keep their own markup: connect → switch to Base → USDC.transfer →
   * wait for the receipt → verify → unlock. The buyer signs one transaction
   * and copies nothing.
   */
  async function oneClick(opts, onStage) {
    var provider = wallet();
    if (!provider) throw new Error(T.noWallet);
    var stage = onStage || function () {};
    stage("connect");
    var accounts = await provider.request({ method: "eth_requestAccounts" });
    if (!accounts || !accounts.length) throw new Error(T.rejected);
    stage("switch");
    await switchToBase(provider);
    stage("send");
    var tx = window.DefiAudit.buildTransferTx({
      from: accounts[0],
      usd: Number(opts.price),
      config: { PAY_TO: PAY_TO }
    });
    var hash = await provider.request({ method: "eth_sendTransaction", params: [tx] });
    if (!hash) throw new Error(T.rejected);
    stage("wait");
    await window.DefiAudit.waitForReceipt(hash, { timeoutMs: 150000 });
    stage("verify");
    return await verifyAndUnlock(opts.product, opts.price, hash);
  }

  /**
   * Attach that flow to a button a page renders itself (docsearch, live-radar,
   * algo-tycoon). Keeps the page's own modal and status line; only the payment
   * path is shared.
   */
  function mountOneClick(btn, opts) {
    if (!btn) return;
    var label = btn.querySelector("[data-1click-label]") || btn;
    var idle = label.textContent;
    var setStage = function (name) {
      var map = { connect: T.connecting, switch: T.switching, send: T.sending, wait: T.waiting, verify: T.verifying };
      label.textContent = map[name] || idle;
    };
    function refresh() {
      var ok = !!wallet();
      btn.disabled = !ok;
      btn.classList.toggle("is-unavailable", !ok);
      if (opts.note) opts.note.textContent = ok ? (opts.hint || T.oneClickHint) : T.noWallet;
    }
    refresh();
    /* Some wallets inject window.ethereum after the page loads. */
    window.addEventListener("ethereum#initialized", refresh);
    btn.addEventListener("click", async function (e) {
      e.preventDefault();
      btn.disabled = true;
      if (opts.onError) opts.onError("");
      try {
        var res = await oneClick(opts, setStage);
        if (opts.onDone) opts.onDone(res);
        else toast(T.oneClickUnlocked + (Number(res.received) / Math.pow(10, USDC_DECIMALS)) + T.confirmed);
      } catch (ex) {
        var msg = walletError(ex);
        if (/has no receipt after/i.test(String(ex && ex.message))) msg = T.pending;
        if (opts.onError) opts.onError(msg);
        else toast(msg, true);
      } finally {
        label.textContent = idle;
        refresh();
      }
    });
  }

  function bind() {
    if (!modalEl && document.body) modalEl = buildModal();

    /* Static pages that sell one product can mark their own card link:
       <a data-shop-product="newsflow" hidden>. It appears only when a real
       Digiseller lot id exists in assets/shop.js, so no page ever links to a
       checkout that was never created. */
    try {
      Array.prototype.forEach.call(document.querySelectorAll("[data-shop-product]"), function (el) {
        var lot = shopEntry(el.getAttribute("data-shop-product"));
        if (lot && lot.id) {
          el.href = cardUrl(lot.id);
          el.hidden = false;
          var rub = rubDisplay(lot) ? " · " + rubDisplay(lot).toLocaleString("ru-RU") + " ₽" : "";
          var label = el.querySelector("[data-shop-label]") || el;
          /* The baseline is captured once, before the first price is written,
             so re-binding on unlock:changed never doubles the price or the
             "TW1 key" tail the markup already carries. */
          var base = label.getAttribute("data-shop-base");
          if (base == null) {
            base = String(label.getAttribute("data-shop-idle") || label.textContent || "")
              .trim()
              .replace(/\s*[·—,]\s*[^·—,]*₽[\s\S]*$/, "")
              .replace(/\s*[·—,]\s*(?:ключ|TW1|key)[\s\S]*$/i, "")
              .trim();
            label.setAttribute("data-shop-base", base);
          }
          var note = label.getAttribute("data-shop-note");
          if (note == null) note = /TW1|ключ|key/i.test(base) ? "" : " — ключ TW1 сразу";
          label.textContent = base + rub + note;
        } else {
          el.hidden = true;
        }
      });
    } catch (e) { /* no shop block on this page */ }

    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-unlock]");
      if (t) {
        e.preventDefault();
        open({
          product: t.getAttribute("data-product"),
          price: t.getAttribute("data-price"),
          name: t.getAttribute("data-name") || "Pro",
          sub: t.getAttribute("data-sub") || ""
        });
        return;
      }
      if (e.target.closest("[data-close]")) { close(); return; }
      if (e.target.closest("[data-copy-addr]")) { copy(PAY_TO); return; }
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

    /* Enter inside the field submits: a licence key is one paste and one keypress. */
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var field = e.target && e.target.id === "unlock-hash" ? e.target : null;
      if (!field || modalEl.hidden) return;
      e.preventDefault();
      var go = modalEl.querySelector("#unlock-go");
      if (go && !go.disabled) go.click();
    });

    /* One-click pay: connect → switch to Base → send USDC.transfer → wait for
       the receipt → unlock. The buyer signs one transaction and copies nothing. */
    document.addEventListener("click", async function (e) {
      var btn = e.target.closest("#unlock-1click");
      if (!btn || !current) return;
      var err = modalEl.querySelector("#unlock-error");
      var label = modalEl.querySelector("#unlock-1click-label");
      var go = modalEl.querySelector("#unlock-go");
      var stage = function (name) {
        var map = { connect: T.connecting, switch: T.switching, send: T.sending, wait: T.waiting, verify: T.verifying };
        label.textContent = map[name] || T.oneClick;
      };
      err.hidden = true;
      btn.disabled = true;
      go.disabled = true;
      try {
        var res = await oneClick(current, stage);
        close();
        toast(T.oneClickUnlocked + (Number(res.received) / Math.pow(10, USDC_DECIMALS)) + T.confirmed);
      } catch (ex) {
        var msg = walletError(ex);
        if (/has no receipt after/i.test(String(ex && ex.message))) msg = T.pending;
        err.textContent = localize(msg);
        err.hidden = false;
      } finally {
        label.textContent = T.oneClick + (current ? " ($" + current.price + ")" : "");
        btn.disabled = !wallet();
        go.disabled = false;
      }
    });

    /* All-in-One Pro Pass — one transfer, universal entitlement. */
    document.addEventListener("click", async function (e) {
      var btn = e.target.closest("#unlock-bundle-pay");
      if (!btn) return;
      var err = modalEl.querySelector("#unlock-error");
      var label = modalEl.querySelector("#unlock-bundle-pay-label");
      var opts = { product: ALL_SLUG, price: BUNDLE_PRICE_USD, name: T.bundleTitle };
      var stage = function (name) {
        var map = { connect: T.connecting, switch: T.switching, send: T.sending, wait: T.waiting, verify: T.verifying };
        label.textContent = map[name] || T.bundlePay;
      };
      err.hidden = true;
      btn.disabled = true;
      try {
        await oneClick(opts, stage);
        close();
        toast(T.bundleDone);
      } catch (ex) {
        var msg = walletError(ex);
        if (/has no receipt after/i.test(String(ex && ex.message))) msg = T.pending;
        err.textContent = localize(msg);
        err.hidden = false;
      } finally {
        label.textContent = T.bundlePay;
        btn.disabled = false;
      }
    });

    document.addEventListener("click", async function (e) {
      if (!e.target.closest("#unlock-go") || !current) return;
      var btn = e.target.closest("#unlock-go");
      var err = modalEl.querySelector("#unlock-error");
      var hash = modalEl.querySelector("#unlock-hash").value.trim();
      err.hidden = true;
      btn.disabled = true;
      btn.textContent = T.checking;
      try {
        var res = await verifyAndUnlock(current.product, current.price, hash);
        close();
        toast(res.license
          ? T.licenseUnlocked + res.code + (res.universal ? " (ALL)" : "")
          : T.unlocked + (Number(res.received) / Math.pow(10, USDC_DECIMALS)) + T.confirmed);
      } catch (ex) {
        err.textContent = localize(ex.message);
        err.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = T.verify;
      }
    });
  }

  /* ------------------------------------------------------------------
   * Auto-activation from a Digiseller / Plati.Market receipt link.
   *
   * A buyer who paid by card gets a TW1-… key on screen at once and, in the
   * receipt, a link like /tg-chats/?key=TW1-TG-...&download=xlsx (or the
   * same inside the hash: #key=TW1-…). The standard flow asks them to find
   * a modal and paste 86 characters. This helper reads the key straight
   * from the URL, verifies it offline (same ECDSA check as the modal),
   * grants the entitlement — so every page listening to unlock:changed
   * opens Pro by itself — and strips the key back out of the address bar.
   * Pages that ship a file (tg-chats) read the download format through
   * getUrlParams() and start the download once their pack is open.
   * ------------------------------------------------------------------ */

  function readUrlParams() {
    var out = { key: "", download: "", pack: "" };
    try {
      var search = new URLSearchParams(window.location.search || "");
      var hash = String(window.location.hash || "").replace(/^#/, "");
      var hashParams = new URLSearchParams(hash);
      var key = (search.get("key") || hashParams.get("key") || search.get("license") || hashParams.get("license") || "").trim();
      var download = (search.get("download") || hashParams.get("download") || "").trim().toLowerCase();
      /* pack selects which ready-made Excel pack a receipt link delivers:
         b2b-stores | wb-sellers | freelance-it  (Digiseller lots 6378375/6378421/12) */
      var pack = (search.get("pack") || hashParams.get("pack") || "").trim().toLowerCase();
      out.key = key.replace(/\s+/g, "");
      out.download = download;
      out.pack = pack;
    } catch (e) { /* very old URL API: page works exactly as before */ }
    return out;
  }

  function getUrlKey() { return readUrlParams().key; }

  function stripUrlKey() {
    try {
      var url = new URL(window.location.href);
      url.searchParams.delete("key");
      url.searchParams.delete("license");
      url.searchParams.delete("download");
      url.searchParams.delete("pack");
      var hash = String(url.hash || "").replace(/^#/, "");
      if (hash) {
        var hp = new URLSearchParams(hash);
        hp.delete("key");
        hp.delete("license");
        hp.delete("download");
        hp.delete("pack");
        var rest = hp.toString();
        url.hash = rest ? "#" + rest : "";
      }
      window.history.replaceState(window.history.state, "", url.toString());
    } catch (e) { /* provenance toolbar / file:// — leaving the URL alone is fine */ }
  }

  var autoActivationDone = false;

  /* Activates Pro from ?key=TW1-… / #key=TW1-… without opening a modal.
   * Never rejects: resolves {key, download, ok} or null when there is no key,
   * so a plain visit — tests included — is untouched. opts:
   *   { product, price, onDone(info), onError(msg) }                        */
  async function autoActivateFromUrl(opts) {
    var o = opts || {};
    if (autoActivationDone) return null;
    var info = readUrlParams();
    if (!info.key) return null;
    autoActivationDone = true;
    var product = o.product || ALL_SLUG;
    var price = o.price == null ? 9 : o.price;
    try {
      var rec = null;
      try { rec = state(product); } catch (e) { /* no storage yet */ }
      var already = rec && rec.hash === "license:" + info.key;
      var res = already
        ? { license: true, key: info.key }
        : await verifyAndUnlock(product, price, info.key);
      stripUrlKey();
      toast(RU ? "Ключ из чека принят. Pro включён в этом браузере." : "Receipt key accepted. Pro is on in this browser.");
      if (o.onDone) { try { o.onDone({ key: info.key, download: info.download, pack: info.pack, result: res, product: product }); } catch (e) {} }
      return { key: info.key, download: info.download, pack: info.pack, ok: true, result: res, product: product };
    } catch (err) {
      var msg = RU ? ("Ключ из чека не принят: " + (err && err.message ? err.message : "ошибка")) : String(err && err.message || err);
      toast(msg, true);
      if (o.onError) { try { o.onError(msg); } catch (e) {} }
      return { key: info.key, download: info.download, pack: info.pack, ok: false };
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();

  window.Unlock = {
    PAY_TO: PAY_TO,
    isPro: isPro,
    state: state,
    activate: activate,
    deactivate: deactivate,
    open: open,
    close: close,
    copy: copy,
    toast: toast,
    short: short,
    verifyAndUnlock: verifyAndUnlock,
    oneClick: oneClick,
    mountOneClick: mountOneClick,
    hasWallet: function () { return !!wallet(); },
    /* universal entitlement + card/shop data */
    hasUniversal: hasUniversal,
    universal: universalRecord,
    grantAll: grantAll,
    grantLicense: grantLicense,
    shopEntry: shopEntry,
    cardUrl: cardUrl,
    BUNDLE_PRICE_USD: BUNDLE_PRICE_USD,
    ALL_SLUG: ALL_SLUG,
    /* 60-second in-memory demo */
    startPreview: startPreview,
    stopPreview: stopPreview,
    isPreview: previewActive,
    previewRemaining: previewRemaining,
    /* offline licence keys */
    LICENSE_PUBLIC_KEY: LICENSE_PUBLIC_KEY,
    LICENSE_PRODUCTS: LICENSE_PRODUCTS,
    isLicenseKey: isLicenseKey,
    parseLicenseKey: parseLicenseKey,
    verifyLicenseKey: verifyLicenseKey,
    /* receipt-link auto-activation (?key=TW1-… / #key=TW1-…) */
    readUrlParams: readUrlParams,
    getUrlKey: getUrlKey,
    autoActivateFromUrl: autoActivateFromUrl,
    stripUrlKey: stripUrlKey,
    /* unlock with a key from anywhere on the page, e.g. the userscript panel */
    unlockWithLicense: async function (product, key) {
      return verifyAndUnlock(product, 0, key);
    }
  };
})();
