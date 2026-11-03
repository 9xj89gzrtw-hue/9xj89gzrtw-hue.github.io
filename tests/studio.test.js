/* Tests for the Audio Dub Extractor studio core: timecode parsing, clip
 * slicing, WAV/BWF writing and ID3v2.3 tagging.
 * node tests/studio.test.js
 */
const S = require("../audio-dub-extractor/studio-core.js");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  → " + extra : "")); }
}
function throws(name, fn, re) {
  try { fn(); fail++; console.log("  FAIL " + name + " (no error thrown)"); }
  catch (e) {
    const good = !re || re.test(e.message);
    if (good) { pass++; console.log("  ok   " + name + "  → \"" + e.message.slice(0, 60) + "…\""); }
    else { fail++; console.log("  FAIL " + name + " (wrong message: " + e.message + ")"); }
  }
}
const ascii = (bytes, start, len) => String.fromCharCode.apply(null, Array.from(bytes.subarray(start, start + len)));
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

console.log("timecode");
ok("plain seconds", S.parseTimecode("83") === 83);
ok("m:ss", S.parseTimecode("1:23") === 83);
ok("h:mm:ss.mmm", Math.abs(S.parseTimecode("01:02:03.250") - 3723.25) < 1e-9, S.parseTimecode("01:02:03.250"));
ok("comma as the decimal mark", Math.abs(S.parseTimecode("1:02:03,5") - 3723.5) < 1e-9);
ok("minutes above 59 are refused", S.parseTimecode("1:75") === null);
ok("empty is refused", S.parseTimecode("  ") === null);
ok("negative number is refused", S.parseTimecode(-3) === null);
ok("garbage is refused", S.parseTimecode("1:2:3:4") === null);
ok("formats back", S.formatTimecode(83.5) === "01:23.500", S.formatTimecode(83.5));
ok("hours appear when needed", S.formatTimecode(3723.25) === "01:02:03.250", S.formatTimecode(3723.25));
ok("without ms", S.formatTimecode(3723.25, false) === "01:02:03");

console.log("clip window");
const c1 = S.clampClip("10", "20", 120);
ok("in/out kept", c1.start === 10 && c1.end === 20 && c1.length === 10, JSON.stringify(c1));
const c2 = S.clampClip("100", "500", 120);
ok("out clamped to the file", c2.start === 100 && c2.end === 120, JSON.stringify(c2));
const c3 = S.clampClip("20", "10", 120);
ok("reversed window is normalised", c3.start === 10 && c3.end === 20);
ok("empty window is refused", S.clampClip("10", "10", 120) === null);
ok("out past the file end and no duration still works", S.clampClip(0, 3) .length === 3);
const c4 = S.clampClip("0", "", 5);
ok("blank out means to the end", c4.start === 0 && c4.end === 5);

console.log("slicing");
const ramp = Float32Array.from([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
const cut = S.sliceChannels([ramp], 8, 0.25, 0.75)[0];
ok("start is floored to a sample", cut.length === 4, cut.length);
ok("first sample is in the window", Math.abs(cut[0] - 0.2) < 1e-6, cut[0]);
ok("last sample is in the window", Math.abs(cut[3] - 0.5) < 1e-6, cut[3]);
ok("mono stays mono", S.sliceChannels([ramp], 8, 0, 1).length === 1);
ok("stereo stays stereo", S.sliceChannels([ramp, ramp], 8, 0, 1).length === 2);
throws("empty clip refuses", () => S.sliceChannels([ramp], 8, 2, 2), /empty/);

console.log("wav");
const left = Float32Array.from([0, 0.5, -0.5, 1]);
const right = Float32Array.from([0, -0.25, 0.25, -1]);
const wav = S.encodeWav({ channels: [left, right], sampleRate: 8000 });
ok("RIFF magic", ascii(wav, 0, 4) === "RIFF");
ok("WAVE magic", ascii(wav, 8, 4) === "WAVE");
ok("fmt at 12", ascii(wav, 12, 4) === "fmt ");
ok("PCM format", wav[20] === 1 && wav[21] === 0);
ok("two channels", wav[22] === 2);
ok("sample rate", u32(wav, 24) === 8000);
ok("byte rate", u32(wav, 28) === 8000 * 2 * 2);
ok("block align", wav[32] === 4 && wav[33] === 0);
ok("16 bits", wav[34] === 16);
ok("data chunk", ascii(wav, 36, 4) === "data");
ok("data size", u32(wav, 40) === 4 * 2 * 2, u32(wav, 40));
ok("file size is 44 + data", wav.length === 44 + 16, wav.length);
ok("riff size is file minus 8", u32(wav, 4) === wav.length - 8);
const dv = new DataView(wav.buffer);
ok("0.5 → 16383", dv.getInt16(48, true) === 16383, dv.getInt16(48, true));
ok("−0.5 → −16384", dv.getInt16(52, true) === -16384, dv.getInt16(52, true));
ok("1.0 clamps to the int16 ceiling", dv.getInt16(56, true) === 32767, dv.getInt16(56, true));
ok("−1.0 clamps to the int16 floor", dv.getInt16(58, true) === -32768, dv.getInt16(58, true));

console.log("wav + BWF bext");
const bext = S.encodeWav({
  channels: [left], sampleRate: 8000,
  bext: { timeReference: 8000 * 3723, description: "episode 12", originator: "Audio Dub Extractor", date: "2026-11-03", time: "12:00:00" }
});
ok("bext chunk follows fmt", ascii(bext, 36, 4) === "bext", ascii(bext, 36, 4));
ok("bext size is the 602-byte EBU block", u32(bext, 40) === 602, u32(bext, 40));
ok("originator is stored", ascii(bext, 44 + 256, 12) === "Audio Dub Ex");
ok("date is stored", ascii(bext, 44 + 320, 10) === "2026-11-03");
ok("time is stored", ascii(bext, 44 + 330, 8) === "12:00:00");
ok("version is 1", bext[44 + 346] === 1);
ok("time reference low word", u32(bext, 44 + 338) === 8000 * 3723, u32(bext, 44 + 338));
ok("time reference high word is zero here", u32(bext, 44 + 342) === 0);
ok("data was shifted, not overwritten", ascii(bext, 44 + 602, 4) === "data");
ok("bext grows the RIFF size", u32(bext, 4) === bext.length - 8);
const big = S.encodeWav({ channels: [left], sampleRate: 8000, bext: { timeReference: 4294967296 + 5 } });
ok("time reference above 2^32 splits into the high word", u32(big, 44 + 342) === 1, u32(big, 44 + 342));

console.log("id3");
const tag = S.id3v23({ title: "Клип", timecode: "00:01:23.450-00:02:03.100", source: "https://youtu.be/x" });
ok("ID3 magic", ascii(tag, 0, 3) === "ID3");
ok("version 2.3", tag[3] === 3 && tag[4] === 0);
ok("flags are clear", tag[5] === 0);
const claimed = (tag[6] << 21) | (tag[7] << 14) | (tag[8] << 7) | tag[9];
ok("size field is synchsafe and equals the body", claimed === tag.length - 10, claimed + " vs " + (tag.length - 10));
const back = S.readTxxx(tag);
ok("timecode reads back", back.TIMECODE === "00:01:23.450-00:02:03.100", back.TIMECODE);
ok("source reads back", back.SOURCE === "https://youtu.be/x", back.SOURCE);
ok("title frame is present", ascii(tag, 10, 4) === "TIT2", ascii(tag, 10, 4));

const commented = S.id3v23({ comment: "Clip 00:00.500–00:01.500" });
ok("a note is written as COMM, not TCOM (composer)", ascii(commented, 10, 4) === "COMM", ascii(commented, 10, 4));
ok("COMM carries the language", ascii(commented, 21, 3) === "eng", ascii(commented, 21, 3));

console.log("tagging an mp3");
const audio = Uint8Array.from([0xff, 0xfb, 0x90, 0x64, 0x11, 0x22]);
const tagged = S.tagMp3(audio, { title: "a", timecode: "00:00:01.000-00:00:02.000" });
ok("tag is first", ascii(tagged, 0, 3) === "ID3");
ok("audio bytes survive at the end", tagged[tagged.length - 6] === 0xff && tagged[tagged.length - 5] === 0xfb);
ok("length is tag plus audio", tagged.length === S.id3v23({ title: "a", timecode: "00:00:01.000-00:00:02.000" }).length + audio.length);
const twice = S.tagMp3(tagged, { title: "b", timecode: "00:00:03.000-00:00:04.000" });
ok("re-tagging drops the old tag instead of stacking", twice.length === tagged.length + (S.id3v23({ title: "b", timecode: "00:00:03.000-00:00:04.000" }).length - S.id3v23({ title: "a", timecode: "00:00:01.000-00:00:02.000" }).length));
ok("only the new timecode is readable", S.readTxxx(twice).TIMECODE === "00:00:03.000-00:00:04.000", JSON.stringify(S.readTxxx(twice)));
ok("empty file is refused", (() => { try { S.tagMp3(new Uint8Array(0), {}); return false; } catch (e) { return true; } })());
ok("mpeg rate is read from the frame header", S.mp3SampleRate(audio) === 44100, S.mp3SampleRate(audio));
ok("mpeg rate is found after an id3 tag", S.mp3SampleRate(tagged) === 44100, S.mp3SampleRate(tagged));
ok("mpeg rate of a 48 kHz header", S.mp3SampleRate(Uint8Array.from([0xff, 0xfb, 0x94, 0x64])) === 48000, S.mp3SampleRate(Uint8Array.from([0xff, 0xfb, 0x94, 0x64])));
ok("mpeg rate of garbage is null", S.mp3SampleRate(Uint8Array.from([1, 2, 3, 4])) === null);
ok("existing tag length is measured", S.existingId3Length(tagged) === tagged.length - audio.length, S.existingId3Length(tagged));

console.log("project files");
const proj = S.makeProject([{ name: "a.mp3", in: "1:23", out: "2:03", source: "https://x" }]);
ok("app marker", proj.app === "audio-dub-extractor" && proj.version === 1);
ok("item is normalised", proj.items[0].in === "01:23.000" && proj.items[0].out === "02:03.000", JSON.stringify(proj.items[0]));
const parsed = S.parseProject(JSON.stringify(proj), 10);
ok("roundtrip start", parsed[0].in === 83 && parsed[0].out === 123, JSON.stringify(parsed[0]));
throws("foreign json is refused", () => S.parseProject('{"app":"other"}'), /не файл проекта/);
throws("broken json is refused", () => S.parseProject("not json"), /не JSON/);
throws("too many items are refused", () => S.parseProject(proj, 0.5), /лимит/);
throws("bad timecode is refused", () => S.parseProject(JSON.stringify({ app: "audio-dub-extractor", items: [{ name: "x", in: "nope", out: "1" }] })), /нечитаемое начало/);
ok("free cap is 2 files", S.parseProject(proj, S.MAX_FILES_FREE).length === 1);
throws("free cap applies", () => S.parseProject(JSON.stringify({ app: "audio-dub-extractor", items: [{ name: "a", in: "0", out: "1" }, { name: "b", in: "0", out: "1" }, { name: "c", in: "0", out: "1" }] }), S.MAX_FILES_FREE), /лимит/);

console.log("output names");
ok("extension is replaced", S.outputName("My Track.mp3", 83, 123) === "My Track__01-23--02-03.wav", S.outputName("My Track.mp3", 83, 123));
ok("unsafe characters are removed", S.outputName('a/b:c*?"<>|.mp3', 0, 1) === "a_b_c___00-00--00-01.wav", S.outputName('a/b:c*?"<>|.mp3', 0, 1));
ok("empty name falls back", S.outputName("", 0, 1).startsWith("clip__"));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
