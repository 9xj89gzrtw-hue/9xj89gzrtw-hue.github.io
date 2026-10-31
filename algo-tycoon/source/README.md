# Algo Tycoon

A pipeline-puzzle economy game for the browser. Synthetic order flow arrives
seed-by-seed (mulberry32 PRNG — every feed is reproducible), you stack
deterministic op-cards into a pipeline (`FLOOR → ODD → ABS → CHUNK-2 → MAX`),
and the desk pays out only when the compiled scalar lands exactly on target
(tolerance 1e-9).

- **14 contracts** across three acts (pilot → volume → playbook)
- **22 op-cards**: maps, abs/floor/neg, filters (even/odd/pos), sorts, reverse,
  dedupe, chunk-2, zigzag, rotate, take/skip/tail, scalars (Σ Π min max)
- **Research tree**: payout multipliers, wider pipelines, offline compilers
  (3 cr/hour each, accrue up to 8 hours while you're away)
- Free tier: 6-card pipeline, all contracts playable
- Pro: **$5** one-time (USDC on Base tx-hash verification, or Ed25519 license
  key) → 11-card pipeline, live **sandbox**, **level editor** (JSON export)
- **Source pack**: $19 one-time → full unminified source zip
- No accounts, no KYC, no telemetry. Saves live in
  `localStorage` (`algo_tycoon_v1`, Pro flag mirrored to `algo_tycoon_pro_v1`).

## Play

Deployed at <https://9xj89gzrtw-hue.github.io/algo-tycoon/> or open
`index.html` straight from disk — no modules, no build step, `file://` friendly
(classic scripts, `window.AT.*` namespaces).

## Tests

Open with `?test=1`: 85 case-groups / 223 assertions covering RNG
determinism, every op-card, pipeline composition + tolerance, a solver pass
reproducing all 14 targets from seeds alone, payout/unlock/research rules,
offline-compiler math, base32 vectors, Ed25519 license checks (valid / wrong
product / expired / tampered) and mocked-RPC USDC verification.

## Telegram Mini App notes

The game is pure static assets and runs inside a Telegram Mini App webview as
-is:

- serve `index.html` over HTTPS (GitHub Pages works),
- all state is client-side; there is no backend to authorize,
- payments intentionally stay on-chain (USDC Base) — verification is local, so
  no Telegram Payments provider registration is required,
- the popup/modal uses plain DOM, no Telegram SDK calls, so it degrades
  gracefully if `Telegram.WebApp` is absent; wrap the page in the TMA shell
  for full-screen height.

MIT — see `LICENSE`.
