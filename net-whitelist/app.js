/* SNI Wh RU 2026 — free latency tester + config generator.
 * 100% client-side: the vless:// key stays in the browser, nothing is sent.
 * Pro features decrypt the same AES container that the other Toolworks
 * products use, after assets/unlock.js confirms entitlement. */
(function () {
  "use strict";

  var PRODUCT = "sni-whitelist";
  var PRICE_USD = 0.99; /* ≈ 99 ₽ СБП/карта, ключ TW1 сразу */

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? "" : s); };
  var fmt = function (n) { return Number(n || 0).toLocaleString("ru-RU"); };

  var FREE = (window.SNI_FREE || []);
  var META = window.SNI_META || {};
  var state = {
    rows: [],            /* tester results */
    domains: [],         /* selectable SNI list (free until pack opens) */
    pro: null,           /* decrypted pack */
    urlKey: "", urlDownload: "", urlPack: "", autoDownloaded: false
  };

  /* Receipt link (?key=TW1-…&pack=sni-whitelist&download=xlsx) is read now,
     before Unlock.autoActivateFromUrl strips it from the address bar. */
  if (window.Unlock && window.Unlock.readUrlParams) {
    var p = window.Unlock.readUrlParams();
    state.urlKey = p.key; state.urlDownload = p.download; state.urlPack = p.pack;
  }

  function isPro() { return !!(window.Unlock && window.Unlock.isPro(PRODUCT)); }
  function toast(msg, bad) { if (window.Unlock && window.Unlock.toast) window.Unlock.toast(msg, bad); else console.log(msg); }

  /* ---------------------------------------------------------------- DOM */
  function renderStats() {
    var meta = (state.pro && state.pro.total) ? state.pro : (META.total ? META : null);
    var total = meta ? meta.total : FREE.length;
    var list = state.pro ? state.pro.domains : FREE;
    var tls13 = list.filter(function (d) { return /TLSv1\.3/.test(d.tls13_alpn || ""); }).length;
    $("#st-total").innerHTML = "<b>" + fmt(total) + "</b><span class='muted small'>доменов в базе</span>";
    $("#st-core").innerHTML = "<b>" + fmt(meta && meta.core || TOTAL_CORE) + "</b><span class='muted small'>инфраструктурных core</span>";
    $("#st-tls").innerHTML = "<b>" + fmt(tls13) + "</b><span class='muted small'>с TLS 1.3 + h2</span>";
    $("#st-free").innerHTML = "<b>" + FREE.length + "</b><span class='muted small'>бесплатно открыты</span>";
  }
  var TOTAL_CORE = 0;

  function rowHtml(d) {
    return "<tr data-domain='" + esc(d.domain) + "'>" +
      "<td class='mono'>" + esc(d.domain) + "</td>" +
      "<td>" + esc(d.category || "") + "</td>" +
      "<td class='mono small muted'>" + esc(d.tls13_alpn || "—") + "</td>" +
      "<td class='mono'>" + (d.ping_ms == null ? "—" : Number(d.ping_ms) + " ms") + "</td>" +
      "<td class='mono small muted'>" + esc(d.asn_org || "—") + "</td>" +
      "<td class='small muted'>" + esc(d.operator_whitelist || "—") + "</td>" +
      "<td class='small muted'>" + esc(d.recommended_client || "") + "</td>" +
      "<td><button class='btn' data-pick='" + esc(d.domain) + "'>SNI →</button></td></tr>";
  }
  function renderTable() {
    var list = state.pro ? state.pro.domains : FREE;
    var q = ($("#filter-q") && $("#filter-q").value.trim()) || "";
    var cat = ($("#filter-cat") && $("#filter-cat").value) || "Все";
    var out = list;
    if (cat !== "Все") out = out.filter(function (d) { return d.category === cat; });
    if (q) out = out.filter(function (d) { return d.domain.indexOf(q) >= 0; });
    var lim = state.pro ? out.slice(0, 500) : out.slice(0, 25);
    $("#tbl-body").innerHTML = lim.map(rowHtml).join("");
    $("#tbl-note").textContent = state.pro
      ? "Показано " + fmt(lim.length) + " из " + fmt(state.pro.total) + " (полная база открыта)"
      : "Открыта бесплатная выжимка: " + fmt(lim.length) + " из " + fmt(META.total || lim.length) + ". Полная база — в Pro.";
    /* category filter source */
    var cats = {}; state.domains.concat(state.pro ? state.pro.domains : []).forEach(function (d) { cats[d.category || "—"] = 1; });
    var sel = $("#filter-cat"), cur = sel.value;
    var opts = "<option>Все</option>" + Object.keys(cats).sort().map(function (c) { return "<option" + (c === cur ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("");
    if (sel.dataset.built !== Object.keys(cats).length) { sel.innerHTML = opts; sel.dataset.built = Object.keys(cats).length; }
  }

  /* ----------------------------------------------------- latency tester */
  function testOne(domain, ms) {
    return new Promise(function (resolve) {
      var t0 = performance.now(), ok = false;
      var done = function () {
        if (!ok) resolve({ domain: domain, ms: null, fail: true });
        else resolve({ domain: domain, ms: performance.now() - t0, fail: false });
      };
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = setTimeout(function () { ok = ok; done(); clearTimeout(timer); }, ms);
      if (ctrl) setTimeout(function () { try { ctrl.abort(); } catch (e) { /* noop */ } }, ms);
      fetch("https://" + domain + "/favicon.ico?snit=" + Date.now(),
        { mode: "no-cors", cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
        .then(function () { ok = true; clearTimeout(timer); done(); })
        .catch(function () { clearTimeout(timer); done(); });
    });
  }

  function runTester() {
    var btn = $("#run-tester");
    if (btn.disabled) return;
    btn.disabled = true;
    $("#tester-status").textContent = "Опрашиваем " + state.domains.length + " узлов из вашей сети…";
    $("#tbl-body").innerHTML = state.domains.map(function (d) {
      return "<tr data-domain='" + esc(d.domain) + "'><td>" +
        "<span class='dot dot--idle'></span>" + esc(d.domain) + "</td>" +
        "<td colspan='6' class='muted small'>тест…</td></tr>";
    }).join("");
    var jobs = state.domains.map(function (d) { return testOne(d.domain, 1800); });
    Promise.all(jobs).then(function (res) {
      var ok = res.filter(function (r) { return !r.fail; });
      ok.sort(function (a, b) { return a.ms - b.ms; });
      state.rows = res;
      var med = ok.length ? Math.round(ok[Math.floor(ok.length / 2)].ms) : 0;
      $("#tester-status").innerHTML = "Отвечают <b class='badge-ok'>" + ok.length + "/" + res.length +
        "</b>; медиана <b>" + med + " ms</b>" + (ok.length ? "; самый быстрый: <b class='mono'>" + esc(ok[0].domain) +
        " (" + Math.round(ok[0].ms) + " ms)</b>" : "") +
        " — замер из вашего интернета, " + new Date().toLocaleDateString("ru-RU");
      $("#tbl-body").innerHTML = res.map(function (r) {
        var d = state.domains.filter(function (x) { return x.domain === r.domain; })[0] || { domain: r.domain, category: "", tls13_alpn: "", operator_whitelist: "", recommended_client: "", asn_org: "" };
        var cls, txt, dot;
        if (r.fail) { cls = "badge-bad"; txt = "нет ответа"; dot = "dot--bad"; }
        else { var m = Math.round(r.ms); if (m < 300) { cls = "badge-ok"; dot = "dot--ok"; txt = m + " ms"; } else { cls = "badge-warn"; dot = "dot--warn"; txt = m + " ms"; } }
        return "<tr data-domain='" + esc(d.domain) + "'><td>" +
          "<span class='dot " + dot + "'></span><span class='mono'>" + esc(d.domain) + "</span></td>" +
          "<td class='small'>" + esc(d.category || "") + "</td>" +
          "<td class='mono small muted'>" + esc(d.tls13_alpn || "—") + "</td>" +
          "<td><span class='" + cls + "'>" + txt + "</span></td>" +
          "<td class='mono small muted'>" + esc(d.asn_org || "—") + "</td>" +
          "<td class='small muted'>" + esc(d.operator_whitelist || "—") + "</td>" +
          "<td class='small muted'>" + esc(d.recommended_client || "") + "</td>" +
          "<td><button class='btn' data-pick='" + esc(d.domain) + "'>SNI →</button></td></tr>";
      }).join("");
      /* default pick = fastest reachable */
      if (ok.length) { var best = domain($("gen-sni")); state.genSni = ok[0].domain; $("#gen-sni").value = ok[0].domain; }
      renderGen();
      btn.disabled = false;
    });
  }

  /* --------------------------------------------------- generator (free) */
  function parseVless(raw) {
    var m = /^vless:\/\/([^@\s]+)@([^:\/\s]+):(\d+)(\?[^#]*)?(#.{0,120})?$/i.exec(String(raw || "").trim());
    if (!m) return null;
    var q = {};
    (m[4] || "").replace(/^\?/, "").split("&").forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf("=");
      q[kv.slice(0, i)] = decodeURIComponent((kv.slice(i + 1) || "").replace(/\+/g, "%20"));
    });
    return { uuid: m[1], host: m[2], port: m[3], q: q, frag: (m[5] || "").replace(/^#/, "") };
  }

  /* Transport presets (November 2026). "tcp" is the classic Reality build with
     XTLS Vision flow; "xhttp" is the split-HTTP build that survives TSPU
     probing on LTE (Xray ≥ 24.9.16, Sing-Box ≥ 1.12); "grpc" stays as the
     third compatible fallback for panels that only expose gRPC. Every preset
     keeps the chosen white SNI as the Reality handshake target. */
  var TRANSPORTS = {
    tcp: {
      label: "VLESS + Reality (TCP + XTLS Vision — классический)",
      type: "tcp",
      flow: "xtls-rprx-vision",
      frag: "tlsv13-h2"
    },
    xhttp: {
      label: "VLESS + XHTTP (SplitHTTP) + Reality — анти-детект ТСПУ",
      type: "xhttp",
      mode: "auto",
      path: "/",
      frag: "xhttp-auto"
    },
    grpc: {
      label: "VLESS + gRPC + Reality (совместимый фолбэк)",
      type: "grpc",
      serviceName: "grpc",
      mode: "gun",
      frag: "grpc-reality"
    }
  };

  function buildVless(link, sni, transport) {
    var v = parseVless(link);
    if (!v) return null;
    var tr = TRANSPORTS[transport || "tcp"] || TRANSPORTS.tcp;
    var q = Object.assign({}, v.q);
    q.sni = sni;
    q.host = sni;
    q.fp = q.fp || "chrome";
    q.type = tr.type;
    q.security = "reality";
    /* flow only exists on TCP+Reality; sending it with xhttp/grpc produces a
       key that clients import but refuse to start. */
    if (tr.flow) q.flow = tr.flow; else delete q.flow;
    if (tr.mode) q.mode = tr.mode; else delete q.mode;
    if (tr.path) q.path = tr.path; else delete q.path;
    if (tr.serviceName) q.serviceName = tr.serviceName; else if (tr.type === "grpc") q.serviceName = "grpc"; else delete q.serviceName;
    var names = ["sni", "host", "fp", "type", "security", "pbk", "sid", "spx", "path", "mode", "serviceName", "flow", "encryption", "headerType"];
    var params = names.filter(function (k) { return q[k] != null && q[k] !== ""; })
      .map(function (k) { return k + "=" + encodeURIComponent(q[k]); }).join("&")
      + ["alpn", "scid", "level", "ed"].map(function (k) { return q[k] ? (k + "=" + encodeURIComponent(String(q[k]).replace(/\s+/g, ""))) : ""; }).filter(Boolean).join("");
    var frag = sni + "-" + tr.frag;
    return "vless://" + v.uuid + "@" + v.host + ":" + v.port + "?" + params.replace(/&&/g, "&") + "#" + encodeURIComponent(frag);
  }

  function outSingBox(link, sni, transport) {
    var v = parseVless(link);
    if (!v) return "";
    var tr = TRANSPORTS[transport || "tcp"] || TRANSPORTS.tcp;
    var transportBlock = tr.type === "ws" && v.q.type === "ws"
      ? { type: "ws", path: v.q.path || "/" }
      : tr.type === "xhttp"
        ? { type: "xhttp", path: tr.path, mode: tr.mode, host: sni }
        : tr.type === "grpc"
          ? { type: "grpc", service_name: tr.serviceName || "grpc" }
          : { type: "tcp" };
    return {
      outbounds: [{
        type: "vless", tag: "vless-" + sni, server: v.host, server_port: Number(v.port) || 443,
        uuid: v.uuid, flow: tr.flow || "",
        tls: {
          enabled: true, insecure: false, utls: { enabled: true, fingerprint: "chrome" },
          server_name: sni, alpn: ["h2", "http/1.1"],
          reality: (v.q.pbk ? { enabled: true, public_key: v.q.pbk, short_id: v.q.sid || "" } : { enabled: false })
        },
        transport: transportBlock
      }]
    };
  }

  /* Server-side twin: the inbound JSON that a 3x-ui panel (Xray-core) accepts
     for the same Reality + chosen-SNI build. Reality's `dest`/`target` is the
     SNI edge itself, so panel and client agree on the handshake; the private
     key lives in the owner's panel only, so it stays a placeholder. */
  function inbound3xui(link, sni, transport) {
    var v = parseVless(link);
    if (!v) return null;
    var tr = TRANSPORTS[transport || "tcp"] || TRANSPORTS.tcp;
    var port = Number(v.port) || 443;
    var inbound = {
      up: 0,
      down: 0,
      total: 0,
      remark: "sni-" + tr.type + "-" + sni,
      enable: true,
      expiryTime: 0,
      listen: "",
      port: port,
      protocol: "vless",
      settings: {
        clients: [{
          id: v.uuid,
          flow: tr.flow || "",
          email: "sni-" + tr.type,
          limitIp: 0, totalGB: 0, expiryTime: 0, enable: true, tgId: "", subId: ""
        }],
        decryption: "none",
        fallbacks: []
      },
      streamSettings: {
        network: tr.type,
        security: "reality",
        externalProxy: [],
        realitySettings: {
          show: false,
          xver: 0,
          dest: sni + ":" + port,
          target: sni + ":" + port,
          serverNames: [sni],
          privateKey: "<вставьте privateKey вашей панели 3x-ui — команда xray x25519>",
          minClient: "", maxClient: "", maxTimeDiff: 0,
          shortIds: [v.q.sid || "ab12cd34"],
          limitFallbackIp: 0,
          fallbackDest: "",
          fallback: [],
          settings: {
            publicKey: v.q.pbk || "<publicKey из xray x25519>",
            fingerprint: v.q.fp || "chrome",
            spiderX: v.q.spx || "/"
          }
        }
      },
      sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false, routeOnly: false },
      allocate: { strategy: "always", refresh: 5, concurrency: 3 }
    };
    if (tr.type === "xhttp") {
      inbound.streamSettings.xhttpSettings = {
        path: tr.path || "/",
        host: sni,
        mode: tr.mode || "auto",
        extra: {}
      };
    } else if (tr.type === "grpc") {
      inbound.streamSettings.grpcSettings = {
        serviceName: tr.serviceName || "grpc",
        authority: sni,
        multiMode: tr.mode === "multi"
      };
    } else {
      inbound.streamSettings.tcpSettings = {
        acceptProxyProtocol: false,
        header: { type: "none" }
      };
    }
    return inbound;
  }

  var genState = { tab: "vless", input: "", transport: "tcp" };

  function transportNow() {
    var sel = $("#gen-transport");
    return (sel && sel.value) || genState.transport || "tcp";
  }

  function renderGen() {
    var raw = $("#gen-input").value.trim();
    genState.input = raw;
    var transport = transportNow();
    genState.transport = transport;
    var sni = ($("#gen-sni") && $("#gen-sni").value) || state.genSni || (state.domains[0] && state.domains[0].domain) || "sberbank.ru";
    if (!raw) { $("#gen-out").innerHTML = "<span class='muted'>Вставьте свой vless://-ключ выше — всё ниже генерируется локально, ключ не покидает браузер.</span>"; $("#qr-box").hidden = true; $("#dl-link").hidden = true; return; }
    var built = buildVless(raw, sni, transport);
    if (!built) { $("#gen-out").innerText = "Не разобрал ссылку: нужен формат vless://UUID@server:port?...#tag"; return; }
    var html = "";
    if (genState.tab === "vless") {
      html += transport === "xhttp"
        ? "<div class='lbl muted small'>XHTTP (SplitHTTP) + Reality — <span class='mono'>type=xhttp&security=reality&mode=auto&path=%2F</span>. Импортируется в Happ, v2rayNG (Xray ≥ 24.9.16), Nekoray, Streisand:</div>"
        : transport === "grpc"
          ? "<div class='lbl muted small'>gRPC + Reality — <span class='mono'>type=grpc&security=reality&serviceName=grpc&mode=gun</span>. Совместимый фолбэк для панелей, где включён только gRPC-транспорт:</div>"
          : "<div class='lbl muted small'>TCP + Reality с <span class='mono'>flow=xtls-rprx-vision</span>. Импортируется в Happ, v2rayNG, Streisand, FoXray, Nekoray (Share → вставить ссылку):</div>";
      html += "<div class='out' id='out-link'>" + esc(built) + "</div>";
    }
    if (genState.tab === "singbox") {
      var sb = outSingBox(raw, sni, transport);
      html += "<div class='lbl muted small'>" + (transport === "xhttp"
        ? "Sing-Box outbound с транспортом xhttp (Sing-Box ≥ 1.12 — для Nekoray / v2rayNG / Happ):"
        : transport === "grpc"
          ? "Sing-Box outbound с транспортом gRPC (SNI/fp/tls подставлены):"
          : "Sing-Box outbound (SNI/fp/tls подставлены):") + "</div><pre class='out'>" + esc(JSON.stringify(sb, null, 2)) + "</pre>";
    }
    if (genState.tab === "xui") {
      var inbound = inbound3xui(raw, sni, transport);
      html += "<div class='lbl muted small'>Inbound для панели 3x-ui (Xray-core): транспорт <span class='mono'>" + esc(transport) +
        "</span>, Reality, <span class='mono'>dest</span> = ваш белый SNI <span class='mono'>" + esc(sni) + ":" + esc(Number(parseVless(raw).port) || 443) + "</span>. " +
        "Кнопка «Скопировать JSON inbound» выше кладёт этот объект в буфер — в 3x-ui: Xray → Inbounds → Add → JSON." +
        " Подставьте только свой privateKey панели.</div>" +
        "<pre class='out' id='out-xui'>" + esc(JSON.stringify(inbound, null, 2)) + "</pre>" +
        "<div class='note note--warn small'>privateKey — серверный ключ вашей панели (в терминале: <span class='mono'>xray x25519</span>). <span class='mono'>serverNames</span>, <span class='mono'>shortIds</span> и <span class='mono'>uuid</span> уже совпадают с ключом клиента выше: подпись клиента и inbound будут совпадать. <span class='mono'>dest</span> (он же <span class='mono'>target</span> в Xray ≥ 24.9) указывает на выбранный белый SNI.</div>";
    }
    if (genState.tab === "routing") {
      var set = (state.pro ? state.pro.domains.filter(function (d) { return d.tier === "core"; }) : FREE).map(function (d) { return d.domain; });
      html += "<div class='lbl muted small'>Routing JSON: домены базы идут напрямую (direct), остальное — в туннель:</div><pre class='out'>" + esc(JSON.stringify({
        domainStrategy: "IPIfNonMatch",
        rules: [{ type: "field", domain: set, outboundTag: "direct" }]
      }, null, 2)) + "</pre>" + (state.pro ? "" : "<div class='note note--warn'>Это шаблон на 25 демо-доменах. Полная маршрутизация на " + fmt(META.total || 0) + "+ доменов открывается в Pro.</div>");
    }
    if (genState.tab === "clients") {
      html += "<div class='small muted' style='margin:8px 0'>Готовые ссылки под каждый клиент (одна строка = один импорт):</div>";
      ["Happ", "v2rayNG", "Streisand", "FoXray", "Nekoray"].forEach(function (c) {
        html += "<div class='row' style='margin:6px 0'><span style='width:110px;text-align:right' class='small muted'>" + c + "</span><div class='out grow mono small'>" + esc(built) + "</div></div>";
      });
    }
    $("#gen-out").innerHTML = html;
    /* QR */
    $("#qr-box").hidden = false;
    renderQR(built);
    $("#dl-link").hidden = false;
    $("#dl-link").href = "data:text/plain;charset=utf-8," + encodeURIComponent(built);
    $("#dl-link").download = sni + "-vless-" + transport + ".txt";
  }

  /* Copy the ready 3x-ui inbound JSON. This is the one-click bridge between
     the client key and the owner's VPS panel: dest/serverNames/xhttpSettings
     already point at the chosen white SNI, so the only manual step left is the
     panel's own privateKey. */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var done = false;
      try { done = document.execCommand("copy"); } catch (e) { done = false; }
      ta.remove();
      done ? resolve() : reject(new Error("copy command rejected"));
    });
  }

  function copyInbound3xui() {
    var raw = ($("#gen-input").value || "").trim();
    if (!parseVless(raw)) {
      toast("Сначала вставьте свой vless://-ключ — inbound собирается под его UUID и порт", true);
      var inp = $("#gen-input");
      if (inp && inp.focus) inp.focus();
      return;
    }
    var sni = ($("#gen-sni") && $("#gen-sni").value) || state.genSni || (state.domains[0] && state.domains[0].domain) || "sberbank.ru";
    var transport = transportNow();
    var inbound = inbound3xui(raw, sni, transport);
    var json = JSON.stringify(inbound, null, 2);
    copyText(json).then(function () {
      toast("3x-ui inbound JSON скопирован: " + transport + " + Reality, dest " + sni + ":" + (Number(parseVless(raw).port) || 443));
      genState.tab = "xui";
      $$(".tab[data-tab]").forEach(function (x) { x.setAttribute("aria-selected", x.getAttribute("data-tab") === "xui" ? "true" : "false"); });
      renderGen();
    }).catch(function () {
      /* Clipboard blocked (insecure origin / no permission): show the JSON so
         the buyer can still select and copy it by hand. */
      genState.tab = "xui";
      $$(".tab[data-tab]").forEach(function (x) { x.setAttribute("aria-selected", x.getAttribute("data-tab") === "xui" ? "true" : "false"); });
      renderGen();
      toast("Буфер обмена недоступен — JSON открыт во вкладке «3x-ui inbound», скопируйте вручную", true);
    });
  }

  function renderQR(text) {
    var box = $("#qr-box");
    var holder = $("#qr-holder");
    var sni = ($("#gen-sni") && $("#gen-sni").value) || "SNI";
    try {
      var qr = window.qrcode(0, "M");
      qr.addData(text);
      qr.make();
      holder.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 6, scalable: true });
      $("#qr-cap").innerHTML = "QR — <b class='mono'>" + esc(sni) + "</b> · отсканируйте из Happ / v2rayNG / Streisand / FoXray";
      $("#qr-blob").hidden = false;
      var school = holder.querySelector("svg");
      if (school) {
        var svgText = new XMLSerializer().serializeToString(school);
        $("#qr-blob").href = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgText)));
        $("#qr-blob").download = sni + "-qr.svg";
      }
    } catch (e) {
      holder.innerHTML = "<span class='small'>Ссылка длинная для QR — используйте импорт по ссылке.</span>";
      $("#qr-blob").hidden = true;
    }
  }

  /* ----------------------------------------------------------- PRO gate */
  function entitlement() {
    var rec = window.Unlock && window.Unlock.state(PRODUCT);
    return rec && rec.hash;
  }
  function canLoadPack() {
    if (!isPro()) return false;
    if (window.Unlock.isPreview && window.Unlock.isPreview(PRODUCT) && !entitlement()) return false;
    return true;
  }

  function loadPro() {
    if (!canLoadPack() || !window.SNIPack || window.SNIPack.isLoaded()) return;
    var bar = $("#pro-status");
    bar.hidden = false;
    bar.innerHTML = "<span class='muted'>Оплата подтверждена. Расшифровываем базу локально…</span>";
    window.SNIPack.ensure(entitlement()).then(function (pack) {
      state.pro = pack;
      state.domains = pack.domains.concat(state.domains.filter(function (d) {
        return !pack.domains.some(function (x) { return x.domain === d.domain; });
      }));
      $("#pro-status").innerHTML = "<span class='badge-ok'>✔ Полная база открыта: " + fmt(pack.total) + " доменов; шаблоны маршрутизации — «Скачать JSON»</span>";
      if (pack.templates && pack.templates.length) $("#btn-json").hidden = false;
      $("#btn-batch").hidden = false;
      renderStats(); renderTable(); renderGen();
      toast("База SNI открыта: " + fmt(pack.total) + " доменов");
      maybeAutoDownload();
    }).catch(function (err) {
      bar.innerHTML = "<span class='badge-bad'>База не открылась: " + esc(err && err.message || "ошибка") + "</span>";
      if (err && err.paymentFailed && window.Unlock) { try { window.Unlock.deactivate(PRODUCT); } catch (e) { /* noop */ } }
    });
  }

  function fullXlsxName() { return "sni-whitelist-500-rf-nov2026.xlsx"; }

  function dlXlsx(pack) {
    var rows = [[
      "domain", "category", "tls13_alpn", "ping_ms", "asn_org", "operator_whitelist",
      "recommended_client", "http_status", "tier", "note", "checked"
    ]];
    pack.domains.forEach(function (d) {
      rows.push([d.domain, d.category, d.tls13_alpn, d.ping_ms, d.asn_org, d.operator_whitelist,
        d.recommended_client, d.https, d.tier, d.note, d.checked]);
    });
    window.XLSX.download(rows, fullXlsxName(), "SNI");
    toast("Скачано: " + fullXlsxName());
  }

  function dlJson(pack) {
    var blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sni-whitelist-full-nov2026.json";
    document.body.appendChild(a); a.click(); a.remove();
    toast("Скачано: sni-whitelist-full-nov2026.json");
  }

  /* Pro: 50 reserve profiles from one buyer key — same server, 50 different
     white SNI domains. Built locally, nothing is uploaded. */
  var BATCH_N = 50;
  function dlBatch(pack) {
    var raw = ($("#gen-input").value || "").trim();
    var v = parseVless(raw);
    if (!v) { toast("Вставьте свой vless://-ключ в генератор выше — 50 профилей строятся из вашего сервера", true); return; }
    var ranked = pack.domains.slice().sort(function (a, b) {
      var ta = a.tier === "core" ? 0 : 1, tb = b.tier === "core" ? 0 : 1;
      return ta - tb;
    });
    var seen = {}, picks = [];
    ranked.forEach(function (d) {
      if (picks.length >= BATCH_N || seen[d.domain]) return;
      seen[d.domain] = 1;
      picks.push(d.domain);
    });
    if (!picks.length) { toast("В базе нет доменов для генерации", true); return; }
    var lines = [
      "# SNI White List LTE RU 2026 — " + picks.length + " резервных профилей",
      "# Сервер: " + v.host + ":" + v.port + " · собрано " + new Date().toISOString().slice(0, 10),
      "# Импорт: Happ / v2rayNG — «+» → «Импорт из буфера», по одной ссылке.",
      ""
    ];
    picks.forEach(function (sni, i) {
      lines.push("# " + (i + 1) + ". " + sni);
      lines.push(buildVless(raw, sni, transportNow()));
    });
    var blob = new Blob([lines.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sni-whitelist-50-reserve-profiles-nov2026.txt";
    document.body.appendChild(a); a.click(); a.remove();
    toast("Скачано " + picks.length + " резервных профилей: sni-whitelist-50-reserve-profiles-nov2026.txt");
  }

  function maybeAutoDownload() {
    if (state.autoDownloaded) return;
    var wants = !!(state.urlKey || entitlement());
    if (!wants || !isPro()) return;
    var pack = (state.urlPack || "").toLowerCase();
    if (pack !== "sni-whitelist" && pack !== "sni") return;
    var fmt_ = (state.urlDownload || "xlsx").toLowerCase();
    state.autoDownloaded = true;
    setTimeout(function () { fmt_ === "json" ? dlJson(state.pro) : dlXlsx(state.pro); }, 600);
  }

  /* ----------------------------------------------------------- listeners */
  function onUnlockChanged() {
    loadPro();
    renderStats();
    /* buttons */
    $$("[data-pay-btn]").forEach(function (b) { b.hidden = isPro(); });
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t.id === "run-tester") runTester();
    else if (t.id === "gen-run") renderGen();
    else if (t.id === "btn-xui-json") copyInbound3xui();
    else if (t.id === "btn-xlsx" && state.pro) dlXlsx(state.pro);
    else if (t.id === "btn-json" && state.pro) dlJson(state.pro);
    else if (t.id === "btn-batch" && state.pro) dlBatch(state.pro);
    else if (t.id === "copy-titled") {
      var ta = $("#gen-input");
      ta.select && ta.select();
    }
    else if (t.hasAttribute && t.hasAttribute("data-pick")) {
      var elem = $("#gen-sni");
      if (elem) { elem.value = t.getAttribute("data-pick"); }
      toast("SNI выбран: " + t.getAttribute("data-pick"));
      renderGen();
    }
    else if (t.hasAttribute && t.hasAttribute("data-tab")) {
      genState.tab = t.getAttribute("data-tab");
      $$(".tab[data-tab]").forEach(function (x) { x.setAttribute("aria-selected", x === t ? "true" : "false"); });
      renderGen();
    }
    else if (t.id === "pro-key-apply") {
      var key = ($("#pro-key").value || "").trim();
      if (!key) { toast("Вставьте ключ TW1-…", true); return; }
      if (window.Unlock && window.Unlock.unlockWithLicense) {
        window.Unlock.unlockWithLicense(PRODUCT, key.replace(/^license:/i, "")).then(function (verdict) {
          if (verdict && verdict.valid) { toast("Ключ принят: " + verdict.code); onUnlockChanged(); }
          else toast("Ключ не принят: " + ((verdict && verdict.error) || "ошибка"), true);
        }).catch(function () { toast("Ключ не принят", true); });
      } else toast("Модуль unlock.js не загружен", true);
    }
    else if (t.id === "pro-key-clear") { $("#pro-key").value = ""; }
  });

  document.addEventListener("click", function (e) {
    if (e.target.id === "gen-run") return;
  });

  /* debounce filter input */
  var ftimer = null;
  document.addEventListener("input", function (e) {
    if (e.id) return;
    var t = e.target;
    if (t.id === "filter-q") {
      clearTimeout(ftimer);
      ftimer = setTimeout(renderTable, 140);
    }
    if (t.id === "filter-cat") renderTable();
    if (t.id === "gen-input") {
      clearTimeout(ftimer);
      ftimer = setTimeout(renderGen, 500);
    }
    if (t.id === "gen-sni") renderGen();
    if (t.id === "gen-transport") renderGen();
  });

  /* --------------------------------------------------------------- init */
  function init() {
    TOTAL_CORE = MFCore();
    state.domains = FREE.slice();
    renderStats();
    renderTable();
    $("#gen-sni").innerHTML = FREE.map(function (d) { return "<option>" + esc(d.domain) + "</option>"; }).join("");
    if (window.Unlock) {
      window.Unlock.autoActivateFromUrl({ product: "sni-whitelist", price: PRICE_USD }).then(function (activated) {
        if (activated) { onUnlockChanged(); } else { loadPro(); }
      }).catch(loadPro);
      document.addEventListener("unlock:changed", onUnlockChanged);
    } else loadPro();
    /* keep hash of the input stable between tabs */
    $$("[data-tab]").forEach(function (t) { if (t.getAttribute("data-tab") === "vless") t.setAttribute("aria-selected", "true"); });
  }
  function MFCore() {
    var n = 0; FREE.forEach(function (d) { if (d.tier === "core") n++; }); return n;
  }
  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
