/* Service worker: the only place with chrome.downloads.
 *
 * Downloading from a content script with fetch() means the whole file lands in
 * memory and CORS decides whether it is allowed at all. Here the browser does
 * the transfer itself, so a 90 MB set is one call and no tabs die.
 */
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || message.type !== "tw-download" || typeof message.url !== "string") return false;

  var filename = String(message.filename || "").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120) || "audio-dub";
  try {
    chrome.downloads.download(
      { url: message.url, filename: filename, saveAs: false, conflictAction: "uniquify" },
      function (id) {
        if (chrome.runtime.lastError || !id) {
          sendResponse({ ok: false, message: (chrome.runtime.lastError && chrome.runtime.lastError.message) || "download failed" });
          return;
        }
        sendResponse({ ok: true, id: id });
      }
    );
  } catch (e) {
    sendResponse({ ok: false, message: String((e && e.message) || e) });
  }
  return true; // keep the channel open for the async response
});
