# Table & TG-Channel Clipper Pro

One-click clean CSV/XLSX from any page: Telegram channel previews (`t.me/s/…`),
catalogs, listings, dashboards, plain HTML tables.

- **Free tier** ($0, no signup): detect card groups & tables, live field
  mapping, CSV export up to 50 rows per file.
- **Pro tier**: one-time **$9.00 in USDC on Base** (tx-hash verification) or an
  Ed25519 license key. Removes the row cap, adds auto-scroll harvest, keyword/
  regex filtering, multi-sheet XLSX export and per-host templates.

No accounts. No KYC. No telemetry — the extension has no server; it only talks
to a public Base RPC (`mainnet.base.org`) to verify your payment locally.

## Install (unpacked / developer mode)

1. Download `data-clipper-unpacked.zip` (from the GitHub release or the landing
   page `downloads/` folder) and unpack it.
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select the unpacked folder.
4. Open any feed page, click the toolbar icon, hit **DETECT**.

Works in any Chromium browser (Chrome, Edge, Brave).

## Architecture

| File | Role |
|---|---|
| `engine.js` | pure DOM detection/extraction core (`ClipEngine`), shared by popup and sandbox |
| `csv.js` | RFC 4180 CSV builder (`ClipCSV`) |
| `xlsx.js` | dependency-free multi-sheet XLSX writer, store-only zip (`ClipXLSX`) |
| `license.js` | offline Ed25519 license verification via WebCrypto (`ClipLicense`) |
| `tx.js` | USDC-on-Base payment verification (`ClipTx`) |
| `content.js` | injected bridge: detect / extract / tables / autoscroll protocol |
| `popup.js` | popup controller, tier state in `chrome.storage.local` |
| `site/` | the landing page & live sandbox (same engine, same code) |

`manifest.json` is MV3 with `activeTab, scripting, storage` only;
`optional_host_permissions` covers `https://mainnet.base.org/*`.

## Tests

Open `index.html?test=1` — the in-page battery runs 40+ cases (≈70
assertions): base32 vectors, Ed25519 license verification (valid / wrong
product / expired / tampered), CSV & XLSX byte-level checks, engine detection,
colspan tables, filtering, and mocked-RPC payment verification.

## License

MIT — see `LICENSE`.
