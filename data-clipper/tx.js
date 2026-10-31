/*
 * tx.js — verify a USDC-on-Base payment by transaction hash.
 *
 * Flow: JSON-RPC eth_getTransactionReceipt against a public Base RPC, filter
 * the receipt logs for USDC Transfer events to one of our receiving
 * addresses with a value >= minAmountUSD (6 decimals).
 *
 * Receiving addresses (team treasury, no KYC rail):
 *   0x72Aa6edDE71B94f6b99c8e52EdC02B5C75F74d1a
 *   0xbbe6966949d7265a7f5f0b793f08293b9b7fe926
 */
(function initTx(root) {
  "use strict";

  var USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  var TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  var RECIPIENTS = [
    "0x72aa6edde71b94f6b99c8e52edc02b5c75f74d1a",
    "0xbbe6966949d7265a7f5f0b793f08293b9b7fe926"
  ];
  var DEFAULT_RPC = "https://mainnet.base.org";

  function padSubject(addr) {
    return "0x" + "0".repeat(24) + addr.replace(/^0x/, "").toLowerCase();
  }

  function isHexTx(t) {
    return /^0x[0-9a-fA-F]{64}$/.test(String(t || "").trim());
  }

  function topicToAddress(topic) {
    if (!topic || topic.length < 42) return null;
    return "0x" + topic.slice(-40).toLowerCase();
  }

  function hexToBigInt(h) {
    try { return BigInt(h); } catch (e) { return null; }
  }

  /* Verify one transaction. fetchImpl injectable for tests.
   * opts: {txHash, minAmountUSD, rpcUrl?, fetchImpl?}
   * Returns Promise<{ok, amountUSDC?, blockNumber?, txHash?, reason?}> */
  function verifyBaseUSDCPayment(opts) {
    var fetchImpl = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
    var rpcUrl = opts.rpcUrl || DEFAULT_RPC;
    if (!fetchImpl) return Promise.resolve({ ok: false, reason: "no fetch available" });
    var tx = String(opts.txHash || "").trim();
    if (!isHexTx(tx)) return Promise.resolve({ ok: false, reason: "not a tx hash" });
    var minUnits = BigInt(Math.round(Number(opts.minAmountUSD) * 1e6));
    var body = JSON.stringify({
      jsonrpc: "2.0", id: "dc1", method: "eth_getTransactionReceipt", params: [tx]
    });
    return fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body
    }).then(function (r) {
      if (!r.ok) throw new Error("rpc http " + r.status);
      return r.json();
    }, function () {
      throw new Error("rpc unreachable");
    }).then(function (j) {
      var rec = j && j.result;
      if (!rec) return { ok: false, reason: "tx not found (give the RPC a few seconds)" };
      if (String(rec.status).toLowerCase() !== "0x1") return { ok: false, reason: "transaction failed on-chain" };
      var logs = rec.logs || [];
      for (var i = 0; i < logs.length; i += 1) {
        var lg = logs[i];
        if (String(lg.address).toLowerCase() !== USDC_BASE) continue;
        var topics = lg.topics || [];
        if (topics[0] !== TRANSFER_TOPIC) continue;
        var to = topicToAddress(topics[2]);
        if (!to || RECIPIENTS.indexOf(to) === -1) continue;
        var wei = hexToBigInt(lg.data);
        if (wei === null) continue;
        if (wei >= minUnits) {
          return {
            ok: true,
            txHash: tx,
            amountUSDC: Number(wei) / 1e6,
            blockNumber: rec.blockNumber
          };
        }
        return { ok: false, reason: "USDC amount below the price (" + (Number(wei) / 1e6) + " < " + opts.minAmountUSD + ")" };
      }
      return { ok: false, reason: "no qualifying USDC transfer in this tx" };
    }, function (err) {
      return { ok: false, reason: String(err && err.message ? err.message : err) };
    });
  }

  var api = {
    verifyBaseUSDCPayment: verifyBaseUSDCPayment,
    RECIPIENTS: RECIPIENTS,
    USDC_BASE: USDC_BASE,
    DEFAULT_RPC: DEFAULT_RPC,
    isHexTx: isHexTx
  };
  root.ClipTx = api;
})(typeof window !== "undefined" ? window : globalThis);
