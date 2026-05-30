/**
 * claimFees.js — Auto-claim pump.fun + PumpSwap creator fees
 * Post-graduation: PumpSwap fees accumulate as WSOL in a token account.
 * This version handles WSOL correctly.
 */

const {
  PublicKey, Transaction, TransactionInstruction,
  SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} = require("@solana/web3.js");

const PUMP_PROGRAM_ID     = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMPSWAP_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const WSOL_MINT           = new PublicKey("So11111111111111111111111111111111111111112");
const TOKEN_PROGRAM_ID    = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

// Anchor discriminators
const PUMP_DISCRIMINATOR     = Buffer.from([20, 22, 86, 123, 198, 28, 219, 132]);
const PUMPSWAP_DISCRIMINATOR = Buffer.from([160, 57, 89, 42, 181, 139, 43, 66]);

const CLAIM_INTERVAL_MS  = 20_000;        // every 20 seconds
const MIN_CLAIM_LAMPORTS = 10_000_000;    // 0.01 SOL minimum

// ── PDA derivations ───────────────────────────────────────────────────────────
function derivePumpVault(creatorPubkey) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creatorPubkey.toBuffer()],
    PUMP_PROGRAM_ID
  );
  return pda;
}

function derivePumpEventAuthority() {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM_ID
  );
  return pda;
}

function derivePumpSwapVaultAuthority(creatorPubkey) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), creatorPubkey.toBuffer()],
    PUMPSWAP_PROGRAM_ID
  );
  return pda;
}

function derivePumpSwapEventAuthority() {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMPSWAP_PROGRAM_ID
  );
  return pda;
}

// Derive the associated token account for WSOL owned by a given authority
function deriveAssociatedTokenAccount(owner, mint) {
  const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bsn");
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM
  );
  return ata;
}

// ── pump.fun bonding curve claim ──────────────────────────────────────────────
async function claimPumpFees(connection, creatorKP, log) {
  const vaultPDA  = derivePumpVault(creatorKP.publicKey);
  const eventAuth = derivePumpEventAuthority();

  let balance = 0;
  try { balance = await connection.getBalance(vaultPDA); } catch { return 0; }

  if (balance <= MIN_CLAIM_LAMPORTS) {
    log(`  [pump.fun] vault: ◎${(balance/LAMPORTS_PER_SOL).toFixed(6)} — below threshold, skipping`);
    return 0;
  }

  log(`  [pump.fun] vault: ◎${(balance/LAMPORTS_PER_SOL).toFixed(6)} — claiming...`);

  try {
    const ix = new TransactionInstruction({
      programId: PUMP_PROGRAM_ID,
      data: PUMP_DISCRIMINATOR,
      keys: [
        { pubkey: creatorKP.publicKey,     isSigner: true,  isWritable: true  },
        { pubkey: vaultPDA,                isSigner: false, isWritable: true  },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: eventAuth,               isSigner: false, isWritable: false },
        { pubkey: PUMP_PROGRAM_ID,         isSigner: false, isWritable: false },
      ],
    });
    const sig = await sendAndConfirmTransaction(
      connection, new Transaction().add(ix), [creatorKP], { commitment: "confirmed" }
    );
    log(`  [pump.fun] ✓ Claimed ◎${(balance/LAMPORTS_PER_SOL).toFixed(6)} | TX: ${sig}`);
    return balance / LAMPORTS_PER_SOL;
  } catch (e) {
    const msg = e.message || "";
    if (msg.includes("AccountNotFound") || msg.includes("does not exist")) return 0;
    log(`  [pump.fun] Error: ${msg.split("\n")[0]}`);
    return 0;
  }
}

// ── PumpSwap post-graduation claim ────────────────────────────────────────────
// After migration, fees accumulate as WSOL in the vault authority's ATA.
// The collect_coin_creator_fee instruction unwraps them into creator wallet SOL.
async function claimPumpSwapFees(connection, creatorKP, log) {
  const vaultAuthority = derivePumpSwapVaultAuthority(creatorKP.publicKey);
  const eventAuth      = derivePumpSwapEventAuthority();

  // Check WSOL ATA balance — this is where post-graduation fees live
  const wsolATA = deriveAssociatedTokenAccount(vaultAuthority, WSOL_MINT);

  let wsolBalance = 0;
  try {
    const info = await connection.getTokenAccountBalance(wsolATA);
    wsolBalance = Math.floor((info.value.uiAmount || 0) * LAMPORTS_PER_SOL);
  } catch {
    // ATA might not exist yet or has no balance
    wsolBalance = 0;
  }

  // Also check native SOL balance on vault authority
  let nativeBal = 0;
  try { nativeBal = await connection.getBalance(vaultAuthority); } catch {}

  const RENT_EXEMPT = 890_880;
  const claimableNative = Math.max(0, nativeBal - RENT_EXEMPT);
  const totalClaimable  = wsolBalance + claimableNative;

  log(`  [pumpswap] WSOL: ◎${(wsolBalance/LAMPORTS_PER_SOL).toFixed(6)} | Native: ◎${(claimableNative/LAMPORTS_PER_SOL).toFixed(6)}`);

  if (totalClaimable < MIN_CLAIM_LAMPORTS) {
    log(`  [pumpswap] below threshold — skipping`);
    return 0;
  }

  log(`  [pumpswap] claiming ◎${(totalClaimable/LAMPORTS_PER_SOL).toFixed(6)}...`);

  try {
    const ix = new TransactionInstruction({
      programId: PUMPSWAP_PROGRAM_ID,
      data: PUMPSWAP_DISCRIMINATOR,
      keys: [
        { pubkey: creatorKP.publicKey,     isSigner: true,  isWritable: true  },
        { pubkey: vaultAuthority,          isSigner: false, isWritable: true  },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: eventAuth,               isSigner: false, isWritable: false },
        { pubkey: PUMPSWAP_PROGRAM_ID,     isSigner: false, isWritable: false },
      ],
    });
    const sig = await sendAndConfirmTransaction(
      connection, new Transaction().add(ix), [creatorKP], { commitment: "confirmed" }
    );
    log(`  [pumpswap] ✓ Claimed ◎${(totalClaimable/LAMPORTS_PER_SOL).toFixed(6)} | TX: ${sig}`);
    return totalClaimable / LAMPORTS_PER_SOL;
  } catch (e) {
    const msg = e.message || "";
    if (msg.includes("AccountNotFound") || msg.includes("does not exist")) return 0;
    if (msg.includes("custom program error") || msg.includes("0x")) {
      log(`  [pumpswap] Program error — fees may not be ready yet`);
      return 0;
    }
    log(`  [pumpswap] Error: ${msg.split("\n")[0]}`);
    return 0;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function claimAllFees(connection, creatorKP, log) {
  const pump     = await claimPumpFees(connection, creatorKP, log).catch(() => 0);
  const pumpSwap = await claimPumpSwapFees(connection, creatorKP, log).catch(() => 0);
  const total    = pump + pumpSwap;
  if (total > 0) log(`  [claim] Total claimed: ◎${total.toFixed(6)}`);
  return total;
}

function startAutoClaimFees(connection, creatorKP, log) {
  const pumpVault  = derivePumpVault(creatorKP.publicKey);
  const swapVault  = derivePumpSwapVaultAuthority(creatorKP.publicKey);
  const wsolATA    = deriveAssociatedTokenAccount(swapVault, WSOL_MINT);

  log(`[AutoClaim] pump.fun vault  : ${pumpVault.toBase58()}`);
  log(`[AutoClaim] PumpSwap vault  : ${swapVault.toBase58()}`);
  log(`[AutoClaim] WSOL ATA        : ${wsolATA.toBase58()}`);
  log(`[AutoClaim] Interval        : ${CLAIM_INTERVAL_MS/1000}s`);
  log(`[AutoClaim] Min threshold   : ◎${MIN_CLAIM_LAMPORTS/LAMPORTS_PER_SOL} SOL`);

  claimAllFees(connection, creatorKP, log).catch(() => {});
  setInterval(() => {
    claimAllFees(connection, creatorKP, log).catch(() => {});
  }, CLAIM_INTERVAL_MS);
}

module.exports = { startAutoClaimFees, claimAllFees };