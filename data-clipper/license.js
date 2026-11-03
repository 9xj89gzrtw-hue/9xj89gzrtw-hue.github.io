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

  /* ---------- TW1-… offline keys (card / SBP buyers) ----------------------
   *
   * The shop auto-delivers keys shaped TW1-<CODE>-<KID>-<SIG>: SIG is an
   * ECDSA P-256 / SHA-256 signature over "TW1-<CODE>-<KID>", base64url of the
   * raw 64-byte r||s pair. The same public key as assets/unlock.js — one
   * signing key per the whole site, one format per the buyer's mail. CODE
   * "CLIP" is this product; "ALL" is universal. Verified with crypto.subtle,
   * no network, ~10 ms.
   */
  var TW1_PUBLIC_KEY = {
    kty: "EC",
    crv: "P-256",
    x: "YVH3fyYkuivpkuKQjUqw02XxX3mO5FadXsxijuK52so",
    y: "POqoRl3cMmg1UUxmwpCDBj2q3kVqwuH-EySTT3zcefQ"
  };

  var TW1_PRODUCT_SLUG = "data-clipper";
  var TW1_PRODUCT_CODES = { CLIP: TW1_PRODUCT_SLUG, ALL: "all-in-one" };
  var TW1_KEY_RE = /^(TW1)-([A-Z0-9]{2,8})-([A-Z0-9]{6})-([A-Za-z0-9_-]{86})$/i;
  var TW1_RE_PREFIX = /^TW1-/i;

  function b64uToBytes(text) {
    var b64 = String(text).replace(/-/g, "+").replace(/_/g, "/");
    var pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    var bin = atob(b64 + pad);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  function isTW1Key(text) {
    return TW1_RE_PREFIX.test(String(text == null ? "" : text).trim());
  }

  function tw1Subtle() {
    var c = (typeof crypto !== "undefined") ? crypto : null;
    return c && c.subtle && typeof c.subtle.verify === "function" ? c.subtle : null;
  }

  /* Returns Promise<{ok, payload|reason}> — the same two-shape contract as
     verifyLicense, so popup.js needs one handler for both formats. */
  function verifyTW1(raw) {
    var subtle = tw1Subtle();
    if (!subtle) return Promise.resolve({ ok: false, reason: "crypto.subtle unavailable" });
    var clean = String(raw == null ? "" : raw).trim().replace(/\s+/g, "");
    var m = TW1_KEY_RE.exec(clean);
    if (!m) {
      return Promise.resolve({ ok: false, reason: isTW1Key(clean) ?
        "truncated TW1 key — copy the whole line TW1-<CODE>-<ID>-<SIG>" : "not a TW1 key" });
    }
    var code = m[2].toUpperCase();
    var kid = m[3].toUpperCase();
    var payload = "TW1-" + code + "-" + kid;
    return subtle.importKey("jwk", TW1_PUBLIC_KEY,
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
    ).then(function (key) {
      return subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
        b64uToBytes(m[4]), new TextEncoder().encode(payload));
    }).then(function (valid) {
      var slug = TW1_PRODUCT_CODES[code] || null;
      if (!valid) return { ok: false, reason: "bad signature" };
      if (!slug) return { ok: false, reason: "wrong product: key is for " + code };
      return { ok: true, payload: { system: "tw1", p: TW1_PRODUCT_SLUG, code: code, u: kid } };
    }, function (e) {
      return { ok: false, reason: "verify call failed (" + String((e && e.message) || e) + ")" };
    });
  }

  var api = {
    verifyLicense: verifyLicense,
    verifyTW1: verifyTW1,
    isTW1Key: isTW1Key,
    TW1_PUBLIC_KEY: TW1_PUBLIC_KEY,
    base32DecodeToBytes: base32DecodeToBytes,
    PUB_HEX: PUB_HEX
  };
  root.ClipLicense = api;
})(typeof window !== "undefined" ? window : globalThis);
