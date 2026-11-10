/*
 * Offline tests for the WB & Ozon seller inspector core.
 *
 * No jsdom and no browser: card.js only needs a tiny, deterministic DOM
 * stand-in, and the point of these tests is exactly the fragile part — which
 * ancestor's text supplies the price of a card.
 */
const assert = require("assert");
const C = require("../wb-ozon-seller-inspector/core.js");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + extra : "")); }
}

/* ---------- a very small DOM ---------- */
function node(tag, attrs, text, className) {
  const n = {
    tagName: tag.toUpperCase(),
    attrs: attrs || {},
    className: className || "",
    children: [],
    parentElement: null,
    _own: text || "",
    get nextElementSibling() {
      const p = this.parentElement;
      if (!p) return null;
      const i = p.children.indexOf(this);
      return i >= 0 && i + 1 < p.children.length ? p.children[i + 1] : null;
    },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    append(c) { c.parentElement = this; this.children.push(c); return c; },
    get innerText() { return this._own; },
    set innerText(v) { this._own = v; },
    get textContent() { return this._own; },
    querySelectorAll(sel) {
      const out = [];
      (function walk(x) {
        for (const c of x.children) {
          if (matches(c, sel)) out.push(c);
          walk(c);
        }
      })(this);
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  };
  return n;
}
function matches(n, sel) {
  if (sel === "a[href]") return n.tagName === "A" && n.getAttribute("href") != null;
  if (sel === "[href]") return n.getAttribute("href") != null;
  if (sel === "[aria-label]") return n.getAttribute("aria-label") != null;
  if (sel === "[data-seller], [data-sellertype], [class*=seller]") {
    return n.getAttribute("data-seller") != null ||
      n.getAttribute("data-sellertype") != null ||
      n.className.indexOf("seller") !== -1;
  }
  return false;
}

/* body > grid > two cards, each with one product link, one seller, prices */
function fixture() {
  const body = node("body");
  const grid = node("div", {}, "");
  const card1 = node("div", {}, "Кроссовки белые 1 299 ₽ 2 499 ₽ ООО Ромашка");
  const a1 = node("a", { href: "/catalog/27030630/detail.aspx", "aria-label": "Кроссовки белые" });
  a1.innerText = "";
  card1.append(a1);
  card1.append(node("span", { "data-seller": "ООО Ромашка" }, "ООО Ромашка", "seller"));
  const card2 = node("div", {}, "Футболка хлопок 899 ₽ 1 199 ₽ ИП Иванов");
  const a2 = node("a", { href: "/catalog/27030631/detail.aspx", "aria-label": "Футболка хлопок" });
  a2.innerText = "";
  card2.append(a2);
  card2.append(node("span", { "data-seller": "ИП Иванов" }, "ИП Иванов", "seller"));
  const noise = node("a", { href: "/info/delivery" }, "Доставка");
  grid.append(card1);
  grid.append(card2);
  body.append(noise);
  body.append(grid);
  grid.innerText = card1.innerText + " " + card2.innerText;
  return body;
}

console.log("1. адреса и SKU");
ok("wildberries.ru -> wb", C.siteOf({ hostname: "wildberries.ru" }).id === "wb");
ok("www.wildberries.ru -> wb", C.siteOf({ hostname: "www.wildberries.ru" }).id === "wb");
ok("ozon.ru -> ozon", C.siteOf({ hostname: "ozon.ru" }).id === "ozon");
ok("чужой домен -> null", C.siteOf({ hostname: "example.com" }) === null);
ok("evil-wildberries.ru не проходит", C.siteOf({ hostname: "evil-wildberries.ru" }) === null);
ok("evilozon.ru не проходит", C.siteOf({ hostname: "evilozon.ru" }) === null);
ok("WB href", C.skuFromHref("/catalog/27030630/detail.aspx").sku === "27030630");
ok("WB href с суффиксом", C.skuFromHref("/catalog/27030630-abc/detail.aspx").sku === "27030630");
ok("Ozon href", C.skuFromHref("/product/krossovki-belye-123456789/").sku === "123456789");
ok("обычная ссылка -> null", C.skuFromHref("/info/delivery") === null);

console.log("2. цены");
let p = C.pricesFromText("1 299 ₽ 2 499 ₽");
ok("цена = меньшая", p.price === 1299, p.price);
ok("старая цена = большая", p.oldPrice === 2499, p.oldPrice);
ok("скидка 48%", p.discount === 48, p.discount);
p = C.pricesFromText("3 990 ₽");
ok("одна цена без старой", p.price === 3990 && p.oldPrice === null, JSON.stringify(p));
p = C.pricesFromText("3 990 ₽ 1 200 ₽/мес");
ok("рассрочка /мес не считается ценой", p.price === 3990 && p.oldPrice === null, JSON.stringify(p));
p = C.pricesFromText("нет цены");
ok("без ₽ -> null", p.price === null);
p = C.pricesFromText("12 990 ₽ 15 000 ₽");
ok("пробелы в тысячах", p.price === 12990 && p.oldPrice === 15000, JSON.stringify(p));

console.log("3. карточки");
const body = fixture();
const rows = C.collect(body, { id: "wb" });
ok("найдены обе карточки", rows.length === 2, rows.length);
const r1 = rows.find((r) => r.sku === "27030630");
const r2 = rows.find((r) => r.sku === "27030631");
ok("цена первой карточки не подменена соседом", r1 && r1.price === 1299, r1 && r1.price);
ok("цена второй карточки", r2 && r2.price === 899, r2 && r2.price);
ok("продавец первой", r1 && r1.seller === "ООО Ромашка", r1 && r1.seller);
ok("имя из aria-label", r1 && r1.name === "Кроссовки белые", r1 && r1.name);
ok("старая цена сохранена", r1 && r1.oldPrice === 2499, r1 && r1.oldPrice);
ok("посторонняя ссылка не стала карточкой", rows.every((r) => r.sku !== "delivery"));

console.log("4. маржа");
const m = C.marginRow({ sku: "1", name: "Тест", seller: "ИП", price: 1000, oldPrice: 1500, discount: 33 },
  { commissionPct: 11, sppPct: 5, taxPct: 7, logisticsRub: 55, costRub: 300 });
ok("выручка после удержаний 770", m.revenue === 770, m.revenue);
ok("маржа 415", m.marginRub === 415, m.marginRub);
ok("маржа 41.5%", m.marginPct === 41.5, m.marginPct);
const m2 = C.marginRow({ sku: "2", price: 0 }, {});
ok("нулевая цена не делит на ноль", m2.marginPct === null, m2.marginPct);
const table = C.marginTable([{ sku: "1", price: 1000 }], { commissionPct: 10 });
ok("marginTable считает каждую строку", table.length === 1 && table[0].marginRub === 900);

console.log("5. CSV");
const csv = C.buildCsv([["a", "b;c"], ['кавычка "х"', "строка\nперенос"]], ";");
ok("BOM в начале", csv.charCodeAt(0) === 0xFEFF);
ok("точка с запятой в ячейке экранирована", csv.indexOf('"b;c"') !== -1);
ok("кавычки удвоены", csv.indexOf('"кавычка ""х"""') !== -1);
const full = C.rowsToCsv([
  C.marginRow({ sku: "1", name: "Кроссовки; белые", seller: "ИП", price: 1000 }, {})
]);
ok("заголовок из 14 колонок", full.split("\n")[0].split(";").length === 14, full.split("\n")[0]);
ok("имя с ; в кавычках", full.indexOf('"Кроссовки; белые"') !== -1);

console.log("6. лимит 50");
const many = Array.from({ length: 60 }, (_, i) => ({ sku: String(i) }));
let clip = C.clipRows(many, false);
ok("free: 50 строк", clip.rows.length === 50 && clip.shown === 50, clip.shown);
ok("free: флаг усечения", clip.truncated === true);
clip = C.clipRows(many, true);
ok("pro: все 60", clip.rows.length === 60 && clip.truncated === false);
clip = C.clipRows(many.slice(0, 50), false);
ok("ровно 50 не считается усечением", clip.truncated === false);

console.log("7. лицензия");
const store = new Map();
const orig = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
try {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    }
  });
  ok("без ключа Pro нет", C.storedLicense() === null);
  C.storeLicense(C.PRODUCT, { kind: "license", hash: "license:WB-OZON:CLIP" });
  ok("ключ продукта читается", C.storedLicense() && C.storedLicense().kind === "license");
  store.clear();
  store.set("unlock:universal", JSON.stringify({ kind: "license", hash: "license:ALL" }));
  ok("универсальный ключ тоже открывает Pro", C.storedLicense() && C.storedLicense().hash === "license:ALL");
  store.clear();
  store.set("unlock:wb-ozon-inspector", "{broken json");
  ok("битый JSON не роняет панель", C.storedLicense() === null);
} finally {
  if (orig) Object.defineProperty(globalThis, "localStorage", orig);
  else delete globalThis.localStorage;
}

(async () => {
  console.log("8. проверка ключа");
  let v = await C.verifyKey("TW1");
  ok("обрезанный ключ -> format", v.valid === false && v.error === "format", JSON.stringify(v));
  v = await C.verifyKey("TW1-AUDIO-ABC123-AAAA");
  ok("чужой продукт -> product", v.valid === false && v.error === "product", JSON.stringify(v));
  v = await C.verifyKey("TW1-CLIP-ABC123-AAAA");
  ok("поддельная подпись -> signature", v.valid === false && v.error === "signature", JSON.stringify(v));
  v = await C.verifyKey("TW1-ALL-ABC123-AAAA");
  ok("ALL принимается форматом", v.valid === false && v.error === "signature", JSON.stringify(v));

  console.log("9. фолбэк v1.1 (sibling-цена + [href])");
  const snap = (rs) => rs.map((r) => { const o = Object.assign({}, r); delete o.container; return o; });
  /* Классы/обёртки поменяли: цена «уехала» в соседний блок. SKU в href + ₽
     в соседнем малом блоке — карточка обязана собраться. */
  function bf1() {
    const body = node("body");
    const row = node("div", {}, "");
    const a = node("a", { href: "/catalog/55512344/detail.aspx", "aria-label": "Кроссовки белые" });
    a.innerText = "";
    row.append(a);
    const price = node("div", { class: "price-2026" }, "1 299 ₽");
    body.append(row);
    body.append(price);
    return body;
  }
  let rows = C.collect(bf1());
  ok("sibling-фолбэк: карточка найдена", rows.length === 1, JSON.stringify(snap(rows)));
  ok("sibling-фолбэк: SKU и цена", rows.length === 1 && rows[0].sku === "55512344" && rows[0].price === 1299);
  ok("sibling-фолбэк: помечен fallback", rows.length === 1 && rows[0].fallback === "sibling");

  /* Ozon-вариант с ценой «новая/старая» в соседнем блоке */
  function bf2() {
    const body = node("body");
    const row = node("div", {}, "");
    const a = node("a", { href: "/product/stol-derevyannyy-777888999/" });
    a.innerText = "";
    row.append(a);
    const price = node("div", {}, "14 900 ₽ 17 000 ₽");
    body.append(row);
    body.append(price);
    return body;
  }
  rows = C.collect(bf2());
  ok("ozon sibling: карточка найдена", rows.length === 1 && rows[0].price === 14900 && rows[0].oldPrice === 17000, JSON.stringify(snap(rows)));

  /* Сосед-«широкий»: в блоке с ценой два чужих SKU — цена не приваривается */
  function busy() {
    const body = node("body");
    const row = node("div", {}, "");
    const a = node("a", { href: "/catalog/11122233/detail.aspx" });
    a.innerText = "";
    row.append(a);
    const wide = node("div", {}, "13 900 ₽");
    wide.append(node("a", { href: "/catalog/88889999/detail.aspx" }));
    wide.append(node("a", { href: "/product/tonometras-66665551/" }));
    body.append(row);
    body.append(wide);
    return body;
  }
  rows = C.collect(busy());
  ok("не сварить чужую цену", rows.length === 0, JSON.stringify(snap(rows)));

  /* Карточка-«area»: href есть, <a> нет — [href]-фолбэк находит */
  function area() {
    const body = node("body");
    const card = node("div", {}, "Пиджак серый 5 400 ₽");
    card.append(node("area", { href: "/catalog/31415926/detail.aspx" }));
    body.append(card);
    return body;
  }
  rows = C.collect(area());
  ok("[href]-фолбэк: карточка найдена", rows.length === 1 && rows[0].sku === "31415926" && rows[0].price === 5400, JSON.stringify(snap(rows)));

  console.log("\n" + pass + " ok, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
