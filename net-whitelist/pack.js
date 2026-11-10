/* pack.js — Net Whitelist Pro data loader.
 *
 * Same AES-256-GCM container as the other Toolworks packs
 * (pro-pack.json.enc / b2b-pack.json.enc / sni-pack.json.enc):
 * PBKDF2-SHA256, 310 000 iterations over the shared material, AAD
 * "tgchats-pro-v1". Decrypted in the browser with WebCrypto only after
 * assets/unlock.js has confirmed a Base USDC receipt or an offline
 * TW1-SNI / TW1-TG / TW1-ALL licence key.
 *
 * Honest limitation (same as every Toolworks page): this is a static site,
 * so the key derivation is public code. The container stops bulk scraping,
 * indexing and casual copying. It is not DRM against a determined reader.
 */
(function (root) {
  "use strict";

  var SALT_LEN = 16;
  var ITERATIONS = 310000;
  var MATERIAL = "toolworks/tgchats/v1|0x72Aa6edDE71B94f6b99c8e52EdC02B5C75F74d1a|9000000";

  var cache = null;
  var loading = null;
  var MIN_USD = 0.99;

  async function checkPayment(hash) {
    if (!root.DefiAudit || !root.DefiAudit.verifyAtLeast) {
      return { ok: false, reason: "Проверка платежа недоступна: не загрузился модуль verify.js." };
    }
    try {
      var res = await root.DefiAudit.verifyAtLeast(hash, MIN_USD, {
        config: { PAY_TO: root.Unlock && root.Unlock.PAY_TO }
      });
      return { ok: true, received: res.received };
    } catch (err) {
      var msg = String((err && err.message) || err);
      if (/rpc|fetch|network|timeout|abort|failed|load/i.test(msg)) {
        return { ok: false, reason: "Не удалось проверить платёж в сети Base (" + msg + "). Попробуйте ещё раз." };
      }
      return { ok: false, reason: msg };
    }
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function subtle() {
    var c = root.crypto || {};
    if (!c.subtle || !c.subtle.importKey) {
      throw new Error("Этот браузер не может открыть файл безопасно. Обновите браузер и откройте страницу по HTTPS.");
    }
    return c.subtle;
  }

  async function deriveKey(salt) {
    var enc = new TextEncoder();
    var base = await subtle().importKey("raw", enc.encode(MATERIAL), "PBKDF2", false, ["deriveKey"]);
    return subtle().deriveKey(
      { name: "PBKDF2", salt: salt, iterations: ITERATIONS, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  async function loadFile(fileName) {
    var res = await fetch("./" + fileName, { cache: "no-store" });
    if (!res.ok) throw new Error("Не удалось загрузить пакет (" + res.status + ").");
    var pkg = await res.json();
    if (!pkg || pkg.v === undefined || !pkg.iv || !pkg.ciphertext) throw new Error("Пакет повреждён.");
    var salt = b64ToBytes(pkg.kdf.salt);
    if (salt.length < SALT_LEN) throw new Error("Пакет повреждён: соль.");
    var key = await deriveKey(salt);
    var plain;
    try {
      plain = await subtle().decrypt(
        { name: "AES-GCM", iv: b64ToBytes(pkg.iv), additionalData: new TextEncoder().encode(pkg.aad || "") },
        key,
        b64ToBytes(pkg.ciphertext)
      );
    } catch (e) {
      throw new Error("Не удалось расшифровать пакет.");
    }
    var data = JSON.parse(new TextDecoder().decode(plain));
    if (!data || !Array.isArray(data.domains)) throw new Error("Пакет пуст.");
    return data;
  }

  /* ensure(entitlement) → decrypted pack. The entitlement is exactly what
   * window.Unlock.state(product).hash holds: a Base tx hash, or the string
   * "license:TW1-…" issued by the shop auto-delivery. */
  function ensure(entitlement) {
    if (cache) return Promise.resolve(cache);
    if (loading) return loading;
    var ent = String(entitlement == null ? "" : entitlement);
    if (!ent) {
      return Promise.reject(new Error("Нет подтверждённого платежа. Откройте Pro и вставьте хеш транзакции или ключ TW1-…"));
    }
    var asLicense = /^license:/i.test(ent);
    var gate;
    if (asLicense) {
      var raw = ent.replace(/^license:/i, "");
      if (!root.Unlock || !root.Unlock.verifyLicenseKey) {
        var err0 = new Error("Не загрузился проверщик ключей. Обновите страницу.");
        err0.paymentFailed = true;
        return Promise.reject(err0);
      }
      gate = root.Unlock.verifyLicenseKey(raw, { product: "sni-whitelist", grant: false }).then(function (lic) {
        if (lic && lic.valid) return { ok: true };
        return { ok: false, reason: "Ключ TW1-… не подходит к этой базе (" + (lic && lic.error) + ")." };
      });
    } else {
      gate = checkPayment(ent);
    }
    loading = gate.then(async function (chk) {
      if (!chk.ok) {
        var err = new Error(chk.reason || "Платёж не подтверждён.");
        err.paymentFailed = true;
        throw err;
      }
      var data = await loadFile("sni-pack.json.enc");
      cache = data;
      loading = null;
      return data;
    }).catch(function (err) {
      loading = null;
      throw err;
    });
    return loading;
  }

  root.SNIPack = {
    ensure: ensure,
    isLoaded: function () { return !!cache; },
    get: function () { return cache; }
  };
})(window);
