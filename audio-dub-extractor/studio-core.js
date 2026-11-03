/* Audio Dub Extractor — Studio core.
 *
 * Pure functions only: no DOM, no fetch, no audio hardware. The page uses them
 * in the browser, tests/studio.test.js uses them in Node, so the code that
 * writes a clip is the code that gets checked.
 *
 * Two exports carry the "timecode" promise, and both are standards rather than
 * a private JSON sidecar:
 *   - WAV gets a Broadcast Wave `bext` chunk whose TimeReference counts samples
 *     since midnight (EBU Tech 3285);
 *   - MP3 gets an ID3v2.3 tag with TXXX frames for the clip window, because
 *     ID3v2.3 is the version every tagger still reads.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AudioDubStudio = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_FILES_FREE = 2;
  const MAX_FILES_PRO = 200;
  const MAX_CLIP_FREE = 30; // seconds

  /* ---------- timecode ---------- */

  /** "83", "1:23", "01:02:03.250", "1:02:03,5" → seconds. Null if unreadable. */
  function parseTimecode(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value >= 0 ? value : null;
    const raw = String(value == null ? "" : value).trim().replace(",", ".");
    if (!raw) return null;
    if (!/^\d+(\.\d+)?(:\d{1,2}(\.\d+)?){0,2}$/.test(raw)) return null;
    const parts = raw.split(":").map(Number);
    if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
    let seconds = 0;
    for (const part of parts) seconds = seconds * 60 + part;
    // "1:75" is not a timecode; minutes and seconds run 0..59.
    for (let i = 1; i < parts.length; i++) if (parts[i] >= 60) return null;
    return seconds;
  }

  /** Seconds → "MM:SS.mmm", or "HH:MM:SS.mmm" from an hour up. */
  function formatTimecode(seconds, withMs) {
    const total = Number(seconds);
    if (!Number.isFinite(total) || total < 0) return "--:--";
    const ms = Math.round(total * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const milli = ms % 1000;
    const two = (n) => String(n).padStart(2, "0");
    const base = (h ? two(h) + ":" : "") + two(m) + ":" + two(s);
    return withMs === false ? base : base + "." + String(milli).padStart(3, "0");
  }

  /**
   * Keep a clip inside the file and make it at least one millisecond long.
   * Returns null when the window is empty, rather than silently exporting the
   * whole file and calling it a clip.
   */
  function clampClip(start, end, duration) {
    const s = parseTimecode(start);
    let e = parseTimecode(end);
    const cap = Number(duration);
    if (s == null) return null;
    if (e == null || e === 0) e = Number.isFinite(cap) && cap > 0 ? cap : s + 1;
    const from = Math.max(0, Math.min(s, e));
    let to = Math.max(s, e);
    if (Number.isFinite(cap) && cap > 0) to = Math.min(to, cap);
    if (!(to - from > 0.001)) return null;
    return { start: from, end: to, length: to - from };
  }

  /* ---------- samples ---------- */

  /** Cut every channel to [start, end) at sample resolution. */
  function sliceChannels(channels, sampleRate, start, end) {
    if (!Array.isArray(channels) || !channels.length) throw new Error("no channels");
    const rate = Number(sampleRate);
    if (!(rate > 0)) throw new Error("bad sample rate");
    const total = channels[0].length;
    const a = Math.max(0, Math.floor(start * rate));
    const b = Math.min(total, Math.ceil(end * rate));
    if (b <= a) throw new Error("empty clip");
    return channels.map((ch) => ch.subarray(a, b));
  }

  /* ---------- WAV (16-bit PCM, optional BWF bext) ---------- */

  const BEXT_SIZE = 602; // EBU Tech 3285 fixed block

  function writeAscii(view, offset, text, length) {
    const bytes = String(text || "").slice(0, length);
    for (let i = 0; i < length; i++) {
      view.setUint8(offset + i, i < bytes.length ? bytes.charCodeAt(i) & 0x7f : 0);
    }
  }

  /**
   * @param {object} o
   * @param {Float32Array[]} o.channels
   * @param {number} o.sampleRate
   * @param {{timeReference?:number, originator?:string, description?:string,
   *          date?:string, time?:string}=} o.bext  timeReference is samples since midnight
   * @returns {Uint8Array}
   */
  function encodeWav(o) {
    const channels = o.channels;
    const rate = Number(o.sampleRate);
    if (!Array.isArray(channels) || !channels.length) throw new Error("no channels");
    if (!(rate > 0)) throw new Error("bad sample rate");
    const frames = channels[0].length;
    if (!frames) throw new Error("empty clip");
    const chCount = channels.length;
    const dataBytes = frames * chCount * 2;
    const bext = o.bext || null;
    const bextBytes = bext ? 8 + BEXT_SIZE : 0;
    const buf = new ArrayBuffer(44 + bextBytes + dataBytes);
    const view = new DataView(buf);
    let off = 0;

    const ascii = (text) => {
      for (let i = 0; i < text.length; i++) view.setUint8(off++, text.charCodeAt(i) & 0x7f);
    };

    ascii("RIFF");
    view.setUint32(off, 36 + bextBytes + dataBytes, true); off += 4;
    ascii("WAVE");
    ascii("fmt ");
    view.setUint32(off, 16, true); off += 4;
    view.setUint16(off, 1, true); off += 2;              // PCM
    view.setUint16(off, chCount, true); off += 2;
    view.setUint32(off, rate, true); off += 4;
    view.setUint32(off, rate * chCount * 2, true); off += 4;
    view.setUint16(off, chCount * 2, true); off += 2;
    view.setUint16(off, 16, true); off += 2;

    if (bext) {
      ascii("bext");
      view.setUint32(off, BEXT_SIZE, true); off += 4;
      const start = off;
      writeAscii(view, start + 0, bext.description || "Audio Dub Extractor clip", 256);
      writeAscii(view, start + 256, bext.originator || "Audio Dub Extractor", 32);
      writeAscii(view, start + 288, bext.originatorReference || "", 32);
      writeAscii(view, start + 320, bext.date || utcDate(new Date()), 10);
      writeAscii(view, start + 330, bext.time || utcTime(new Date()), 8);
      const ref = Math.max(0, Math.round(Number(bext.timeReference) || 0));
      view.setUint32(start + 338, ref % 4294967296, true);          // low
      view.setUint32(start + 342, Math.floor(ref / 4294967296), true); // high
      view.setUint16(start + 346, 1, true);                         // version 1
      // UMID, loudness and reserved stay zero: the spec allows it and a fake
      // loudness value is worse than none.
      off = start + BEXT_SIZE;
    }

    ascii("data");
    view.setUint32(off, dataBytes, true); off += 4;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < chCount; c++) {
        const sample = Math.max(-1, Math.min(1, channels[c][i] || 0));
        view.setInt16(off, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        off += 2;
      }
    }
    return new Uint8Array(buf);
  }

  function utcDate(d) {
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  }
  function utcTime(d) {
    return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0") + ":" + String(d.getUTCSeconds()).padStart(2, "0");
  }

  /* ---------- ID3v2.3 ---------- */

  function synchsafe(n) {
    return [ (n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f ];
  }

  function utf16(text) {
    const s = String(text || "");
    const out = new Uint8Array(2 + s.length * 2);
    out[0] = 0xff; out[1] = 0xfe; // little-endian BOM
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      out[2 + i * 2] = code & 0xff;
      out[3 + i * 2] = code >> 8;
    }
    return out;
  }

  function frame(id, body) {
    const head = new Uint8Array(10 + body.length);
    for (let i = 0; i < 4; i++) head[i] = id.charCodeAt(i);
    // ID3v2.3 frame size is plain big-endian, not synchsafe.
    head[4] = (body.length >>> 24) & 0xff;
    head[5] = (body.length >>> 16) & 0xff;
    head[6] = (body.length >>> 8) & 0xff;
    head[7] = body.length & 0xff;
    head.set(body, 10);
    return head;
  }

  function textFrame(id, value) {
    const enc = utf16(value);
    const body = new Uint8Array(1 + enc.length);
    body[0] = 0x01; // UTF-16 with BOM
    body.set(enc, 1);
    return frame(id, body);
  }

  /** COMM, not TCOM: TCOM means composer, and a comment in it is a lie that
   *  some taggers copy into the wrong field. COMM is encoding + language +
   *  short description + text. */
  function commentFrame(text, description) {
    const lang = new Uint8Array([0x65, 0x6e, 0x67]); // "eng"
    const desc = utf16(description || "");
    const value = utf16(text);
    const body = new Uint8Array(1 + lang.length + desc.length + 2 + value.length);
    body[0] = 0x01;
    body.set(lang, 1);
    body.set(desc, 4);
    body.set(value, 4 + desc.length + 2);
    return frame("COMM", body);
  }

  function txxx(description, value) {
    const d = utf16(description);
    const v = utf16(value);
    // encoding byte + description + 0x0000 terminator + value
    const body = new Uint8Array(1 + d.length + 2 + v.length);
    body[0] = 0x01;
    body.set(d, 1);
    body.set(v, 1 + d.length + 2);
    return frame("TXXX", body);
  }

  /**
   * Build a complete ID3v2.3 tag. `timecode` is the human window, e.g.
   * "00:01:23.450-00:02:03.100"; `startSamples`/`rate` add a machine value.
   */
  function id3v23(fields) {
    const f = fields || {};
    const frames = [];
    if (f.title) frames.push(textFrame("TIT2", f.title));
    if (f.artist) frames.push(textFrame("TPE1", f.artist));
    if (f.album) frames.push(textFrame("TALB", f.album));
    if (f.comment) frames.push(commentFrame(f.comment));
    if (f.timecode) frames.push(txxx("TIMECODE", f.timecode));
    if (f.startSamples != null && f.rate) {
      frames.push(txxx("TIMECODE_SAMPLES", String(Math.round(f.startSamples))));
      frames.push(txxx("TIMECODE_RATE", String(Math.round(f.rate))));
    }
    if (f.source) frames.push(txxx("SOURCE", f.source));
    let size = 0;
    for (const fr of frames) size += fr.length;
    const tag = new Uint8Array(10 + size);
    tag[0] = 0x49; tag[1] = 0x44; tag[2] = 0x33; // "ID3"
    tag[3] = 0x03; tag[4] = 0x00;                 // v2.3.0
    tag[5] = 0x00;                                // flags
    tag.set(synchsafe(size), 6);
    let off = 10;
    for (const fr of frames) { tag.set(fr, off); off += fr.length; }
    return tag;
  }

  /** Existing ID3v2 tag length (10 + synchsafe size), 0 when there is none. */
  function existingId3Length(bytes) {
    if (!bytes || bytes.length < 10) return 0;
    if (!(bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)) return 0;
    const size = (bytes[6] & 0x7f) * 0x200000 + (bytes[7] & 0x7f) * 0x4000 + (bytes[8] & 0x7f) * 0x80 + (bytes[9] & 0x7f);
    // A footer, when the v2.4 flag says so, is part of the tag.
    const footer = bytes[5] & 0x10 ? 10 : 0;
    return Math.min(bytes.length, 10 + size + footer);
  }

  /**
   * Put a fresh tag on an MP3 without touching its audio bytes: any old ID3v2
   * tag is dropped first so the frames cannot contradict each other.
   */
  function tagMp3(bytes, fields) {
    if (!bytes || !bytes.length) throw new Error("empty file");
    const tag = id3v23(fields);
    const skip = existingId3Length(bytes);
    const out = new Uint8Array(tag.length + bytes.length - skip);
    out.set(tag, 0);
    out.set(bytes.subarray(skip), tag.length);
    return out;
  }

  const MPEG_RATES = {
    "1": [44100, 48000, 32000],
    "2": [22050, 24000, 16000],
    "2.5": [11025, 12000, 8000]
  };

  /** Sample rate of the MPEG audio itself, read from the first frame header.
   *  Tagging a copy must describe the copy, not the browser's decode rate. */
  function mp3SampleRate(bytes) {
    if (!bytes || bytes.length < 4) return null;
    const start = existingId3Length(bytes);
    for (let i = start; i + 3 < bytes.length; i++) {
      if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;
      const versionBits = (bytes[i + 1] >> 3) & 0x03;
      const layerBits = (bytes[i + 1] >> 1) & 0x03;
      if (versionBits === 1 || layerBits === 0) continue; // reserved values
      const table = versionBits === 3 ? MPEG_RATES["1"] : versionBits === 2 ? MPEG_RATES["2"] : MPEG_RATES["2.5"];
      const rateIndex = (bytes[i + 2] >> 2) & 0x03;
      if (rateIndex === 3) continue;
      return table[rateIndex];
    }
    return null;
  }

  /** Read back TXXX frames written by this module (used by tests and the UI). */
  function readTxxx(bytes) {
    const found = {};
    const tagLen = existingId3Length(bytes);
    if (!tagLen) return found;
    let off = 10;
    const end = tagLen;
    const decodeUtf16 = (start, stop) => {
      let s = "";
      for (let i = start; i + 1 < stop; i += 2) s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
      return s;
    };
    while (off + 10 <= end) {
      const id = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const size = (bytes[off + 4] << 24) | (bytes[off + 5] << 16) | (bytes[off + 6] << 8) | bytes[off + 7];
      const body = off + 10;
      if (size <= 0 || body + size > end) break;
      if (id === "TXXX" && bytes[body] === 0x01) {
        let p = body + 1;
        // BOM + UTF-16 description, then 0x0000
        p += 2;
        const descStart = p;
        while (p + 1 < body + size && !(bytes[p] === 0 && bytes[p + 1] === 0)) p += 2;
        const desc = decodeUtf16(descStart, p);
        p += 2;
        const value = decodeUtf16(p + 2, body + size);
        found[desc] = value;
      }
      off = body + size;
    }
    return found;
  }

  /* ---------- project files ---------- */

  function makeProject(items, meta) {
    return {
      app: "audio-dub-extractor",
      version: 1,
      savedAt: new Date().toISOString(),
      ...(meta || {}),
      items: (items || []).map((it) => ({
        name: String(it.name || "").slice(0, 200),
        in: formatTimecode(parseTimecode(it.in) || 0),
        out: formatTimecode(parseTimecode(it.out) || 0),
        source: String(it.source || "").slice(0, 500)
      }))
    };
  }

  /** Validate a project file. Throws with the first real problem, because a
   *  silently half-imported queue is worse than a refusal. */
  function parseProject(text, cap) {
    let data;
    try { data = typeof text === "string" ? JSON.parse(text) : text; }
    catch (e) { throw new Error("это не JSON"); }
    if (!data || data.app !== "audio-dub-extractor") throw new Error("это не файл проекта Audio Dub Extractor");
    if (!Array.isArray(data.items)) throw new Error("в проекте нет списка файлов");
    const max = Number(cap) > 0 ? Number(cap) : MAX_FILES_PRO;
    if (data.items.length > max) throw new Error("в проекте " + data.items.length + " файлов, лимит " + max);
    return data.items.map((it, i) => {
      const start = parseTimecode(it && it.in);
      const end = parseTimecode(it && it.out);
      if (start == null) throw new Error("файл " + (i + 1) + ": нечитаемое начало клипа");
      if (end == null) throw new Error("файл " + (i + 1) + ": нечитаемый конец клипа");
      return {
        name: String((it && it.name) || "clip-" + (i + 1)),
        in: start,
        out: end,
        source: String((it && it.source) || "")
      };
    });
  }

  function outputName(name, start, end) {
    const base = String(name || "clip")
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .trim()
      .slice(0, 90) || "clip";
    const stamp = (s) => formatTimecode(s, false).replace(/:/g, "-");
    return base + "__" + stamp(start) + "--" + stamp(end) + ".wav";
  }

  return {
    MAX_FILES_FREE, MAX_FILES_PRO, MAX_CLIP_FREE,
    parseTimecode, formatTimecode, clampClip, sliceChannels,
    encodeWav, id3v23, tagMp3, existingId3Length, readTxxx, txxx, commentFrame, mp3SampleRate,
    makeProject, parseProject, outputName, synchsafe
  };
});
