/* Faux DOM for the WB & Ozon inspector unit tests: just enough of the
 * Element surface core.js touches (querySelectorAll on a[href],
 * parentElement climbs, getAttribute, innerText, querySelector by
 * attribute selectors) so the harvest runs offline in Node.
 */
"use strict";

function makeEl(tag, attrs, children, text) {
  attrs = attrs || {};
  children = children || [];
  var el = {
    tagName: tag,
    attrs: attrs,
    children: children,
    textContent: text || "",
    parentElement: null,
    getAttribute: function (name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    }
  };
  Object.defineProperty(el, "innerText", {
    get: function () {
      var own = typeof this.textContent === "string" ? this.textContent : "";
      return own + children.map(function (c) { return c.innerText; }).join(" ");
    }
  });
  children.forEach(function (c) { c.parentElement = el; });
  el.querySelectorAll = function (selector) {
    if (selector !== "a[href]") return [];
    var out = [];
    (function walk(n) {
      n.children && n.children.forEach(function (c) {
        if (c.tagName === "a" && c.getAttribute("href")) out.push(c);
        walk(c);
      });
    })(el);
    return out;
  };
  el.querySelector = function (selector) {
    var parts = selector.split(",").map(function (s) { return s.trim(); });
    var found = null;
    (function walk(n) {
      (n.children || []).forEach(function (c) {
        for (var i = 0; i < parts.length; i++) {
          var m = /^\[(?:data-|class)class\]/.test(parts[i]);
          if (matches(c, parts[i])) { found = c; return; }
        }
        if (found) return;
        walk(c);
      });
    })(el);
    return found;
  };
  function matches(node, selector) {
    var bracket = /^\[([^\]\*=]+)(?:\*=|)?(?:([^\]]*))?\]$/.exec(selector);
    if (!bracket) return false;
    var name = bracket[1], frag = bracket[2] || "";
    if (name === "class") {
      var cls = node.attrs["class"] || "";
      return frag ? cls.indexOf(frag) !== -1 : cls !== "";
    }
    if (name === "*") return true;
    return node.getAttribute(name) != null && (frag ? String(node.getAttribute(name)).indexOf(frag) !== -1 : true);
  }
  return el;
}

function wbCard(sku, ariaLabel, oldPrice, price) {
  return makeEl("div", { "class": "product-card__wrapper" }, [
    makeEl("a", { href: "/catalog/" + sku + "/detail.aspx", "aria-label": ariaLabel }, [
      makeEl("div", { "class": "price" }, [
        makeEl("del", {}, [], oldPrice + " ₽"),
        makeEl("ins", {}, [], price + " ₽")
      ])
    ])
  ]);
}

module.exports = {
  makeEl: makeEl,
  wbSearch: function () {
    return makeEl("main", {}, [
      makeEl("div", { "class": "search-list" }, [
        wbCard(103, "Штора рулонная 1,8×2,5 м, цвет графит", 2490, 1990),
        wbCard(105, "Сковорода литая 26 см", 3590, 2190),
        wbCard(103, "Штора рулонная 1,8×2,5 м, цвет графит (повтор)", 2490, 1990),
        wbCard(107, "Набор контейнеров 3 пр.", 990, 790),
        wbCard(123, "Кружка керамическая 350 мл", 590, 490)
      ]),
      makeEl("a", { href: "/promotions/black-friday" }, [], "Распродажа"),
      makeEl("a", { href: "/help/delivery" }, [], "Доставка")
    ]);
  },
  ozonSearch: function () {
    return makeEl("main", {}, [
      makeEl("div", { "data-seller": "ИП Петров", "class": "seller-badge" }, [], "ИП Петров",
        // seller badge sits INSIDE the card below
      ),
      makeEl("div", { "class": "tile" }, [
        makeEl("a", { href: "/product/shtora-1285740013/", "aria-label": "Штора блэкаут 230 см" }, [
          makeEl("div", { "class": "tsHeadline5" }, [], "2 990 ₽ 4 490 ₽")
        ]),
        makeEl("div", { "data-sellertest": true })
      ])
    ]);
  }
};

/* The junk page: links exist, but none is a priced product card. */
module.exports.junkPage = function () {
  return module.exports.makeEl("main", {}, [
    module.exports.makeEl("a", { href: "/catalog/0000/detail.aspx" }, [], "Пустая карточка"),
    module.exports.makeEl("a", { href: "/categories/hobby" }, [], "Хобби")
  ]);
};
