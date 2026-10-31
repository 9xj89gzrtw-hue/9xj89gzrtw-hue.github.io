/*
 * game.js — Algo Tycoon state machine.
 * Free tier: 6-card pipelines. Pro: 11 cards, sandbox, level editor.
 * Payout only on exact scalar match (1e-9 tolerance). Jobs unlock in order.
 */
(function initGame(root) {
  "use strict";
  root.AT = root.AT || {};

  var BASE_SLOTS = 6;

  function freshState() { return root.AT.save.fresh(); }

  function slots(state) { return BASE_SLOTS + root.AT.save.effects(state).slots; }

  function payoutMultiplier(state) {
    return 1 + root.AT.save.effects(state).payoutPct / 100;
  }

  function unlockedIndex(state) {
    return state.solved.length; // nth unsolved job index
  }

  function isJobUnlocked(state, jobIndex) {
    return jobIndex <= unlockedIndex(state);
  }

  function isJobSolved(state, jobId) { return state.solved.indexOf(jobId) !== -1; }

  /* Attempt a job with the player's card list. Returns a verdict and, on
   * success, credits to add. Does not mutate state. */
  function attempt(state, job, opIds) {
    var stream = root.AT.rng.genStream(job.seed, job.n);
    var out = root.AT.pipeline.compile(opIds, stream, slots(state) + 8);
    var m = root.AT.pipeline.match(out, job.target);
    if (!m.ok) return { ok: false, reason: m.reason };
    return { ok: true, value: out[0], payout: creditFor(state, job) };
  }

  function creditFor(state, job) {
    return Math.round(job.payout * payoutMultiplier(state) * 100) / 100;
  }

  function markSolved(state, jobId) {
    if (state.solved.indexOf(jobId) === -1) state.solved.push(jobId);
  }

  function canResearch(state, node) {
    return state.research.indexOf(node.id) === -1 && state.credits >= node.cost;
  }

  function doResearch(state, node) {
    if (!canResearch(state, node)) return false;
    state.credits -= node.cost;
    state.research.push(node.id);
    if (node.effect.compilers) state.compilers += node.effect.compilers;
    return true;
  }

  function actsCleared(state) {
    var byAct = { 1: 0, 2: 0, 3: 0 };
    root.AT.levels.JOBS.forEach(function (j) {
      if (state.solved.indexOf(j.id) !== -1) byAct[j.act] += 1;
    });
    return byAct;
  }

  function totalEarnable(state) {
    var sum = 0;
    root.AT.levels.JOBS.forEach(function (j) {
      if (state.solved.indexOf(j.id) === -1) sum += creditFor(state, j);
    });
    return Math.round(sum * 100) / 100;
  }

  root.AT.game = {
    freshState: freshState,
    slots: slots,
    payoutMultiplier: payoutMultiplier,
    unlockedIndex: unlockedIndex,
    isJobUnlocked: isJobUnlocked,
    isJobSolved: isJobSolved,
    attempt: attempt,
    creditFor: creditFor,
    markSolved: markSolved,
    canResearch: canResearch,
    doResearch: doResearch,
    actsCleared: actsCleared,
    totalEarnable: totalEarnable,
    BASE_SLOTS: BASE_SLOTS
  };
})(typeof window !== "undefined" ? window : globalThis);
