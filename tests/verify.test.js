/* Tests for the storefront payment verifier, run against real Base mainnet data.
 * node tests/verify.test.js
 */
const A = require("../assets/verify.js");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  → " + extra : "")); }
}
async function throws(name, fn, re) {
  try { await fn(); fail++; console.log("  FAIL " + name + " (no error thrown)"); }
  catch (e) {
    const good = !re || re.test(e.message);
    if (good) { pass++; console.log("  ok   " + name + "  → \"" + e.message.slice(0, 70) + "…\""); }
    else { fail++; console.log("  FAIL " + name + " (wrong message: " + e.message + ")"); }
  }
}

/* A real Base mainnet transaction: USDC.transferWithAuthorization inside a
 * smart-account call. Recipient and amount are read from the chain below, so
 * this test fails loudly if the fixture stops being a USDC transfer. */
const FIXTURE_TX = "0xd27af909788e20f66ac57e2e4f49c0c610fdbf5d6ff20066669076e770945527";

(async () => {
  console.log("calldata");
  const cd = A.transferCalldata(29000000n, "0x72Aa6edDE71B94f6b99c8e52EdC02B5C75F74d1a");
  ok("selector is transfer(address,uint256)", cd.slice(0, 10) === "0xa9059cbb");
  ok("length is 4+32+32 bytes", cd.length === 10 + 64 + 64, cd.length);
  ok("recipient is left-padded", cd.slice(10, 74) === "0".repeat(24) + "72aa6edde71b94f6b99c8e52edc02b5c75f74d1a");
  ok("amount is 29e6 in hex", BigInt("0x" + cd.slice(74)) === 29000000n);
  ok("99 tier encodes as 99e6", BigInt("0x" + A.transferCalldata(99000000n).slice(74)) === 99000000n);

  console.log("input validation");
  await throws("rejects a non-hash", () => A.verify("hello"), /64 hex/);
  await throws("rejects a 64-char hash without 0x", () => A.verify("a".repeat(64)), /64 hex/);
  await throws("rejects a hash that was already redeemed",
    () => A.verify("0x" + "a".repeat(64), { usedHashes: ["0x" + "a".repeat(64)] }), /already redeemed/);

  /* Everything below this point would hit mainnet.base.org, but the parsing and
   * the whole verify path can be exercised on a synthetic receipt with a stubbed
   * fetch — so the logic is covered even when the RPC is unreachable. */
  console.log("receipt parsing (stubbed RPC)");
  const PAY = "0x72Aa6edDE71B94f6b99c8e52EdC02B5C75F74d1a";
  const PAYOUT = "0x1111111111111111111111111111111111111111";
  const units = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
  const logFor = (to, amount, token) => ({
    address: token || A.CONFIG.USDC,
    topics: [A.TRANSFER, A.pad32(PAYOUT), A.pad32(to)],
    data: units(amount)
  });
  const synth = (logs, status) => ({
    status: status || "0x1",
    logs
  });

  ok("sumUsdcIn reads a synthetic USDC transfer",
    A.sumUsdcIn(synth([logFor(PAY, 9000000)]), PAY) === 9000000n);
  ok("sumUsdcIn ignores another token",
    A.sumUsdcIn(synth([logFor(PAY, 9000000, "0x000000000000000000000000000000000000dEaD")]), PAY) === 0n);
  ok("sumUsdcIn ignores a transfer to someone else",
    A.sumUsdcIn(synth([logFor(PAYOUT, 9000000)]), PAY) === 0n);
  ok("sumUsdcIn adds two transfers in one receipt",
    A.sumUsdcIn(synth([logFor(PAY, 5000000), logFor(PAY, 4000000)]), PAY) === 9000000n);

  const realFetch = globalThis.fetch;
  const stub = (receipt) => (globalThis.fetch = async () => ({
    ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: receipt })
  }));
  const H = "0x" + "7".repeat(64);
  try {
    stub(synth([logFor(PAY, 9000000)]));
    const paid = await A.verifyAtLeast(H, 9, { rpcs: ["http://stub"], config: { PAY_TO: PAY } });
    ok("verifyAtLeast accepts exactly $9 for the $9 tier", paid.received === 9000000n);
    ok("verifyAtLeast returns a lowercased hash", paid.hash === H);

    stub(synth([logFor(PAY, 8999999)]));
    await throws("verifyAtLeast refuses one unit short",
      () => A.verifyAtLeast(H, 9, { rpcs: ["http://stub"], config: { PAY_TO: PAY } }), /carried 8\.999999 USDC/);

    stub(synth([logFor(PAYOUT, 9000000)]));
    await throws("verifyAtLeast refuses a payment to another address",
      () => A.verifyAtLeast(H, 9, { rpcs: ["http://stub"], config: { PAY_TO: PAY } }), /No USDC transfer to 0x72Aa/);

    stub(synth([logFor(PAY, 9000000)], "0x0"));
    await throws("verifyAtLeast refuses a reverted transaction",
      () => A.verifyAtLeast(H, 9, { rpcs: ["http://stub"], config: { PAY_TO: PAY } }), /reverted/);

    stub(null);
    await throws("verifyAtLeast refuses an unknown hash",
      () => A.verifyAtLeast(H, 9, { rpcs: ["http://stub"], config: { PAY_TO: PAY } }), /No receipt yet/);
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log("live chain: " + FIXTURE_TX.slice(0, 12) + "…");
  try {
  const receipt = await A.rpc("eth_getTransactionReceipt", [FIXTURE_TX]);
  ok("receipt fetched from a public Base RPC", !!receipt);
  ok("fixture transaction succeeded", receipt.status === "0x1");

  const transfers = (receipt.logs || []).filter(l =>
    l.address.toLowerCase() === A.CONFIG.USDC &&
    (l.topics[0] || "").toLowerCase() === A.TRANSFER);
  ok("fixture contains a native-USDC Transfer log", transfers.length > 0);

  const recipient = "0x" + transfers[0].topics[2].slice(-40);
  const amount = BigInt(transfers[0].data);
  console.log("       recipient " + recipient + " · " + Number(amount) / 1e6 + " USDC");

  const sum = A.sumUsdcIn(receipt, recipient);
  ok("sumUsdcIn finds the transfer to that recipient", sum === amount, String(sum));

  const other = A.sumUsdcIn(receipt, "0x000000000000000000000000000000000000dEaD");
  ok("sumUsdcIn returns 0 for an uninvolved address", other === 0n, String(other));

  const ours = await A.verify(FIXTURE_TX, {
    config: { PAY_TO: recipient, PRICES: { "29": 1n, "99": amount + 1n } }
  });
  ok("verify() unlocks for the real recipient at the $29 tier", ours.tier === "29", ours.tier);
  ok("verify() reports the exact on-chain amount", ours.received === amount, String(ours.received));

  await throws("verify() refuses our own address on someone else's tx",
    () => A.verify(FIXTURE_TX), /No USDC transfer to 0x72Aa…4d1a/);

  await throws("undersized payment is rejected",
    () => A.verify(FIXTURE_TX, { config: { PAY_TO: recipient, PRICES: { "29": amount + 1n, "99": amount + 2n } } }),
    /under the \$29 minimum/);

  const atLeast = await A.verifyAtLeast(FIXTURE_TX, 0.01, {
    config: { PAY_TO: recipient }
  });
  ok("verifyAtLeast() accepts a single-tier price below the amount", atLeast.received === amount, String(atLeast.received));

  await throws("verifyAtLeast() rejects an amount below the price",
    () => A.verifyAtLeast(FIXTURE_TX, 1, { config: { PAY_TO: recipient } }), /carried 0.02 USDC/);

  await throws("verifyAtLeast() rejects a bad price", () => A.verifyAtLeast(FIXTURE_TX, 0), /No price configured/);

  await throws("unknown hash gives a clear message",
    () => A.verify("0x" + "b".repeat(64)), /No receipt yet|unknown or still pending/);
  } catch (e) {
    /* These checks read a real transaction from Base, so they cannot run on a
       network that blocks the public RPCs (VPN, corporate DNS, offline). Skip
       them loudly: a skip is not a pass, and the offline checks above still
       count. */
    const text = String((e && e.name) + " " + (e && e.message));
    if (!/AbortError|fetch failed|Connect|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|network/i.test(text)) throw e;
    console.log("  skip live-chain checks — no Base RPC reachable from this network");
    console.log("       (" + text.slice(0, 90) + ")");
    console.log("       re-run where mainnet.base.org is reachable; earlier checks are unaffected");
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("harness error:", e); process.exit(2); });
