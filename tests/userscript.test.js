/* Unit tests for the Audio Dub Kombo core.
 *
 * The panel is DOM code, but everything that decides *what* gets downloaded and
 * *what* ends up in Studio is a pure function. Those are tested here, so a
 * wrong itag or a broken base64url does not reach a buyer's browser.
 *
 *   node tests/userscript.test.js
 */
const fs = require("fs");
const path = require("path");

/* Minimal localStorage so licence storage can be exercised without a browser. */
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};

const C = require("../audio-dub-kombo/core.js");
const V = require("../assets/verify.js");

const OUT = path.resolve(process.env.HOME, "gemini/agent1_out");
const keysOf = p => fs.readFileSync(path.join(OUT, "license_keys", p + ".txt"), "utf8")
  .split("\n").filter(l => l.startsWith("TW1-"));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  → " + extra : "")); }
}

console.log("таймкод");
ok("0 секунд", C.tc(0) === "00:00.000");
ok("миллисекунды", C.tc(83.456) === "01:23.456");
ok("часы появляются", C.tc(3723.25) === "01:02:03.250");
ok("обратный разбор", Math.abs(C.parseTc("01:02:03.250") - 3723.25) < 1e-9);
ok("запятая как разделитель", Math.abs(C.parseTc("1:02,5") - 62.5) < 1e-9);
ok("минуты 60 не бывает", C.parseTc("1:75") === null);
ok("пустая строка", C.parseTc("  ") === null);

console.log("метки и проект");
const marks = [{ at: 10 }, { at: 22.5 }, { at: 40 }, { at: 51 }, { at: 70 }];
const p = C.pairs(marks);
ok("две полные пары, хвост отброшен", p.length === 2, p.length);
ok("границы верные", p[0].start === 10 && p[0].end === 22.5);
ok("вторая пара", p[1].start === 40 && p[1].end === 51);
ok("перевёрнутая пара отброшена", C.pairs([{ at: 5 }, { at: 1 }]).length === 0);
ok("пустой список", C.pairs([]).length === 0);
ok("null не падает", C.pairs(null).length === 0);

const proj = C.buildProject({ marks: marks, title: 'Клип: "тест"/1', url: "https://example.test/w?v=1" });
ok("app и версия", proj.app === "audio-dub-extractor" && proj.version === 1);
ok("две записи", proj.items.length === 2);
ok("in/out в формате Studio", proj.items[0].in === "00:10.000" && proj.items[0].out === "00:22.500", proj.items[0].in);
ok("запрещённые символы вычищены", !/[\\/:*?"<>|]/.test(proj.items[0].name), proj.items[0].name);
ok("длительность клипов посчитана", Math.abs(proj.clipSeconds - 23.5) < 1e-9, proj.clipSeconds);

console.log("handoff в Studio");
const url = C.studioUrl(proj, "TW1-AUDIO-ABC123-" + "a".repeat(86));
ok("адрес Studio", url.startsWith(C.STUDIO_URL + "#"));
ok("ключ в хеше", url.includes("&key=TW1-AUDIO-"));
const back = C.readStudioHash(url.slice(url.indexOf("#")));
ok("хеш читается обратно", back && back.project && back.project.items.length === 2);
ok("ключ читается обратно", back.key.startsWith("TW1-AUDIO-"));
ok("записи совпадают", back.project.items[1].out === "00:51.000", back.project.items[1].out);
ok("пустой хеш -> null", C.readStudioHash("") === null && C.readStudioHash("#") === null);
ok("битый base64 не бросает исключение", (() => {
  const r = C.readStudioHash("#clips=%%%");
  return r === null || typeof r.error === "string";
})());
ok("base64url без + и /", !/[+/=]/.test(C.b64uEncode(JSON.stringify({ a: "ююю?" }))));

console.log("классификация потоков");
const dub = C.classify("https://strm.yandex.net/video-translation/dub/abc/audio.mp3?mime=audio%2Fmpeg");
ok("озвучка Яндекса распознана", dub && dub.kind === "dub", JSON.stringify(dub));
ok("расширение mp3", dub && dub.ext === "mp3", dub && dub.ext);
ok("score озвучки выше звука", dub && dub.score >= 1000);

const yaPlain = C.classify("https://translate.yandex.net/api/tts/stream/xyz");
ok("yandex + tts = озвучка", yaPlain && yaPlain.kind === "dub");

const ytAudio = C.classify("https://rr3---sn-x.googlevideo.com/videoplayback?itag=140&mime=audio%2Fmp4&clen=3500000");
ok("YouTube audio itag 140", ytAudio && ytAudio.kind === "audio", JSON.stringify(ytAudio));
ok("YouTube m4a", ytAudio && ytAudio.ext === "m4a", ytAudio && ytAudio.ext);

const ytOpus = C.classify("https://rr1---sn-x.googlevideo.com/videoplayback?itag=251&mime=audio%2Fwebm");
ok("YouTube Opus", ytOpus && ytOpus.kind === "audio" && ytOpus.ext === "webm", JSON.stringify(ytOpus));

const ytVideo = C.classify("https://rr1---sn-x.googlevideo.com/videoplayback?itag=137&mime=video%2Fmp4");
ok("видеопоток YouTube не выдаётся за звук", ytVideo === null, JSON.stringify(ytVideo));

ok("HLS отклонён", C.classify("https://cdn.example.test/live/index.m3u8") === null);
ok("картинка не аудио", C.classify("https://i.ytimg.com/vi/abc/hqdefault.jpg") === null);
ok("js не аудио", C.classify("https://www.youtube.com/s/player/base.js") === null);
ok("blob: отброшен", C.classify("blob:https://www.youtube.com/1234") === null);
ok("не ссылка", C.classify("") === null && C.classify(null) === null);

const vkAudio = C.classify("https://psv4.userapi.com/s/v1/audios/xyz/track.mp3");
ok("VK audio", vkAudio && vkAudio.kind === "audio", JSON.stringify(vkAudio));

const vkMuxed = C.classify("https://vk.com/video/720p.mp4");
ok("VK mp4 помечен как muxed", vkMuxed && vkMuxed.kind === "muxed", JSON.stringify(vkMuxed));

console.log("выбор лучшего");
const ranked = C.rank([
  { url: "https://x.test/clip.mp3" },
  { url: "https://strm.yandex.net/dub/audio.mp3" },
  { url: "https://rr1.googlevideo.com/videoplayback?itag=140&mime=audio%2Fmp4" },
  { url: "https://x.test/pic.png" }
]);
ok("озвучка первая", ranked[0].kind === "dub", ranked[0] && ranked[0].kind);
ok("мусор не попал", ranked.length === 3, ranked.length);
ok("дубликаты схлопнуты", C.rank([{ url: "https://a.test/x.mp3" }, { url: "https://a.test/x.mp3" }]).length === 1);
ok("best(audio) берёт m4a", C.best(ranked, "audio").ext === "m4a");
ok("best(dub) находит озвучку", C.best(ranked, "dub").kind === "dub");
ok("без музыки best = null", C.best([], "audio") === null);
const muxedOnly = C.rank([{ url: "https://vk.com/v/1.mp4" }]);
const fallback = C.best(muxedOnly, "audio");
ok("muxed подставляется как fallback", fallback && fallback.fallback === true, JSON.stringify(fallback));

console.log("имена файлов");
ok("m4a по умолчанию", C.filenameFor("audio", "Название", "m4a") === "Название — звук.m4a");
ok("озвучка помечена", C.filenameFor("dub", "Видео", "mp3").includes("озвучка"));
ok("пустое имя -> video", C.filenameFor("audio", "", "m4a") === "video — звук.m4a");
ok("слэши вычищены", !C.filenameFor("audio", "a/b:c", "m4a").includes("/"));
ok("mime -> ext", C.extFromMime("audio/mp4; codecs=mp4a.40.2") === "m4a" && C.extFromMime("audio/mpeg") === "mp3");

console.log("площадки");
ok("youtube", C.siteOf({ hostname: "www.youtube.com", pathname: "/watch", protocol: "https:" }).id === "youtube");
ok("youtu.be", C.siteOf({ hostname: "youtu.be", pathname: "/x", protocol: "https:" }).id === "youtube");
ok("vk", C.siteOf({ hostname: "vk.com", pathname: "/video", protocol: "https:" }).id === "vk");
ok("vkvideo", C.siteOf({ hostname: "vkvideo.ru", pathname: "/video", protocol: "https:" }).id === "vk");
ok("rutube", C.siteOf({ hostname: "rutube.ru", pathname: "/video/1", protocol: "https:" }).id === "rutube");
ok("чужой сайт отключён", C.siteOf({ hostname: "example.com", pathname: "/", protocol: "https:" }) === null);
ok("у площадки есть светлый акцент", /^#[0-9a-f]{6}$/i.test(C.siteOf({ hostname: "www.youtube.com", pathname: "/", protocol: "https:" }).accent));

console.log("лицензия из панели");
(async () => {
  const key = keysOf("audio-dub-studio")[0];
  const good = await C.verifyLicense(key, { product: C.PRODUCT });
  ok("ключ принят", good.valid === true, JSON.stringify(good));
  ok("код AUDIO", good.code === "AUDIO");
  ok("универсальный ключ тоже", (await C.verifyLicense(keysOf("all-in-one")[0], { product: C.PRODUCT })).valid);
  ok("чужой продукт отклонён", (await C.verifyLicense(keysOf("newsflow")[0], { product: C.PRODUCT })).error === "product");
  ok("подпись не сходится", (await C.verifyLicense(key.slice(0, -2) + "aa", { product: C.PRODUCT })).error === "signature");

  ok("до активации Pro нет", C.storedLicense(C.PRODUCT) === null);
  C.storeLicense(C.PRODUCT, good);
  const rec = C.storedLicense(C.PRODUCT);
  ok("ключ сохранён в localStorage площадки", rec && rec.kind === "license" && rec.code === "AUDIO", JSON.stringify(rec));
  ok("hash помечен как license", /^license:TW1-AUDIO-/.test(rec.hash));

  /* The panel embeds the same verifier; a drift here would mean YouTube and
     the site disagree about a key the buyer paid for. */
  let diff = 0;
  for (const k of [key, keysOf("all-in-one")[0], "TW1-AUDIO-ABC"]) {
    const a = await V.verifyLicense(k, { product: "audio-dub-studio" });
    const b = await C.verifyLicense(k, { product: "audio-dub-studio" });
    if (a.valid !== b.valid || a.error !== b.error) diff++;
  }
  ok("core и verify.js совпадают", diff === 0, diff);
  ok("публичный ключ во всех трёх копиях один",
    C.LICENSE_PUBLIC_KEY.x === V.LICENSE_PUBLIC_KEY.x &&
    C.LICENSE_PUBLIC_KEY.y === V.LICENSE_PUBLIC_KEY.y);

  console.log("сборка");
  const bundle = fs.readFileSync(path.join(__dirname, "..", "downloads", "audio-dub-tools.user.js"), "utf8");
  ok("userscript собран", bundle.length > 20000, bundle.length);
  ok("есть @match на VK", /@match\s+https:\/\/vk\.com/.test(bundle));
  ok("есть @match на Rutube", /@match\s+https:\/\/rutube\.ru/.test(bundle));
  ok("три кнопки в разметке", /data-dub/.test(bundle) && /data-audio/.test(bundle) && /data-mark/.test(bundle));
  ok("никаких эмодзи в скрипте", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(bundle));
  ok("нет fetch к нашему серверу за лицензией", !/api\/license|verify\.php/.test(bundle));

  console.log("\n" + pass + " ok, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
