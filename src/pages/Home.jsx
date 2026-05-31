import { useState, useEffect, useRef } from "react";
import { doc, onSnapshot, collection, query, orderBy, limit } from "firebase/firestore";
import { db } from "../firebase";

const TOKEN_CA = "87oG6xRvgJfwbxB4sZAAcYewFozT5w6abX5wFCirpump";
const PUMP_URL = "https://pump.fun/coin/" + TOKEN_CA;
const X_URL    = "https://https://x.com/lastbuyerwins26";

const short   = (a) => a ? `${a.slice(0,4)}...${a.slice(-4)}` : "—";
const fmtSOL  = (n, d=4) => n == null ? "—" : Number(n).toFixed(d);
const fmtTime = (ms) => {
  if (ms <= 0) return "00:00";
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2,"0")}:${String(s % 60).padStart(2,"0")}`;
};
const timeAgo = (ms) => {
  if (!ms) return "";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5)  return "now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
};
const fmtMC = (usd) => {
  if (!usd) return null;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000)     return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd.toFixed(0)}`;
};

const RAINBOW = "linear-gradient(90deg,#FF3366,#FF8C00,#FFD700,#39FF14,#00B4FF,#BF5FFF,#FF3366)";

// ── Confetti ──────────────────────────────────────────────────────────────────
function Confetti() {
  const PRIDE_COLORS = ["#FF3366","#FF8C00","#FFD700","#39FF14","#00B4FF","#BF5FFF","#FF69B4","#fff"];
  const pieces = Array.from({ length: 60 }, (_, i) => ({
    id: i, x: Math.random() * 100, delay: Math.random() * 0.8,
    dur: 1.5 + Math.random() * 1.5,
    color: PRIDE_COLORS[i % PRIDE_COLORS.length],
    size: 4 + Math.random() * 7, rot: Math.random() * 360,
  }));
  return (
    <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:9999, overflow:"hidden" }}>
      {pieces.map(p => (
        <div key={p.id} style={{
          position:"absolute", left:`${p.x}%`, top:"-20px",
          width:p.size, height:p.size, background:p.color,
          borderRadius: p.id % 3 === 0 ? "50%" : 2,
          transform:`rotate(${p.rot}deg)`,
          animation:`confetti-fall ${p.dur}s ease-in ${p.delay}s forwards`,
        }}/>
      ))}
    </div>
  );
}

// ── Buy toast ─────────────────────────────────────────────────────────────────
function BuyToast({ toasts }) {
  return (
    <div style={{ position:"fixed", top:72, right:20, zIndex:500, display:"flex", flexDirection:"column", gap:6, pointerEvents:"none", alignItems:"flex-end" }}>
      {toasts.slice(-2).map(t => (
        <div key={t.id} style={{
          padding:"7px 14px", background:"rgba(13,13,13,0.96)",
          border:"1px solid rgba(191,95,255,0.3)", borderRadius:24,
          backdropFilter:"blur(16px)", display:"flex", alignItems:"center", gap:10,
          animation:"toast-in 0.25s ease", boxShadow:"0 4px 20px rgba(0,0,0,0.5)",
          whiteSpace:"nowrap",
        }}>
          <div style={{ width:5, height:5, borderRadius:"50%", flexShrink:0, animation:"pride-dot-cycle 3s linear infinite" }}/>
          <span style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"var(--white)" }}>{short(t.wallet)}</span>
          <span style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#BF5FFF", fontWeight:700 }}>◎{fmtSOL(t.amount, 3)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Rules modal ───────────────────────────────────────────────────────────────
function RulesModal({ onClose, minBuy }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rules = [
    {
      n:"01", title:"BUY THE TOKEN",
      body:`Purchase the token on pump.fun. Your transaction must spend at least ◎${minBuy.toFixed(1)} SOL to qualify. The minimum buy increases automatically as the market cap grows — ◎0.1 at seed stage, ◎0.5 at growth, ◎1.0 at blue chip.`,
    },
    {
      n:"02", title:"TAKE THE LEAD",
      body:"Every qualifying buy resets the countdown timer and moves your wallet to position #1 on the leaderboard. The most recent qualifying buyer is always the leader.",
    },
    {
      n:"03", title:"THE SHRINKING TIMER",
      body:"The countdown starts at 60 seconds each round. For every real-time minute that passes, the reset duration drops by 5 seconds — down to a floor of 10 seconds. The longer a round runs, the more intense the pressure. Once the floor is reached, it stays at 10s until someone wins.",
    },
    {
      n:"04", title:"WINNERS & PAYOUTS",
      body:"When the timer hits zero, payouts fire automatically on-chain. Position #1 (last buyer) receives 50% of the pot. Positions #2 through #5 split the remaining 50% equally. Everything is verifiable on Solscan.",
    },
  ];

  return (
    <div onClick={onClose} style={{
      position:"fixed", inset:0, zIndex:1000,
      background:"rgba(0,0,0,0.88)", backdropFilter:"blur(10px)",
      display:"flex", alignItems:"center", justifyContent:"center",
      padding:24, animation:"fade-in 0.2s ease",
    }}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:"#0a0a0a", border:"1px solid rgba(191,95,255,0.18)",
        borderRadius:8, padding:"40px 36px", maxWidth:540, width:"100%",
        maxHeight:"90vh", overflowY:"auto",
        animation:"modal-slide-up 0.28s cubic-bezier(0.16,1,0.3,1)",
        boxShadow:"0 0 80px rgba(191,95,255,0.08), 0 32px 80px rgba(0,0,0,0.6)",
        position:"relative",
      }}>
        {/* Rainbow top line */}
        <div style={{ position:"absolute", top:0, left:0, right:0, height:2,
          background:RAINBOW, backgroundSize:"200% auto",
          animation:"rainbow-shift 4s linear infinite", borderRadius:"8px 8px 0 0" }}/>

        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:36 }}>
          <div>
            <div style={{ fontFamily:"'Inter',sans-serif", fontSize:9, fontWeight:700, letterSpacing:5, marginBottom:8, animation:"pride-text-cycle 6s linear infinite" }}>THE RULES</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:36, letterSpacing:"0.06em", color:"var(--white)", lineHeight:1 }}>HOW TO PLAY</div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"1px solid var(--border)", borderRadius:4, cursor:"pointer", color:"var(--grey)", width:36, height:36, fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transition:"all 0.2s" }}
            onMouseEnter={e=>{ e.currentTarget.style.borderColor="var(--pride-purple)"; e.currentTarget.style.color="var(--pride-purple)"; }}
            onMouseLeave={e=>{ e.currentTarget.style.borderColor="var(--border)"; e.currentTarget.style.color="var(--grey)"; }}
          >✕</button>
        </div>

        {rules.map((r, i) => (
          <div key={r.n} style={{ paddingBottom:28, marginBottom: i < rules.length-1 ? 28 : 24, borderBottom: i < rules.length-1 ? "1px solid var(--border)" : "none" }}>
            <div style={{ display:"flex", gap:18, alignItems:"flex-start" }}>
              <div style={{ fontFamily:"'Space Mono',monospace", fontSize:30, color:"rgba(191,95,255,0.12)", fontWeight:700, lineHeight:1, flexShrink:0, width:38, userSelect:"none" }}>{r.n}</div>
              <div>
                <div style={{ fontFamily:"'Inter',sans-serif", fontSize:12, fontWeight:800, letterSpacing:"0.1em", color:"var(--white)", marginBottom:10 }}>{r.title}</div>
                <div style={{ fontFamily:"'Inter',sans-serif", fontSize:13, color:"var(--grey)", lineHeight:1.75 }}>{r.body}</div>
              </div>
            </div>
          </div>
        ))}

        <div style={{ padding:"14px 18px", background:"rgba(255,32,32,0.04)", border:"1px solid rgba(255,32,32,0.14)", borderRadius:4 }}>
          <div style={{ fontFamily:"'Inter',sans-serif", fontSize:12, color:"var(--grey)", lineHeight:1.6 }}>
            <span style={{ color:"var(--red)", fontWeight:800, letterSpacing:1 }}>DISQUALIFIED:</span>{" "}
            Wallets holding ≥3.5% of token supply are excluded from the leaderboard. This prevents whale manipulation.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Leaderboard row ───────────────────────────────────────────────────────────
function LeaderRow({ entry, isMobile, animateIn, isWatched }) {
  const isFirst = entry.position === 1;
  const [copied, setCopied] = useState(false);

  const copyWallet = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(entry.wallet).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{
      display:"grid",
      gridTemplateColumns: isMobile ? "26px 1fr 74px" : "34px 1fr 100px 100px 68px",
      gap: isMobile ? 10 : 16,
      alignItems:"center",
      padding: isMobile ? "12px 16px" : "13px 24px",
      background: isWatched ? "rgba(255,184,0,0.03)" : "transparent",
      borderLeft: isWatched ? "2px solid var(--amber)" : "2px solid transparent",
      borderBottom:"1px solid rgba(255,255,255,0.025)",
      animation: animateIn ? "leader-enter 0.3s ease" : "none",
      transition:"background 0.3s",
    }}>
      {/* Position circle */}
      <div style={{
        width: isMobile?24:28, height: isMobile?24:28, borderRadius:"50%",
        display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
        background: isFirst
          ? RAINBOW
          : "rgba(255,255,255,0.05)",
        backgroundSize: isFirst ? "200% auto" : undefined,
        animation: isFirst ? "rainbow-shift 3s linear infinite" : "none",
        fontFamily:"'Space Mono',monospace",
        fontSize: isFirst ? (isMobile?11:13) : (isMobile?9:10),
        fontWeight:700, color: isFirst ? "#000" : "var(--grey-dim)",
        boxShadow: isFirst ? "0 0 16px rgba(191,95,255,0.5), 0 0 32px rgba(255,51,102,0.25)" : "none",
      }}>
        {isFirst ? "★" : entry.position}
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0 }}>
        <span style={{
          fontFamily:"'Space Mono',monospace", fontSize: isMobile?11:13,
          fontWeight: isFirst||isWatched ? 700 : 400,
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          ...(isFirst ? {
            background: RAINBOW,
            backgroundSize:"200% auto",
            WebkitBackgroundClip:"text",
            WebkitTextFillColor:"transparent",
            backgroundClip:"text",
            animation:"rainbow-shift 3s linear infinite",
          } : {
            color: isWatched ? "var(--amber)" : "var(--white)",
          }),
        }}>{short(entry.wallet)}</span>
        {isWatched && <span style={{ fontFamily:"'Inter',sans-serif", fontSize:8, fontWeight:700, color:"var(--amber)", flexShrink:0, letterSpacing:1 }}>YOU</span>}
        <button onClick={copyWallet} title="Copy" style={{ background:"none", border:"none", cursor:"pointer", color:copied?"#BF5FFF":"var(--grey-dim)", fontSize:10, padding:"1px 3px", flexShrink:0, transition:"color 0.2s" }}>
          {copied ? "✓" : "⎘"}
        </button>
        <a href={`https://solscan.io/account/${entry.wallet}`} target="_blank" rel="noreferrer"
          style={{ color:"var(--grey-dim)", fontSize:10, textDecoration:"none", flexShrink:0, transition:"color 0.2s" }}
          onMouseEnter={e=>e.currentTarget.style.color="var(--pride-purple)"}
          onMouseLeave={e=>e.currentTarget.style.color="var(--grey-dim)"}
        >↗</a>
      </div>

      <div style={{ textAlign:"right", fontFamily:"'Space Mono',monospace", fontSize: isMobile?10:11, color:"var(--grey)" }}>◎{fmtSOL(entry.amount)}</div>
      {!isMobile && <div style={{ textAlign:"right", fontFamily:"'Space Mono',monospace", fontSize:13, color: isFirst?"#BF5FFF":"var(--white)", fontWeight:700 }}>◎{fmtSOL(entry.shareSol)}</div>}
      {!isMobile && <div style={{ textAlign:"right", fontFamily:"'Inter',sans-serif", fontSize:10, color:"var(--grey-dim)" }}>{entry.timestamp ? timeAgo(entry.timestamp.toMillis()) : ""}</div>}
    </div>
  );
}

function Leaderboard({ entries, isMobile, watchedWallet }) {
  const prevTopRef = useRef(null);
  const [newTop, setNewTop] = useState(null);

  useEffect(() => {
    if (!entries?.length) return;
    const top = entries[0]?.wallet;
    if (top && top !== prevTopRef.current) {
      setNewTop(top);
      setTimeout(() => setNewTop(null), 500);
    }
    prevTopRef.current = top;
  }, [entries]);

  if (!entries?.length) {
    return (
      <div style={{ border:"1px solid var(--border)", borderRadius:4, background:"var(--bg2)", padding:"48px 24px", textAlign:"center" }}>
        <div style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"var(--grey-dim)", letterSpacing:4 }}>WAITING FOR FIRST BUY...</div>
        <div style={{ fontFamily:"'Inter',sans-serif", fontSize:12, color:"var(--grey-dim)", marginTop:8, opacity:0.6 }}>Be the first. Take the lead.</div>
      </div>
    );
  }

  return (
    <div style={{ border:"1px solid var(--border)", borderRadius:4, overflow:"hidden", background:"var(--bg2)" }}>
      <div style={{
        display:"grid",
        gridTemplateColumns: isMobile?"26px 1fr 74px":"34px 1fr 100px 100px 68px",
        gap: isMobile?10:16,
        padding: isMobile?"8px 16px":"9px 24px",
        background:"var(--bg3)", borderBottom:"1px solid var(--border)",
      }}>
        {["#","WALLET", isMobile?"SPENT":"BUY AMT", ...(isMobile?[]:["PAYOUT","WHEN"])].map((h, i) => (
          <div key={i} style={{ fontFamily:"'Inter',sans-serif", fontSize:8, fontWeight:700, letterSpacing:3, color:"var(--grey-dim)", textAlign:i>1?"right":"left" }}>{h}</div>
        ))}
      </div>
      {entries.map(e => (
        <LeaderRow key={e.wallet} entry={e} isMobile={isMobile} animateIn={e.wallet===newTop} isWatched={!!watchedWallet&&e.wallet.toLowerCase()===watchedWallet.toLowerCase()}/>
      ))}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Home({ navigate }) {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  const isMobile = w < 768;
  const isLive   = TOKEN_CA !== "PASTE_TOKEN_CA_HERE";

  const [stats,         setStats]         = useState(null);
  const [winners,       setWinners]       = useState([]);
  const [countdown,     setCountdown]     = useState(60_000);
  const [copiedCA,      setCopiedCA]      = useState(false);
  const [menuOpen,      setMenuOpen]      = useState(false);
  const [rulesOpen,     setRulesOpen]     = useState(false);
  const [confetti,      setConfetti]      = useState(false);
  const [toasts,        setToasts]        = useState([]);
  const [solPrice,      setSolPrice]      = useState(null);
  const [watchedWallet, setWatchedWallet] = useState(() => localStorage.getItem("lbw_watch") || "");
  const [trackInput,    setTrackInput]    = useState(() => localStorage.getItem("lbw_watch") || "");
  const [notifGranted,  setNotifGranted]  = useState(
    typeof Notification !== "undefined" && Notification.permission === "granted"
  );
  const [trackOpen, setTrackOpen] = useState(false);
  const [blacklist, setBlacklist] = useState(new Set());

  const winAtRef       = useRef(null);
  const prevRoundRef   = useRef(null);
  const prevLeaderRef  = useRef(null);
  const lockedRef      = useRef(false);
  const urgentNotifRef = useRef(false);

  useEffect(() => {
    return onSnapshot(doc(db,"lbw_stats","global"), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      setStats(d);
      if (d.nextWinAt) {
        const nextMs = d.nextWinAt.toMillis();
        if (nextMs > Date.now()) { winAtRef.current = nextMs; lockedRef.current = false; }
      }
      if (prevRoundRef.current !== null && d.totalRounds > prevRoundRef.current) {
        setConfetti(true);
        setTimeout(() => setConfetti(false), 4000);
        urgentNotifRef.current = false;
      }
      prevRoundRef.current = d.totalRounds ?? 0;
    });
  }, []);

  useEffect(() => {
    const lb = stats?.leaderboard;
    if (!lb?.length) return;
    const top = lb[0];
    if (top?.wallet && top.wallet !== prevLeaderRef.current) {
      if (prevLeaderRef.current !== null) {
        const id = Date.now();
        setToasts(t => [...t.slice(-1), { id, wallet:top.wallet, amount:top.amount }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
      }
      prevLeaderRef.current = top.wallet;
    }
  }, [stats?.leaderboard]);

  useEffect(() => {
    const q = query(collection(db,"lbw_history"), orderBy("timestamp","desc"), limit(5));
    return onSnapshot(q, snap => setWinners(snap.docs.map(d => ({ id:d.id, ...d.data() }))));
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (!winAtRef.current) return;
      const rem = winAtRef.current - Date.now();
      if (rem <= 0) { setCountdown(0); lockedRef.current = true; return; }
      if (lockedRef.current) return;
      setCountdown(rem);
      if (rem > 15_000) urgentNotifRef.current = false;
    }, 200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!watchedWallet || !notifGranted || urgentNotifRef.current) return;
    if (countdown <= 0 || countdown > 15_000) return;
    const lb = stats?.leaderboard || [];
    const idx = lb.findIndex(e => e.wallet.toLowerCase() === watchedWallet.toLowerCase());
    if (idx === -1) return;
    urgentNotifRef.current = true;
    try {
      new Notification(`⚠️ ${Math.ceil(countdown/1000)}s left — you're #${idx+1}!`, {
        body:`On the board. Could win ◎${fmtSOL(lb[idx]?.shareSol)} SOL.`,
        icon:"/logo.png", tag:"lbw-urgent",
      });
    } catch {}
  }, [countdown, stats?.leaderboard, watchedWallet, notifGranted]);

  useEffect(() => {
    return onSnapshot(doc(db, "lbw_config", "blacklist"), snap => {
      if (!snap.exists()) return;
      const wallets = snap.data().wallets || [];
      setBlacklist(new Set(wallets.map(w => w.toLowerCase())));
    });
  }, []);

  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const r = await window.fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
        const d = await r.json();
        if (d?.solana?.usd) setSolPrice(d.solana.usd);
      } catch {}
    };
    fetchPrice();
    const id = setInterval(fetchPrice, 60_000);
    return () => clearInterval(id);
  }, []);

  const saveWatchedWallet = (val) => {
    setWatchedWallet(val);
    localStorage.setItem("lbw_watch", val);
  };

  const currentPot     = stats?.currentPotSOL ?? null;
  const leaderboard    = (stats?.leaderboard || [])
    .filter(e => !blacklist.has(e.wallet.toLowerCase()))
    .map((e, i, arr) => ({
      ...e,
      position: i + 1,
      shareSol: i === 0
        ? (currentPot ?? 0) * 0.5
        : arr.length > 1 ? (currentPot ?? 0) * 0.5 / (arr.length - 1) : 0,
    }));
  const totalPaid      = stats?.totalPaid ?? 0;
  const totalRounds    = stats?.totalRounds ?? 0;
  const biggestPot     = stats?.biggestPot ?? 0;
  const minBuy         = stats?.currentMinBuySol ?? 0.1;
  const resetSec       = stats?.currentResetMs ? Math.round(stats.currentResetMs / 1000) : 60;
  const roundElapsedMs = stats?.roundElapsedMs ?? 0;
  const leader         = leaderboard[0];
  const potUSD         = currentPot != null && solPrice ? currentPot * solPrice : null;
  const urgent         = countdown > 0 && countdown < 15_000;
  const warning        = countdown > 0 && countdown < 30_000 && !urgent;
  const isNormal       = !urgent && !warning;
  const timerColor     = urgent ? "var(--red)" : warning ? "var(--amber)" : "var(--pride-purple)";
  const statusLabel    = countdown <= 0 ? "PROCESSING..." : urgent ? "FINAL COUNTDOWN" : warning ? "ENDING SOON" : "LIVE ROUND";

  const elapsedMin   = Math.floor(roundElapsedMs / 60_000);
  const nextShrinkMs = ((elapsedMin + 1) * 60_000) - roundElapsedMs;
  const atFloor      = resetSec <= 10;

  const mcUSD  = stats?.marketCapUSD ?? 0;
  const mcTier = mcUSD < 35_000  ? { label:"SEED",      color:"#39FF14" }
               : mcUSD < 100_000 ? { label:"GROWTH",    color:"#FFB800" }
               :                   { label:"BLUE CHIP",  color:"#FF2020" };

  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column", background:"var(--bg)" }}>
      {confetti && <Confetti />}
      <BuyToast toasts={toasts} />
      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} minBuy={minBuy} />}

      {/* Rainbow pride stripe — fixed above everything */}
      <div style={{
        position:"fixed", top:0, left:0, right:0, height:4, zIndex:300,
        background:RAINBOW, backgroundSize:"200% auto",
        animation:"rainbow-shift 4s linear infinite",
      }}/>

      {/* HEADER */}
      <header style={{
        position:"fixed", top:4, left:0, right:0, zIndex:200,
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding: isMobile?"12px 16px":"14px 32px",
        background:"rgba(6,6,6,0.94)", borderBottom:"1px solid var(--border)",
        backdropFilter:"blur(20px)",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <img src="/logo.png" alt="" style={{ width:isMobile?28:32, height:isMobile?28:32, borderRadius:4, objectFit:"cover" }}/>
          <div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:isMobile?15:18, letterSpacing:"0.1em", color:"var(--white)", lineHeight:1 }}>LAST BUYER WINS</div>
            {!isMobile && <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"var(--grey)", letterSpacing:3 }}>ON SOLANA</div>}
          </div>
        </div>
        <nav style={{ display:"flex", alignItems:"center", gap: isMobile?10:16 }}>
          {!isMobile && [["HOME",()=>navigate("home")],["HISTORY",()=>navigate("history")]].map(([l,fn]) => (
            <button key={l} onClick={fn} style={{ background:"none", border:"none", cursor:"pointer", fontFamily:"'Inter',sans-serif", fontSize:11, fontWeight:700, letterSpacing:3, color:"var(--grey)", transition:"color 0.2s" }}
              onMouseEnter={e=>e.currentTarget.style.color="var(--white)"}
              onMouseLeave={e=>e.currentTarget.style.color="var(--grey)"}
            >{l}</button>
          ))}

          <button onClick={()=>setRulesOpen(true)} style={{
            background:"none", border:"1px solid var(--border)", borderRadius:20,
            cursor:"pointer", fontFamily:"'Inter',sans-serif", fontSize:9, fontWeight:700,
            letterSpacing:2, color:"var(--grey)", padding:"5px 13px", transition:"all 0.2s",
          }}
            onMouseEnter={e=>{ e.currentTarget.style.borderColor="var(--pride-purple)"; e.currentTarget.style.color="var(--pride-purple)"; }}
            onMouseLeave={e=>{ e.currentTarget.style.borderColor="var(--border)"; e.currentTarget.style.color="var(--grey)"; }}
          >? RULES</button>
          <a href={X_URL} target="_blank" rel="noreferrer" style={{ fontFamily:"'Inter',sans-serif", fontSize:11, fontWeight:700, letterSpacing:2, color:"var(--grey)", textDecoration:"none", transition:"color 0.2s" }}
            onMouseEnter={e=>e.currentTarget.style.color="var(--white)"}
            onMouseLeave={e=>e.currentTarget.style.color="var(--grey)"}
          >𝕏</a>
          {isMobile && (
            <button onClick={()=>setMenuOpen(o=>!o)} style={{ background:"none", border:"1px solid var(--border)", borderRadius:3, cursor:"pointer", color:"var(--grey)", padding:"5px 10px", fontSize:13 }}>
              {menuOpen?"✕":"☰"}
            </button>
          )}
        </nav>
      </header>

      {menuOpen && (
        <div style={{ position:"fixed", top:isMobile?56:65, left:0, right:0, background:"var(--bg2)", borderBottom:"1px solid var(--border)", zIndex:199, padding:"12px 16px 20px", animation:"slide-down 0.2s ease" }}>
          {[["HOME",()=>{navigate("home");setMenuOpen(false);}],["HISTORY",()=>{navigate("history");setMenuOpen(false);}]].map(([l,fn]) => (
            <button key={l} onClick={fn} style={{ display:"block", width:"100%", background:"none", border:"none", cursor:"pointer", fontFamily:"'Inter',sans-serif", fontSize:14, fontWeight:700, letterSpacing:3, color:"var(--grey)", textAlign:"left", padding:"13px 0", borderBottom:"1px solid var(--border)" }}>{l}</button>
          ))}
        </div>
      )}

      {/* HERO */}
      <section style={{
        minHeight:"100vh", display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center",
        padding: isMobile?"92px 24px 64px":"104px 32px 80px",
        position:"relative", textAlign:"center", overflow:"hidden",
      }}>
        {/* Subtle grid */}
        <div style={{
          position:"absolute", inset:0, pointerEvents:"none",
          backgroundImage:`linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)`,
          backgroundSize:"64px 64px",
          maskImage:"radial-gradient(ellipse 70% 70% at 50% 40%, black 20%, transparent 100%)",
          WebkitMaskImage:"radial-gradient(ellipse 70% 70% at 50% 40%, black 20%, transparent 100%)",
        }}/>

        {/* Pride hero glow */}
        <div style={{
          position:"absolute", top:"36%", left:"50%", transform:"translate(-50%,-50%)",
          width:720, height:520, pointerEvents:"none", zIndex:0,
          ...(isNormal ? {
            animation:"pride-ambient 8s ease-in-out infinite",
          } : {
            background:`radial-gradient(ellipse, ${urgent?"rgba(255,32,32,0.1)":"rgba(255,184,0,0.07)"} 0%, transparent 65%)`,
            transition:"background 1.5s",
          }),
        }}/>

        {/* Status pill */}
        <div style={{
          display:"inline-flex", alignItems:"center", gap:8, padding:"6px 16px",
          border: isNormal ? "1px solid rgba(191,95,255,0.3)" : `1px solid ${timerColor}30`,
          borderRadius:24,
          background: isNormal ? "rgba(191,95,255,0.07)" : `${timerColor}08`,
          marginBottom:28, zIndex:1, animation:"fade-in 0.5s ease both",
          ...(isNormal && { animation:"pulse-pride 6s linear infinite" }),
        }}>
          <div style={{
            width:6, height:6, borderRadius:"50%", flexShrink:0,
            ...(isNormal ? {
              animation:"pride-dot-cycle 3s linear infinite, blink 2s ease infinite",
            } : {
              background:timerColor, boxShadow:`0 0 8px ${timerColor}`,
              animation:"blink 1.5s ease infinite",
            }),
          }}/>
          <span style={{
            fontFamily:"'Inter',sans-serif", fontSize:9, fontWeight:700, letterSpacing:"0.4em",
            ...(isNormal ? { animation:"pride-text-cycle 6s linear infinite" } : { color:timerColor }),
          }}>{statusLabel}</span>
        </div>

        {/* TIMER */}
        {isNormal ? (
          <div className="rainbow-timer" style={{
            fontFamily:"'Space Mono',monospace",
            fontSize: isMobile?"clamp(80px,20vw,130px)":"clamp(100px,13vw,172px)",
            fontWeight:700, lineHeight:0.88, letterSpacing:"-0.04em",
            zIndex:1, marginBottom:18,
          }}>
            {fmtTime(countdown)}
          </div>
        ) : (
          <div style={{
            fontFamily:"'Space Mono',monospace",
            fontSize: isMobile?"clamp(80px,20vw,130px)":"clamp(100px,13vw,172px)",
            fontWeight:700, lineHeight:0.88, letterSpacing:"-0.04em",
            color:timerColor, zIndex:1,
            animation: urgent ? "urgent-shake 0.35s ease infinite, countdown-pulse 0.5s ease infinite"
                     : "countdown-pulse 2s ease infinite",
            textShadow: urgent ? `0 0 80px ${timerColor}, 0 0 160px ${timerColor}44`
                      : `0 0 40px ${timerColor}88`,
            transition:"color 0.5s, text-shadow 0.5s",
            marginBottom:18,
          }}>
            {fmtTime(countdown)}
          </div>
        )}

        {/* Subtitle + shrink info */}
        <div style={{ zIndex:1, marginBottom:10, animation:"fade-in 0.8s ease both" }}>
          <div style={{ fontFamily:"'Inter',sans-serif", fontSize:10, fontWeight:700, letterSpacing:"0.45em", color:"var(--grey)", marginBottom:10 }}>
            UNTIL NEXT WINNER
          </div>
          <div style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"var(--grey-dim)", letterSpacing:1 }}>
            {atFloor
              ? <span style={{ color: urgent?"var(--red)":"var(--amber)" }}>floor reached · resets {resetSec}s</span>
              : `resets ${resetSec}s · shrinks in ${Math.ceil(nextShrinkMs / 1000)}s`
            }
          </div>
        </div>

        {/* Rainbow vertical divider */}
        <div style={{ width:1, height:44, background:"linear-gradient(180deg,#FF3366,#FF8C00,#FFD700,#39FF14,#00B4FF,#BF5FFF)", margin:"22px auto", zIndex:1, animation:"fade-in 0.9s ease both" }}/>

        {/* POT */}
        <div style={{ zIndex:1, marginBottom:32, animation:"fade-in 1s ease both" }}>
          <div style={{ fontFamily:"'Inter',sans-serif", fontSize:9, fontWeight:700, letterSpacing:5, color:"var(--grey-dim)", marginBottom:12 }}>CURRENT POT</div>
          <div style={{
            fontFamily:"'Space Mono',monospace",
            fontSize: isMobile?"clamp(32px,9vw,52px)":"clamp(40px,5vw,58px)",
            fontWeight:700, color:"var(--white)", lineHeight:1, letterSpacing:"-0.02em", marginBottom:8,
          }}>
            ◎ {fmtSOL(currentPot, 4)}
          </div>
          <div style={{ fontFamily:"'Inter',sans-serif", fontSize:13, color:"var(--grey)" }}>
            {potUSD != null && <span style={{ color:"rgba(191,95,255,0.7)", marginRight:12 }}>≈ ${potUSD.toFixed(0)}</span>}
            {leaderboard.length > 0 && <span>{leaderboard.length} wallet{leaderboard.length!==1?"s":""} competing</span>}
          </div>
        </div>

        {/* BUY CTA */}
        <div style={{ zIndex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:10, animation:"fade-in 1.1s ease both" }}>
          <a href={PUMP_URL} target="_blank" rel="noreferrer">
            <button className="btn btn-green" style={{
              fontSize: isMobile?14:15,
              padding: isMobile?"16px 36px":"18px 52px",
              letterSpacing:"0.1em",
            }}
              onMouseEnter={e=>{ e.currentTarget.style.transform="translateY(-2px)"; e.currentTarget.style.boxShadow="0 4px 40px rgba(191,95,255,0.55),0 0 80px rgba(255,51,102,0.25)"; }}
              onMouseLeave={e=>{ e.currentTarget.style.transform="translateY(0)"; e.currentTarget.style.boxShadow="0 0 28px rgba(191,95,255,0.25),0 0 50px rgba(255,51,102,0.1)"; }}
            >
              BUY ON PUMP.FUN <span style={{ fontSize:15 }}>↗</span>
            </button>
          </a>
          <div style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"var(--grey-dim)", letterSpacing:1 }}>
            min ◎{minBuy.toFixed(1)} SOL · top 5 share the pot · all on-chain
          </div>
        </div>

        {/* MC & Tier indicator */}
        {mcUSD > 0 && (
          <div style={{ zIndex:1, marginTop:28, animation:"fade-in 1.2s ease both", display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:5, height:5, borderRadius:"50%", background:mcTier.color, boxShadow:`0 0 6px ${mcTier.color}` }}/>
              <span style={{ fontFamily:"'Inter',sans-serif", fontSize:9, letterSpacing:3, color:"var(--grey-dim)" }}>MARKET CAP</span>
              <span style={{ fontFamily:"'Space Mono',monospace", fontSize:15, fontWeight:700, color:"var(--white)" }}>{fmtMC(mcUSD)}</span>
            </div>
            <div style={{ display:"flex", gap:2 }}>
              {[
                { label:"SEED",      min:"0.1", active: mcUSD < 35_000,                       color:"#39FF14" },
                { label:"GROWTH",    min:"0.5", active: mcUSD >= 35_000 && mcUSD < 100_000,   color:"#FFB800" },
                { label:"BLUE CHIP", min:"1.0", active: mcUSD >= 100_000,                     color:"#FF2020" },
              ].map(t => (
                <div key={t.label} style={{
                  padding: isMobile?"5px 10px":"5px 14px", borderRadius:3,
                  background: t.active ? `${t.color}12` : "transparent",
                  border:`1px solid ${t.active ? t.color+"55" : "rgba(255,255,255,0.06)"}`,
                  display:"flex", flexDirection:"column", alignItems:"center", gap:3,
                  transition:"all 0.4s",
                }}>
                  <span style={{ fontFamily:"'Inter',sans-serif", fontSize:7, fontWeight:700, letterSpacing:2, color: t.active ? t.color : "var(--grey-dim)" }}>{t.label}</span>
                  <span style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color: t.active ? "var(--white)" : "#333", fontWeight: t.active ? 700 : 400 }}>◎{t.min}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Scroll cue */}
        <div style={{ position:"absolute", bottom:28, left:"50%", transform:"translateX(-50%)", display:"flex", flexDirection:"column", alignItems:"center", gap:6, animation:"bounce-down 2.5s ease infinite", opacity:0.4 }}>
          <div style={{ width:1, height:28, background:"linear-gradient(#BF5FFF,transparent)" }}/>
          <div style={{ fontFamily:"'Inter',sans-serif", fontSize:8, letterSpacing:3, color:"var(--grey-dim)" }}>SCROLL</div>
        </div>
      </section>

      {/* LEADERBOARD */}
      <section style={{ padding: isMobile?"48px 16px 56px":"64px 32px 72px", maxWidth:880, margin:"0 auto", width:"100%" }}>
        <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:7, height:7, borderRadius:"50%", animation:"pride-dot-cycle 3s linear infinite, blink 2s ease infinite" }}/>
            <span style={{ fontFamily:"'Inter',sans-serif", fontSize:9, fontWeight:700, letterSpacing:5, color:"var(--white)" }}>LIVE LEADERBOARD</span>
          </div>
          <div style={{ flex:1, height:1, background:"linear-gradient(90deg,var(--border),transparent)" }}/>
          {leaderboard.length > 0 && <span style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"var(--grey-dim)" }}>{leaderboard.length}/5 spots</span>}
        </div>

        {/* Leader callout */}
        {leader && (
          <div style={{
            padding: isMobile?"16px 20px":"20px 28px",
            border:`1px solid ${urgent?"var(--red)":"rgba(191,95,255,0.5)"}`,
            borderRadius:6, marginBottom:8,
            background: urgent?"rgba(255,32,32,0.04)":"rgba(191,95,255,0.03)",
            animation: urgent?"pulse-red 1.5s ease-in-out infinite":"pulse-pride 6s linear infinite",
            display:"flex", alignItems:"center", justifyContent:"space-between", gap:16, flexWrap:"wrap",
          }}>
            <div>
              <div style={{
                fontFamily:"'Inter',sans-serif", fontSize:8, fontWeight:700, letterSpacing:4, marginBottom:7,
                ...(urgent ? { color:"var(--red)" } : { animation:"pride-text-cycle 6s linear infinite" }),
              }}>★ CURRENT LEADER — WINS 50%</div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontFamily:"'Space Mono',monospace", fontSize: isMobile?13:15, color:"var(--white)", fontWeight:700 }}>{short(leader.wallet)}</span>
                <button onClick={()=>navigator.clipboard.writeText(leader.wallet)} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--grey-dim)", fontSize:10, padding:"1px 3px" }}>⎘</button>
                <a href={`https://solscan.io/account/${leader.wallet}`} target="_blank" rel="noreferrer"
                  style={{ color:"var(--grey-dim)", fontSize:11, textDecoration:"none", transition:"color 0.2s" }}
                  onMouseEnter={e=>e.currentTarget.style.color="var(--pride-purple)"}
                  onMouseLeave={e=>e.currentTarget.style.color="var(--grey-dim)"}
                >↗</a>
              </div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontFamily:"'Space Mono',monospace", fontSize: isMobile?20:26, color: urgent?"var(--red)":"#BF5FFF", fontWeight:700, lineHeight:1 }}>◎ {fmtSOL(leader.shareSol)}</div>
              <div style={{ fontFamily:"'Inter',sans-serif", fontSize:9, color:"var(--grey)", marginTop:5 }}>if timer expires now</div>
            </div>
          </div>
        )}

        <Leaderboard entries={leaderboard} isMobile={isMobile} watchedWallet={watchedWallet}/>

        {leaderboard.length > 1 && (
          <div style={{ marginTop:8, padding:"10px 18px", border:"1px solid var(--border)", borderRadius:4, background:"var(--bg2)", display:"flex", alignItems:"center", gap:24, flexWrap:"wrap" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:6, height:6, borderRadius:"50%", animation:"pride-dot-cycle 3s linear infinite" }}/>
              <span style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"var(--grey)" }}>#1 gets 50% → ◎{fmtSOL(leaderboard[0]?.shareSol)}</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:"var(--grey-dim)" }}/>
              <span style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"var(--grey)" }}>#2–{leaderboard.length} split 50% → ◎{fmtSOL(leaderboard[1]?.shareSol)} each</span>
            </div>
          </div>
        )}

        {/* Track wallet */}
        <div style={{ marginTop:16 }}>
          <button onClick={()=>setTrackOpen(o=>!o)} style={{ background:"none", border:"1px solid var(--border)", borderRadius:3, cursor:"pointer", fontFamily:"'Inter',sans-serif", fontSize:9, fontWeight:700, letterSpacing:3, color:"var(--grey)", padding:"7px 14px", transition:"all 0.2s" }}
            onMouseEnter={e=>{ e.currentTarget.style.borderColor="var(--pride-purple)"; e.currentTarget.style.color="var(--pride-purple)"; }}
            onMouseLeave={e=>{ e.currentTarget.style.borderColor="var(--border)"; e.currentTarget.style.color="var(--grey)"; }}
          >{trackOpen?"▲ HIDE":"🔔 TRACK MY WALLET"}</button>

          {trackOpen && (
            <div style={{ marginTop:8, padding:16, border:"1px solid var(--border)", borderRadius:4, background:"var(--bg2)", animation:"slide-up 0.2s ease" }}>
              <div style={{ fontFamily:"'Inter',sans-serif", fontSize:9, fontWeight:700, letterSpacing:3, color:"var(--grey)", marginBottom:10 }}>GET ALERTED WHEN YOU'RE ON THE BOARD AND TIME IS RUNNING OUT</div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <input placeholder="Paste your wallet address..." value={trackInput} onChange={e=>setTrackInput(e.target.value)}
                  style={{ flex:1, minWidth:200, background:"rgba(255,255,255,0.03)", border:"1px solid var(--border)", borderRadius:3, padding:"9px 12px", fontFamily:"'Space Mono',monospace", fontSize:10, color:"var(--white)", outline:"none" }}
                  onFocus={e=>e.currentTarget.style.borderColor="var(--pride-purple)"}
                  onBlur={e=>e.currentTarget.style.borderColor="var(--border)"}
                />
                <button onClick={()=>{ saveWatchedWallet(trackInput.trim()); urgentNotifRef.current=false; }} className="btn btn-green" style={{ fontSize:10, padding:"9px 18px" }}>SAVE</button>
                {watchedWallet && <button onClick={()=>{ saveWatchedWallet(""); setTrackInput(""); }} className="btn btn-outline" style={{ fontSize:10, padding:"9px 14px" }}>CLEAR</button>}
              </div>
              {watchedWallet && (
                <div style={{ marginTop:8, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                  <span style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"#BF5FFF" }}>✓ Tracking {short(watchedWallet)}</span>
                  {!notifGranted ? (
                    <button onClick={async()=>{ const p=await Notification.requestPermission(); setNotifGranted(p==="granted"); }} style={{ background:"rgba(255,184,0,0.08)", border:"1px solid rgba(255,184,0,0.25)", borderRadius:3, cursor:"pointer", fontFamily:"'Inter',sans-serif", fontSize:9, fontWeight:700, letterSpacing:2, color:"var(--amber)", padding:"4px 10px" }}>ENABLE ALERTS 🔔</button>
                  ) : (
                    <span style={{ fontFamily:"'Inter',sans-serif", fontSize:9, color:"var(--grey-dim)" }}>◎ Browser alerts active</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* STATS STRIP */}
      <div style={{ borderTop:"1px solid var(--border)", borderBottom:"1px solid var(--border)", background:"rgba(191,95,255,0.008)" }}>
        <div style={{ maxWidth:880, margin:"0 auto", display:"grid", gridTemplateColumns: isMobile?"repeat(2,1fr)":"repeat(4,1fr)" }}>
          {[
            { label:"TOTAL PAID",    value:`◎ ${fmtSOL(totalPaid)}` },
            { label:"ROUNDS PLAYED", value:totalRounds.toString() },
            { label:"BIGGEST POT",   value:`◎ ${fmtSOL(biggestPot)}` },
            { label:"MIN BUY NOW",   value:`◎ ${minBuy.toFixed(1)} SOL` },
          ].map((s, i) => (
            <div key={s.label} style={{ padding: isMobile?"20px":"24px 28px", borderRight: i<3?"1px solid var(--border)":"none", borderBottom: isMobile&&i<2?"1px solid var(--border)":"none" }}>
              <div style={{ fontFamily:"'Inter',sans-serif", fontSize:8, fontWeight:700, letterSpacing:4, color:"var(--grey-dim)", marginBottom:8 }}>{s.label}</div>
              <div style={{ fontFamily:"'Space Mono',monospace", fontSize: isMobile?15:17, color:"var(--white)", fontWeight:700 }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* RECENT ROUNDS */}
      {winners.length > 0 && (
        <section style={{ padding: isMobile?"40px 16px":"56px 32px", maxWidth:880, margin:"0 auto", width:"100%" }}>
          <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:18 }}>
            <div style={{ flex:1, height:1, background:"linear-gradient(90deg,transparent,var(--border))" }}/>
            <span style={{ fontFamily:"'Inter',sans-serif", fontSize:9, fontWeight:700, letterSpacing:4, color:"var(--grey)", whiteSpace:"nowrap" }}>RECENT ROUNDS</span>
            <div style={{ flex:1, height:1, background:"linear-gradient(90deg,var(--border),transparent)" }}/>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:1, border:"1px solid var(--border)", borderRadius:4, overflow:"hidden" }}>
            {winners.map((w, i) => {
              const top = w.winners?.[0];
              return (
                <div key={w.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, padding: isMobile?"12px 16px":"14px 24px", background: i%2===0?"var(--bg2)":"var(--bg3)", flexWrap:"wrap" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"var(--grey-dim)", minWidth:22 }}>#{w.round}</div>
                    <div>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ fontFamily:"'Space Mono',monospace", fontSize:11, color:"var(--white)" }}>{short(top?.wallet)}</span>
                        {top?.wallet && <a href={`https://solscan.io/account/${top.wallet}`} target="_blank" rel="noreferrer"
                          style={{ color:"var(--grey-dim)", fontSize:10, textDecoration:"none", transition:"color 0.2s" }}
                          onMouseEnter={e=>e.currentTarget.style.color="var(--pride-purple)"}
                          onMouseLeave={e=>e.currentTarget.style.color="var(--grey-dim)"}
                        >↗</a>}
                        {w.numWinners>1 && <span style={{ fontFamily:"'Inter',sans-serif", fontSize:9, color:"var(--grey)" }}>+{w.numWinners-1} more</span>}
                      </div>
                      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:9, color:"var(--grey-dim)", marginTop:2 }}>{w.timestamp?timeAgo(w.timestamp.toMillis()):""}</div>
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontFamily:"'Space Mono',monospace", fontSize:13, color:"#BF5FFF", fontWeight:700 }}>◎ {fmtSOL(w.pot)}</div>
                    <div style={{ fontFamily:"'Inter',sans-serif", fontSize:9, color:"var(--grey-dim)", marginTop:2 }}>{w.numWinners} winner{w.numWinners>1?"s":""}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ textAlign:"center", marginTop:14 }}>
            <button onClick={()=>navigate("history")} className="btn btn-outline">VIEW ALL ROUNDS →</button>
          </div>
        </section>
      )}

      {/* CONTRACT */}
      <section style={{ padding: isMobile?"0 16px 56px":"0 32px 72px", maxWidth:880, margin:"0 auto", width:"100%" }}>
        <div style={{ border:"1px solid var(--border)", borderRadius:6, padding: isMobile?"20px":"28px", background:"var(--bg2)", position:"relative", overflow:"hidden" }}>
          {/* Rainbow top accent */}
          <div style={{ position:"absolute", top:0, left:0, right:0, height:1,
            background:RAINBOW, backgroundSize:"200% auto",
            animation:"rainbow-shift 4s linear infinite" }}/>
          <div style={{ fontFamily:"'Inter',sans-serif", fontSize:9, fontWeight:700, letterSpacing:4, color:"var(--grey)", marginBottom:10 }}>CONTRACT ADDRESS</div>
          <div style={{ fontFamily:"'Space Mono',monospace", fontSize: isMobile?9:11, color: isLive?"var(--white)":"var(--grey)", wordBreak:"break-all", lineHeight:1.7, marginBottom:16, fontStyle: isLive?"normal":"italic" }}>
            {isLive ? TOKEN_CA : "— contract address at launch —"}
          </div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            {isLive && <button onClick={()=>{ navigator.clipboard.writeText(TOKEN_CA); setCopiedCA(true); setTimeout(()=>setCopiedCA(false),2200); }} className="btn btn-green" style={{ fontSize:11, padding:"11px 22px" }}>{copiedCA?"COPIED ✓":"COPY CA"}</button>}
            <a href={X_URL} target="_blank" rel="noreferrer"><button className="btn btn-outline">𝕏 TWITTER</button></a>
            <button onClick={()=>navigate("history")} className="btn btn-outline">HISTORY →</button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop:"1px solid var(--border)", padding:"18px 32px", display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:"auto", flexWrap:"wrap", gap:12 }}>
        <div style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"var(--grey-dim)" }}>
          LAST BUYER WINS · SOLANA
        </div>
        {!isMobile && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"var(--grey-dim)", fontStyle:"italic" }}>Buy last. Win big.</div>}
        <a href={X_URL} target="_blank" rel="noreferrer" style={{ color:"var(--grey-dim)", textDecoration:"none", fontSize:10, letterSpacing:2 }}>𝕏</a>
      </footer>
    </div>
  );
}
