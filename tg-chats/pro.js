/* Pro data loader for TG Chat Validator.
 *
 * The public catalogue (catalog.js) ships only the free rows. The full
 * catalogue lives in pro-pack.json.enc and is decrypted here with
 * WebCrypto AES-256-GCM after the browser has verified a USDC payment on
 * Base (assets/unlock.js keeps that entitlement).
 *
 * Honest limitation, stated on the page as well: this is a static site, so
 * the key derivation below is public code. It stops bulk scraping, search
 * engine indexing and casual copying of the full list. It is not DRM.
 */
(function (root) {
  "use strict";

  var SALT_LEN = 16;
  var ITERATIONS = 310000;
  var MATERIAL = "toolworks/tgchats/v1|0x72Aa6edDE71B94f6b99c8e52EdC02B5C75F74d1a|9000000";

  var cache = null;
  var loading = null;
  var MIN_USD = 9;

  /* The entitlement lives in localStorage, which anyone can edit, so the hash
     is re-checked against Base before the pack is decrypted. No receipt, a
     reverted receipt, or less than $9 USDC to the seller address means no
     decryption. A buyer whose RPC is down sees the reason and can retry. */
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
    if (!c.subtle || !c.subtle.importKey || !c.subtle.deriveKey) {
      throw new Error("Браузер не поддерживает WebCrypto. Откройте страницу по HTTPS в актуальном браузере.");
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

  async function load() {
    var res = await fetch("./pro-pack.json.enc", { cache: "no-store" });
    if (!res.ok) throw new Error("Не удалось загрузить пакет Pro (" + res.status + ").");
    var pkg = await res.json();
    if (!pkg || pkg.v !== 1 || !pkg.iv || !pkg.ciphertext) throw new Error("Пакет Pro повреждён.");
    var salt = b64ToBytes(pkg.kdf.salt);
    if (salt.length < SALT_LEN) throw new Error("Пакет Pro повреждён: соль.");
    var key = await deriveKey(salt);
    var plain;
    try {
      plain = await subtle().decrypt(
        { name: "AES-GCM", iv: b64ToBytes(pkg.iv), additionalData: new TextEncoder().encode(pkg.aad || "") },
        key,
        b64ToBytes(pkg.ciphertext)
      );
    } catch (e) {
      throw new Error("Не удалось расшифровать пакет Pro.");
    }
    var data = JSON.parse(new TextDecoder().decode(plain));
    if (!data || !Array.isArray(data.chats)) throw new Error("Пакет Pro пуст.");
    return data;
  }

  /* Returns the decrypted catalogue once per page load. */
  function ensure(hash) {
    if (cache) return Promise.resolve(cache);
    if (loading) return loading;
    if (!hash) {
      return Promise.reject(new Error("Нет подтверждённого платежа. Откройте Pro и вставьте хеш транзакции."));
    }
    loading = checkPayment(hash).then(async function (chk) {
      if (!chk.ok) {
        var err = new Error(chk.reason || "Платёж не подтверждён.");
        err.paymentFailed = true;
        throw err;
      }
      var data = await load();
      cache = data;
      loading = null;
      return data;
    }).catch(function (err) {
      loading = null;
      throw err;
    });
    return loading;
  }

  root.ChatPack = {
    ensure: ensure,
    isLoaded: function () { return !!cache; }
  };
})(window);
