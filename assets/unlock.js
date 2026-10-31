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
