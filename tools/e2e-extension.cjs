/* Load the packed MV3 extension into a real Chromium and prove the download
 * path the userscript cannot reach: panel (MAIN world) -> bridge.js (isolated
 * world) -> service worker -> chrome.downloads.
 *
 *   node tools/e2e-extension.cjs [--shots <dir>]
 */
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("/Users/evgenijdanilov/.npm/_npx/13ab0715f9f30c2e/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const AGENT_OUT = path.resolve(process.env.HOME, "gemini/agent1_out");
const SHOTS = (() => {
  const i = process.argv.indexOf("--shots");
  return i === -1 ? path.join(AGENT_OUT, "screenshots") : process.argv[i + 1];
})();
const PORT = 8815;
const MP3 = fs.readFileSync(path.join(ROOT, "tests", "fixtures", "tone.mp3"));

function unpack() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adk-ext-"));
  execFileSync("unzip", ["-q", path.join(ROOT, "downloads", "audio-dub-kombo-ext.zip"), "-d", dir]);
  const ext = path.join(dir, "audio-dub-kombo");
  /* The shipped manifest only matches the real video hosts, so the fixture on
     127.0.0.1 would never receive the content scripts. Add the local origin to
     the unpacked copy (test copy only — the distributed zip stays untouched). */
  const manifestPath = path.join(ext, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const cs of manifest.content_scripts || []) {
    cs.matches = (cs.matches || []).concat(["http://127.0.0.1/*", "http://localhost/*"]);
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return ext;
}

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let file = path.join(ROOT, url);
    if (file.endsWith("/")) file = path.join(file, "index.html");
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "content-type": path.extname(file) === ".html" ? "text/html; charset=utf-8" : "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(PORT, "127.0.0.1", () => r(server)));
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + extra : "")); }
};

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const extPath = unpack();
  const server = await serve();
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), "adk-dl-"));

  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "adk-profile-")), {
    channel: "chromium",
    headless: true,
    acceptDownloads: true,
    downloadsPath: downloads,
    args: [
      /* The dub path is only recognised on a Yandex host, so the media origin
         is aliased to one and answered by the local fixture server. No DNS,
         no network: Chromium resolves the alias itself. */
      "--host-resolver-rules=MAP audio.yandex.ru 127.0.0.1",
      "--disable-extensions-except=" + extPath,
      "--load-extension=" + extPath
    ]
  });

  /* Playwright cannot use ctx.route for extension pages, so the media host is
     answered by a second, tiny server and the URL is rewritten in the page. */
  const media = http.createServer((req, res) => {
    res.writeHead(200, {
      "content-type": "audio/mpeg",
      "content-length": String(MP3.length),
      "access-control-allow-origin": "*"
    });
    res.end(MP3);
  });
  await new Promise(r => media.listen(PORT + 1, "127.0.0.1", r));

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message)));

  await page.goto("http://127.0.0.1:" + PORT + "/tests/fixtures/watch.html", { waitUntil: "load" });
  await page.waitForFunction(() => document.getElementById("tone") && document.getElementById("tone").readyState >= 1);
  await page.waitForSelector("#adk-panel", { timeout: 15000 });

  const markers = await page.evaluate(() => {
    const p = document.getElementById("adk-panel");
    return {
      bridge: document.documentElement.dataset.adkExt || null,
      buttons: p ? p.querySelectorAll(".adk-btn").length : 0,
      parent: p && p.parentElement ? p.parentElement.id : null
    };
  });
  ok("расширение инжектирует панель", markers.buttons === 3, JSON.stringify(markers));
  ok("bridge.js поднял флаг в isolated world", markers.bridge === "1", markers.bridge);
  ok("панель под видео", markers.parent === "below", markers.parent);

  /* The stream URL lives on the media server, and the panel must pick it up
     from a real fetch() while the page is alive. */
  const status = await page.evaluate(async () => {
    const url = "http://audio.yandex.ru:" + (Number(location.port) + 1) + "/dub/audio.mp3?mime=audio%2Fmpeg";
    await fetch(url).then(r => r.arrayBuffer());
    const C = window.AudioDubCore;
    const list = C.rank([{ url: url }]);
    return { list: list, best: C.best(list, "dub") };
  });
  ok("поток поймал сам расширенный fetch-хук", status.best && status.best.kind === "dub", JSON.stringify(status));

  const before = fs.readdirSync(downloads).length;
  /* Playwright stores CDP downloads under a generated name, so the name the
     extension chose is read from the download event (and from the panel). */
  let suggested = "";
  page.on("download", d => { suggested = d.suggestedFilename(); });
  await page.click("#adk-panel [data-dub]");
  let got = null;
  for (let i = 0; i < 40 && !got; i += 1) {
    await page.waitForTimeout(250);
    const files = fs.readdirSync(downloads).filter(f => !f.endsWith(".crdownload"));
    if (files.length > before) got = files[files.length - 1];
  }
  ok("chrome.downloads сохранил файл", !!got, fs.readdirSync(downloads).join(","));
  if (got) {
    const size = fs.statSync(path.join(downloads, got)).size;
    ok("файл не пустой и совпадает с потоком", size === MP3.length, size + " vs " + MP3.length);
  }

  await page.waitForFunction(
    () => /Готово/.test(document.querySelector("#adk-panel [data-status]").textContent || ""),
    null,
    { timeout: 20000 }
  ).catch(() => {});
  const text = (await page.textContent("#adk-panel [data-status]")).trim();
  ok("панель отчиталась о готовом файле", /Готово/.test(text), text);
  const named = suggested || (text.match(/Готово:\s*(.+?)\s*(?:·|$)/) || [])[1] || "";
  ok("имя файла с расширением mp3", /\.mp3$/i.test(named), named || "no name");
  await page.screenshot({ path: path.join(SHOTS, "ext-01-chrome-download.png") });

  await ctx.close();
  media.close();
  server.close();
  console.log("\n" + pass + " ok, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
