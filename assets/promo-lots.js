/* Promo price-comparison block for the paid lots.
   Prices come from window.SHOP (generated from shop.json), so the page never
   disagrees with the checkout. Old prices are marketing anchors only. */
(function () {
  "use strict";

  var OLD = {
    "audio-dub-studio": 390,
    "data-clipper": 690,
    "algo-tycoon": 299,
    "tg-chats": 990,
    "docsearch": 1290,
    "newsflow": 690,
    "live-radar": 690,
    "base-tax-audit": 690,
    "bundle": 3097
  };

  var COPY = {
    "audio-dub-studio": "Озвучка Яндекса и звук YouTube/VK в MP3 плюс нарезка клипов по таймкоду. Один платёж, без подписки.",
    "data-clipper": "Калькулятор маржи WB/Ozon 2026 и выгрузка любых таблиц или Telegram в Excel за один клик.",
    "algo-tycoon": "Симулятор алгоритмической торговли и пайплайнов с песочницей и живой экономикой.",
    "tg-chats": "1 211 проверенных открытых чатов Telegram с поиском, валидатором ссылок и Excel-выгрузкой.",
    "docsearch": "Поиск договоров, ИНН и счетов в архивах .eml/.mbox локально: индекс, цитаты и экспорт в Excel.",
    "newsflow": "Дайджесты из Telegram и RSS без дублей и рекламы, автопостинг в ТГ/ВК и план контента в Excel.",
    "live-radar": "Вилки, спреды и импульсы Polymarket + Telegram Gifts в реальном времени, с выгрузкой и уведомлениями.",
    "base-tax-audit": "Сканер опасных approvals кошелька Base и выгрузка транзакций в Excel/CSV для налоговой.",
    "bundle": "Все 8 инструментов одним ключом TW1-ALL-… — дешевле, чем покупать по отдельности."
  };

  function rub(n) {
    return Math.round(n).toLocaleString("ru-RU") + " ₽";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function render(host) {
    var slug = host.getAttribute("data-promo-lots");
    var lot = window.SHOP && window.SHOP.products && window.SHOP.products[slug];
    if (!slug || !lot) return;
    var now = Math.round(lot.price_rub);
    var old = OLD[slug];
    var save = old && old > now ? Math.round((1 - now / old) * 100) : 0;
    var compact = host.hasAttribute("data-promo-compact");
    var href = lot.pay_url || lot.card_url || "#pro";
    var buy = "ОПЛАТИТЬ КАРТОЙ РФ / СБП · " + rub(now);

    host.innerHTML =
      '<div class="promo-lot' + (compact ? " promo-lot--compact" : "") + '">' +
        '<div class="promo-lot-top">' +
          '<span class="promo-lot-badge">Акция ноября</span>' +
          (save ? '<span class="promo-lot-save">−' + save + '%</span>' : "") +
        '</div>' +
        '<div class="promo-lot-prices">' +
          '<span class="promo-lot-now">' + rub(now) + '</span>' +
          (old && old > now ? '<s class="promo-lot-old">' + rub(old) + '</s>' : "") +
        '</div>' +
        '<p class="promo-lot-copy">' + esc(COPY[slug] || lot.title || "") + '</p>' +
        '<a class="promo-lot-buy" href="' + esc(href) + '" target="_blank" rel="noopener">' + buy + '</a>' +
        '<p class="promo-lot-note">Ключ TW1-… сразу после оплаты · без подписки и регистрации</p>' +
      '</div>';
  }

  function renderAll() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-promo-lots]"), render);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderAll);
  else renderAll();
})();
