/*
 * popup.js — Table & TG-Channel Clipper Pro controller.
 * Talks to the injected bridge (content.js) over chrome messaging, keeps Pro
 * state in chrome.storage.local, enforces the Free tier cap honestly.
 */
(function () {
  "use strict";

  var PRO_MIN_USD = 9;
  var FREE_MAX_ROWS = 50; // free tier cap, stated in UI
  var PRO_MAX_ROWS = 5000; // single-shot cap; auto-scroll harvests up to 1000+
  var OS_MAX_ROWS = 5000;

  var $ = function (id) { return document.getElementById(id); };
  var state = {
    tabId: null,
    tabUrl: "",
    host: "",
    pro: null, // {mode:"tx|key", proof:{...}}
    groups: [], // card groups from content
    tables: [],
    selectedGroupIdx: null,
    selectedRoles: {}, // role -> selector
    roleOrder: [],
    lastRows: null,
    filterActive: false,
    scrolling: false
  };

  /* ---------- small ui helpers ---------- */

  function setStatus(s) { $("detect-status").textContent = s; }

  function setPro(pro) {
    state.pro = pro;
    var chip = $("tier-chip");
    if (pro) {
      chip.textContent = "PRO";
      chip.classList.remove("chip-free");
      chip.classList.add("chip-pro");
      $("cap-line").innerHTML = "<b>Pro active</b> — caps removed (single export up to " + PRO_MAX_ROWS + ", auto-scroll to " + OS_MAX_ROWS + ").";
    } else {
      chip.textContent = "FREE";
      chip.classList.add("chip-free");
      chip.classList.remove("chip-pro");
      $("cap-line").textContent = "Free: up to " + FREE_MAX_ROWS + " rows per export. Pro removes the cap.";
    }
    refreshButtons();
  }

  function refreshButtons() {
    var pro = !!state.pro;
    var hasSelection = state.selectedGroupIdx !== null || state.tables.length > 0;
    $("btn-csv").disabled = !hasSelection;
    $("btn-xlsx").disabled = !pro || !hasSelection;
    $("btn-scroll").disabled = !pro || state.selectedGroupIdx === null || state.scrolling;
    $("btn-tpl").disabled = !pro || state.selectedGroupIdx === null;
    $("filter-input").disabled = !pro;
    $("filter-chip").textContent = pro ? (state.filterActive ? "ON" : "OFF") : "PRO";
  }

  function currentMaxRows() {
    return state.pro ? PRO_MAX_ROWS : FREE_MAX_ROWS;
  }

  /* ---------- messaging to bridge ---------- */

  function sendToTab(msg) {
    return new Promise(function (resolve) {
      chrome.tabs.sendMessage(state.tabId, msg, function (resp) {
        if (chrome.runtime.lastError) resolve({ t: "error", reason: chrome.runtime.lastError.message });
        else resolve(resp || { t: "error", reason: "no response" });
      });
    });
  }

  function injectBridge() {
    return new Promise(function (resolve) {
      chrome.scripting.executeScript(
        { target: { tabId: state.tabId }, files: ["engine.js", "content.js"] },
        function (res) {
          if (chrome.runtime.lastError) resolve({ ok: false, reason: chrome.runtime.lastError.message });
          else resolve({ ok: true, res: res });
        });
    });
  }

  /* ---------- detection ---------- */

  async function detect() {
    setStatus("reading tab…");
    $("groups").textContent = "";
    var inj = await injectBridge();
    if (!inj.ok) { setStatus("cannot inject: " + inj.reason); return; }
    var resp = await sendToTab({ t: "detect" });
    if (resp.t === "error") { setStatus(resp.reason || "bridge error"); return; }
    state.groups = resp.cards || [];
    state.tables = resp.tables || [];
    state.selectedGroupIdx = null;
    state.selectedRoles = {};
    state.roleOrder = [];
    renderGroups();
    // template auto-apply for this host
    var tpl = await findTemplateForHost(state.host, state.groups);
    if (tpl) {
      applyTemplate(tpl);
      setStatus("template applied: " + tpl.id + " · " + summarizeCounts());
    } else {
      setStatus(summarizeCounts());
    }
  }

  function summarizeCounts() {
    var n = state.groups.length, m = state.tables.length;
    var top = state.groups.length ? " · top: " + state.groups[0].count + "× cards" : "";
    return n + " card group" + (n === 1 ? "" : "s") + (m ? " · " + m + " table" + (m === 1 ? "" : "s") : "") + top;
  }

  function renderGroups() {
    var wrap = $("groups");
    wrap.textContent = "";
    state.groups.forEach(function (g, idx) {
      var box = document.createElement("div");
      box.className = "group" + (state.selectedGroupIdx === idx ? " selected" : "");
      var head = document.createElement("div");
      head.className = "g-head";
      var countEl = document.createElement("label");
      countEl.className = "g-count mono";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = state.selectedGroupIdx === idx;
      cb.addEventListener("change", function () { selectGroup(idx); });
      countEl.appendChild(cb);
      var n = document.createElement("span");
      n.textContent = String(g.count);
      n.style.fontWeight = "700";
      countEl.appendChild(n);
      head.appendChild(countEl);
      var sig = document.createElement("span");
      sig.className = "g-sig";
      sig.textContent = g.selector;
      head.appendChild(sig);
      box.appendChild(head);

      var fields = document.createElement("div");
      fields.className = "fields";
      g.fieldCandidates.forEach(function (cand) {
        var tag = document.createElement("button");
        tag.className = "field-tag mono" +
          (isSelected(idx, cand.role) ? " on" : "");
        tag.textContent = cand.role;
        tag.title = cand.selector + " = " + cand.sample;
        tag.addEventListener("click", function () {
          toggleRole(idx, cand.role, cand.selector);
        });
        fields.appendChild(tag);
      });
      box.appendChild(fields);
      wrap.appendChild(box);
    });
    if (state.tables.length) {
      var box = document.createElement("div");
      box.className = "group" + (state.selectedGroupIdx === -1 ? " selected" : "");
      var head = document.createElement("div");
      head.className = "g-head";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = state.selectedGroupIdx === -1;
      cb.addEventListener("change", function () { selectTable(); });
      head.appendChild(cb);
      var label = document.createElement("span");
      label.className = "g-sig";
      label.textContent = "HTML TABLE MODE — " + state.tables.length + " table(s)";
      head.appendChild(label);
      box.appendChild(head);
      wrap.appendChild(box);
    }
  }

  function isSelected(idx, role) {
    if (idx === -1) return false;
    return state.selectedGroupIdx === idx && state.selectedRoles[role] !== undefined;
  }

  function selectGroup(idx) {
    state.selectedGroupIdx = idx;
    state.selectedRoles = {};
    state.roleOrder = [];
    state.lastRows = null;
    if (idx >= 0) {
      var g = state.groups[idx];
      // auto-select the first three sensible roles
      var prefer = ["title", "link", "datetime"];
      g.fieldCandidates.slice(0, 8).forEach(function (cand) {
        if (prefer.indexOf(cand.role) === -1 && state.roleOrder.length < 3) {
          prefer.push(cand.role);
        }
      });
      prefer.forEach(function (role) {
        var cand = g.fieldCandidates.find(function (c) { return c.role === role; });
        if (cand && state.selectedRoles[role] === undefined) {
          state.selectedRoles[role] = cand.selector;
          state.roleOrder.push(role);
        }
      });
    }
    renderGroups();
    refreshButtons();
    void preview();
  }

  function selectTable() {
    state.selectedGroupIdx = state.selectedGroupIdx === -1 ? null : -1;
    state.selectedRoles = {};
    state.lastRows = null;
    renderGroups();
    refreshButtons();
  }

  function toggleRole(idx, role, selector) {
    if (idx === -1) return;
    if (state.selectedGroupIdx !== idx) selectGroup(idx);
    if (state.selectedRoles[role] !== undefined) {
      delete state.selectedRoles[role];
      state.roleOrder = state.roleOrder.filter(function (r) { return r !== role; });
    } else {
      state.selectedRoles[role] = selector;
      state.roleOrder.push(role);
    }
    renderGroups();
    refreshButtons();
    void preview();
  }

  /* ---------- preview & harvest ---------- */

  async function preview() {
    if (state.selectedGroupIdx === null) { $("preview-wrap").classList.add("hidden"); return; }
    var resp;
    if (state.selectedGroupIdx === -1) {
      resp = await sendToTab({ t: "tables", maxRows: FREE_MAX_ROWS });
      var rows = (resp.result && resp.result[0]) ? resp.result[0].rows : [];
      $("preview-wrap").classList.remove("hidden");
      renderPreview(rows);
      return;
    }
    var g = state.groups[state.selectedGroupIdx];
    resp = await sendToTab({ t: "extract", recipe: { selector: g.selector }, roles: state.selectedRoles, maxRows: 5 });
    if (resp.t !== "rows") return;
    $("preview-wrap").classList.remove("hidden");
    renderPreview(resp.result.rows);
  }

  function renderPreview(rows) {
    var pv = $("preview");
    pv.textContent = "";
    var tbl = document.createElement("table");
    if (rows && rows.length) {
      var trh = document.createElement("tr");
      Object.keys(rows[0]).forEach(function (k) {
        var th = document.createElement("th");
        th.textContent = k;
        trh.appendChild(th);
      });
      tbl.appendChild(trh);
    }
    (rows || []).slice(0, 5).forEach(function (r) {
      var tr = document.createElement("tr");
      Object.keys(r).forEach(function (k) {
        var td = document.createElement("td");
        td.textContent = String(r[k]);
        tr.appendChild(td);
      });
      tbl.appendChild(tr);
    });
    pv.appendChild(tbl);
  }

  function applyFilter(rows) {
    if (!state.pro || !state.filterActive) return { rows: rows, dropped: 0 };
    var pat = $("filter-input").value;
    return ClipEngine.filterRows(rows, pat);
  }

  async function harvestRows(maxRows) {
    if (state.selectedGroupIdx === -1) {
      var resp = await sendToTab({ t: "tables", maxRows: maxRows });
      var out = { rows: [], total: 0, truncated: false };
      if (resp.result && resp.result.length) {
        var t = resp.result[0];
        var colCount = Math.max.apply(null, t.rows.map(function (r) { return r.length; }));
        var header = t.rows[0];
        out.rows = t.rows.slice(1).map(function (r) {
          var o = {};
          for (var i = 0; i < colCount; i += 1) o[header[i] || ("col" + (i + 1))] = r[i] || "";
          return o;
        });
        out.total = out.rows.length;
        out.truncated = t.rowCount > t.rows.length;
      }
      return out;
    }
    var g = state.groups[state.selectedGroupIdx];
    resp = await sendToTab({ t: "extract", recipe: { selector: g.selector }, roles: state.selectedRoles, maxRows: maxRows });
    return resp.result || { rows: [], total: 0 };
  }

  state.readyForExport = function () { return state.selectedGroupIdx !== null; };

  async function exportCSV() {
    if (!state.readyForExport()) return;
    var cap = currentMaxRows();
    setStatus("harvesting…");
    var result = await harvestRows(cap);
    var filtered = applyFilter(result.rows);
    if (result.truncated) result.truncated = true;
    state.lastRows = filtered.rows;
    var columns = state.roleOrder.length ? state.roleOrder : Object.keys(filtered.rows[0] || { a: 1 });
    var csv = ClipCSV.buildCSV(filtered.rows, columns, { delimiter: ",", withBOM: true });
    var name = "dclip-" + (state.host.replace(/[^a-z0-9]/gi, "-").slice(0, 24) || "page") + "-" + filtered.rows.length + "rows.csv";
    downloadBlob(csv, "text/csv", name);
    var note = filtered.rows.length + " rows exported";
    if (filtered.dropped) note += " · " + filtered.dropped + " filtered out";
    if (!state.pro && result.truncated) note += " · FREE CAPPED AT " + FREE_MAX_ROWS + " (Pro removes caps)";
    setStatus(note);
  }

  function downloadBlob(text, mime, name) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  async function exportXLSX() {
    if (!state.pro || !state.readyForExport()) return;
    var result = await harvestRows(PRO_MAX_ROWS);
    var filtered = applyFilter(result.rows);
    var mainRows = null;
    if (state.selectedGroupIdx === -1) {
      mainRows = filtered.rows.map(function (r) { return Object.keys(r).map(function (k) { return r[k]; }); });
    } else {
      var columns = state.roleOrder.length ? state.roleOrder : Object.keys(filtered.rows[0] || { a: 1 });
      mainRows = filtered.rows.map(function (r) { return columns.map(function (c) { return r[c]; }); });
      mainRows.unshift(columns);
    }
    var sheets = [{ name: "Clip", rows: mainRows }];
    var meta = [
      ["source", state.tabUrl || state.host],
      ["host", state.host],
      ["date", new Date().toISOString()],
      ["rows", String(filtered.rows.length)],
      ["filter", state.pro && state.filterActive ? $("filter-input").value : "off"],
      ["product", "dclip-1.0.0"]
    ];
    sheets.push({ name: "Meta", rows: meta });
    var bytes = ClipXLSX.buildXLSX(sheets);
    var b64 = base64FromBytes(bytes);
    var name = "dclip-" + (state.host.replace(/[^a-z0-9]/gi, "-").slice(0, 24) || "page") + "-" + filtered.rows.length + "rows.xlsx";
    downloadBlobBytes(b64, name);
    setStatus(filtered.rows.length + " rows exported to multi-sheet XLSX");
  }

  function base64FromBytes(bytes) {
    var binary = "";
    var CH = 32768;
    for (var i = 0; i < bytes.length; i += CH) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(binary);
  }

  function downloadBlobBytes(b64, name) {
    var byteStr = atob(b64);
    var arr = new Uint8Array(byteStr.length);
    for (var i = 0; i < byteStr.length; i += 1) arr[i] = byteStr.charCodeAt(i);
    var blob = new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* ---------- auto-scroll (Pro) ---------- */

  async function autoScrollHarvest() {
    if (!state.pro || state.selectedGroupIdx === null || state.selectedGroupIdx === -1) return;
    var g = state.groups[state.selectedGroupIdx];
    state.scrolling = true;
    refreshButtons();
    $("btn-scroll-stop").classList.remove("hidden");
    $("btn-scroll").classList.add("hidden");
    setStatus("auto-scroll harvest running… click STOP to abort");
    chrome.runtime.onMessage.addListener(function progressListener(msg) {
      if (msg.t === "progress") {
        setStatus("auto-scroll harvest: " + msg.rows + " rows collected…");
      }
    });
    var resp = await sendToTab({ t: "autoscroll", recipe: { selector: g.selector }, roles: state.selectedRoles, maxRows: OS_MAX_ROWS });
    $("btn-scroll-stop").classList.add("hidden");
    $("btn-scroll").classList.remove("hidden");
    state.scrolling = false;
    refreshButtons();
    if (resp.t === "rows") {
      var res = resp.result;
      var filtered = applyFilter(res.rows);
      var columns = state.roleOrder.length ? state.roleOrder : Object.keys(filtered.rows[0] || { a: 1 });
      var csv = ClipCSV.buildCSV(filtered.rows, columns, { delimiter: ",", withBOM: true });
      downloadBlob(csv, "text/csv", "dclip-scroll-" + filtered.rows.length + "-rows.csv");
      setStatus("scroll harvest done: " + filtered.rows.length + " rows exported" + (filtered.dropped ? " · " + filtered.dropped + " filtered" : ""));
    } else if (resp.t === "aborted") {
      setStatus("scroll harvest aborted");
    } else {
      setStatus(resp.reason || "scroll harvest error");
    }
  }

  /* ---------- templates (Pro) ---------- */

  function storageGet(keys) {
    return new Promise(function (r) { chrome.storage.local.get(keys, r); });
  }
  function storageSet(obj) {
    return new Promise(function (r) { chrome.storage.local.set(obj, r); });
  }

  async function findTemplateForHost(host, cards) {
    var data = await storageGet({ templates: [] });
    var list = data.templates || [];
    return list.find(function (t) {
      return t && t.host === host && cards.some(function (g) { return g.selector === t.recipe.selector; });
    }) || null;
  }

  async function saveTemplate() {
    if (!state.pro || state.selectedGroupIdx === null || state.selectedGroupIdx === -1) {
      setStatus("select a card group first");
      return;
    }
    var g = state.groups[state.selectedGroupIdx];
    var data = await storageGet({ templates: [] });
    var list = data.templates || [];
    list = list.filter(function (t) { return !t || t.host !== state.host || t.recipe.selector !== g.selector; });
    list.push({
      id: "tpl-" + Date.now().toString(36),
      host: state.host,
      recipe: { selector: g.selector },
      roles: state.selectedRoles,
      rolesOrder: state.roleOrder,
      ts: Date.now()
    });
    await storageSet({ templates: list.slice(-20) });
    renderTemplates();
    setStatus("template saved for this host");
  }

  function applyTemplate(tpl) {
    var idx = state.groups.findIndex(function (g) { return g.selector === tpl.recipe.selector; });
    if (idx === -1) { refreshButtons(); return; }
    state.selectedGroupIdx = idx;
    state.selectedRoles = tpl.roles || {};
    state.roleOrder = tpl.rolesOrder || Object.keys(state.selectedRoles);
    renderGroups();
    refreshButtons();
    void preview();
  }

  async function renderTemplates() {
    var data = await storageGet({ templates: [] });
    var list = (data.templates || []).filter(function (t) { return t && t.host === state.host; });
    var line = $("tpl-line");
    line.innerHTML = "";
    if (!list.length) { line.textContent = "no templates for this host"; refreshButtons(); return; }
    list.forEach(function (t) {
      var b = document.createElement("button");
      b.className = "btn mono";
      b.textContent = "APPLY: " + t.recipe.selector.slice(0, 28);
      b.addEventListener("click", function () { applyTemplate(t); });
      line.appendChild(b);
    });
    refreshButtons();
  }

  /* ---------- Pro unlock ---------- */

  function openModal() {
    $("modal").classList.remove("hidden");
    $("verify-status").textContent = "";
  }
  function closeModal() { $("modal").classList.add("hidden"); }

  document.querySelectorAll(".tabs .tab").forEach(function (t) {
    t.addEventListener("click", function () {
      document.querySelectorAll(".tabs .tab").forEach(function (x) { x.classList.remove("tab-active"); });
      t.classList.add("tab-active");
      var which = t.getAttribute("data-tab");
      $("tab-tx").classList.toggle("hidden", which !== "tx");
      $("tab-key").classList.toggle("hidden", which !== "key");
    });
  });

  $("btn-verify-tx").addEventListener("click", async function () {
    var tx = $("tx-hash").value.trim();
    $("verify-status").textContent = "querying Base RPC…";
    var res = await ClipTx.verifyBaseUSDCPayment({ txHash: tx, minAmountUSD: PRO_MIN_USD });
    if (res.ok) {
      await savePro({ mode: "tx", proof: { tx: res.txHash, amount: res.amountUSDC, block: res.blockNumber } });
      $("verify-status").textContent = "verified: " + res.amountUSDC + " USDC @ block " + res.blockNumber;
      setTimeout(closeModal, 900);
    } else {
      $("verify-status").textContent = "not verified: " + res.reason;
      $("verify-status").style.color = "#B04000";
    }
  });

  $("btn-verify-key").addEventListener("click", async function () {
    var key = $("lic-key").value;
    $("verify-status").textContent = "checking key…";
    var res = await ClipLicense.verifyLicense(key, ["dclip"]);
    if (res.ok) {
      await savePro({ mode: "key", proof: { tag: res.payload.u, exp: res.payload.e } });
      $("verify-status").textContent = "license valid (" + res.payload.u + ")";
      setTimeout(closeModal, 900);
    } else {
      $("verify-status").textContent = "invalid: " + res.reason;
      $("verify-status").style.color = "#B04000";
    }
  });

  async function savePro(extra) {
    var pro = { ts: Date.now(), mode: extra.mode, proof: extra.proof };
    await storageSet({ pro: pro });
    setPro(pro);
  }

  document.querySelectorAll(".copy").forEach(function (btn) {
    btn.addEventListener("click", function () {
      navigator.clipboard.writeText(btn.getAttribute("data-addr")).then(function () {
        btn.textContent = "OK";
        setTimeout(function () { btn.textContent = "COPY"; }, 800);
      }, function () {
        btn.textContent = "ERR";
      });
    });
  });

  $("tier-chip").addEventListener("click", function () { openModal(); });
  $("modal-close").addEventListener("click", closeModal);
  $("btn-csv").addEventListener("click", function () { void exportCSV(); });
  $("btn-xlsx").addEventListener("click", function () {
    if (!state.pro) { openModal(); return; }
    void exportXLSX();
  });
  $("btn-scroll").addEventListener("click", function () {
    if (!state.pro) { openModal(); return; }
    void autoScrollHarvest();
  });
  $("btn-scroll-stop").addEventListener("click", function () {
    sendToTab({ t: "stop" });
  });
  $("btn-tpl").addEventListener("click", function () {
    if (!state.pro) { openModal(); return; }
    void saveTemplate();
  });
  $("btn-detect").addEventListener("click", function () { void detect(); });
  $("filter-input").addEventListener("input", function () {
    state.filterActive = state.pro && $("filter-input").value.length > 0;
    $("filter-chip").textContent = state.pro ? (state.filterActive ? "ON" : "OFF") : "PRO";
    void preview();
  });

  /* ---------- boot ---------- */

  chrome.tabs.query({ active: true, currentWindow: true }, async function (tabs) {
    var tab = tabs && tabs[0];
    if (!tab) { setStatus("no active tab"); return; }
    state.tabId = tab.id;
    try {
      var u = new URL(tab.url || "about:blank");
      state.host = u.hostname || "";
      state.tabUrl = tab.url;
    } catch (e) {
      state.host = "";
    }
    var data = await storageGet({ pro: null });
    setPro(data.pro && data.pro.ts ? data.pro : null);
    await renderTemplates();
    void detect();
  });
})();
