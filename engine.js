/**
 * Last Buyer Wins — Engine v7
 * - Queue-based tx processing
 * - Dynamic minimum buy based on market cap (DexScreener)
 * - Shrinking timer: every 1 real-time minute → reset drops 5s, floor 10s
 * - WebSocket + poll backup
 */

require("dotenv").config();
const { startAutoClaimFees } = require("./claimFees");

const {
  Connection, PublicKey, Transaction, SystemProgram,
  Keypair, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} = require("@solana/web3.js");
const bs58 = require("bs58");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CREATOR_WALLET  = process.env.CREATOR_WALLET;
const TOKEN_CA        = process.env.TOKEN_CA;
const SOLANA_RPC          = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const SOLANA_TRACKER_KEY  = process.env.SOLANA_TRACKER_API_KEY || "";
const GAS_RESERVE_SOL     = parseFloat(process.env.GAS_RESERVE_SOL  || "0.1");
const TIMER_MS_MAX        = parseInt(process.env.TIMER_MS           || "60000");  // starting reset (60s)
const TIMER_MS_MIN        = parseInt(process.env.TIMER_MS_MIN       || "10000");  // floor (10s)
const TIMER_STEP_MS       = parseInt(process.env.TIMER_STEP_MS      || "5000");   // ms removed per minute
const MAX_HOLDER_PCT      = parseFloat(process.env.MAX_HOLDER_PCT   || "3.5");
const SPLIT_THRESHOLD     = parseFloat(process.env.SPLIT_THRESHOLD  || "1.0");
const POLL_MS             = 3000;

// Market-cap tiers — configurable via env, defaults match user spec
const MC_TIERS = [
  { maxUSD: 35_000,   minBuySol: parseFloat(process.env.MIN_BUY_TIER1 || "0.1") },
  { maxUSD: 100_000,  minBuySol: parseFloat(process.env.MIN_BUY_TIER2 || "0.5") },
  { maxUSD: Infinity, minBuySol: parseFloat(process.env.MIN_BUY_TIER3 || "1.0") },
];

// ── VALIDATE ──────────────────────────────────────────────────────────────────
["CREATOR_PRIVATE_KEY","FIREBASE_SERVICE_ACCOUNT_JSON","CREATOR_WALLET","TOKEN_CA"]
  .forEach(k => { if (!process.env[k]) { console.error(`Missing: ${k}`); process.exit(1); } });

// ── SOLANA ────────────────────────────────────────────────────────────────────
const WS_RPC     = SOLANA_RPC.replace("https://","wss://").replace("http://","ws://");
const connection = new Connection(SOLANA_RPC, { commitment:"confirmed", wsEndpoint: WS_RPC });
const creatorKP  = Keypair.fromSecretKey(bs58.decode(process.env.CREATOR_PRIVATE_KEY));

if (creatorKP.publicKey.toBase58() !== CREATOR_WALLET) {
  console.error("Key mismatch"); process.exit(1);
}

// ── FIREBASE ──────────────────────────────────────────────────────────────────
initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) });
const db = getFirestore();

// ── UTILS ─────────────────────────────────────────────────────────────────────
const log   = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function withRetry(fn, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries) throw e;
      const delay = e.message?.includes("429") ? 8000 * (i+1) : 2000 * (i+1);
      await sleep(delay);
    }
  }
}

async function getWalletBalance() {
  const lam = await withRetry(() => connection.getBalance(new PublicKey(CREATOR_WALLET)));
  return lam / LAMPORTS_PER_SOL;
}

async function sendSOL(to, lamports) {
  const tx = new Transaction().add(SystemProgram.transfer({
    fromPubkey: creatorKP.publicKey,
    toPubkey:   new PublicKey(to),
    lamports,
  }));
  return withRetry(() =>
    sendAndConfirmTransaction(connection, tx, [creatorKP], { commitment: "confirmed" })
  );
}

// ── DYNAMIC MIN BUY ───────────────────────────────────────────────────────────
function calcMinBuy(mcUSD) {
  for (const tier of MC_TIERS) {
    if (mcUSD < tier.maxUSD) return tier.minBuySol;
  }
  return MC_TIERS[MC_TIERS.length - 1].minBuySol;
}

let marketCapUSD     = 0;
let currentMinBuySol = MC_TIERS[0].minBuySol;

async function updateMarketCap() {
  try {
    let mc = 0;

    // Solana Tracker (primary, if key provided)
    if (SOLANA_TRACKER_KEY) {
      try {
        const res = await fetch(`https://data.solanatracker.io/tokens/${TOKEN_CA}`, {
          headers: { "x-api-key": SOLANA_TRACKER_KEY },
        });
        if (res.ok) {
          const data = await res.json();
          const pool = data?.pools?.[0];
          mc = pool?.marketCap?.usd || pool?.fdv?.usd || 0;
        }
      } catch {}
    }

    // DexScreener fallback
    if (!mc) {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${TOKEN_CA}`);
      if (res.ok) {
        const data = await res.json();
        const pairs = data?.pairs;
        if (pairs?.length) {
          const pair = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
          mc = pair.marketCap || pair.fdv || 0;
        }
      }
    }

    if (!mc) return;

    marketCapUSD = mc;
    const newMin = calcMinBuy(mc);
    if (newMin !== currentMinBuySol) {
      currentMinBuySol = newMin;
      log(`[MarketCap] $${mc.toLocaleString()} → min buy now ◎${newMin} SOL`);
    }
    await db.doc("lbw_stats/global").set({ marketCapUSD: mc, currentMinBuySol }, { merge: true }).catch(() => {});
  } catch (e) {
    log(`[MarketCap] error: ${e.message}`);
  }
}

async function marketCapLoop() {
  while (true) {
    await updateMarketCap();
    await sleep(60_000);
  }
}

// ── DYNAMIC TIMER (time-based) ────────────────────────────────────────────────
// Every 1 real-time minute elapsed in the round, reset duration drops by TIMER_STEP_MS.
// Floor: TIMER_MS_MIN (default 10s). Resets to TIMER_MS_MAX on new round.
let buyCountThisRound = 0; // display only
let roundStartTime    = Date.now();

function getResetMs() {
  const elapsedMin = (Date.now() - roundStartTime) / 60_000;
  const steps      = Math.floor(elapsedMin);
  return Math.max(TIMER_MS_MIN, TIMER_MS_MAX - steps * TIMER_STEP_MS);
}

// Pushes updated currentResetMs to Firestore every 30s so frontend stays in sync
async function timerShrinkLoop() {
  while (true) {
    await sleep(30_000);
    if (isPayingOut) continue;
    try {
      const newResetMs     = getResetMs();
      const roundElapsedMs = Math.floor(Date.now() - roundStartTime);
      await db.doc("lbw_stats/global").set({ currentResetMs: newResetMs, roundElapsedMs }, { merge: true });
    } catch {}
  }
}

// ── HOLDER CHECK ──────────────────────────────────────────────────────────────
async function isQualifiedBuyer(wallet) {
  try {
    const mintPub   = new PublicKey(TOKEN_CA);
    const walletPub = new PublicKey(wallet);
    const [tokenAccts, mintInfo] = await Promise.all([
      connection.getParsedTokenAccountsByOwner(walletPub, { mint: mintPub }),
      connection.getParsedAccountInfo(mintPub),
    ]);
    if (tokenAccts.value.length === 0) return { qualified: true, pct: 0 };
    const walletBal  = tokenAccts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0;
    const supplyRaw  = mintInfo.value?.data?.parsed?.info?.supply;
    const decimals   = mintInfo.value?.data?.parsed?.info?.decimals ?? 6;
    if (!supplyRaw) return { qualified: true, pct: 0 };
    const totalSupply = parseInt(supplyRaw) / Math.pow(10, decimals);
    const pct         = (walletBal / totalSupply) * 100;
    return { qualified: pct < MAX_HOLDER_PCT, pct };
  } catch {
    return { qualified: true, pct: 0 };
  }
}

// ── LEADERBOARD ───────────────────────────────────────────────────────────────
function calculateShares(entries, potSOL) {
  const n = entries.length;
  if (n === 0) return [];
  const useSplit = potSOL >= SPLIT_THRESHOLD && n > 1;
  return entries.map((e, i) => {
    let pct, sol;
    if (!useSplit || n === 1) {
      pct = i === 0 ? 100 : 0;
      sol = i === 0 ? potSOL : 0;
    } else if (i === 0) {
      pct = 50; sol = potSOL * 0.5;
    } else {
      pct = 50 / (n - 1);
      sol = (potSOL * 0.5) / (n - 1);
    }
    return { ...e, position: i + 1, sharePercent: Math.round(pct * 100) / 100, shareSol: Math.round(sol * 1e6) / 1e6 };
  });
}

function addToLeaderboard(current, newEntry) {
  const without = current.filter(e => e.wallet !== newEntry.wallet);
  return [newEntry, ...without].slice(0, 5);
}

// ── BLACKLIST ─────────────────────────────────────────────────────────────────
let blacklistedWallets = new Set();

function watchBlacklist() {
  db.doc("lbw_config/blacklist").onSnapshot(snap => {
    const wallets = snap.exists ? (snap.data().wallets || []) : [];
    blacklistedWallets = new Set(wallets.map(w => w.toLowerCase()));
    log(`[Blacklist] ${blacklistedWallets.size} wallet(s) loaded`);
  }, err => log(`[Blacklist] listener error: ${err.message}`));
}

// ── STATE ─────────────────────────────────────────────────────────────────────
let leaderboard    = [];
let roundNumber    = 0;
let winTimer       = null;
let isPayingOut    = false;
let processedSigs  = new Set();
let lastSigSeen    = null;
let lastLeaderTime = 0;
const LEADER_COOLDOWN = 2000;

// ── TX QUEUE ──────────────────────────────────────────────────────────────────
const txQueue    = [];
let queueRunning = false;

function enqueueTx(sig) {
  if (processedSigs.has(sig)) return;
  processedSigs.add(sig);
  if (processedSigs.size > 2000) {
    processedSigs = new Set(Array.from(processedSigs).slice(-1000));
  }
  txQueue.push(sig);
  runQueue();
}

async function runQueue() {
  if (queueRunning) return;
  queueRunning = true;
  while (txQueue.length > 0) {
    const sig = txQueue.shift();
    await processTx(sig).catch(() => {});
    await sleep(300);
  }
  queueRunning = false;
}

// ── FIRESTORE PUSH ────────────────────────────────────────────────────────────
async function pushState(potSOL) {
  const withShares     = calculateShares(leaderboard, potSOL);
  const resetMs        = getResetMs();
  const roundElapsedMs = Math.floor(Date.now() - roundStartTime);
  await db.doc("lbw_stats/global").set({
    currentPotSOL:     potSOL,
    splitThreshold:    SPLIT_THRESHOLD,
    currentMinBuySol,
    currentResetMs:    resetMs,
    buyCountThisRound,
    roundElapsedMs,
    leaderboard: withShares.map(e => ({
      position:     e.position,
      wallet:       e.wallet,
      amount:       e.amount,
      sharePercent: e.sharePercent,
      shareSol:     e.shareSol,
      sig:          e.sig || null,
      timestamp:    Timestamp.fromMillis(e.tsMs),
    })),
    lastBuyer:  leaderboard[0]?.wallet || null,
    lastBuyAt:  leaderboard[0] ? Timestamp.fromMillis(leaderboard[0].tsMs) : null,
    lastBuySOL: leaderboard[0]?.amount || null,
  }, { merge: true });
}

// ── TIMER ─────────────────────────────────────────────────────────────────────
function resetTimer() {
  if (winTimer) clearTimeout(winTimer);
  const resetMs        = getResetMs();
  const nextWinAt      = Date.now() + resetMs;
  const roundElapsedMs = Math.floor(Date.now() - roundStartTime);
  db.doc("lbw_stats/global")
    .set({ nextWinAt: Timestamp.fromMillis(nextWinAt), currentResetMs: resetMs, buyCountThisRound, roundElapsedMs }, { merge: true })
    .catch(() => {});
  winTimer = setTimeout(triggerPayout, resetMs);
  const elapsedMin = Math.floor(roundElapsedMs / 60_000);
  log(`  ⏱ Timer reset — ${resetMs / 1000}s (round min ${elapsedMin}, buy #${buyCountThisRound})`);
}

// ── ON QUALIFYING BUY ─────────────────────────────────────────────────────────
async function onBuy(wallet, solAmount, sig, tsMs) {
  const now = Date.now();
  if (now - lastLeaderTime < LEADER_COOLDOWN) return;
  lastLeaderTime = now;

  if (blacklistedWallets.has(wallet.toLowerCase())) {
    log(`  [skip] ${wallet.slice(0,8)}... blacklisted`);
    return;
  }

  const { qualified, pct } = await isQualifiedBuyer(wallet);
  if (!qualified) {
    log(`  [skip] ${wallet.slice(0,8)}... holds ${pct.toFixed(1)}% — disqualified`);
    return;
  }

  buyCountThisRound++;
  const resetMs = getResetMs();
  log(`  ★ LEADER: ${wallet.slice(0,8)}... ◎${solAmount.toFixed(4)} | Resets to: ${resetMs/1000}s | Buy #${buyCountThisRound}`);

  leaderboard = addToLeaderboard(leaderboard, { wallet, amount: solAmount, sig, tsMs });

  const bal = await getWalletBalance().catch(() => 0);
  const pot = Math.max(0, bal - GAS_RESERVE_SOL);
  await pushState(pot).catch(e => log(`  Firestore error: ${e.message}`));
  log(`  Pot: ◎${pot.toFixed(4)} | Players: ${leaderboard.length}/5 | MinBuy: ◎${currentMinBuySol}`);

  resetTimer();
}

// ── PAYOUT ────────────────────────────────────────────────────────────────────
async function triggerPayout() {
  if (isPayingOut) return;
  if (leaderboard.length === 0) { log("No players — resetting."); resetTimer(); return; }

  isPayingOut    = true;
  const snapshot = [...leaderboard];
  const n        = snapshot.length;

  log(`\n${"=".repeat(50)}`);
  log(`PAYOUT — Round ${roundNumber} — ${n} player${n>1?"s":""}`);

  try {
    const balSOL   = await getWalletBalance();
    let sendSOLAmt = balSOL - GAS_RESERVE_SOL;

    if (sendSOLAmt <= 0) {
      log("Pot empty — waiting 30s...");
      await sleep(30000);
      sendSOLAmt = (await getWalletBalance()) - GAS_RESERVE_SOL;
      if (sendSOLAmt <= 0) { log("Still empty — new round."); await startNewRound(); isPayingOut = false; return; }
    }

    const sendLam  = Math.floor(sendSOLAmt * LAMPORTS_PER_SOL);
    const useSplit = sendSOLAmt >= SPLIT_THRESHOLD && n > 1;
    log(`Pot: ◎${sendSOLAmt.toFixed(6)} | Split: ${useSplit ? `YES (${n} winners)` : "NO (last buyer takes all)"}`);

    const payouts = snapshot.map((e, i) => {
      let lam;
      if (!useSplit || n === 1) { lam = i === 0 ? sendLam : 0; }
      else if (i === 0)         { lam = Math.floor(sendLam / 2); }
      else                      { lam = Math.floor(sendLam / 2 / (n - 1)); }
      return { ...e, lam, sol: lam / LAMPORTS_PER_SOL };
    }).filter(p => p.lam > 0);

    const results = [];
    for (const p of payouts) {
      try {
        log(`  → ◎${p.sol.toFixed(6)} to pos ${p.position} ${p.wallet.slice(0,8)}...`);
        const txSig = await sendSOL(p.wallet, p.lam);
        log(`    ✓ ${txSig}`);
        results.push({ ...p, txSig, ok: true });
      } catch (e) {
        log(`    ✗ Failed: ${e.message}`);
        results.push({ ...p, txSig: null, ok: false });
      }
    }

    const totalPaid     = results.filter(r => r.ok).reduce((s, r) => s + r.sol, 0);
    const actualWinners = results.filter(r => r.ok && r.sol > 0);

    if (totalPaid > 0 && actualWinners.length > 0) {
      await db.collection("lbw_history").add({
        round: roundNumber, pot: sendSOLAmt, totalPaid,
        numWinners: actualWinners.length, splitUsed: useSplit,
        timestamp: Timestamp.now(),
        winners: actualWinners.map((r, i) => ({
          position: i + 1, wallet: r.wallet,
          buyAmount: r.amount, payout: r.sol, txSig: r.txSig || null,
        })),
      });
    } else {
      log("No SOL paid out — skipping history write.");
    }

    await db.doc("lbw_stats/global").set({
      totalPaid:   FieldValue.increment(totalPaid),
      totalRounds: FieldValue.increment(1),
      lastRoundAt: Timestamp.now(),
    }, { merge: true });

    const gs = await db.doc("lbw_stats/global").get();
    if (gs.exists && sendSOLAmt > (gs.data().biggestPot || 0)) {
      await db.doc("lbw_stats/global").set({ biggestPot: sendSOLAmt }, { merge: true });
    }

    log(`Done — ◎${totalPaid.toFixed(6)} paid out`);
    log(`${"=".repeat(50)}\n`);
  } catch (e) {
    log(`PAYOUT ERROR: ${e.message}`);
  }

  await startNewRound();
  isPayingOut = false;
}

// ── NEW ROUND ─────────────────────────────────────────────────────────────────
async function startNewRound() {
  roundNumber++;
  leaderboard       = [];
  processedSigs     = new Set();
  lastSigSeen       = null;
  lastLeaderTime    = 0;
  txQueue.length    = 0;
  buyCountThisRound = 0;
  roundStartTime    = Date.now();
  log(`Round ${roundNumber} started.`);

  const bal = await getWalletBalance().catch(() => 0);
  const pot = Math.max(0, bal - GAS_RESERVE_SOL);
  await db.doc("lbw_stats/global").set({
    currentPotSOL: pot, leaderboard: [],
    lastBuyer: null, lastBuyAt: null, lastBuySOL: null,
    nextWinAt:         Timestamp.fromMillis(Date.now() + TIMER_MS_MAX),
    currentResetMs:    TIMER_MS_MAX,
    buyCountThisRound: 0,
    roundElapsedMs:    0,
    currentMinBuySol,
  }, { merge: true });

  resetTimer();
}

// ── PROCESS ONE TX ────────────────────────────────────────────────────────────
async function processTx(sig) {
  try {
    const tx = await connection.getTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx?.meta) return;

    const accounts = tx.transaction.message.staticAccountKeys
                  || tx.transaction.message.accountKeys || [];
    const pre  = tx.meta.preBalances  || [];
    const post = tx.meta.postBalances || [];

    let maxDec = 0, buyerIdx = -1;
    for (let i = 0; i < pre.length; i++) {
      const dec = pre[i] - post[i];
      if (dec > maxDec && dec > 10_000) { maxDec = dec; buyerIdx = i; }
    }
    if (buyerIdx === -1) return;

    const solSpent = maxDec / LAMPORTS_PER_SOL;
    const buyer    = accounts[buyerIdx].toString();
    const skip = [
      CREATOR_WALLET, TOKEN_CA,
      "11111111111111111111111111111111",
      "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
      "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
    ];
    if (skip.includes(buyer)) return;

    const tsMs = tx.blockTime ? tx.blockTime * 1000 : Date.now();
    log(`  [tx] ${sig.slice(0,16)}... | ${buyer.slice(0,8)}... | ◎${solSpent.toFixed(4)}`);

    if (solSpent >= currentMinBuySol && !isPayingOut) {
      await onBuy(buyer, solSpent, sig, tsMs);
    }
  } catch (e) {
    if (!e.message?.includes("429")) return;
    log(`  [tx] 429 on ${sig.slice(0,12)} — will retry via poll`);
  }
}

// ── WEBSOCKET ─────────────────────────────────────────────────────────────────
function startWebSocket(mintPubkey) {
  log(`WebSocket subscribing to: ${TOKEN_CA}`);
  try {
    connection.onLogs(mintPubkey, ({ signature, err }) => {
      if (err || isPayingOut) return;
      enqueueTx(signature);
    }, "confirmed");
    log("WebSocket active.");
  } catch (e) {
    log(`WebSocket failed: ${e.message} — poll will handle detection`);
  }
}

// ── POLL BACKUP ───────────────────────────────────────────────────────────────
async function pollLoop(mintPubkey) {
  log(`Poll backup every ${POLL_MS/1000}s`);
  while (true) {
    await sleep(POLL_MS);
    if (isPayingOut) continue;
    try {
      const opts = { limit: 5, commitment: "confirmed" };
      if (lastSigSeen) opts.until = lastSigSeen;
      const sigs = await connection.getSignaturesForAddress(mintPubkey, opts);
      if (!sigs || sigs.length === 0) continue;
      if (!lastSigSeen) { lastSigSeen = sigs[0].signature; continue; }
      const fresh = sigs.filter(s => !s.err);
      if (fresh.length > 0) {
        lastSigSeen = fresh[0].signature;
        fresh.forEach(s => enqueueTx(s.signature));
      }
    } catch (e) { log(`  [poll] error: ${e.message}`); }
  }
}

// ── BALANCE LOOP ──────────────────────────────────────────────────────────────
async function balanceLoop() {
  while (true) {
    await sleep(5_000);
    try {
      const bal = await getWalletBalance();
      const pot = Math.max(0, bal - GAS_RESERVE_SOL);
      await db.doc("lbw_stats/global").set({ currentPotSOL: pot }, { merge: true });
    } catch {}
  }
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
console.log(`\n  LAST BUYER WINS — Engine v7\n`);
log(`Wallet         : ${CREATOR_WALLET}`);
log(`Token          : ${TOKEN_CA}`);
log(`Timer          : ${TIMER_MS_MAX/1000}s max → ${TIMER_MS_MIN/1000}s floor (shrinks ${TIMER_STEP_MS/1000}s per real minute)`);
log(`Min Buy Tiers  : ◎${MC_TIERS[0].minBuySol} (<$35k) | ◎${MC_TIERS[1].minBuySol} (<$100k) | ◎${MC_TIERS[2].minBuySol} ($100k+)`);
log(`Gas Reserve    : ◎${GAS_RESERVE_SOL}`);
log(`Split Threshold: ◎${SPLIT_THRESHOLD}`);
log(`Max Holding    : ${MAX_HOLDER_PCT}%`);
log("─".repeat(50));

db.doc("lbw_stats/global").get().then(snap => {
  if (!snap.exists) {
    db.doc("lbw_stats/global").set({
      currentPotSOL: 0, totalPaid: 0, totalRounds: 0, biggestPot: 0,
      leaderboard: [], lastBuyer: null, lastBuyAt: null,
      nextWinAt:         Timestamp.fromMillis(Date.now() + TIMER_MS_MAX),
      currentResetMs:    TIMER_MS_MAX,
      buyCountThisRound: 0,
      roundElapsedMs:    0,
      currentMinBuySol:  MC_TIERS[0].minBuySol,
      marketCapUSD:      0,
    });
    log("Firestore initialized.");
  }
}).catch(e => log(`Init error: ${e.message}`));

const mintPubkey = new PublicKey(TOKEN_CA);
startAutoClaimFees(connection, creatorKP, log);
watchBlacklist();
updateMarketCap();
startNewRound();
startWebSocket(mintPubkey);
pollLoop(mintPubkey);
balanceLoop();
marketCapLoop();
timerShrinkLoop();
