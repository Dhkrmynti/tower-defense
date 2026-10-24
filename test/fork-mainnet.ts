/**
 * The burn bot against a LOCAL FORK of Robinhood Chain mainnet: real Pons contracts, fake ETH.
 * Nothing here is ever sent to mainnet.
 *
 *   cd <scratch> && npx hardhat node --port 8599   (hardhat.config: forking mainnet, chainId 4663,
 *                                                     chains.4663.hardforkHistory { cancun: 0 })
 *   FORK_RPC=http://127.0.0.1:8599 npx tsx test/fork-mainnet.ts
 *
 * B · tokenomics read from the real curve: fee rate, graduation threshold, supply.
 * A · the real fee flow: trades leave the fee in the curve; the creator's sweepFees() moves the creator
 *     share into the Pons escrow; claim() pays it out.
 * C · the bot in split mode on real contracts only: sweep, claim, the dev share to the treasury, the burn
 *     share bought in capped buys with a slippage floor and buried at 0x…dEaD; the books survive a restart. On the fork the curve's creator is rewritten to a
 *     dev key we hold (storage slot 1 and the immutable in its code), since nobody holds the real one.
 * D · the graduated path: a real Uniswap v4 buy of a graduated Pons token through the bot's own calldata.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { buildUniswapV4Buy, findGraduationPool, quoteUniswapV4Buy } from "../bot/uniswap-v4";

const RPC = process.env.FORK_RPC || "http://127.0.0.1:8599";
const MAINNET = process.env.MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com";
const PORT = 5420;
const API = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK = path.join(ROOT, ".e2e-fork");

const TOKEN = "0x1b91003eef8b131cf493c59bf0940ae15f7ccec8"; // old $GRAVE, still trading on its curve
const CURVE = "0x5378D9D6629E0B7E8Ca8d9B5d1277e051A922ee5";
const ESCROW = "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e";
const ROUTER = "0x8876789976dEcBfCbBbe364623C63652db8C0904";
const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
const MEME_HOOK = "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const CREATOR = "0x789A2b5b3828AaAF323CA30171b217E90F4104a9"; // the old $GRAVE creator / engine wallet
const MNEMONIC = "test test test test test test test test test test test junk";
const dev = (i: number) => ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`);

const provider = new ethers.JsonRpcProvider(RPC, 4663, { staticNetwork: true, cacheTimeout: -1 });
const E = (s: string) => ethers.parseEther(s);
const fmt = (v: bigint) => ethers.formatUnits(v, 18);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const erc20 = (a: string, r: ethers.ContractRunner = provider) =>
  new ethers.Contract(a, ["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)", "function symbol() view returns (string)", "function approve(address, uint256) returns (bool)"], r);
const curveAt = (r: ethers.ContractRunner = provider) =>
  new ethers.Contract(
    CURVE,
    [
      "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256)",
      "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256)",
      "function sweepFees(uint256 maxAmount)",
      "function graduated() view returns (bool)",
      "function getReserves() view returns (uint256, uint256)",
      "function feeBps() view returns (uint256)",
      "function graduationThreshold() view returns (uint256)",
    ],
    r,
  );
const escrowAt = (r: ethers.ContractRunner = provider) => new ethers.Contract(ESCROW, ["function balanceOf(address) view returns (uint256)", "function claim()"], r);

let passed = 0;
const findings: string[] = [];
const ok = (cond: unknown, what: string) => {
  assert.ok(cond, what);
  passed++;
  console.log(`  ✔ ${what}`);
};
const finding = (what: string) => {
  findings.push(what);
  console.log(`  ! ${what}`);
};

let engine: ChildProcess | null = null;
const log = () => (fs.existsSync(path.join(WORK, "engine.log")) ? fs.readFileSync(path.join(WORK, "engine.log"), "utf-8") : "");
const status = async (): Promise<any> => ((await (await fetch(API + "/api/status", { signal: AbortSignal.timeout(5000) })).json()) as any).data;
async function until<T>(what: string, read: () => Promise<T | false | null | undefined>, seconds = 120): Promise<T> {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const v = await read().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what}\n${log().split("\n").slice(-25).join("\n")}`);
    await sleep(500);
  }
}

async function main() {
  assert.equal(BigInt(await provider.send("eth_chainId", [])), 4663n);
  await provider.send("hardhat_reset", [{ forking: { jsonRpcUrl: MAINNET } }]); // fresh copy of mainnet every run
  await provider.send("hardhat_mine", ["0x1"]); // calls on the fork block itself have no hardfork rules
  // hardhat's well-known accounts carry code on this chain (bots delegated them), so ETH sent to them
  // by the curve or the escrow fails; every actor here is a fresh random wallet
  const buyer = ethers.Wallet.createRandom().connect(provider);
  const operator = ethers.Wallet.createRandom().connect(provider);
  const treasury = ethers.Wallet.createRandom().address;

  /* ───────── B · tokenomics, from the real contracts ───────── */
  console.log("\nB · tokenomics (real curve)");
  const curve = curveAt();
  const feeBps: bigint = await curve.feeBps();
  const gradThreshold: bigint = await curve.graduationThreshold();
  const supply: bigint = await erc20(TOKEN).totalSupply();
  const [quoteRes, tokenRes] = (await curve.getReserves()) as [bigint, bigint];
  console.log(`    trade fee ${Number(feeBps) / 100}% · graduates at ${ethers.formatEther(gradThreshold)} ETH in the curve · supply ${fmt(supply)} · curve now ${ethers.formatEther(quoteRes)} ETH / ${fmt(tokenRes)} tokens`);
  ok(supply === E("1000000000"), "supply is 1,000,000,000");
  ok(!(await curve.graduated()), "the $GRAVE curve has not graduated: buys go through curve.buy()");

  /* ───────── A · the real fee flow ───────── */
  console.log("\nA · real fee flow: curve → sweepFees → Pons escrow → claim");
  const escrow = escrowAt();
  await provider.send("hardhat_setBalance", [buyer.address, ethers.toQuantity(E("100"))]);
  /** Volume without moving the curve much: buy, then sell everything back. */
  // the token refuses sells from hardhat's well-known accounts (they are on this chain's bot lists),
  // so every churn trades from a fresh random wallet
  const churn = async (eth: string) => {
    const w = ethers.Wallet.createRandom().connect(provider);
    await provider.send("hardhat_setBalance", [w.address, ethers.toQuantity(E("10"))]);
    const c = curveAt(w) as ethers.Contract;
    await (await c.buy(E(eth), 0n, w.address, { value: E(eth) })).wait();
    const bag: bigint = await erc20(TOKEN).balanceOf(w.address);
    await (await (erc20(TOKEN, w) as ethers.Contract).approve(CURVE, bag)).wait();
    await (await c.sell(bag, 0n, w.address)).wait();
  };
  const owed0: bigint = await escrow.balanceOf(CREATOR);
  await churn("0.5");
  ok((await escrow.balanceOf(CREATOR)) === owed0, "after a 0.5 ETH buy + sell the escrow is unchanged: the fee waits in the curve");
  await provider.send("hardhat_impersonateAccount", [CREATOR]);
  await provider.send("hardhat_setBalance", [CREATOR, ethers.toQuantity(E("1"))]);
  const asCreator = new ethers.JsonRpcSigner(provider, CREATOR); // impersonated, so not in eth_accounts
  const strangerSweep = await (curveAt(buyer) as ethers.Contract).sweepFees.staticCall(0n).then(() => true, () => false);
  ok(!strangerSweep, "sweepFees() is refused for anyone but the creator");
  await (await (curveAt(asCreator) as ethers.Contract).sweepFees(0n)).wait();
  const owed: bigint = (await escrow.balanceOf(CREATOR)) - owed0;
  ok(owed > 0n, `sweepFees(0) by the creator moved ${ethers.formatEther(owed)} ETH into the escrow`);
  console.log(`    creator share ≈ ${((Number(owed) / Number(E("1.0"))) * 100).toFixed(3)}% of the ~1 ETH traded (trade fee ${Number(feeBps) / 100}%)`);
  const ethBefore = await provider.getBalance(CREATOR);
  const rc = await (await (escrowAt(asCreator) as ethers.Contract).claim()).wait();
  const paid = (await provider.getBalance(CREATOR)) + rc!.gasUsed * BigInt(rc!.gasPrice) - ethBefore;
  ok(paid === owed0 + owed, `claim() paid out the whole escrow balance (${ethers.formatEther(paid)} ETH)`);
  await provider.send("hardhat_stopImpersonatingAccount", [CREATOR]);

  /* ───────── C · the bot, on real contracts ───────── */
  console.log("\nC · the bot on real contracts (curve creator rewritten to a dev key)");
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  const code = (await provider.getCode(CURVE)).toLowerCase();
  const opHex = operator.address.slice(2).toLowerCase();
  await provider.send("hardhat_setCode", [CURVE, code.split(CREATOR.slice(2).toLowerCase()).join(opHex)]);
  await provider.send("hardhat_setStorageAt", [CURVE, "0x1", ethers.zeroPadValue(operator.address, 32)]);
  await provider.send("hardhat_setBalance", [operator.address, ethers.toQuantity(E("0.05"))]);
  const dead = () => erc20(TOKEN).balanceOf(DEAD) as Promise<bigint>;

  // enough volume for a claim of a few hundredths of an ETH
  for (let i = 0; i < 3; i++) await churn("0.7");
  const SPLIT = 50;
  const MAXBUY = E("0.01");
  const env = {
    RPC_URL: RPC, PORT: String(PORT), HOST: "127.0.0.1", TOKEN_ADDRESS: TOKEN, CURVE_ADDRESS: "", TREASURY_ADDRESS: treasury,
    CREATOR_PRIVATE_KEY: operator.privateKey, POLL_INTERVAL_SECONDS: "2", SWEEP_INTERVAL_SECONDS: "30", ADMIN_SECRET: "fork-secret", SITE_DIR: "",
    CYCLE_MODE: "split", BURN_SHARE_PCT: String(SPLIT), MAX_BUY_ETH: "0.01", MIN_BUY_ETH: "0.001", BUY_SPACING_SECONDS: "10", SLIPPAGE_BPS: "300", GAS_RESERVE_ETH: "0.002",
  };
  const dead1 = await dead();
  const t0 = await provider.getBalance(treasury);
  const startEngine = () => {
    engine = spawn(process.execPath, ["--import", "tsx", path.join(ROOT, "bot/pons-burn-bot.ts")], { cwd: WORK, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    const out = fs.createWriteStream(path.join(WORK, "engine.log"), { flags: "a" });
    engine.stdout!.pipe(out);
    engine.stderr!.pipe(out);
  };
  startEngine();

  await until("the bot API", () => status());
  await until("the curve to be read from token.curve()", async () => ((await status()).curveAddress?.toLowerCase() === CURVE.toLowerCase() ? true : null));
  ok(true, "the bot found the real curve from token.curve()");
  const r = await fetch(API + "/api/config", { method: "POST", body: JSON.stringify({ treasuryAddress: dev(7).address }) });
  ok(r.status === 403 && (await status()).treasuryAddress.toLowerCase() === treasury.toLowerCase(), "a config change without the admin secret is refused");
  const rk = await fetch(API + "/api/config", { method: "POST", headers: { "x-admin-secret": "fork-secret" }, body: JSON.stringify({ privateKey: dev(3).privateKey }) });
  ok(rk.status === 400 && (await status()).walletAddress.toLowerCase() === operator.address.toLowerCase(), "the operator key cannot be swapped over HTTP, even with the secret");

  const s1 = await until("claim #1", async () => ((await status()).totalCyclesExecuted >= 1 ? status() : null), 180);
  ok(/\[SWEEP\] Moved/.test(log()), "the bot swept the curve's fees into the real escrow itself");
  const claimed = E(s1.totalFeesClaimedETH);
  const wages = (await provider.getBalance(treasury)) - t0;
  ok(claimed > 0n, `claim #1 took ${ethers.formatEther(claimed)} ETH from the real escrow`);
  ok(wages === claimed - (claimed * BigInt(SPLIT)) / 100n || wages === (claimed * BigInt(100 - SPLIT)) / 100n, `the dev's ${100 - SPLIT}% went to the treasury at once: ${ethers.formatEther(wages)} ETH`);
  console.log(`    burn budget after the claim: ${s1.burnBudgetETH} ETH`);

  // the budget drips out in buys of at most MAX_BUY_ETH
  const st = await until("the burn budget to be spent", async () => {
    const s = await status();
    return E(s.burnBudgetETH) < E("0.001") ? s : null;
  }, 240);
  const buys = [...log().matchAll(/\[BUY #\d+\] ([\d.]+) ETH on the curve, at least/g)].map((m) => E(m[1]));
  ok(buys.length >= 2, `the budget was spent in ${buys.length} separate buys`);
  ok(buys.every((b) => b <= MAXBUY), `no buy was bigger than ${ethers.formatEther(MAXBUY)} ETH (largest ${ethers.formatEther(buys.reduce((a, b) => (b > a ? b : a), 0n))})`);
  ok(E(st.totalBurnSpentETH) + E(st.burnBudgetETH) === claimed - wages, "burn spent + budget left = exactly the burn share of the claim");
  const burned = (await dead()) - dead1;
  ok(burned > 0n && E(st.totalTokensBurned) === burned, `${fmt(burned)} $GRAVE buried at 0x…dEaD, matching the bot's books`);
  ok((await erc20(TOKEN).balanceOf(operator.address)) === 0n, "nothing bought was left in the operator wallet");
  ok(/at least [\d.]+ tokens/.test(log()), "every buy carried a slippage floor from a fresh quote");

  // a restart keeps the books
  engine!.kill("SIGKILL");
  engine = null;
  startEngine();
  const s2 = await until("the bot to come back", () => status());
  ok(s2.burnBudgetETH === st.burnBudgetETH && s2.totalWagesETH === st.totalWagesETH, "after a restart the burn budget and wages are exactly as before");
  engine!.kill("SIGKILL");
  engine = null;

  /* ───────── D · a graduated Pons token through Uniswap v4 ───────── */
  console.log("\nD · graduated path (real Uniswap v4 pool on the fork)");
  const main = new ethers.JsonRpcProvider(MAINNET, 4663, { staticNetwork: true });
  const INIT = ethers.id("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)");
  const head = await main.getBlockNumber();
  let gradToken = "";
  for (let to = head, n = 0; to > 0 && n < 40 && !gradToken; to -= 500_000, n++) {
    const logs = await main.getLogs({ address: POOL_MANAGER, topics: [INIT, null, ethers.zeroPadValue(ethers.ZeroAddress, 32)], fromBlock: Math.max(0, to - 499_999), toBlock: to });
    for (const l of logs.reverse()) {
      const [, , hooks] = ethers.AbiCoder.defaultAbiCoder().decode(["uint24", "int24", "address", "uint160", "int24"], l.data);
      if (ethers.getAddress(hooks) === MEME_HOOK) {
        gradToken = ethers.getAddress("0x" + l.topics[3].slice(26));
        break;
      }
    }
  }
  if (!gradToken) {
    finding("no graduated Pons pool (Pons meme hook) found on mainnet, so the v4 path could not be exercised");
  } else {
    const tokenCurve: string = await new ethers.Contract(gradToken, ["function curve() view returns (address)"], provider).curve();
    const sym = await erc20(gradToken).symbol().catch(() => "?");
    const key = await findGraduationPool(main, gradToken, tokenCurve);
    ok(key !== null, `findGraduationPool found ${sym}'s pool (fee ${key?.fee}, spacing ${key?.tickSpacing})`);
    if (key) {
      const amount = E("0.01");
      const quote = await quoteUniswapV4Buy(provider, ROUTER, buyer.address, gradToken, amount, key);
      ok(quote > 0n, `the simulated v4 quote for 0.01 ETH is ${fmt(quote)} ${sym}`);
      const tooGreedy = (quote * 105n) / 100n;
      const refused = await provider.call({ from: buyer.address, to: ROUTER, value: amount, data: buildUniswapV4Buy(gradToken, amount, key, 1800, tooGreedy) }).then(() => false, () => true);
      ok(refused, "a buy demanding 5% more than the quote reverts: the slippage floor is enforced on chain");
      const minOut = (quote * 97n) / 100n;
      const b0: bigint = await erc20(gradToken).balanceOf(buyer.address);
      const rc = await (await buyer.sendTransaction({ to: ROUTER, value: amount, data: buildUniswapV4Buy(gradToken, amount, key, 1800, minOut), gasLimit: 400000n })).wait();
      const got: bigint = (await erc20(gradToken).balanceOf(buyer.address)) - b0;
      ok(rc?.status === 1 && got >= minOut, `the bot's v4 calldata with a 3% floor bought ${fmt(got)} ${sym} for 0.01 ETH (gas ${rc?.gasUsed})`);
    }
  }

  console.log(`\n${passed} checks passed, ${findings.length} findings.`);
  for (const f of findings) console.log(`  - ${f}`);
}

main()
  .catch((e) => {
    console.error("\nFAILED:", e.shortMessage || e.message || e);
    process.exitCode = 1;
  })
  .finally(() => {
    engine?.kill("SIGKILL");
    setTimeout(() => process.exit(), 200);
  });
