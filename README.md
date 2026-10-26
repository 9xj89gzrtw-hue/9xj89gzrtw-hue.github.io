# defiaudit.store — source

Static storefront for an independent audit of DefiLlama fee feeds.

- **`/`** — free protocol checker over 491 audited rows, plus a USDC-on-Base
  checkout that verifies the payment on-chain before unlocking.
- **`/defi-audit/`** — method, definitions, and the honest caveats.
- **`/ledgerkit/`** — landing page for the open-source ledger engine.

Everything is static. There is no backend, no database, no account system, and no
analytics. The only network calls the site makes are JSON-RPC calls to public
Base endpoints, and only after a visitor asks it to verify a transaction.

## Why the checkout verifies on-chain

The entitlement is a transaction receipt. `assets/verify.js` fetches
`eth_getTransactionReceipt` from a list of public Base RPCs and accepts a payment
when all of these hold:

1. the transaction exists and `status == 0x1`;
2. its logs contain a `Transfer` emitted by native USDC on Base
   (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`);
3. `topics[2]` (the recipient) is our address;
4. the summed amount is `>=` the price tier.

Replays are blocked per-browser via `localStorage`. That is a deliberate
trade-off, documented on the page: a static site cannot do better without a
server, so the file is issued as a one-time link and re-issued on request.

## Tests

The verifier is shared between browser and Node, so the code that unlocks the
page is literally the code under test:

```bash
node tests/verify.test.js
```

18 checks, run against a **real Base mainnet transaction** fetched live. The
fixture's recipient and amount are read from the chain, so the suite fails loudly
if the fixture ever stops being a USDC transfer.

Covered: calldata encoding, hash validation, replay rejection, receipt fetching,
transfer summing, a positive unlock at the $29 tier, refusal of our own address
on someone else's transaction, and rejection of an undersized payment.

## Regenerating the data

`build/build_pack.py` produces `data/checker.json` (free tier) and the paid
diagnostics pack from the CSVs in
[defillama-fee-feed-audit](https://github.com/9xj89gzrtw-hue/defillama-fee-feed-audit).
It expects that repo cloned as `../dlaudit` and the
`DefiLlama/dimension-adapters` tree cached as `../adapters-tree.json`.
The pack filename is random and only ever appears after a verified payment.

## Honesty constraints baked into the copy

- A silent feed is not automatically a broken adapter. 10 of 10 hand-checked
  breaks were genuine zero at the source, and the site says so above the fold.
- The $3.33M/day headline is the aggregate measured hole across all 411 rows,
  including dead protocols. The actionable subset ($23,735/day, 18 protocols) is
  stated separately.
- No cold DMs pairing a defect with a price. No promise of a merged PR.
- The raw CSVs stay public; what is sold is the diagnostics layer on top.
