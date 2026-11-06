/*
 * content.js — AI & Market Tycoon: содержание игры.
 *
 * Здесь только данные: главы, заказы, апгрейды и кризисы. Никакой логики —
 * она в js/economy.js, отрисовка в js/app.js. Так содержание можно править
 * без риска сломать расчёты, а тесты проверяют цифры независимо от UI.
 */
(function initContent(root) {
  "use strict";
  root.AT = root.AT || {};

  /* Главы. Free — 1 и 2, Pro открывает 3-ю. */
  var CHAPTERS = [
    {
      id: 1,
      tag: "Глава 1",
      name: "Фриланс и первые заказы",
      sub: "Один ноутбук, одна серверная стойка и 1 000 ₽ на счету. Берите заказы в один клик.",
      goal: 25000,
      free: true
    },
    {
      id: 2,
      tag: "Глава 2",
      name: "Агентство и автоматизация",
      sub: "Заказы дороже, стойки шире, появляется команда. Здесь начинается настоящий бизнес.",
      goal: 250000,
      free: true
    },
    {
      id: 3,
      tag: "Глава 3",
      name: "Уолл-Стрит и квантовый кластер",
      sub: "Pro-глава: квантовый кластер, песочница на $1 000 000, ускорение x5 и x10, конструктор кризисов.",
      goal: 0,
      free: false
    }
  ];

  /* Заказы. rub — оплата, load — сколько нагрузки на серверы, sec — время
     исполнения в секундах при скорости x1. */
  var ORDERS = [
    /* Глава 1 */
    { id: "o_wb_parse", chapter: 1, title: "Спарсить 100 карточек WB", client: "Селлер · Wildberries", rub: 250, load: 35, sec: 6 },
    { id: "o_voice", chapter: 1, title: "Озвучить ролик нейросетью", client: "Видеомейкер · YouTube", rub: 400, load: 45, sec: 8 },
    { id: "o_arb", chapter: 1, title: "Поймать арбитражную сделку", client: "Трейдер · крипта", rub: 800, load: 70, sec: 12 },
    { id: "o_tg_pack", chapter: 1, title: "Собрать 300 чатов в Telegram", client: "Агентство · Telegram", rub: 320, load: 40, sec: 7 },
    { id: "o_unit20", chapter: 1, title: "Посчитать юнит-экономику 20 SKU", client: "Селлер · Ozon", rub: 380, load: 50, sec: 9 },

    /* Глава 2 */
    { id: "o_price1000", chapter: 2, title: "Спарсить 1 000 карточек с ценами", client: "Агентство · маркетплейсы", rub: 1400, load: 120, sec: 16 },
    { id: "o_dub5", chapter: 2, title: "Озвучить 5 роликов с переводом", client: "Студия · YouTube", rub: 2200, load: 160, sec: 22 },
    { id: "o_funnel", chapter: 2, title: "Настроить Telegram-воронку", client: "Инфобизнес · Telegram", rub: 1800, load: 140, sec: 18 },
    { id: "o_news", chapter: 2, title: "Собрать новостной поток по рынку", client: "Фонд · аналитика", rub: 1600, load: 130, sec: 17 },
    { id: "o_taxaudit", chapter: 2, title: "Аудит налоговой отчётности", client: "ООО · финансы", rub: 2600, load: 180, sec: 24 },
    { id: "o_analog", chapter: 2, title: "Найти аналоги товара у 3 конкурентов", client: "Бренд · WB", rub: 2000, load: 150, sec: 20 },

    /* Глава 3 — Pro */
    { id: "o_quant", chapter: 3, title: "Развернуть квантовый кластер", client: "Лаборатория · R&D", rub: 120000, load: 400, sec: 26 },
    { id: "o_btc_arb", chapter: 3, title: "Арбитраж BTC/ETH на трёх биржах", client: "Проп-деск · крипта", rub: 85000, load: 350, sec: 22 },
    { id: "o_hft", chapter: 3, title: "Запустить HFT-бота на 3 пары", client: "Хедж-фонд · США", rub: 240000, load: 500, sec: 32 },
    { id: "o_stress", chapter: 3, title: "Стресс-тест портфеля $10 млн", client: "Банк · риск-департамент", rub: 400000, load: 620, sec: 40 },
    { id: "o_ipo", chapter: 3, title: "Подготовить портфель к выходу на IPO", client: "Фонд · pre-IPO", rub: 650000, load: 800, sec: 48 }
  ];

  /* Апгрейды. Цена растёт как base * growth^level. */
  var UPGRADES = [
    { id: "rack", name: "Серверная стойка", desc: "+100 нагрузки: больше заказов крутится одновременно", base: 600, growth: 1.6, max: 8 },
    { id: "gpu", name: "Нейросеть-ассистент", desc: "−20% времени на каждый заказ", base: 1200, growth: 1.7, max: 5 },
    { id: "sales", name: "Отдел продаж", desc: "+15% к оплате каждого заказа", base: 900, growth: 1.65, max: 6 },
    { id: "team", name: "Оператор поддержки", desc: "+2 репутации за заказ: клиенты платят больше", base: 700, growth: 1.5, max: 5 }
  ];

  /* Кризисы — только Pro. Проверяете, выдержит ли бизнес плохой день. */
  var CRISES = [
    { id: "crash", name: "Обвал рынка", desc: "−35% к оплате заказов на 20 секунд", sec: 20, payMult: 0.65, loadMult: 1 },
    { id: "blackout", name: "Отключили стойку", desc: "−50% нагрузки серверов на 15 секунд", sec: 15, payMult: 1, loadMult: 0.5 },
    { id: "tax", name: "Налоговая проверка", desc: "Списывает 10% баланса один раз", sec: 0, payMult: 1, loadMult: 1, finePct: 10 }
  ];

  /* Быстрые подсказки в панели «Как играть». */
  var STEPS = [
    "Берите заказ одним нажатием — деньги придут, когда полоска дойдёт до конца.",
    "Следите за нагрузкой: если стойка занята, заказ придётся подождать.",
    "Покупайте стойки и апгрейды — так растёт доход в час.",
    "Дошли до цели главы — открывается следующая. В Pro есть песочница на $1 000 000."
  ];

  root.AT.content = {
    CHAPTERS: CHAPTERS,
    ORDERS: ORDERS,
    UPGRADES: UPGRADES,
    CRISES: CRISES,
    STEPS: STEPS
  };
})(typeof window !== "undefined" ? window : globalThis);
