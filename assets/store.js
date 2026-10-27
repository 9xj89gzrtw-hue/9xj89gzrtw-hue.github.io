/* toolworks storefront — product catalog + checkout UI.
 *
 * The verification primitives live in assets/verify.js (same file the Node test
 * suite loads), so the code that unlocks a download is the code under test.
 *
 * Honest limitation, stated on the page too: the passphrase below is client-side.
 * A static site cannot enforce a licence. Payment-gated obscurity, not DRM.
 */
(function () {
  "use strict";

  /* CATALOG:BEGIN — rewritten by build/encrypt_packs.py, do not hand-edit */
  const CATALOG = {
    forensics: {
      id: "forensics",
      name: "Token Holder Forensics Kit \u2014 Pro",
      price: 19,
      units: 19000000n,
      archive: "packs/forensics-pro.zip.enc",
      pass: "fphJyUcCH-p3WLIwjWqpsA4g",
      sha256: "10a4578ea508fea9cc48c4dfef3fc6f5c41c6c9ea98c59c7e91fd32531aedb4a",
      bytes: 98080
    },
    paywall: {
      id: "paywall",
      name: "USDC Paywall Boilerplate \u2014 Pro",
      price: 29,
      units: 29000000n,
      archive: "packs/paywall-pro.zip.enc",
      pass: "FdYTJP-RyH7TAoQ3v6AoyC34",
      sha256: "72ba75855a70336e9f160f503a285529f59630f67116faf2423f79de11adb719",
      bytes: 45424
    },
    alertbot: {
      id: "alertbot",
      name: "Alert & Bounty Sniper Bot \u2014 Pro",
      price: 25,
      units: 25000000n,
      archive: "packs/alertbot-pro.zip.enc",
      pass: "d7872TOUCHbUSt33h7CZt405",
      sha256: "45f24794acbe6379c0707919e467d7b83322b74f4b276fd03df313e5d090c886",
      bytes: 73760
    },
    tgbot: {
      id: "tgbot",
      name: "Telegram Crypto Shop Bot (aiogram 3) \u2014 Pro",
      price: 29,
      units: 29000000n,
      archive: "packs/tg-crypto-shop-pro.zip.enc",
      pass: "e2OniydOiQ7AkjYlofpYGPUO",
      sha256: "27c8c74da11b9f9060627c3b539ab544209fd44ac309a000677581e8170f769e",
      bytes: 10752
    },
    scraper: {
      id: "scraper",
      name: "Universal Scraper Pro (Cloudflare Bypass) \u2014 Pro",
      price: 39,
      units: 39000000n,
      archive: "packs/universal-scraper-pro.zip.enc",
      pass: "s4gWMmxCNqTjcLNvBKw8wXY3",
      sha256: "905c95e934985dfca784fca4460cc51c8a0072a77b5270f1b986eb1469d7e668",
      bytes: 7952
    },
    uikit: {
      id: "uikit",
      name: "10 Premium Landing UI Components & SVG Kit \u2014 Pro",
      price: 25,
      units: 25000000n,
      archive: "packs/landing-ui-svg-kit-pro.zip.enc",
      pass: "iZodrJbK5HJjVs6myWeEIz8R",
      sha256: "b0e82c95722050e334c1d947cf7acdb6b37a5a3b6a4d2f0526cd4575aba311f4",
      bytes: 9904
    },
    bounty: {
      id: "bounty",
      name: "Crypto Bounty Hunter & Onchain Analytics \u2014 Pro",
      price: 49,
      units: 49000000n,
      archive: "packs/crypto-bounty-hunter-pro.zip.enc",
      pass: "_T_jo84FOczAXHsneL71Wzbe",
      sha256: "01c72020ce1f317d80eea88b33fa78ce3529488412bf469ea77952d6dbf3fe2d",
      bytes: 348992
    }
  };
  /* CATALOG:END */

  const PAY_TO = "0x72Aa6edDE71B94f6b99c8e52EdC02B5C75F74d1a";
  const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
  const USED_KEY = "tw:redeemed:v1";

  let current = "forensics";

  const $ = sel => document.querySelector(sel);
  const fmt = units => (Number(units) / 1e6).toFixed(2) + " USDC";
  const short = a => a.slice(0, 6) + "…" + a.slice(-4);

  function usedHashes() {
    try { return JSON.parse(localStorage.getItem(USED_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function markUsed(h) {
    try {
      const list = usedHashes();
      if (!list.includes(h)) list.push(h);
      localStorage.setItem(USED_KEY, JSON.stringify(list.slice(-200)));
    } catch (e) { /* private mode: replay protection degrades, page still works */ }
  }

  function setProduct(id, updateHash) {
    if (!CATALOG[id]) return;
    current = id;
    const p = CATALOG[id];
    document.querySelectorAll(".tab").forEach(t =>
      t.classList.toggle("on", t.dataset.product === id));
    $("#amount").textContent = p.price.toFixed(2) + " USDC";
    $("#result").innerHTML = "";
    $("#txhash").value = "";
    if (updateHash !== false) history.replaceState(null, "", "#buy");
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function showError(msg) {
    const box = el("div", "box bad");
    box.appendChild(el("h3", null, "Not unlocked"));
    box.appendChild(el("p", null, msg));
    $("#result").replaceChildren(box);
  }

  function showSuccess(p, received, receipt) {
    const box = el("div", "box ok");
    box.appendChild(el("h3", null, "Paid and verified — " + p.name));

    const kv = el("dl", "kv");
    const rows = [
      ["amount", fmt(received)],
      ["recipient", short(PAY_TO)],
      ["block", parseInt(receipt.blockNumber, 16).toLocaleString()],
      ["tx", receipt.transactionHash]
    ];
    rows.forEach(([k, v]) => {
      kv.appendChild(el("dt", null, k));
      kv.appendChild(el("dd", null, v));
    });
    box.appendChild(kv);

    box.appendChild(el("p", "small dim", "Download the encrypted archive, then decrypt it with the passphrase below. The archive is AES-256-CBC (PBKDF2, 200,000 iterations)."));

    const dl = el("a", "btn primary", "Download " + p.archive.split("/").pop());
    dl.href = p.archive;
    dl.setAttribute("download", "");
    dl.style.margin = "6px 0 14px";
    box.appendChild(dl);

    const pre = el("pre");
    pre.textContent =
      "openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \\\n" +
      "  -in " + p.archive.split("/").pop() + " -out pack.zip\n" +
      "# passphrase:\n" + p.pass;
    box.appendChild(pre);

    if (p.sha256) {
      const sha = el("p", "small dim");
      sha.textContent = "SHA-256 of the encrypted file: " + p.sha256;
      box.appendChild(sha);
    }

    box.appendChild(el("p", "small dim", "Keep the passphrase and the hash. If the download 404s later, open an issue with the hash and we re-issue the file."));
    $("#result").replaceChildren(box);
  }

  async function verify() {
    const btn = $("#btnverify");
    const hash = ($("#txhash").value || "").trim();
    const p = CATALOG[current];

    if (!HASH_RE.test(hash)) {
      return showError("That is not a transaction hash. A Base hash is 0x followed by 64 hex characters.");
    }
    const h = hash.toLowerCase();
    if (usedHashes().includes(h)) {
      return showError("This hash was already redeemed in this browser. Re-open the download link from your notes, or open an issue with the hash for a re-issue.");
    }

    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Checking 4 RPCs…";
    $("#result").innerHTML = "";

    try {
      const receipt = await window.DefiAudit.rpc("eth_getTransactionReceipt", [h]);
      if (!receipt) {
        throw new Error("No receipt for that hash. It is unknown, still pending, or belongs to another chain — Base receipts only here.");
      }
      if (receipt.status !== "0x1") {
        throw new Error("That transaction reverted (status 0x0). Nothing moved, so nothing unlocks.");
      }
      const received = window.DefiAudit.sumUsdcIn(receipt, PAY_TO);
      if (received === 0n) {
        throw new Error("No USDC transfer to " + short(PAY_TO) + " inside that transaction. Exchange withdrawals, bridged USDC and other chains all look like this.");
      }
      if (received < p.units) {
        const bigger = Object.values(CATALOG)
          .filter(c => c.units <= received)
          .sort((a, b) => b.units - a.units)[0];
        const hint = bigger
          ? " That amount covers \u201c" + bigger.name + "\u201d — switch to it and verify the same hash again."
          : "";
        throw new Error("This transaction paid " + fmt(received) + ", the " + p.name + " costs " + fmt(p.units) + "." + hint);
      }
      markUsed(h);
      showSuccess(p, received, receipt);
    } catch (e) {
      showError(e && e.message ? e.message : String(e));
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".tab").forEach(t =>
      t.addEventListener("click", () => setProduct(t.dataset.product)));
    document.querySelectorAll("[data-buy]").forEach(b =>
      b.addEventListener("click", () => {
        setProduct(b.dataset.buy);
        document.getElementById("buy").scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => $("#txhash").focus(), 350);
      }));
    $("#btnverify").addEventListener("click", verify);
    $("#txhash").addEventListener("keydown", e => { if (e.key === "Enter") verify(); });
    const copy = $("#copyaddr");
    if (copy) copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(PAY_TO);
        copy.textContent = "copied";
        setTimeout(() => copy.textContent = "copy", 1500);
      } catch (e) {
        copy.textContent = "select it";
      }
    });
    setProduct("forensics", false);
  });

  window.Toolworks = { CATALOG, PAY_TO, USDC, TRANSFER, verify };
})();
