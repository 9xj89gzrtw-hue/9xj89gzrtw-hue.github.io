/*
 * pipeline.js — Algo Tycoon pipeline compiler.
 * compile(ops, stream) runs the card chain over the input stream.
 * match(value, target) uses strict 1e-9 tolerance; scalar targets require a
 * collapsed pipeline ([x]).
 */
(function initPipeline(root) {
  "use strict";
  root.AT = root.AT || {};

  var TOL = 1e-9;

  function compile(opIds, stream, cap) {
    var ids = (opIds || []).slice(0, cap || 16);
    var arr = stream.slice();
    for (var i = 0; i < ids.length; i += 1) {
      arr = root.AT.ops.apply(ids[i], arr);
    }
    return arr;
  }

  function match(value, target) {
    if (value.length !== 1) {
      return { ok: false, reason: "the pipeline must end with a scalar card (SUM Σ / PROD Π / MIN / MAX)" };
    }
    if (Math.abs(value[0] - target) <= TOL) return { ok: true };
    return { ok: false, reason: "output " + value[0] + " ≠ target " + target };
  }

  root.AT.pipeline = { compile: compile, match: match, TOL: TOL };
})(typeof window !== "undefined" ? window : globalThis);
