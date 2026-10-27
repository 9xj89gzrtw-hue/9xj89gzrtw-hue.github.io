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
```

18 checks against a **real Base mainnet transaction**. The fixture's recipient and amount are read
from the chain, so the suite fails loudly if the fixture stops being a USDC transfer.

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
