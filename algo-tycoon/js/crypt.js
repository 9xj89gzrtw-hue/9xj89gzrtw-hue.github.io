/*
 * crypt.js — Algo Tycoon Acts II–III content gate (WebCrypto AES-GCM).
 *
 * levels.js ships Act I plaintext and keeps the Act II–III job definitions
 * inside a sealed blob (`AT1:` base64 = iv[12] || ciphertext+tag), encrypted
 * with AES-256-GCM. The key is SHA-256 over a build-time pepper constant —
 * this is content gating for the progression order, NOT a security boundary:
 * the pepper ships with the page by design, and the real gate is gameplay
 * (Act I must be solved before Act II matters anyway). Honest DRM-lite.
 *
 * On boot, crypt.ready() decrypts the blob and sets AT.levels.JOBS to the
 * full 14-job list. If WebCrypto or the blob is unavailable, the game still
 * runs on Act I with a visible notice instead of silently showing 10 jobs.
 */
(function initCrypt(root) {
  "use strict";
  root.AT = root.AT || {};
  var L = root.AT.levels;

  var readyPromise = null;

  function b64ToUint8(b64) {
    var bin = atob(b64);
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) u[i] = bin.charCodeAt(i);
    return u;
  }

  /* must match the encrypt-time KEY_SEED */
  var KEY_SEED = "AT-act23-PEPPER-2026-10-31-9xj89gzrtw-hue";

  function whenReady(cb) { ready().then(cb, cb); }

  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = (async function () {
      var payload = String((L && L.__ACT23_BLOB__) || "");
      if (!payload || payload.indexOf("AT1:") !== 0) {
        L.act23Error = "act2/3 blob missing";
        return { loaded: false, error: L.act23Error };
      }
      if (!root.crypto || !root.crypto.subtle || typeof atob !== "function") {
        L.act23Error = "WebCrypto unavailable (secure context required)";
        return { loaded: false, error: L.act23Error };
      }
      try {
        var packed = b64ToUint8(payload.slice(4));
        var iv = packed.slice(0, 12);
        var ct = packed.slice(12);
        var keyBytes = new Uint8Array(
          await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(KEY_SEED))
        );
        var key = await root.crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
        var pt = await root.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ct);
        var parsed = JSON.parse(new TextDecoder().decode(pt));
        if (!parsed || !Array.isArray(parsed.jobs)) throw new Error("bad payload");
        L.ACT1_JOBS = L.ACT1_JOBS || L.JOBS;
        L.JOBS = L.ACT1_JOBS.concat(parsed.jobs);
        L.act23Loaded = true;
        return { loaded: true, count: L.JOBS.length };
      } catch (e) {
        L.act23Error = "decrypt failed: " + (e && e.message ? e.message : String(e));
        return { loaded: false, error: L.act23Error };
      }
    })();
    return readyPromise;
  }

  root.AT.crypt = { ready: ready, whenReady: whenReady };
})(typeof window !== "undefined" ? window : globalThis);
