/*
 * levels.js — Algo Tycoon content: 14 jobs (3 acts), research tree,
 * ticker dataset. Targets are exact pipeline outputs of the canonical
 * solution; the test battery reproduces them from the seed alone.
 */
(function initLevels(root) {
  "use strict";
  root.AT = root.AT || {};

  var JOBS = [
    { id: "j01", act: 1, seed: 101, n: 8, rtl: "First compile", brief: "Prove the desk works: return the sum of the raw stream.", canonical: ["sum"], target: 14.4, payout: 25 },
    { id: "j02", act: 1, seed: 102, n: 8, rtl: "Mirror book", brief: "The client wants the mirrored book: negate first, then sum.", canonical: ["neg", "sum"], target: -41.9, payout: 30 },
    { id: "j03", act: 1, seed: 103, n: 8, rtl: "Long side only", brief: "Drop the shorts: keep positive values, then sum.", canonical: ["pos", "sum"], target: 16.6, payout: 35 },
    { id: "j04", act: 1, seed: 104, n: 10, rtl: "Tick rounding", brief: "Exchange rounds every fill down: FLOOR the stream, then sum.", canonical: ["floor", "sum"], target: -5, payout: 45 },
    { id: "j05", act: 2, seed: 201, n: 10, rtl: "Exposure, signed away", brief: "Absolutize every fill and sum the gross exposure.", canonical: ["abs", "sum"], target: 38.9, payout: 70 },
    { id: "j06", act: 2, seed: 202, n: 10, rtl: "Lot doubling", brief: "Round down to lots, keep the EVEN lots, double them, sum.", canonical: ["floor", "even", "map2", "sum"], target: -44, payout: 85 },
    { id: "j07", act: 2, seed: 203, n: 10, rtl: "Two biggest longs", brief: "Keep the longs, sort descending, TAKE-2 and sum them.", canonical: ["pos", "sortDesc", "take2", "sum"], target: 19, payout: 95 },
    { id: "j08", act: 2, seed: 204, n: 12, rtl: "Pairing desk", brief: "Gross it up, pair fills (CHUNK-2) and net the pairs into a sum.", canonical: ["abs", "chunk2", "sum"], target: 46.1, payout: 110 },
    { id: "j09", act: 3, seed: 301, n: 12, rtl: "Deepest mirror bid", brief: "Mirror the book and report its best (MAX).", canonical: ["neg", "max"], target: 9.6, payout: 150 },
    { id: "j10", act: 3, seed: 302, n: 12, rtl: "Lot compounding", brief: "Floor to lots, keep the positive ones, PROD Π them.", canonical: ["floor", "pos", "product"], target: 51840, payout: 180 },
    { id: "j11", act: 3, seed: 303, n: 12, rtl: "Second-band picker", brief: "Gross the fills, sort ascending, SKIP-1, TAKE-2, then MAX.", canonical: ["abs", "sortAsc", "skip1", "take2", "max"], target: 0.7, payout: 200 },
    { id: "j12", act: 3, seed: 304, n: 14, rtl: "Odd-pair ceiling", brief: "Floor to lots, keep ODD lots, gross them, pair, MAX of pairs.", canonical: ["floor", "odd", "abs", "chunk2", "max"], target: 8, payout: 230 },
    { id: "j13", act: 3, seed: 305, n: 14, rtl: "Leverage reprice", brief: "Longs only, DEDUPE the fills, ×3 the book, then sum.", canonical: ["pos", "dedupe", "map3", "sum"], target: 38.1, payout: 260 },
    { id: "j14", act: 3, seed: 306, n: 14, rtl: "Final: zigzag tape", brief: "Gross fills, ZIGZAG the tape, TAIL it off, then sum.", canonical: ["abs", "zigzag", "tail", "sum"], target: 72.9, payout: 300 }
  ];

  var RESEARCH = [
    { id: "r_pay1", label: "APPROVAL SPEED", desc: "+15% on every future payout", cost: 60, effect: { payoutPct: 15 } },
    { id: "r_comp1", label: "OFFLINE COMPILER I", desc: "+1 offline compiler: 3 cr/hour, accrues up to 8h while away", cost: 100, effect: { compilers: 1 } },
    { id: "r_slots", label: "WIDE PIPELINE", desc: "pipeline cap 6 → 9 cards", cost: 120, effect: { slots: 3 } },
    { id: "r_pay2", label: "DESK REPUTATION", desc: "+25% on every future payout", cost: 220, effect: { payoutPct: 25 } },
    { id: "r_comp2", label: "OFFLINE COMPILER II", desc: "+1 offline compiler (stacks)", cost: 320, effect: { compilers: 1 } },
    { id: "r_pay3", label: "EXECUTION PHONE LINE", desc: "+35% on every future payout", cost: 500, effect: { payoutPct: 35 } },
    { id: "r_slots2", label: "BREADTH MODE", desc: "pipeline cap +2 more (11 total)", cost: 640, effect: { slots: 2 } },
    { id: "r_comp3", label: "OFFLINE COMPILER III", desc: "+1 offline compiler (stacks)", cost: 900, effect: { compilers: 1 } }
  ];

  var TICKER = {
    seed: 4242,
    n: 10,
    instruments: ["ALGO/USDC", "IDX-7", "NOTE B3", "SIGMA 04", "TICK 19"]
  };

  root.AT.levels = { JOBS: JOBS, RESEARCH: RESEARCH, TICKER: TICKER };
})(typeof window !== "undefined" ? window : globalThis);
