/*
 * sandbox.js — landing-page driver. Runs the real ClipEngine on the demo
 * feed, mirrors the popup flow: detect -> select fields -> preview -> CSV.
 * Exposes window.__CLIP_DEMO__ = { rows, csv, groups } for the test harness.
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var state = {
    groups: [],
    selectedIdx: null,
    roles: {},
    roleOrder: [],
    rows: [],
    csv: ""
  };

  function demoRoot() { return $("demo-feed"); }

  function renderGroups() {
    var wrap = $("groups-out");
    wrap.textContent = "";
    state.groups.forEach(function (g, idx) {
      var row = document.createElement("div");
      row.className = "grp" + (state.selectedIdx === idx ? " sel" : "");
      row.dataset.sig = [g.tag, g.classes.join(".")].join(".").toLowerCase();
      var cnt = document.createElement("span");
      cnt.className = "cnt";
      cnt.textContent = String(g.count) + "×";
      var sig = document.createElement("span");
      sig.className = "sig";
      sig.textContent = [g.tag, g.classes.join(".")].join(".");
      row.appendChild(cnt);
      row.appendChild(sig);
      var tags = document.createElement("div");
      tags.className = "field-tags";
      g.fieldCandidates.forEach(function (cand) {
        var t = document.createElement("span");
        t.className = "field-tag" + (state.roles[cand.role] !== undefined ? " on" : "");
        t.textContent = cand.role;
        t.dataset.role = cand.role;
        t.addEventListener("click", function () { toggleRole(idx, cand.role, cand.selector); });
        t.dataset.groupIdx = String(idx);
        tags.appendChild(t);
      });
      row.appendChild(tags);
      row.id = "grp-" + idx;
      row.addEventListener("click", function (ev) {
        if (ev.target.classList && ev.target.classList.contains("field-tag")) return;
        selectGroup(idx);
      });
      wrap.appendChild(row);
    });
  }

  function selectGroup(idx) {
    state.selectedIdx = idx;
    state.roles = {};
    state.roleOrder = [];
    var g = state.groups[idx];
    var prefer = ["title", "link", "datetime"];
    (g ? g.fieldCandidates : []).forEach(function (cand) {
      var add = prefer.indexOf(cand.role) !== -1 || state.roleOrder.length < 2;
      if (add && state.roles[cand.role] === undefined) {
        state.roles[cand.role] = cand.selector;
        state.roleOrder.push(cand.role);
      }
    });
    renderGroups();
    harvest();
  }

  function toggleRole(idx, role, selector) {
    if (state.selectedIdx !== idx) { selectGroup(idx); return; }
    if (state.roles[role] !== undefined) {
      delete state.roles[role];
      state.roleOrder = state.roleOrder.filter(function (r) { return r !== role; });
    } else {
      state.roles[role] = selector;
      state.roleOrder.push(role);
    }
    renderGroups();
    harvest();
  }

  function harvest() {
    var g = state.groups[state.selectedIdx];
    if (!g) {
      state.rows = [];
      state.csv = "";
      renderPreview();
      return;
    }
    var res = ClipEngine.extractRows({ selector: g.selector }, state.roles, ClipEngine.FREE_ROW_CAP, demoRoot());
    state.rows = res.rows;
    var columns = state.roleOrder.length ? state.roleOrder : Object.keys(res.rows[0] || {});
    state.csv = ClipCSV.buildCSV(state.rows, columns, { withBOM: false });
    renderPreview();
  }

  function renderPreview() {
    var table = $("preview-out");
    table.textContent = "";
    if (!state.rows.length) {
      table.hidden = true;
      $("out-title").textContent = state.selectedIdx === null ?
        "OUTPUT · no group selected" : "OUTPUT · no rows with the selected fields";
      $("btn-dl").disabled = !state.csv;
      $("csv-preview").textContent = state.csv || "— pick at least one field tag —";
      window.__CLIP_DEMO__ = { rows: state.rows, csv: state.csv, groups: state.groups.length };
      return;
    }
    table.hidden = false;
    $("out-title").textContent = "OUTPUT · " + state.rows.length + " rows · fields: " +
      (state.roleOrder.join(", ") || "none");
    var trh = document.createElement("tr");
    state.roleOrder.forEach(function (k) {
      var th = document.createElement("th");
      th.textContent = k;
      trh.appendChild(th);
    });
    table.appendChild(trh);
    state.rows.slice(0, 50).forEach(function (r) {
      var tr = document.createElement("tr");
      state.roleOrder.forEach(function (k) {
        var td = document.createElement("td");
        td.textContent = String(r[k] == null ? "" : r[k]);
        td.dataset.role = k;
        tr.appendChild(td);
      });
      tr.dataset.row = "1";
      table.appendChild(tr);
    });
    $("btn-dl").disabled = !state.csv;
    $("csv-preview").textContent = state.csv.slice(0, 400);
    window.__CLIP_DEMO__ = { rows: state.rows, csv: state.csv, groups: state.groups.length };
  }

  function detect() {
    state.groups = ClipEngine.findCardGroups(demoRoot());
    state.selectedIdx = null;
    state.roles = {};
    state.roleOrder = [];
    state.rows = [];
    state.csv = "";
    renderGroups();
    renderPreview();
    return state.groups;
  }

  function downloadDemoCSV() {
    if (!state.csv) return;
    var blob = new Blob([state.csv], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "demo-feed-clip.csv";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* wiring */
  $("btn-detect").addEventListener("click", function () { detect(); });
  $("btn-dl").addEventListener("click", function () { downloadDemoCSV(); });
  window.__CLIP_DETECT__ = detect;
  window.__CLIP_SELECT__ = selectGroup;
  window.__CLIP_TOGGLE__ = toggleRole;
  window.__CLIP_HARVEST__ = harvest;

  // auto-detect so the sandbox is never empty on first view
  window.addEventListener("DOMContentLoaded", function () { detect(); });
  if (document.readyState !== "loading") { detect(); }
})();
