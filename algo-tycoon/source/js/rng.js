/*
 * rng.js — Algo Tycoon deterministic RNG.
 * mulberry32 PRNG; streams are reproducible from a seed anywhere
 * (browser, node, the test battery).
 */
(function initRng(root) {
  "use strict";

  function mulberry32(seed) {
    var a = (seed >>> 0);
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* One-decimal values in [-9.9, 9.9]: FLOOR/ABS/checks stay exact. */
  function genStream(seed, n) {
    var make = mulberry32(seed);
    var out = new Array(n);
    for (var i = 0; i < n; i += 1) {
      out[i] = Math.round((make() * 20 - 10) * 10) / 10;
    }
    return out;
  }

  root.AT = root.AT || {};
  root.AT.rng = {
    mulberry32: mulberry32,
    genStream: genStream
  };
})(typeof window !== "undefined" ? window : globalThis);
