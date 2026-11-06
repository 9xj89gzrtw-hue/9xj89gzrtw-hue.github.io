/*
 * levels.js — Algo Tycoon content: 14 jobs (3 acts), research tree,
 * ticker dataset. Act I stays plaintext; Act II–III job definitions are
 * sealed as an AES-GCM blob (WebCrypto) unlocked by js/crypt.js at boot. Targets are exact pipeline outputs of the canonical
 * solution; the test battery reproduces them from the seed alone.
 */
(function initLevels(root) {
  "use strict";
  root.AT = root.AT || {};

  var JOBS = [
    { id: "j01", act: 1, seed: 101, n: 8, rtl: "Первая сборка", brief: "Проверьте работу деска: посчитайте сумму исходного потока.", canonical: ["sum"], target: 14.4, payout: 25 },
    { id: "j02", act: 1, seed: 102, n: 8, rtl: "Зеркальный стакан", brief: "Клиенту нужен зеркальный стакан: инвертируйте знак и просуммируйте.", canonical: ["neg", "sum"], target: -41.9, payout: 30 },
    { id: "j03", act: 1, seed: 103, n: 8, rtl: "Только лонг", brief: "Исключите короткие позиции: оставьте положительные числа и просуммируйте.", canonical: ["pos", "sum"], target: 16.6, payout: 35 },
    { id: "j04", act: 1, seed: 104, n: 10, rtl: "Округление тика", brief: "Биржа округляет каждую сделку вниз: примените floor и просуммируйте.", canonical: ["floor", "sum"], target: -5, payout: 45 },
  ];

  var RESEARCH = [
    { id: "r_pay1", label: "Скорость согласования", desc: "+15% к каждой последующей выплате", cost: 60, effect: { payoutPct: 15 } },
    { id: "r_comp1", label: "Автономный компилятор I", desc: "+1 фоновый компилятор: 3 кр/ч (до 8 ч офлайн)", cost: 100, effect: { compilers: 1 } },
    { id: "r_slots", label: "Широкий пайплайн", desc: "лимит пайплайна: с 6 до 9 карт", cost: 120, effect: { slots: 3 } },
    { id: "r_pay2", label: "Репутация деска", desc: "+25% к каждой последующей выплате", cost: 220, effect: { payoutPct: 25 } },
    { id: "r_comp2", label: "Автономный компилятор II", desc: "+1 фоновый компилятор (суммируется)", cost: 320, effect: { compilers: 1 } },
    { id: "r_pay3", label: "Прямой телефон исполнения", desc: "+35% к каждой последующей выплате", cost: 500, effect: { payoutPct: 35 } },
    { id: "r_slots2", label: "Режим масштаба", desc: "лимит пайплайна ещё +2 карты (всего 11)", cost: 640, effect: { slots: 2 } },
    { id: "r_comp3", label: "Автономный компилятор III", desc: "+1 фоновый компилятор (суммируется)", cost: 900, effect: { compilers: 1 } }
  ];

  var TICKER = {
    seed: 4242,
    n: 10,
    instruments: ["ALGO/USDC", "IDX-7", "NOTE B3", "SIGMA 04", "TICK 19"]
  };

  var ACT23_BLOB = "AT1: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";

  root.AT.levels = {
    ACT1_JOBS: JOBS,
    JOBS: JOBS,
    RESEARCH: RESEARCH,
    TICKER: TICKER,
    __ACT23_BLOB__: ACT23_BLOB
  };
})(typeof window !== "undefined" ? window : globalThis);