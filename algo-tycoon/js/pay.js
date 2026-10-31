/*
 * pay.js — Algo Tycoon Pro payments & licenses ( mirrors the Clipper module ):
 * USDC on Base tx-hash verification against the team treasury, plus offline
 * Ed25519 license checks. Verification runs in the visitor's browser against
 * a public Base RPC; no server sees the hash.
 */
(function initPay(root) {
  "use strict";
  root.AT = root.AT || {};

  var PRODUCT = "algo-tycoon";
  var PRICE_PRO = 5;
  var PRICE_SOURCE = 19;
  var USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  var TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  var RECIPIENTS = [
    "0x72aa6edde71b94f6b99c8e52edc02b5c75f74d1a",
    "0xbbe6966949d7265a7f5f0b793f08293b9b7fe926"
  ];
  var DEFAULT_RPC = "https://mainnet.base.org";

  var PUB_HEX = "8078ae09413aaab39c1735aa2870c17d3a790dda5157d0cfde1dac48fdb718d4";
  var A32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  function base32DecodeToBytes(clean) {
    var bits = 0, value = 0, out = [];
    clean = String(clean || "").replace(/[^A-Za-z2-7]/g, "");
    for (var i = 0; i < clean.length; i += 1) {
      var v = A32.indexOf(clean[i].toUpperCase());
      if (v < 0) return null;
      value = (value << 5) | v;
      bits += 5;
      if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xFF); bits -= 8; }
    }
    return new Uint8Array(out);
  }

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function isHexTx(t) { return /^0x[0-9a-fA-F]{64}$/.test(String(t || "").trim()); }

  function topicToAddress(topic) {
    return (topic && topic.length >= 42) ? "0x" + topic.slice(-40).toLowerCase() : null;
  }

  /* opts: { txHash, amountUSD (5 or 19), rpcUrl?, fetchImpl? } */
  function verifyBaseUSDCPayment(opts) {
    var fetchImpl = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
    var rpcUrl = opts.rpcUrl || DEFAULT_RPC;
    if (!fetchImpl) return Promise.resolve({ ok: false, reason: "no fetch available" });
    var tx = String(opts.txHash || "").trim();
    if (!isHexTx(tx)) return Promise.resolve({ ok: false, reason: "not a tx hash" });
    var minUnits = BigInt(Math.round(Number(opts.amountUSD) * 1e6));
    return fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "at1", method: "eth_getTransactionReceipt", params: [tx] })
    }).then(function (r) {
      if (!r.ok) throw new Error("rpc http " + r.status);
      return r.json();
    }, function () { throw new Error("rpc unreachable"); }).then(function (j) {
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
        var wei;
        try { wei = BigInt(lg.data); } catch (e) { continue; }
        if (wei >= minUnits) {
          return { ok: true, txHash: tx, amountUSDC: Number(wei) / 1e6, blockNumber: rec.blockNumber };
        }
        return { ok: false, reason: "USDC amount below the price (" + (Number(wei) / 1e6) + ")" };
      }
      return { ok: false, reason: "no qualifying USDC transfer in this tx" };
    }, function (err) { return { ok: false, reason: String(err && err.message ? err.message : err) }; });
  }

  /* raw license string -> Promise<{ok, payload|reason}> */
  function verifyLicense(raw) {
    var subtle = (typeof crypto !== "undefined") && crypto.subtle;
    if (!subtle || typeof subtle.importKey !== "function") {
      return Promise.resolve({ ok: false, reason: "crypto.subtle unavailable" });
    }
    var all = base32DecodeToBytes(String(raw || ""));
    if (!all || all.length < 71) return Promise.resolve({ ok: false, reason: "malformed license" });
    if (String.fromCharCode(all[0], all[1], all[2]) !== "LC1") return Promise.resolve({ ok: false, reason: "bad magic" });
    var payloadLen = (all[3] << 8) | all[4];
    if (payloadLen <= 0 || payloadLen > 200 || all.length !== 5 + payloadLen + 64) {
      return Promise.resolve({ ok: false, reason: "bad length" });
    }
    var payloadBytes = all.subarray(5, 5 + payloadLen);
    var sig = all.subarray(5 + payloadLen);
    var signed = all.subarray(0, 5 + payloadLen);
    var payload;
    try { payload = JSON.parse(new TextDecoder().decode(payloadBytes)); }
    catch (e) { return Promise.resolve({ ok: false, reason: "bad payload json" }); }
    return crypto.subtle.importKey("raw", hexToBytes(PUB_HEX), { name: "Ed25519" }, false, ["verify"])
      .then(function (key) {
        return crypto.subtle.verify("Ed25519", key, sig, signed);
      })
      .then(function (valid) {
        if (!valid) return { ok: false, reason: "bad signature" };
        if (payload.p !== PRODUCT) return { ok: false, reason: "wrong product" };
        if (payload.t !== "pro") return { ok: false, reason: "not a pro license" };
        if (payload.e && payload.e > 0 && payload.e < Date.now() / 1000) {
          return { ok: false, reason: "expired" };
        }
        return { ok: true, payload: payload };
      }, function () { return { ok: false, reason: "verify call failed" }; });
  }

  root.AT.pay = {
    verifyBaseUSDCPayment: verifyBaseUSDCPayment,
    verifyLicense: verifyLicense,
    isHexTx: isHexTx,
    base32DecodeToBytes: base32DecodeToBytes,
    PRODUCT: PRODUCT,
    PRICE_PRO: PRICE_PRO,
    PRICE_SOURCE: PRICE_SOURCE,
    USDC_BASE: USDC_BASE,
    TRANSFER_TOPIC: TRANSFER_TOPIC,
    RECIPIENTS: RECIPIENTS,
    DEFAULT_RPC: DEFAULT_RPC,
    PUB_HEX: PUB_HEX
  };
})(typeof window !== "undefined" ? window : globalThis);
