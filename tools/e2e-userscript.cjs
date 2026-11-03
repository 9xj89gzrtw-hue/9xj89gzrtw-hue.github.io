/* Browser test for the Audio Dub Kombo userscript.
 *
 * Injects the built userscript into a page that looks like a watch page, then
 * drives the three buttons for real: two downloads land as files, two marks
 * open Studio with the timecodes encoded, and a TW1 key turns the panel Pro.
 *
 *   node tools/e2e-userscript.cjs [--shots <dir>]
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("/Users/evgenijdanilov/.npm/_npx/13ab0715f9f30c2e/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const AGENT_OUT = path.resolve(process.env.HOME, "gemini/agent1_out");
const KEYS = path.join(AGENT_OUT, "license_keys");
const shotsArg = process.argv.indexOf("--shots");
const SHOTS = shotsArg === -1 ? path.join(AGENT_OUT, "screenshots") : process.argv[shotsArg + 1];
const PORT = 8818;

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".mp3": "audio/mpeg", ".png": "image/png", ".svg": "image/svg+xml" };

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let file = path.join(ROOT, url);
    if (file.endsWith("/")) file = path.join(file, "index.html");
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    const size = fs.statSync(file).size;
    const type = TYPES[path.extname(file)] || "application/octet-stream";
    /* Media needs byte ranges: without them Chromium cannot seek a paused
       track, currentTime stays 0 and the timecode test would be meaningless. */
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(206, {
        "content-type": type,
        "content-range": "bytes " + start + "-" + end + "/" + size,
        "accept-ranges": "bytes",
        "content-length": String(end - start + 1)
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { "content-type": type, "content-length": String(size), "accept-ranges": "bytes" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(PORT, "127.0.0.1", () => r(server)));
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + extra : "")); }
};

const DUB_URL = "https://strm.yandex.net/video-translation/dub/abc/audio.mp3?mime=audio%2Fmpeg&clen=420000";
const AUDIO_URL = "https://rr3---sn-test.googlevideo.com/videoplayback?itag=140&mime=audio%2Fmp4&clen=3100000";
const key = fs.readFileSync(path.join(KEYS, "audio-dub-studio.txt"), "utf8").split("\n").find(l => l.startsWith("TW1-"));

const USCRIPT = fs.readFileSync(path.join(ROOT, "downloads", "audio-dub-tools.user.js"), "utf8");
const MP3 = fs.readFileSync(path.join(ROOT, "tests", "fixtures", "tone.mp3"));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  const base = "http://127.0.0.1:" + PORT;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1120, height: 1000 }, deviceScaleFactor: 2, acceptDownloads: true, locale: "ru-RU" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message)));

  /* The two media hosts are faked with a real MP3 body and permissive CORS,
     because a download is only proven when a file actually arrives. */
  for (const origin of ["https://strm.yandex.net/**", "https://rr3---sn-test.googlevideo.com/**"]) {
    await ctx.route(origin, route => route.fulfill({
      status: 200,
      contentType: "audio/mpeg",
      headers: { "access-control-allow-origin": "*", "content-length": String(MP3.length) },
      body: MP3
    }));
  }

  await page.addInitScript(([dub, audio]) => {
    window.__AUDIO_DUB_TEST__ = [dub, audio];
  }, [DUB_URL, AUDIO_URL]);

  await page.goto(base + "/tests/fixtures/watch.html", { waitUntil: "load" });
  await page.waitForFunction(() => document.getElementById("tone") && document.getElementById("tone").readyState >= 1);
  await page.addScriptTag({ content: USCRIPT });
  await page.waitForSelector("#adk-panel", { timeout: 10000 });

  console.log("панель");
  const inside = await page.evaluate(() => {
    const p = document.getElementById("adk-panel");
    return { parent: p.parentElement.id, buttons: p.querySelectorAll(".adk-btn").length, bg: getComputedStyle(p).backgroundColor };
  });
  ok("панель встроена под видео (#below)", inside.parent === "below", inside.parent);
  ok("три кнопки", inside.buttons === 3, inside.buttons);
  ok("панель светлая", inside.bg === "rgb(255, 255, 255)", inside.bg);
  const labels = await page.$$eval("#adk-panel .adk-btn", els => els.map(e => e.textContent.trim()));
  ok("кнопка озвучки", /озвучк/i.test(labels[0]), labels[0]);
  ok("кнопка оригинального звука", /оригинальн/i.test(labels[1]), labels[1]);
  ok("кнопка метки и Studio", /Studio/.test(labels[2]), labels[2]);
  await page.screenshot({ path: path.join(SHOTS, "kombo-01-panel.png") });

  console.log("скачивание озвучки");
  const dl1 = page.waitForEvent("download", { timeout: 20000 });
  await page.click("#adk-panel [data-dub]");
  const got1 = await dl1;
  ok("файл озвучки получен", /озвучка/i.test(got1.suggestedFilename()), got1.suggestedFilename());
  ok("расширение mp3", /\.mp3$/.test(got1.suggestedFilename()), got1.suggestedFilename());
  const path1 = await got1.path();
  ok("вес файла совпадает с потоком", path1 && fs.statSync(path1).size === MP3.length, path1 && fs.statSync(path1).size);
  await page.waitForFunction(() => /Готово/.test(document.querySelector("#adk-panel [data-status]").textContent), null, { timeout: 15000 });
  const status1 = (await page.textContent("#adk-panel [data-status]")).trim();
  ok("статус называет источник", /yandex\.net/.test(status1), status1);
  await page.screenshot({ path: path.join(SHOTS, "kombo-02-dub-downloaded.png") });

  console.log("скачивание оригинального звука");
  const dl2 = page.waitForEvent("download", { timeout: 20000 });
  await page.click("#adk-panel [data-audio]");
  const got2 = await dl2;
  ok("файл звука получен", /звук/i.test(got2.suggestedFilename()), got2.suggestedFilename());
  ok("m4a из itag 140", /\.m4a$/.test(got2.suggestedFilename()), got2.suggestedFilename());

  console.log("метки и Studio");
  const stamps = await page.evaluate(() => {
    const a = document.getElementById("tone");
    a.currentTime = Number((a.duration * 0.2).toFixed(2));
    const first = a.currentTime;
    a.currentTime = Number((a.duration * 0.7).toFixed(2));
    return { duration: a.duration, in: first, out: a.currentTime };
  });
  await page.evaluate(() => { document.getElementById("tone").currentTime = Number((document.getElementById("tone").duration * 0.2).toFixed(2)); });
  await page.waitForTimeout(200);
  const popupPromise = ctx.waitForEvent("page", { timeout: 15000 });
  await page.keyboard.press("m");
  await page.waitForFunction(() => /Начало клипа/.test(document.querySelector("#adk-panel [data-status]").textContent), null, { timeout: 5000 });
  await page.evaluate(() => { document.getElementById("tone").currentTime = Number((document.getElementById("tone").duration * 0.7).toFixed(2)); });
  await page.waitForTimeout(200);
  await page.keyboard.press("m");
  const popup = await popupPromise;
  const studioHref = popup.url();
  ok("Studio открылся из панели", studioHref.startsWith("https://9xj89gzrtw-hue.github.io/audio-dub-extractor/studio.html#"), studioHref.slice(0, 90));

  const payload = decodeURIComponent(studioHref.split("#clips=")[1].split("&")[0]);
  const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  ok("в ссылке один клип", decoded.items.length === 1, JSON.stringify(decoded.items));
  const mmss = t => {
    const m = Math.floor(t / 60), sec = t - m * 60;
    return String(m).padStart(2, "0") + ":" + sec.toFixed(3).padStart(6, "0");
  };
  ok("начало совпадает с таймкодом плеера", decoded.items[0].in === mmss(stamps.in), decoded.items[0].in + " vs " + mmss(stamps.in));
  ok("конец совпадает с таймкодом плеера", decoded.items[0].out === mmss(stamps.out), decoded.items[0].out + " vs " + mmss(stamps.out));
  ok("имя файла из заголовка видео", /часть 1/.test(decoded.items[0].name), decoded.items[0].name);
  await popup.close();

  console.log("Studio принимает хеш");
  const studio = await ctx.newPage();
  await studio.goto(base + "/audio-dub-extractor/studio.html#" + studioHref.split("#")[1], { waitUntil: "load" });
  await studio.waitForTimeout(400);
  const rowText = (await studio.textContent("#rows")).replace(/\s+/g, " ").trim();
  ok("клип попал в очередь Studio", /часть 1/.test(rowText), rowText.slice(0, 90));
  /* in/out live in <input value>, not in the row text. */
  const cells = await studio.$$eval("#rows input.field.tc", els => els.map(e => e.value));
  const short = t => mmss(t).replace(/\.\d{3}$/, "");
  ok("границы в полях in/out", cells.includes(short(stamps.in)) && cells.includes(short(stamps.out)), JSON.stringify(cells));
  await studio.screenshot({ path: path.join(SHOTS, "kombo-03-studio-queue.png") });

  console.log("Studio активирует ключ из ссылки");
  /* A buyer who pasted the key in the panel must not type it again in Studio:
     studio.html redeems the `key=` part of the hash through unlock.js. A fresh
     context is required — the shared one would already carry the licence. */
  const freshCtx = await browser.newContext({ viewport: { width: 1180, height: 900 }, locale: "ru-RU" });
  const fresh = await freshCtx.newPage();
  await fresh.goto(base + "/audio-dub-extractor/studio.html#" + studioHref.split("#")[1] + "&key=" + encodeURIComponent(key), { waitUntil: "load" });
  await fresh.waitForFunction(() => (document.getElementById("mode-pill").textContent || "").trim() === "Pro", null, { timeout: 8000 })
    .catch(() => {});
  const freshPill = (await fresh.textContent("#mode-pill")).trim();
  ok("Studio поднял Pro из ключа в ссылке", freshPill === "Pro", freshPill);
  const freshRows = (await fresh.textContent("#rows")).replace(/\s+/g, " ").trim();
  ok("клипы при этом не потерялись", /часть 1/.test(freshRows), freshRows.slice(0, 80));
  await fresh.screenshot({ path: path.join(SHOTS, "kombo-05-studio-key.png") });
  await freshCtx.close();

  console.log("Pro из панели");
  await page.bringToFront();
  await page.fill("#adk-panel [data-pro] input", key);
  await page.click("#adk-panel [data-pro] button");
  await page.waitForFunction(() => /Pro активен/.test(document.querySelector("#adk-panel [data-status]").textContent), null, { timeout: 8000 });
  ok("ключ принят панелью", true);
  ok("пилюля переключилась на Pro", (await page.textContent("#adk-panel [data-pill]")).trim() === "Pro");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("unlock:audio-dub-studio") || "null"));
  ok("лицензия в localStorage площадки", stored && /^license:TW1-AUDIO-/.test(stored.hash), JSON.stringify(stored));
  await page.screenshot({ path: path.join(SHOTS, "kombo-04-pro-key.png") });

  await page.reload({ waitUntil: "load" });
  await page.addScriptTag({ content: USCRIPT });
  await page.waitForSelector("#adk-panel");
  ok("Pro пережил перезагрузку", (await page.textContent("#adk-panel [data-pill]")).trim() === "Pro");

  console.log("прокрутка ключа в Studio");
  const popup2Promise = ctx.waitForEvent("page", { timeout: 15000 });
  await page.keyboard.press("m");
  await page.waitForTimeout(150);
  await page.keyboard.press("m");
  const popup2 = await popup2Promise;
  ok("ключ передан в Studio", popup2.url().includes("&key=TW1-AUDIO-"), popup2.url().slice(-60));
  await popup2.close();

  const realErrors = errors.filter(e => !/Failed to load resource|net::ERR|ERR_NAME_NOT_RESOLVED/i.test(e));
  ok("нет JS-ошибок панели", realErrors.length === 0, realErrors.join(" | "));

  await browser.close();
  server.close();
  console.log("\n" + pass + " ok, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
