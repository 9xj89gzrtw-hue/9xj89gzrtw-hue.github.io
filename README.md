# toolworks — source

Static storefront for three digital kits. Paid in USDC on Base, delivered without a backend.

- **`/`** — the store: three products, prices, a checkout that verifies the payment on-chain and
  unlocks an AES-256 encrypted archive.
- **`/defi-audit/`** — method and caveats for the independent DefiLlama fee-feed audit.
- **`/ledgerkit/`** — landing page for the open-source ledger engine.
- **`/packs/`** — the encrypted Pro archives. Useless without the passphrase, which is revealed only
  after a verified payment.

Everything is static: no backend, no database, no accounts, no analytics. The only network calls the
page makes are JSON-RPC reads to public Base endpoints, and only after a visitor presses verify.

## How the checkout works

The entitlement is a transaction receipt. `assets/verify.js` fetches
`eth_getTransactionReceipt` from four public Base RPCs and accepts a payment when all of these hold:

1. the transaction exists and `status == 0x1`;
2. its logs contain a `Transfer` emitted by native USDC on Base
   (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`);
3. `topics[2]` (the recipient) is the seller address;
4. the summed amount is `>=` the selected product's price.

`assets/store.js` adds the catalog, price matching, per-browser replay blocking, and the unlock panel.
A hash that pays more than the selected product unlocks the most expensive product it covers and says so.

## Tests

The verifier is shared between the browser and Node, so the code that unlocks a download is the code
under test:

```bash
node tests/verify.test.js
node tests/studio.test.js
```

44 checks against a **real Base mainnet transaction**, plus 83 offline checks for the Audio Dub
Extractor studio: timecode parsing, sample slicing, WAV/BWF headers, ID3v2.3 frames and project
files (no network needed). The fixture's recipient and amount are read
from the chain, so the suite fails loudly if the fixture stops being a USDC transfer. The one-click
path is covered too: the exact `eth_sendTransaction` payload (contract, chain id, calldata) and the
receipt polling loop are asserted with a stubbed RPC, so no network is needed for those.

## One-click payment

Every Pro modal leads with **Pay in 1 Click**: the page asks the wallet for an account, switches it to
Base (`0x2105`, adding the chain if the wallet has never seen it), sends `transfer(payTo, price)` to
native USDC, waits for the receipt and unlocks itself. The buyer never copies an address or a hash.

The manual tx-hash field stays below the button as the fallback for mobile wallets and exchange
withdrawals, because an exchange withdrawal hash is not the transfer hash and has to be handled by
hand. The extension popup keeps the manual flow only — a Chrome extension popup has no injected
provider, so one-click would be a button that cannot work there.

## Building the Pro archives

```bash
python3 build/encrypt_packs.py
```

Zips the three product directories, encrypts each with AES-256-CBC (PBKDF2, 200,000 iterations, random
salt), records SHA-256 and size, and rewrites the `CATALOG` block in `assets/store.js` between its
`CATALOG:BEGIN` / `CATALOG:END` markers. Passphrases are generated once and kept in
`build/pack-secrets.json` (gitignored) so re-running the build never invalidates a passphrase a buyer
already has.

The paywall template is sanitised before it is zipped: the live catalog with the other products'
passphrases is replaced by a placeholder, so buying the $29 template does not hand over the $19 and
$25 archives.

## Honesty constraints baked into the copy

- A static page cannot enforce a licence. The passphrase lives in `assets/store.js`; the page says
  this in plain language and offers manual access control (private repo) as the real alternative.
- The DefiLlama audit's $3.33M/day headline is the aggregate across all 411 rows, including dead
  protocols. The actionable subset is stated separately, and 10 of 10 hand-checked "broken" adapters
  turned out to be correct.
- No cold DMs pairing a defect with a price. The store is pull-only.
- Pro packs contain exactly what their `PRO_FEATURES.md` lists. Anything not shipped is in a
  "Roadmap — NOT included" section.
