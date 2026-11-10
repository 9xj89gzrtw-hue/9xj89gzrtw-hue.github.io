/*
 * core.js — the pure brain of the WB & Ozon seller inspector.
 *
 * The panel is DOM code; everything that decides which product cards exist,
 * what each card costs, and what the exported Excel table says is a pure
 * function — tested offline in tests/wb-ozon.test.js so a broken selector or
 * a wrong margin can never reach the buyer's browser.
 */
(function (global) {
  "use strict";

  var VERSION = "1.2.0";
  var FREE_ROWS = 50;
  var PRODUCT = "wb-ozon-inspector";
  var SITE = "https://9xj89gzrtw-hue.github.io/data-clipper/";
  var HOME = "https://9xj89gzrtw-hue.github.io/userscripts/";
  var SITE_KEY = "unlock:" + PRODUCT;
  var UNIVERSAL = "unlock:universal";

  /* Same public key as assets/unlock.js and the clipper: a key signed for
     CLIP (or ALL) opens the limit here too — one key, every export product,
     no request and no account. */
  var LICENSE_PUBLIC_KEY = {
    kty: "EC", crv: "P-256",
    x: "YVH3fyYkuivpkuKQjUqw02XxX3mO5FadXsxijuK52so",
    y: "POqoRl3cMmg1UUxmwpCDBj2q3kVqwuH-EySTT3zcefQ"
  };

  /* Cards live under catalog URLs; the SKU is the number the vendor db keys
     on. WB: /catalog/27030630/detail.aspx ( optionally -<n> suffix ),
     Ozon: /product/<slug>-<digits>/. */
  var HREF_RE = {
    wb: /\/catalog\/(\d{4,})(?:-[^/?#]*)?\/detail(?:\.aspx)?(?:-[^/?#]*)?/i,
    ozon: /\/product\/[^/]*?-{1}(\d{6,})(?:\/|$)/i
  };

  /* FALLBACK pair — v1.1. When WB / Ozon shuffle CSS classes and wrappers,
     two things never change at the same time: the numbers in the href and
     the ₽ price pattern in the card text. These are the templates used by
     the universal fallback collector below.
     WB href: /catalog/<digits>/detail(.aspx)  ·  Ozon: /product/<slug>-<digits> */
  var FALLBACK_HREF_RE = {
    wb: /\/catalog\/(\d{5,})\/detail/i,
    ozon: /\/product\/(?:[^/]*?-)?(\d{6,})(?:\/|$)/i
  };
  var PRICE_CHROME_RE = /[0-9][0-9\s\u00A0\u202F\u2009\u200A\u200B]*₽/;

  function siteOf(loc) {
    if (!loc || !loc.hostname) return null;
    var host = String(loc.hostname).toLowerCase().replace(/^www\.|^m\./, "");
    if (host === "wildberries.ru" || host.slice(-15) === ".wildberries.ru") return { id: "wb" };
    if (host === "ozon.ru" || host.slice(-8) === ".ozon.ru") return { id: "ozon" };
    return null;
  }

  function skuFromHref(href, fallback) {
    if (!href) return null;
    var set = fallback ? FALLBACK_HREF_RE : HREF_RE;
    for (var id in set) {
      var m = set[id].exec(href);
      if (m) return { site: id, sku: m[1] };
    }
    return null;
  }

  /* The two visible numbers on a card are the current price (smaller) and
     the strikethrough list price (larger). One number -> just the price.
     Thousands separators (spaces / narrow spaces) are tolerated. */
  function pricesFromText(text) {
    if (text == null) return { price: null, oldPrice: null, discount: null };
    var norm = String(text).replace(/[\u00A0\u202F\u2009\u200A\u200B]/g, " ");
    var nums = [], re = /((?:\d{1,3}(?:[ ]?\d{3})+|\d{2,7})(?:[.,]\d{1,2})?)\s*₽/g, m;
    while ((m = re.exec(norm)) !== null) {
      // "1 234 ₽/мес" is an installment, not the shelf price
      if (/^\s*\/\s*мес/i.test(norm.slice(re.lastIndex))) continue;
      var v = parseFloat(m[1].replace(/[ ]/g, "").replace(",", "."));
      if (isFinite(v)) nums.push(v);
    }
    if (!nums.length) return { price: null, oldPrice: null, discount: null };
    var uniq = [];
    nums.forEach(function (n) {
      if (uniq.indexOf(n) === -1) uniq.push(n);
    });
    uniq.sort(function (a, b) { return a - b; });
    if (uniq.length === 1) {
      return { price: uniq[0], oldPrice: null, discount: null };
    }
    var price = uniq[0], oldPrice = uniq[uniq.length - 1];
    var discount = oldPrice > 0 ? Math.round((1 - price / oldPrice) * 100) : null;
    return { price: price, oldPrice: oldPrice, discount: discount };
  }

  /* One product card: the cheapest anchor to a detail page plus its card
     container's innerText as the value source. Returns null for junk. */
  function cardFromAnchor(a, container) {
    if (!a || !a.getAttribute || !a.getAttribute("href")) return null;
    var ref = skuFromHref(a.getAttribute("href"));
    if (!ref) return null;
    var box = container || a;
    var text = "";
    try { text = (box.innerText || box.textContent || ""); } catch (e) { text = ""; }
    var pr = pricesFromText(text);
    if (pr.price == null) return null;
    var name = a.getAttribute("aria-label") || null;
    if (!name && box.querySelector) {
      var named = box.querySelector("[aria-label]");
      if (named && named.getAttribute) name = named.getAttribute("aria-label");
    }
    var title = text.replace(/\s+/g, " ").trim();
    var seller = null;
    try {
      var st = box.querySelector("[data-seller], [data-sellertype], [class*=seller]");
      if (st) {
        seller = st.getAttribute("data-seller") || (st.innerText || "").trim() || null;
      }
    } catch (e) { seller = null; }
    return {
      site: ref.site,
      sku: ref.sku,
      name: name || title.replace(/\s*\d[\d\s.,]*₽.*$/, "").trim().slice(0, 180) || ("sku " + ref.sku),
      raw: title.slice(0, 300),
      price: pr.price,
      oldPrice: pr.oldPrice,
      discount: pr.discount,
      seller: seller,
      href: a.getAttribute("href"),
      container: box
    };
  }

  /* Harvest every product card of the page.
   *
   * Primary pass — every anchor to a detail URL is considered, and its
   * numbers come from the widest ancestor that still contains exactly one
   * product (stops a grid from lending its cheapest neighbour's price to
   * the card).
   *
   * Fallback pass (v1.1) — for anchors whose own subtree carries no ₽-price
   * (classes/wrappers changed), walk two more ancestors and then the next
   * priced siblings. The sibling is only accepted when it holds at most one
   * product SKU, so a sibling grid never welds a foreign price onto a card.
   */
  function collect(root, site) {
    if (!root || !root.querySelectorAll) return [];
    if (!site) site = { id: "wb" };
    var seen = {}, rows = [], hrefs = [];
    hrefs.push.apply(hrefs, root.querySelectorAll("a[href]"));
    var extra = root.querySelectorAll("[href]");
    for (var k = 0; k < extra.length; k++) {
      if (hrefs.indexOf(extra[k]) === -1) hrefs.push(extra[k]);
    }
    for (var i = 0; i < hrefs.length; i++) {
      var direct = cardFromAnchor(hrefs[i], null);
      var box = hrefs[i], best = null, hop = 0;
      while (box && hop < 8) {
        var tag = String(box.tagName || "").toUpperCase();
        if (tag === "BODY" || tag === "HTML") break;
        var probe = cardFromAnchor(hrefs[i], box);
        if (probe && probe.price != null) {
          if (probe.raw.length > 600 || countSkus(box) > 1) break;
          best = probe;
        }
        box = box.parentElement || null;
        hop++;
      }
      /* fallback: SKU found, price lives in a neighbouring block */
      if (!best) {
        var ref = skuFromHref(rawHref(hrefs[i])) ||
                  (skuFromHref(rawHref(hrefs[i]), true) || null);
        if (ref) {
          var near = pricedBetween(parentChain(hrefs[i], 3));
          if (near && near.text) {
            var pr = pricesFromText(near.text);
            if (pr.price != null) {
              best = cardFromAnchor(hrefs[i], null) || {};
              best.site = ref.site;
              best.sku = ref.sku;
              best.price = pr.price;
              best.oldPrice = pr.oldPrice;
              best.discount = pr.discount;
              best.raw = near.text.replace(/\s+/g, " ").trim().slice(0, 300);
              if (!best.name || /^sku \d+$/.test(best.name)) {
                best.name = best.raw.replace(/\s*\d[\d\s.,]*₽.*$/, "").trim().slice(0, 180) || ("sku " + ref.sku);
              }
              best.href = best.href || rawHref(hrefs[i]);
              best.container = near.node;
              best.fallback = "sibling";
            }
          }
        }
      }
      if (!best || best.sku == null) continue;
      if (seen[best.sku]) continue;
      seen[best.sku] = true;
      rows.push(best);
    }
    return rows;
  }

  function rawHref(node) {
    if (!node || !node.getAttribute) return null;
    return node.getAttribute("href") || node.getAttribute("data-href") || null;
  }

  function parentChain(node, levels) {
    var out = [], cur = node;
    for (var i = 0; cur && i <= (levels || 0); i++) {
      out.push(cur);
      cur = cur.parentElement || null;
    }
    return out;
  }

  /* First block reachable from the anchor's closest container (its next
   * siblings, then the container's own next siblings) that contains a ₽
   * price and at most one product SKU. Anchored to the DOM order: cards on
   * WB/Ozon are laid out as [img][info] or [link][price-stripe] side by
   * side, so "next in document order" is where the price lives. */
  function pricedBetween(block, hops) {
    var horizon = hops == null ? 3 : hops;
    for (var l = 0; l < block.length && l < horizon; l++) {
      var sib = block[l].nextElementSibling;
      while (sib) {
        var text = (sib.innerText || sib.textContent || "");
        if (text && PRICE_CHROME_RE.test(text) && countSkus(sib) <= 1) {
          return { node: sib, text: text };
        }
        sib = sib.nextElementSibling;
      }
    }
    return null;
  }

  function countSkus(node) {
    if (!node || !node.querySelectorAll) return 0;
    var links = node.querySelectorAll("a[href]"), seen = {}, n = 0;
    for (var i = 0; i < links.length; i++) {
      var ref = skuFromHref(links[i].getAttribute("href"));
      if (ref && !seen[ref.sku]) { seen[ref.sku] = true; n++; }
    }
    return n;
  }

  /* Unit economics of one row. revenue = price after marketplace cut,
     margin = revenue − logistics − cost. All inputs plain numbers. */
  function marginRow(row, cfg) {
    var c = cfg || {};
    var commission = num(c.commissionPct, 0) / 100;
    var spp = num(c.sppPct, 0) / 100;
    var tax = num(c.taxPct, 0) / 100;
    var logistics = num(c.logisticsRub, 0);
    var cost = num(c.costRub, 0);
    var price = row && row.price != null ? row.price : 0;
    var cut = commission + spp + tax;
    var revenue = price * (1 - cut);
    var marginRub = revenue - logistics - cost;
    return {
      sku: row.sku,
      name: row.name,
      seller: row.seller || "",
      price: price,
      oldPrice: row.oldPrice || "",
      discount: row.discount != null ? row.discount : "",
      commissionPct: num(c.commissionPct, 0),
      sppPct: num(c.sppPct, 0),
      taxPct: num(c.taxPct, 0),
      logisticsRub: logistics,
      costRub: cost,
      revenue: round2(revenue),
      marginRub: round2(marginRub),
      marginPct: price > 0 ? round2(marginRub / price * 100) : null
    };
  }

  function marginTable(rows, cfg) {
    return rows.map(function (r) { return marginRow(r, cfg); });
  }

  var COLUMNS = [
    "SKU", "Наименование", "Продавец", "Цена, ₽", "Старая цена, ₽",
    "Скидка, %", "Комиссия, %", "СПП, %", "Налог, %", "Логистика, ₽",
    "Закуп/себест., ₽", "Выручка минус удержания, ₽", "Маржа, ₽", "Маржа, %"
  ];

  function rowsToCsv(margins) {
    var out = [COLUMNS];
    margins.forEach(function (m) {
      out.push([m.sku, m.name, m.seller, m.price, m.oldPrice, m.discount,
                m.commissionPct, m.sppPct, m.taxPct, m.logisticsRub,
                m.costRub, m.revenue, m.marginRub, m.marginPct]);
    });
    return buildCsv(out);
  }

  function buildCsv(table, delimiter) {
    var d = delimiter || ";";
    var withBOM = true;
    var csvRows = table.map(function (r) {
      return r.map(function (v) { return escapeCell(v, d); }).join(d);
    });
    var text = csvRows.join("\n") + "\n";
    return withBOM ? "\uFEFF" + text : text;
  }

  function escapeCell(value, delimiter) {
    var v = value == null ? "" : String(value);
    var needsQuote = v.indexOf(delimiter) !== -1 ||
      v.indexOf('"') !== -1 || v.indexOf("\n") !== -1 || v.indexOf("\r") !== -1;
    if (!needsQuote) return v;
    return '"' + v.replace(/"/g, '""') + '"';
  }

  /* The free tier: 50 rows per export without a key. */
  function clipRows(rows, isPro, limit) {
    var lim = limit || FREE_ROWS;
    if (isPro || rows.length <= lim) {
      return { rows: rows, truncated: false, shown: rows.length };
    }
    return { rows: rows.slice(0, lim), truncated: true, shown: lim };
  }

  function storedLicense(product) {
    try {
      var raw = null;
      if (global.localStorage) raw = global.localStorage.getItem(SITE_KEY);
      if (raw == null && global.localStorage) raw = global.localStorage.getItem(UNIVERSAL);
      if (!raw) return null;
      var rec = JSON.parse(raw);
      if (rec && (rec.hash || rec.kind === "license")) return rec;
    } catch (e) { /* private mode etc. */ }
    return null;
  }

  function storeLicense(product, rec) {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(SITE_KEY, JSON.stringify(rec));
      }
    } catch (e) { /* storage full / disabled */ }
  }

  /* TW1 key check — the exact ECDSA P-256 verify from assets/unlock.js and
     the clipper, so all three components agree on the same paid key.
     Format: TW1-<CODE>-<kid>-<base64url signature> (the signature's
     alphabet includes - and _, so the regex captures to end of line). */
  function verifyKey(text, opts) {
    opts = opts || {};
    var product = opts.product || PRODUCT;
    var clean = String(text == null ? "" : text).trim();
    var m = /^TW1-([A-Z0-9]{2,8})-([A-Z0-9]{6})-(.+)$/i.exec(clean);
    if (!m) return Promise.resolve({ valid: false, error: "format" });
    var code = m[1].toUpperCase();
    if (code !== "CLIP" && code !== "ALL") {
      return Promise.resolve({ valid: false, error: "product" });
    }
    var subtle = global.crypto && (global.crypto.subtle ||
      (global.crypto.webcrypto && global.crypto.webcrypto.subtle));
    if (!subtle) return Promise.resolve({ valid: false, error: "crypto" });
    var payload = new TextEncoder().encode("TW1-" + code + "-" + m[2]);
    return subtle.importKey(
      "jwk", LICENSE_PUBLIC_KEY, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
    ).then(function (pub) {
      return subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64uDecode(m[3]), payload);
    }).then(function (okSig) {
      return okSig
        ? { valid: true, ok: true, code: code, kid: m[2] }
        : { valid: false, ok: false, error: "signature" };
    }, function () {
      return { valid: false, ok: false, error: "signature" };
    });
  }

  function b64uDecode(s) {
    try {
      var pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
      var bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (e) { return null; }
  }

  function num(v, dflt) {
    var n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : v;
    return isFinite(n) ? n : (dflt || 0);
  }

  function round2(v) { return Math.round(v * 100) / 100; }

  var api = {
    VERSION: VERSION, PRODUCT: PRODUCT, FREE_ROWS: FREE_ROWS,
    SITE: SITE, SITE_KEY: SITE_KEY, UNIVERSAL: UNIVERSAL,
    LICENSE_PUBLIC_KEY: LICENSE_PUBLIC_KEY, COLUMNS: COLUMNS,
    siteOf: siteOf, skuFromHref: skuFromHref, pricesFromText: pricesFromText,
    cardFromAnchor: cardFromAnchor, collect: collect,
    marginRow: marginRow, marginTable: marginTable, rowsToCsv: rowsToCsv,
    buildCsv: buildCsv, clipRows: clipRows,
    storedLicense: storedLicense, storeLicense: storeLicense, verifyKey: verifyKey,
    num: num, round2: round2, escapeCell: escapeCell
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.WbOzon = api;
})(typeof window !== "undefined" ? window : globalThis);
