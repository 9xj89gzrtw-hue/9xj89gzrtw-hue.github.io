/* Isolated-world half of the extension.
 *
 * The panel runs in the page's own world so it can see the player's fetch/XHR
 * and media elements. chrome.* does not exist there, so the panel posts a
 * message and this bridge forwards it to the service worker, which owns
 * chrome.downloads. The flag on <html> tells core.js that the bridge is alive.
 */
(function () {
  "use strict";

  if (!(window.chrome && chrome.runtime && chrome.runtime.id)) return;
  try { document.documentElement.dataset.adkExt = "1"; } catch (e) { /* ignore */ }

  window.addEventListener("message", function (event) {
    var data = event && event.data;
    if (!data || data.__adk !== "download" || typeof data.url !== "string") return;
    if (event.source !== window) return;

    chrome.runtime.sendMessage(
      { type: "tw-download", url: data.url, filename: String(data.filename || "audio") },
      function (res) {
        var payload = {
          __adk: "download-result",
          id: data.id,
          ok: !!(res && res.ok),
          downloadId: res && res.id,
          message: (res && res.message) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || ""
        };
        window.postMessage(payload, "*");
      }
    );
  });
})();
