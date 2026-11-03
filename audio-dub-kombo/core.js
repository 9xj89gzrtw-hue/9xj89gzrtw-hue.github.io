/* Audio Dub Kombo — shared core.
 *
 * The userscript and the MV3 extension load this same file, so the panel on
 * YouTube behaves exactly like the panel in the extension. Nothing here touches
 * the DOM: everything is a pure function with a test in tests/userscript.test.js.
 *
 * Loaded as a <script>, it defines window.AudioDubCore; loaded with require(),
 * it returns the same object.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.AudioDubCore = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var VERSION = "2.0.0";
  var STUDIO_URL = "https://9xj89gzrtw-hue.github.io/audio-dub-extractor/studio.html";
  var PRODUCT = "audio-dub-studio";
  var MARK_KEY = "adk:marks:v1";
  var MAX_MARKS = 200;

  /* --- timecode ------------------------------------------------------- */

  function tc(seconds) {
    var ms = Math.round(Math.max(0, Number(seconds) || 0) * 1000);
    var h = Math.floor(ms / 3600000);
    var m = Math.floor((ms % 3600000) / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    var milli = ms % 1000;
    var two = function (n) { return String(n).padStart(2, "0"); };
    return (h ? two(h) + ":" : "") + two(m) + ":" + two(s) + "." + String(milli).padStart(3, "0");
  }

  function parseTc(text) {
    var raw = String(text == null ? "" : text).trim().replace(",", ".");
    if (!raw) return null;
    var parts = raw.split(":");
    if (parts.length > 3) return null;
    var total = 0;
    for (var i = 0; i < parts.length; i += 1) {
      var n = Number(parts[i]);
      if (!isFinite(n) || n < 0 || (i > 0 && n >= 60)) return null;
      total = total * 60 + n;
    }
    return total;
  }

  /* --- marks and the Studio project ----------------------------------- */

  /** Marks come in pairs: opening and closing. A lone tail is not a clip yet —
   *  Studio must never invent an end that the editor did not set. */
  function pairs(list) {
    var out = [];
    var src = Array.isArray(list) ? list : [];
    for (var i = 0; i + 1 < src.length; i += 2) {
      var start = Number(src[i] && src[i].at) || 0;
      var end = Number(src[i + 1] && src[i + 1].at) || 0;
      if (end > start) out.push({ start: start, end: end, index: out.length });
    }
    return out;
  }

  function safeName(name, fallback) {
    var clean = String(name == null ? "" : name)
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")
      .replace(/\s+/g, " ")
      .trim();
    return clean.slice(0, 70) || (fallback || "video");
  }

  function buildProject(opts) {
    var o = opts || {};
    var list = pairs(o.marks);
    var name = safeName(o.title, "video");
    return {
      app: "audio-dub-extractor",
      version: 1,
      savedAt: new Date().toISOString(),
      source: String(o.url || ""),
      title: String(o.title || ""),
      clipSeconds: list.reduce(function (sum, c) { return sum + (c.end - c.start); }, 0),
      items: list.map(function (c, i) {
        return {
          name: name + " часть " + (i + 1),
          in: tc(c.start),
          out: tc(c.end),
          source: String(o.url || "")
        };
      })
    };
  }

  /* --- base64url ------------------------------------------------------ */

  function b64uEncode(text) {
    var bytes = new TextEncoder().encode(text);
    var bin = "";
    for (var i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function b64uDecode(text) {
    var b64 = String(text || "").replace(/-/g, "+").replace(/_/g, "/");
    var pad = b64.length % 4 ? new Array(5 - (b64.length % 4)).join("=") : "";
    var bin = atob(b64 + pad);
    var out = "";
    for (var i = 0; i < bin.length; i += 1) out += String.fromCharCode(bin.charCodeAt(i));
    var bytes = new Uint8Array(out.length);
    for (var j = 0; j < out.length; j += 1) bytes[j] = out.charCodeAt(j);
    return new TextDecoder().decode(bytes);
  }

  /** URL that opens Studio with the clips already in the queue. */
  function studioUrl(project, licenseKey) {
    var hash = "clips=" + b64uEncode(JSON.stringify(project));
    if (licenseKey) hash += "&key=" + encodeURIComponent(licenseKey);
    return STUDIO_URL + "#" + hash;
  }

  /** Read that hash back (studio.html uses this). */
  function readStudioHash(hash) {
    var raw = String(hash || "").replace(/^#/, "");
    if (!raw) return null;
    var out = { project: null, key: null, error: null };
    var parts = raw.split("&");
    for (var i = 0; i < parts.length; i += 1) {
      var eq = parts[i].indexOf("=");
      if (eq === -1) continue;
      var name = parts[i].slice(0, eq);
      var value = parts[i].slice(eq + 1);
      if (name === "key") out.key = decodeURIComponent(value);
      if (name === "clips") {
        try { out.project = JSON.parse(b64uDecode(value)); }
        catch (e) { out.error = "clips: " + e.message; }
      }
    }
    if (!out.project && !out.key) return null;
    return out;
  }

  /* --- media URL classification --------------------------------------- */

  var AUDIO_EXT = /\.(m4a|mp3|aac|ogg|oga|opus|flac|wav)(?:$|[?#])/i;
  var MUXED_EXT = /\.(mp4|m4v|webm|mov|mkv)(?:$|[?#])/i;
  var YANDEX_HOST = /(^|\.)(yandex\.(net|ru|com|by|kz)|ya\.ru|yastatic\.net)$/i;
  var DUB_HINT = /(translat|dub|voiceover|voice-over|voice_over|perevod|ozvuch|\u043e\u0437\u0432\u0443\u0447|tts|speech|narrat|\/audio\/|audiostream|audio_stream|audiobook)/i;
  var VK_AUDIO_HOST = /(^|\.)(mycdn\.me|userapi\.com|vk\.com|vk\.ru)$/i;

  /** Audio-only itags on YouTube: 139/140/141 (AAC), 171/172 (Vorbis), 249-251 (Opus). */
  var AUDIO_ITAGS = { 139: 1, 140: 1, 141: 1, 171: 1, 172: 1, 249: 1, 250: 1, 251: 1 };

  function query(url, name) {
    var m = new RegExp("[?&]" + name + "=([^&#]*)", "i").exec(url);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : null;
  }

  function extFromMime(mime) {
    var m = String(mime || "").toLowerCase().split(";")[0].trim();
    if (/audio\/mp4|audio\/m4a|audio\/aac/.test(m)) return "m4a";
    if (/audio\/mpeg/.test(m)) return "mp3";
    if (/audio\/webm|audio\/ogg|audio\/opus/.test(m)) return "webm";
    if (/audio\/wav|x-wav/.test(m)) return "wav";
    if (/video\/mp4/.test(m)) return "mp4";
    if (/video\/webm/.test(m)) return "webm";
    return null;
  }

  /**
   * Decide what a URL is worth.
   *   { kind: "dub" | "audio" | "muxed", ext, score, host }
   * Returns null for anything that cannot become a usable audio file
   * (video-only streams, HLS playlists, images, scripts).
   */
  function classify(url) {
    var raw = String(url == null ? "" : url).trim();
    if (!/^https?:\/\//i.test(raw)) return null;

    var host = "";
    try { host = new URL(raw).hostname; } catch (e) { return null; }

    var mime = query(raw, "mime") || "";
    var itag = query(raw, "itag");
    var m3u8 = /\.m3u8(?:$|[?#])/i.test(raw);

    /* HLS is a playlist, not a file: download it as-is would hand the buyer
       400 bytes of text. Refuse instead of lying. */
    if (m3u8) return null;

    var yandex = YANDEX_HOST.test(host);
    var hinted = DUB_HINT.test(raw);
    var audioMime = /^audio\//i.test(mime);
    var videoMime = /^video\//i.test(mime);
    var audioExt = AUDIO_EXT.exec(raw);
    var muxedExt = MUXED_EXT.exec(raw);

    if (yandex && (hinted || audioMime || audioExt)) {
      return {
        kind: "dub",
        ext: extFromMime(mime) || (audioExt ? audioExt[1].toLowerCase() : "mp3"),
        score: 1000 + (audioMime ? 20 : 0),
        host: host
      };
    }

    if (/googlevideo\.com$/i.test(host)) {
      if (audioMime || (itag && AUDIO_ITAGS[itag])) {
        return {
          kind: "audio",
          ext: extFromMime(mime) || "m4a",
          score: 500 + (audioMime && /mp4/.test(mime) ? 30 : 0) + (itag && AUDIO_ITAGS[itag] ? 10 : 0),
          host: host
        };
      }
      return null;
    }

    if (VK_AUDIO_HOST.test(host) && (audioExt || audioMime) && !videoMime) {
      return {
        kind: "audio",
        ext: audioExt ? audioExt[1].toLowerCase() : extFromMime(mime) || "mp3",
        score: 480,
        host: host
      };
    }

    if (audioMime || (audioExt && !muxedExt)) {
      return {
        kind: "audio",
        ext: audioExt ? audioExt[1].toLowerCase() : extFromMime(mime) || "m4a",
        score: 400,
        host: host
      };
    }

    /* A muxed MP4 has the original soundtrack inside. We say "muxed" so the
       panel can be honest about it instead of promising a bare audio track. */
    if (videoMime && /mp4/i.test(videoMime ? mime : "")) {
      return { kind: "muxed", ext: "mp4", score: 120, host: host };
    }
    if (muxedExt) return { kind: "muxed", ext: muxedExt[1].toLowerCase(), score: 100, host: host };

    return null;
  }

  /** Highest score first, one entry per URL. */
  function rank(list) {
    var seen = {};
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (item) {
      if (!item || !item.url) return;
      var url = String(item.url);
      if (seen[url]) return;
      seen[url] = true;
      var info = item.kind ? item : Object.assign({ url: url }, classify(url) || {});
      if (!info.kind) return;
      out.push(Object.assign({ url: url }, info, {
        score: Number(info.score) || 0,
        at: Number(item.at) || 0
      }));
    });
    out.sort(function (a, b) { return b.score - a.score || b.at - a.at; });
    return out;
  }

  /** Best candidate of a kind, falling back to a muxed file for "audio". */
  function best(list, kind) {
    var ranked = rank(list);
    for (var i = 0; i < ranked.length; i += 1) {
      if (ranked[i].kind === kind) return ranked[i];
    }
    if (kind === "audio") {
      for (var j = 0; j < ranked.length; j += 1) {
        if (ranked[j].kind === "muxed") {
          return Object.assign({}, ranked[j], { fallback: true });
        }
      }
    }
    return null;
  }

  function filenameFor(kind, title, ext) {
    var base = safeName(title, "video");
    var suffix = kind === "dub" ? " \u2014 \u043e\u0437\u0432\u0443\u0447\u043a\u0430 \u042f\u043d\u0434\u0435\u043a\u0441\u0430" : " \u2014 \u0437\u0432\u0443\u043a";
    return base + suffix + "." + (ext || "m4a");
  }

  /* --- offline licence keys (same constants as assets/unlock.js) ------- */

  var LICENSE_PUBLIC_KEY = {
    kty: "EC",
    crv: "P-256",
    x: "YVH3fyYkuivpkuKQjUqw02XxX3mO5FadXsxijuK52so",
    y: "POqoRl3cMmg1UUxmwpCDBj2q3kVqwuH-EySTT3zcefQ"
  };

  var LICENSE_PRODUCTS = {
    "audio-dub-studio": "AUDIO",
    "tg-chats": "TG",
    "docsearch": "DOC",
    "newsflow": "NEWS",
    "live-radar": "RADAR",
    "data-clipper": "CLIP",
    "base-tax-audit": "TAX",
    "all-in-one": "ALL"
  };
  var LICENSE_CODE_SLUG = (function () {
    var out = {};
    for (var slug in LICENSE_PRODUCTS) {
      if (Object.prototype.hasOwnProperty.call(LICENSE_PRODUCTS, slug)) out[LICENSE_PRODUCTS[slug]] = slug;
    }
    return out;
  })();
  var UNIVERSAL_CODE = "ALL";

  function b64uToBytes(text) {
    var b64 = String(text).replace(/-/g, "+").replace(/_/g, "/");
    var pad = b64.length % 4 ? new Array(5 - (b64.length % 4)).join("=") : "";
    var bin = atob(b64 + pad);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

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
    var want = LICENSE_PRODUCTS[String(product).toLowerCase()] ||
      (/^[A-Z0-9]{2,8}$/i.test(product) ? String(product).toUpperCase() : null);
    if (!want) return false;
    return code === UNIVERSAL_CODE || code === want;
  }

  var licenseKeyPromise = null;
  function licenseCryptoKey() {
    if (!licenseKeyPromise) {
      var subtle = globalThis.crypto && globalThis.crypto.subtle;
      if (!subtle) return Promise.reject(new Error("crypto.subtle unavailable"));
      licenseKeyPromise = subtle.importKey("jwk", LICENSE_PUBLIC_KEY,
        { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    }
    return licenseKeyPromise;
  }

  async function verifyLicense(text, opts) {
    var o = opts || {};
    var parsed = parseLicenseKey(text);
    if (!parsed.ok) return { valid: false, error: "format" };
    var product = o.product == null ? null : String(o.product).toLowerCase();
    try {
      var key = await licenseCryptoKey();
      var sig = b64uToBytes(parsed.signature);
      if (sig.length !== 64) return { valid: false, error: "signature" };
      var ok = await globalThis.crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig,
        new TextEncoder().encode(parsed.payload));
      if (!ok) return { valid: false, error: "signature" };
    } catch (e) {
      return { valid: false, error: "crypto", message: String((e && e.message) || e) };
    }
    if (!licenseCovers(parsed.code, product)) return { valid: false, error: "product", code: parsed.code };
    return {
      valid: true, code: parsed.code, kid: parsed.kid, key: parsed.key,
      slug: LICENSE_CODE_SLUG[parsed.code] || null,
      universal: parsed.code === UNIVERSAL_CODE
    };
  }

  /* --- licence storage ------------------------------------------------- */

  function licenseStorageKey(product) { return "unlock:" + (product || PRODUCT); }

  function storedLicense(product) {
    try {
      var rec = JSON.parse(root.localStorage.getItem(licenseStorageKey(product)) || "null");
      return rec && rec.hash ? rec : null;
    } catch (e) { return null; }
  }

  function storeLicense(product, license) {
    try {
      root.localStorage.setItem(licenseStorageKey(product), JSON.stringify({
        hash: "license:" + license.key,
        received: "0",
        at: new Date().toISOString(),
        price: "7",
        kind: "license",
        code: license.code,
        kid: license.kid
      }));
      if (root.document && root.document.dispatchEvent) {
        root.document.dispatchEvent(new CustomEvent("unlock:changed", { detail: { product: product || PRODUCT } }));
      }
      return true;
    } catch (e) { return false; }
  }

  /* --- download -------------------------------------------------------- */

  function fileSizeOf(url) {
    var clen = query(url, "clen");
    return clen ? Number(clen) : 0;
  }

  function extBlocked(url) {
    return /\.m3u8(?:$|[?#])/i.test(url);
  }

  /**
   * Download one URL. Four strategies, best first, because the hosts differ:
   *   1. MV3 extension, isolated world -> chrome.downloads in the worker
   *   2. MV3 extension, MAIN world     -> bridge.js over window.postMessage
   *   3. fetch + Blob                  -> *.googlevideo.com / *.yandex.net (CORS *)
   *   4. plain <a download>            -> last resort for opaque responses
   */
  function download(url, filename, opts) {
    var o = opts || {};
    if (extBlocked(url)) {
      return Promise.resolve({ ok: false, error: "hls", message: "Это HLS-плейлист, а не файл: скачать одним куском нельзя." });
    }

    var chromeApi = root.chrome;
    if (chromeApi && chromeApi.runtime && chromeApi.runtime.id && chromeApi.runtime.sendMessage) {
      return sendToWorker(url, filename).then(function (res) {
        return res.ok ? res : fetchBlob(url, filename);
      });
    }
    if (bridgeReady()) return bridgeDownload(url, filename).then(function (res) {
      return res.ok ? res : fetchBlob(url, filename);
    });
    return fetchBlob(url, filename);
  }

  function sendToWorker(url, filename) {
    return new Promise(function (resolve) {
      var api = root.chrome;
      var timer = setTimeout(function () { resolve({ ok: false, error: "timeout" }); }, 60000);
      try {
        api.runtime.sendMessage({ type: "tw-download", url: url, filename: filename }, function (res) {
          clearTimeout(timer);
          if (api.runtime.lastError || !res || !res.ok) {
            resolve({ ok: false, error: "extension", message: (res && res.message) || "" });
            return;
          }
          resolve({ ok: true, method: "extension", id: res.id });
        });
      } catch (e) {
        clearTimeout(timer);
        resolve({ ok: false, error: "extension", message: String(e && e.message) });
      }
    });
  }

  /* bridge.js runs in the isolated world and sets this flag on <html>. */
  function bridgeReady() {
    try {
      var el = root.document && root.document.documentElement;
      return !!(el && el.dataset && el.dataset.adkExt === "1");
    } catch (e) { return false; }
  }

  function bridgeDownload(url, filename) {
    return new Promise(function (resolve) {
      var id = "d" + Date.now().toString(36) + Math.random().toString(16).slice(2);
      var timer = setTimeout(function () { cleanup(); resolve({ ok: false, error: "timeout" }); }, 60000);
      function cleanup() { clearTimeout(timer); root.removeEventListener("message", onMessage); }
      function onMessage(e) {
        var data = e && e.data;
        if (!data || data.__adk !== "download-result" || data.id !== id) return;
        cleanup();
        if (data.ok) resolve({ ok: true, method: "extension", id: data.downloadId });
        else resolve({ ok: false, error: "extension", message: data.message || "" });
      }
      root.addEventListener("message", onMessage);
      root.postMessage({ __adk: "download", id: id, url: url, filename: filename }, "*");
    });
  }

  function fetchBlob(url, filename) {
    if (typeof fetch !== "function" || typeof Blob !== "function") return Promise.resolve(anchorDownload(url, filename));

    /* Media CDNs answer with `Access-Control-Allow-Origin: *`, and a wildcard
       is rejected outright when credentials are included — so an anonymous
       request goes first and cookies are the fallback, not the default. */
    function attempt(credentials) {
      return fetch(url, { credentials: credentials, mode: "cors" }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.blob();
      });
    }

    return attempt("omit")
      .catch(function (firstError) {
        return attempt("include").catch(function () { throw firstError; });
      })
      .then(function (blob) {
        if (!blob || blob.size < 1024) throw new Error("empty response");
        var href = URL.createObjectURL(blob);
        clickAnchor(href, filename);
        setTimeout(function () { URL.revokeObjectURL(href); }, 60000);
        return { ok: true, method: "fetch", bytes: blob.size, type: blob.type };
      })
      .catch(function (e) {
        var fallback = anchorDownload(url, filename);
        fallback.message = String((e && e.message) || e);
        return fallback;
      });
  }

  function anchorDownload(url, filename) {
    clickAnchor(url, filename);
    return { ok: true, method: "anchor", bytes: 0 };
  }

  function clickAnchor(href, filename) {
    var a = root.document.createElement("a");
    a.href = href;
    a.download = filename || "audio";
    /* Without target=_blank a cross-origin link drops the `download`
       attribute and navigates away from the video — the panel would vanish. */
    a.target = "_blank";
    a.rel = "noopener";
    a.style.display = "none";
    root.document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); }, 1000);
  }

  /* --- site detection --------------------------------------------------- */

  function siteOf(loc) {
    var host = "";
    var path = "/";
    try {
      host = String(loc.hostname || "");
      path = String(loc.pathname || "/");
    } catch (e) { /* ignore */ }
    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/.test(host)) {
      return {
        id: "youtube",
        name: "YouTube",
        accent: "#065fd4",
        accentSoft: "#e8f0fe",
        anchor: ["#below", "#secondary-inner", "ytd-watch-flexy #primary-inner", "#shorts-inner-container", "#owner"]
      };
    }
    if (/(^|\.)vk\.com$|(^|\.)vkvideo\.ru$|(^|\.)vk\.ru$/.test(host)) {
      return {
        id: "vk",
        name: "VK Video",
        accent: "#0077ff",
        accentSoft: "#eaf2ff",
        anchor: [".vv_info", "#video_info", ".video_info", ".vv_player_wrap"]
      };
    }
    if (/(^|\.)rutube\.ru$/.test(host)) {
      return {
        id: "rutube",
        name: "Rutube",
        accent: "#ef2c37",
        accentSoft: "#ffeceb",
        anchor: [".video-page-info", "#video-info", ".video-info", ".wrapper-video"]
      };
    }
    if (host === "127.0.0.1" || host === "localhost" || /^file:/.test(String(loc.protocol))) {
      return { id: "test", name: "Local", accent: "#065fd4", accentSoft: "#e8f0fe", anchor: ["#below", "#adk-test-anchor", "body"] };
    }
    return null;
  }

  return {
    VERSION: VERSION,
    STUDIO_URL: STUDIO_URL,
    PRODUCT: PRODUCT,
    MARK_KEY: MARK_KEY,
    MAX_MARKS: MAX_MARKS,
    tc: tc,
    parseTc: parseTc,
    pairs: pairs,
    safeName: safeName,
    buildProject: buildProject,
    b64uEncode: b64uEncode,
    b64uDecode: b64uDecode,
    studioUrl: studioUrl,
    readStudioHash: readStudioHash,
    classify: classify,
    rank: rank,
    best: best,
    filenameFor: filenameFor,
    extFromMime: extFromMime,
    fileSizeOf: fileSizeOf,
    query: query,
    download: download,
    siteOf: siteOf,
    LICENSE_PUBLIC_KEY: LICENSE_PUBLIC_KEY,
    LICENSE_PRODUCTS: LICENSE_PRODUCTS,
    parseLicenseKey: parseLicenseKey,
    isLicenseKey: isLicenseKey,
    licenseCovers: licenseCovers,
    verifyLicense: verifyLicense,
    storedLicense: storedLicense,
    storeLicense: storeLicense
  };
});
