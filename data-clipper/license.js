/*
 * license.js — offline license verification (Ed25519 over WebCrypto).
 *
 * License string layout:
 *   BASE32( magic "LC1" + len(payload, 2 bytes big-endian) + payload JSON + sig(64 bytes) )
 *   encoded as RFC4648 base32 without padding, uppercased, grouped into
 *   5-character chunks joined by '-'.
 *
 * Only the 32-byte Ed25519 PUBLIC key is embedded here. The private issuer
 * lives in the team's key vault, never in product code.
 */
(function initLicense(root) {
  "use strict";

  // Raw Ed25519 public key, 32 bytes.
  var PUB_HEX = "8078ae09413aaab39c1735aa2870c17d3a790dda5157d0cfde1dac48fdb718d4";

  var A32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  var A32_REV = (function () {
    var m = {};
    for (var i = 0; i < A32.length; i += 1) m[A32[i]] = i;
    return m;
  })();

  function base32DecodeToBytes(clean) {
    var bits = 0;
    var value = 0;
    var out = [];
    for (var i = 0; i < clean.length; i += 1) {
      var ch = clean[i];
      if (ch === "=") break;
      var v = A32_REV[ch.toUpperCase()];
      if (v === undefined) return null;
      value = (value << 5) | v;
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 0xFF);
        bits -= 8;
      }
    }
    return new Uint8Array(out);
  }

  function normalizeLicense(raw) {
    return String(raw || "").replace(/[^A-Za-z2-7]/g, "").trim();
  }

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function subtleAvailable() {
    var c = (typeof crypto !== "undefined") ? crypto : null;
    var s = c && c.subtle;
    return !!(s && typeof s.importKey === "function" && typeof s.verify === "function");
  }

  /* Verify a license string against an allow-list of product ids.
   * Returns Promise<{ok, payload|reason}>. */
  function verifyLicense(raw, products) {
    var productIds = Array.isArray(products) ? products : [products];
    if (!subtleAvailable()) {
      return Promise.resolve({ ok: false, reason: "crypto.subtle unavailable" });
    }
    var clean = normalizeLicense(raw);
    if (clean.length < 20) return Promise.resolve({ ok: false, reason: "too short" });
    var all;
    try {
      all = base32DecodeToBytes(clean);
    } catch (e) {
      all = null;
    }
    if (!all || all.length < 3 + 2 + 2 + 64) return Promise.resolve({ ok: false, reason: "malformed license" });
    if (String.fromCharCode(all[0], all[1], all[2]) !== "LC1") {
      return Promise.resolve({ ok: false, reason: "bad magic" });
    }
    var payloadLen = (all[3] << 8) | all[4];
    if (payloadLen <= 0 || payloadLen > 200 || all.length !== 5 + payloadLen + 64) {
      return Promise.resolve({ ok: false, reason: "bad length" });
    }
    var payloadBytes = all.subarray(5, 5 + payloadLen);
    var sigBytes = all.subarray(5 + payloadLen);
    var signed = all.subarray(0, 5 + payloadLen);
    var payloadStr = null;
    try {
      payloadStr = new TextDecoder().decode(payloadBytes);
    } catch (e) {
      return Promise.resolve({ ok: false, reason: "payload undecodable" });
    }
    var payload;
    try {
      payload = JSON.parse(payloadStr);
    } catch (e) {
      return Promise.resolve({ ok: false, reason: "bad payload json" });
    }
    var pubBytes = hexToBytes(PUB_HEX);
    var keyPromise = crypto.subtle.importKey(
      "raw", pubBytes, { name: "Ed25519" }, false, ["verify"]);
    return keyPromise.then(function (key) {
      return crypto.subtle.verify("Ed25519", key, sigBytes, signed).then(function (valid) {
        if (!valid) return { ok: false, reason: "bad signature" };
        if (productIds.indexOf(payload.p) === -1) return { ok: false, reason: "wrong product" };
        if (payload.t !== "pro") return { ok: false, reason: "not a pro license" };
        if (payload.e && payload.e > 0 && payload.e < Date.now() / 1000) {
          return { ok: false, reason: "expired" };
        }
        return { ok: true, payload: payload };
      }, function () {
        return { ok: false, reason: "verify call failed" };
      });
    }, function () {
      return { ok: false, reason: "key import failed" };
    });
  }

  var api = {
    verifyLicense: verifyLicense,
    base32DecodeToBytes: base32DecodeToBytes,
    PUB_HEX: PUB_HEX
  };
  root.ClipLicense = api;
})(typeof window !== "undefined" ? window : globalThis);
