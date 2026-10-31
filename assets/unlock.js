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

    return { isPro, verify, reset, PAY_TO, priceUnits: price };
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

  function key(product) { return "unlock:" + product; }
  function usedKey() { return "unlock:used"; }

  function readJSON(k, fallback) {
    try { return JSON.parse(localStorage.getItem(k)) || fallback; } catch (e) { return fallback; }
  }

  function isPro(product) {
    var rec = readJSON(key(product), null);
    return !!(rec && rec.hash);
  }

  function state(product) { return readJSON(key(product), null); }

  function activate(product, data) {
    localStorage.setItem(key(product), JSON.stringify({
      hash: data.hash,
      received: String(data.received),
      at: new Date().toISOString(),
      price: data.price
    }));
    var used = readJSON(usedKey(), []);
    if (used.indexOf(data.hash) === -1) used.push(data.hash);
    localStorage.setItem(usedKey(), JSON.stringify(used));
    document.dispatchEvent(new CustomEvent("unlock:changed", { detail: { product: product } }));
  }

  function deactivate(product) {
    localStorage.removeItem(key(product));
    document.dispatchEvent(new CustomEvent("unlock:changed", { detail: { product: product } }));
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
    hash: "Хеш транзакции",
    exchange: "Платите с биржи? Хеш вывода — это хеш биржи, а не перевода нам. Отправьте с кошелька или пришлите оба хеша письмом, и мы откроем доступ вручную.",
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
    badHash: "Это не хеш транзакции: нужны 0x и 64 шестнадцатеричных символа."
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
    hash: "Transaction hash",
    exchange: "Paying from an exchange? The withdrawal hash is the exchange\u2019s, not the transfer to us. Pay from a wallet, or send both hashes by mail and we will unlock it manually.",
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
    badHash: ""
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
      '    <div class="pay-amount"><span id="unlock-price"></span><span class="small muted">' + T.onBase + '</span></div>',
      '    <div class="pay-address">',
      '      <code class="mono" id="unlock-addr"></code>',
      '      <button class="btn btn-ghost btn-sm" type="button" data-copy-addr>' + T.copy + '</button>',
      '    </div>',
      '    <ol class="pay-steps">',
      '      <li>' + T.steps[0] + '</li>',
      '      <li>' + T.steps[1] + '</li>',
      '      <li>' + T.steps[2] + '</li>',
      '    </ol>',
      '    <label class="small" for="unlock-hash" style="display:block;margin:14px 0 6px;color:var(--ink-2)">' + T.hash + '</label>',
      '    <input class="field mono" id="unlock-hash" placeholder="0x…" autocomplete="off" spellcheck="false">',
      '    <p class="unlock-error small" id="unlock-error" role="alert" hidden></p>',
      '    <p class="tiny muted" style="margin-top:10px">' + T.exchange + '</p>',
      '  </div>',
      '  <div class="modal-foot">',
      '    <button class="btn btn-ghost" type="button" data-close>' + T.cancel + '</button>',
      '    <button class="btn btn-primary" type="button" id="unlock-go">' + T.verify + '</button>',
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
    modalEl.querySelector("#unlock-price").textContent = "$" + opts.price;
    modalEl.querySelector("#unlock-addr").textContent = PAY_TO;
    modalEl.querySelector("#unlock-hash").value = "";
    modalEl.querySelector("#unlock-error").hidden = true;
    modalEl.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(function () { modalEl.querySelector("#unlock-hash").focus(); }, 30);
  }

  function close() {
    if (!modalEl) return;
    modalEl.hidden = true;
    document.body.style.overflow = "";
  }

  async function verifyAndUnlock(product, price, hash) {
    var used = readJSON(usedKey(), []);
    var res = await window.DefiAudit.verifyAtLeast(hash, price, {
      usedHashes: used,
      config: { PAY_TO: PAY_TO }
    });
    activate(product, { hash: res.hash, received: res.received, price: price });
    return res;
  }

  function bind() {
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
        toast(T.unlocked + (Number(res.received) / Math.pow(10, USDC_DECIMALS)) + T.confirmed);
      } catch (ex) {
        err.textContent = localize(ex.message);
        err.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = T.verify;
      }
    });
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
    verifyAndUnlock: verifyAndUnlock
  };
})();
