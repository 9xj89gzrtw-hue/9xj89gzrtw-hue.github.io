# Table & TG-Channel Clipper Pro

One-click clean CSV/XLSX from any page: Telegram channel previews (`t.me/s/…`),
catalogs, listings, dashboards, plain HTML tables.

- **Free tier** ($0, no signup): detect card groups & tables, live field
  mapping, CSV export up to 50 rows per file.
- **Pro tier**: one-time **$9.00 in USDC on Base** (tx-hash verification) or an
  Ed25519 license key. Removes the row cap, adds auto-scroll harvest, keyword/
  regex filtering, multi-sheet XLSX export and per-host templates.
- **Unit-Economics Studio (WB / Ozon)** (added 2026-11-05): paste any price
  list, HTML table, CSV or JSON export — instant net-profit / margin / ROI /
  break-even per SKU with 2026 WB, Ozon and direct-sales presets (category
  commission, logistics with СПП, packaging, returns, УСН 6 %), colour
  verdict matrix and competitor batch compare. Free: CSV up to 50 SKUs.
  Pro (the same TW1-CLIP-… / TW1-ALL-… key): 10 000 SKUs, competitor compare
  and a multi-sheet XLSX report. One key — both tools.

No accounts. No KYC. No telemetry — the extension has no server; it only talks
to a public Base RPC (`mainnet.base.org`) to verify your payment locally.

## Unit-Economics Studio (WB / Ozon)

On the landing page at `#unitcalc` (same tier model, same TW1-CLIP-… /
TW1-ALL-… key): paste an HTML table, CSV/TSV or JSON price list and the
`ClipUnit` core (pure `unitcalc.js`, dependency-free) computes net profit,
margin %, ROI %, break-even units and the minimum profitable price per SKU —
with WB, Ozon and direct-sale 2026 presets (commission, logistics with СПП,
packaging, returns, УСН 6 %). Free: clean CSV up to 50 SKUs. Pro: up to
10 000 SKUs, competitor batch compare, multi-sheet XLSX via `ClipXLSX`.

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
| `unitcalc.js` | pure WB/Ozon unit-economics core (parsing, model, CSV rows) |
| `unitui.js` | landing-page studio wiring + Pro tier gate (same TW1 key) |
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
