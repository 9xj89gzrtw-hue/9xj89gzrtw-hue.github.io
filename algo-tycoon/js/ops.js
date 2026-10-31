/*
 * ops.js — Algo Tycoon op-cards. Every card is a pure function on a number
 * array. Scalar cards (SUM / PRODUCT / MIN / MAX) collapse to a 1-element
 * array so pipelines stay uniform end to end.
 */
(function initOps(root) {
  "use strict";
  root.AT = root.AT || {};

  function map2(a) { return a.map(function (x) { return Math.round(x * 2 * 1e9) / 1e9; }); }
  function map3(a) { return a.map(function (x) { return Math.round(x * 3 * 1e9) / 1e9; }); }
  function abs(a) { return a.map(Math.abs); }
  function floor(a) { return a.map(Math.floor); }
  function neg(a) { return a.map(function (x) { return -x; }); }
  function even(a) { return a.filter(function (x) { return x % 2 === 0; }); }
  function odd(a) { return a.filter(function (x) { return x % 2 !== 0; }); }
  function pos(a) { return a.filter(function (x) { return x > 0; }); }
  function sortAsc(a) { return a.slice().sort(function (p, q) { return p - q; }); }
  function sortDesc(a) { return a.slice().sort(function (p, q) { return q - p; }); }
  function reverse(a) { return a.slice().reverse(); }
  function dedupe(a) {
    var seen = {};
    return a.filter(function (x) {
      var k = String(x);
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }
  function chunk2(a) {
    var out = [];
    for (var i = 0; i < a.length; i += 2) {
      if (i + 1 < a.length) out.push(a[i] + a[i + 1]);
      else out.push(a[i]);
    }
    return out;
  }
  /* zig-zag reorder: even-indexed items first, then odd-indexed */
  function zigzag(a) {
    return a.filter(function (_, i) { return i % 2 === 0; })
      .concat(a.filter(function (_, i) { return i % 2 !== 0; }));
  }
  function rotateL(a) {
    if (!a.length) return a;
    return a.slice(1).concat([a[0]]);
  }
  function take2(a) { return a.slice(0, 2); }
  function skip1(a) { return a.slice(1); }
  function tail(a) { return a.slice(0, -1); } /* drop the last element */
  function sum(a) { return [a.reduce(function (s, x) { return s + x; }, 0)]; }
  function product(a) { return [a.reduce(function (p, x) { return p * x; }, 1)]; }
  function min(a) { return a.length ? [Math.min.apply(null, a)] : []; }
  function max(a) { return a.length ? [Math.max.apply(null, a)] : []; }

  var OPS = [
    { id: "map2", label: "MAP ×2", fn: map2 },
    { id: "map3", label: "MAP ×3", fn: map3 },
    { id: "abs", label: "ABS", fn: abs },
    { id: "floor", label: "FLOOR", fn: floor },
    { id: "neg", label: "NEG", fn: neg },
    { id: "even", label: "EVEN", fn: even },
    { id: "odd", label: "ODD", fn: odd },
    { id: "pos", label: "POS", fn: pos },
    { id: "sortAsc", label: "SORT ↑", fn: sortAsc },
    { id: "sortDesc", label: "SORT ↓", fn: sortDesc },
    { id: "reverse", label: "REV", fn: reverse },
    { id: "dedupe", label: "DEDUPE", fn: dedupe },
    { id: "chunk2", label: "CHUNK-2", fn: chunk2 },
    { id: "zigzag", label: "ZIGZAG", fn: zigzag },
    { id: "rotateL", label: "ROT-L", fn: rotateL },
    { id: "take2", label: "TAKE-2", fn: take2 },
    { id: "skip1", label: "SKIP-1", fn: skip1 },
    { id: "tail", label: "TAIL", fn: tail },
    { id: "sum", label: "SUM Σ", fn: sum },
    { id: "product", label: "PROD Π", fn: product },
    { id: "min", label: "MIN", fn: min },
    { id: "max", label: "MAX", fn: max }
  ];

  var byId = {};
  OPS.forEach(function (o) { byId[o.id] = o; });

  function get(id) { return byId[id] || null; }
  function apply(id, arr) {
    var op = byId[id];
    if (!op) throw new Error("unknown op: " + id);
    return op.fn(arr);
  }

  root.AT.ops = { list: OPS, get: get, apply: apply };
})(typeof window !== "undefined" ? window : globalThis);
