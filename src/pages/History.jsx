import { useState, useEffect, useMemo } from "react";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

const RAINBOW = "linear-gradient(90deg,#FF3366,#FF8C00,#FFD700,#39FF14,#00B4FF,#BF5FFF,#FF3366)";

const short  = (a) => a ? `${a.slice(0,4)}...${a.slice(-4)}` : "—";
const fmtSOL = (n, d=4) => (n == null ? "—" : Number(n).toFixed(d));
const fmtDate = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts.toMillis());
  return d.toLocaleDateString("en-US", { month:"short", day:"numeric" }) + " " +
         d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
};

function useWindowWidth() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}

function CopyWalletBtn({ wallet }) {
  const [copied, setCopied] = useState(false);
  const copy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(wallet).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} title="Copy wallet" style={{ background:"none", border:"none", cursor:"pointer", color:copied?"#BF5FFF":"var(--grey-dim)", fontSize:10, padding:"1px 3px", transition:"color 0.2s" }}>
      {copied ? "✓" : "⎘"}
    </button>
  );
}

function WalletCell({ wallet, fontSize=11, color="var(--white)" }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
      <span style={{ fontFamily:"'Space Mono',monospace", fontSize, color }}>{short(wallet)}</span>
      <CopyWalletBtn wallet={wallet}/>
      <a href={`https://solscan.io/account/${wallet}`} target="_blank" rel="noreferrer"
        style={{ color:"var(--grey-dim)", fontSize:10, textDecoration:"none", transition:"color 0.2s" }}
        onMouseEnter={e=>e.currentTarget.style.color="var(--pride-purple)"}
        onMouseLeave={e=>e.currentTarget.style.color="var(--grey-dim)"}
      >↗</a>
    </div>
  );
}

export default function History({ navigate }) {
  const width    = useWindowWidth();
  const isMobile = width < 768;

  const [rounds,   setRounds]   = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("rounds");

  useEffect(() => {
    const q = query(collection(db, "lbw_history"), orderBy("timestamp","desc"), limit(100));
    return onSnapshot(q, snap => {
      setRounds(snap.docs.map(d => ({ id:d.id, ...d.data() })));
      setLoading(false);
    });
  }, []);

  const hallOfFame = useMemo(() => {
    const map = {};
    rounds.forEach(round => {
      round.winners?.forEach((w, i) => {
        if (!w.wallet) return;
        if (!map[w.wallet]) map[w.wallet] = { wallet:w.wallet, firstWins:0, appearances:0, totalSol:0, biggest:0 };
        map[w.wallet].appearances++;
        map[w.wallet].totalSol += w.payout || 0;
        map[w.wallet].biggest   = Math.max(map[w.wallet].biggest, w.payout || 0);
        if (i === 0) map[w.wallet].firstWins++;
      });
    });
    return Object.values(map).sort((a, b) => b.totalSol - a.totalSol);
  }, [rounds]);

  const totalRounds = rounds.length;
  const totalPaid   = rounds.reduce((s, r) => s + (r.totalPaid || 0), 0);
  const biggestPot  = Math.max(0, ...rounds.map(r => r.pot || 0));
  const maxWinners  = Math.max(0, ...rounds.map(r => r.numWinners || 0));

  const tabStyle = (tab) => ({
    background:"none", border:"none", cursor:"pointer",
    fontFamily:"'Inter',sans-serif", fontSize:10, fontWeight:700, letterSpacing:3,
    color: activeTab === tab ? "#BF5FFF" : "var(--grey)",
    padding:"10px 18px",
    borderBottom: activeTab === tab ? "2px solid #BF5FFF" : "2px solid transparent",
    transition:"all 0.2s",
  });

  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column", position:"relative", zIndex:1 }}>

      {/* Rainbow pride stripe */}
      <div style={{
        position:"fixed", top:0, left:0, right:0, height:4, zIndex:200,
        background:RAINBOW, backgroundSize:"200% auto",
        animation:"rainbow-shift 4s linear infinite",
      }}/>

      {/* Header */}
      <header style={{ position:"fixed", top:4, left:0, right:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"space-between", padding:isMobile?"12px 16px":"14px 28px", background:"rgba(8,8,8,0.95)", borderBottom:"1px solid var(--border)", backdropFilter:"blur(12px)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <img src="/logo.png" alt="" style={{ width:isMobile?28:34, height:isMobile?28:34, objectFit:"cover", borderRadius:4 }}/>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:isMobile?15:20, letterSpacing:"0.12em", color:"var(--white)", lineHeight:1 }}>LAST BUYER WINS</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:isMobile?12:20 }}>
          {!isMobile && [["HOME",()=>navigate("home")],["HISTORY",()=>navigate("history")]].map(([l,fn]) => (
            <button key={l} onClick={fn} style={{ background:"none", border:"none", cursor:"pointer", fontFamily:"'Inter',sans-serif", fontSize:11, fontWeight:700, letterSpacing:3, color:l==="HISTORY"?"#BF5FFF":"var(--grey)", transition:"color 0.2s" }}>{l}</button>
          ))}

          {isMobile && (
            <button onClick={() => setMenuOpen(o=>!o)} style={{ background:"none", border:"1px solid var(--border)", borderRadius:3, cursor:"pointer", color:"var(--grey)", padding:"5px 10px", fontSize:13 }}>{menuOpen?"✕":"☰"}</button>
          )}
        </div>
      </header>

      {menuOpen && (
        <div style={{ position:"fixed", top:57, left:0, right:0, background:"var(--bg2)", borderBottom:"1px solid var(--border)", zIndex:99, padding:"12px 16px 20px" }}>
          {[["HOME",()=>{navigate("home");setMenuOpen(false);}],["HISTORY",()=>{navigate("history");setMenuOpen(false);}]].map(([l,fn]) => (
            <button key={l} onClick={fn} style={{ display:"block", width:"100%", background:"none", border:"none", cursor:"pointer", fontFamily:"'Inter',sans-serif", fontSize:14, fontWeight:700, letterSpacing:3, color:"var(--grey)", textAlign:"left", padding:"12px 0", borderBottom:"1px solid var(--border)" }}>{l}</button>
          ))}
        </div>
      )}

      <div style={{ marginTop:isMobile?57:67, flex:1, padding:isMobile?"24px 16px 60px":"40px 24px 80px", maxWidth:"var(--max-w)", margin:`${isMobile?57:67}px auto 0`, width:"100%" }}>

        {/* Page title */}
        <div style={{ marginBottom:24 }}>
          <div style={{ fontFamily:"'Inter',sans-serif", fontSize:9, fontWeight:700, letterSpacing:5, color:"var(--grey)", marginBottom:10 }}>ON-CHAIN RECORD</div>
          <h1 style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:isMobile?"clamp(36px,10vw,48px)":"clamp(48px,6vw,64px)", letterSpacing:"0.08em", color:"var(--white)", lineHeight:1, marginBottom:8 }}>
            WINNERS HISTORY
          </h1>
          <p style={{ fontFamily:"'Inter',sans-serif", fontSize:13, color:"var(--grey)", lineHeight:1.6 }}>Every round. Every winner. Every payout. All on-chain.</p>
        </div>

        {/* Summary stats */}
        {rounds.length > 0 && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:1, border:"1px solid var(--border)", borderRadius:4, overflow:"hidden", marginBottom:24 }}>
            {[
              { label:"TOTAL ROUNDS", value:totalRounds.toString() },
              { label:"TOTAL PAID",   value:`◎ ${fmtSOL(totalPaid)}` },
              { label:"BIGGEST POT",  value:`◎ ${fmtSOL(biggestPot)}` },
              { label:"MAX WINNERS",  value:`${maxWinners} wallets` },
            ].map(s => (
              <div key={s.label} style={{ padding:"16px 20px", background:"var(--bg2)", borderRight:"1px solid var(--border)" }}>
                <div style={{ fontFamily:"'Inter',sans-serif", fontSize:9, fontWeight:700, letterSpacing:4, color:"var(--grey-dim)", marginBottom:6 }}>{s.label}</div>
                <div style={{ fontFamily:"'Space Mono',monospace", fontSize:16, color:"var(--white)", fontWeight:700 }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tab switcher */}
        <div style={{ display:"flex", borderBottom:"1px solid var(--border)", marginBottom:20 }}>
          <button style={tabStyle("rounds")}    onClick={() => setActiveTab("rounds")}>ROUNDS</button>
          <button style={tabStyle("halloffame")} onClick={() => setActiveTab("halloffame")}>🏆 HALL OF FAME</button>
        </div>

        {/* ROUNDS TAB */}
        {activeTab === "rounds" && (
          loading ? (
            <div style={{ textAlign:"center", padding:60, fontFamily:"'Space Mono',monospace", fontSize:11, color:"var(--grey-dim)", letterSpacing:3 }}>LOADING...</div>
          ) : rounds.length === 0 ? (
            <div style={{ textAlign:"center", padding:80 }}>
              <div style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"var(--grey-dim)", letterSpacing:4, marginBottom:12 }}>NO ROUNDS YET</div>
              <button onClick={() => navigate("home")} className="btn btn-outline" style={{ marginTop:24 }}>GO TO GAME →</button>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:1, border:"1px solid var(--border)", borderRadius:4, overflow:"hidden" }}>
              {rounds.map((round, ri) => {
                const isOpen    = expanded === round.id;
                const topWinner = round.winners?.[0];
                return (
                  <div key={round.id} style={{ borderBottom:ri<rounds.length-1?"1px solid var(--border)":"none" }}>
                    <div
                      onClick={() => setExpanded(isOpen ? null : round.id)}
                      style={{
                        display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
                        padding:isMobile?"12px 14px":"16px 22px",
                        background:isOpen?"rgba(191,95,255,0.04)":ri%2===0?"var(--bg2)":"var(--bg3)",
                        cursor:"pointer", flexWrap:isMobile?"wrap":"nowrap",
                        borderLeft:isOpen?"2px solid #BF5FFF":"2px solid transparent",
                        transition:"all 0.2s",
                      }}
                      onMouseEnter={e => { if(!isOpen) e.currentTarget.style.background="rgba(191,95,255,0.02)"; }}
                      onMouseLeave={e => { if(!isOpen) e.currentTarget.style.background=ri%2===0?"var(--bg2)":"var(--bg3)"; }}
                    >
                      <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
                        {/* Round number circle */}
                        <div style={{
                          width:32, height:32, borderRadius:"50%", flexShrink:0,
                          display:"flex", alignItems:"center", justifyContent:"center",
                          background: isOpen
                            ? "linear-gradient(135deg,#FF3366,#FF8C00,#FFD700,#39FF14,#00B4FF,#BF5FFF)"
                            : "rgba(255,255,255,0.05)",
                          backgroundSize: isOpen ? "200% auto" : undefined,
                          animation: isOpen ? "rainbow-shift 3s linear infinite" : "none",
                          fontFamily:"'Space Mono',monospace", fontSize:10, fontWeight:700,
                          color:isOpen?"#000":"var(--grey-dim)",
                        }}>{round.round}</div>
                        <div>
                          <WalletCell wallet={topWinner?.wallet} fontSize={isMobile?10:12} color={isOpen?"#BF5FFF":"var(--white)"}/>
                          {round.numWinners > 1 && <span style={{ fontFamily:"'Inter',sans-serif", fontSize:9, color:"var(--grey)", marginLeft:4 }}>+{round.numWinners-1} more</span>}
                          <div style={{ fontFamily:"'Inter',sans-serif", fontSize:9, color:"var(--grey-dim)", marginTop:2 }}>{fmtDate(round.timestamp)}</div>
                        </div>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:isMobile?14:24, flexShrink:0 }}>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontFamily:"'Space Mono',monospace", fontSize:isMobile?13:15, color:"#BF5FFF", fontWeight:700 }}>◎ {fmtSOL(round.pot)}</div>
                          <div style={{ fontFamily:"'Inter',sans-serif", fontSize:9, color:"var(--grey-dim)", marginTop:2 }}>{round.numWinners} winner{round.numWinners>1?"s":""}</div>
                        </div>
                        <div style={{ fontFamily:"'Inter',sans-serif", fontSize:14, color:isOpen?"#BF5FFF":"var(--grey-dim)", transition:"color 0.2s" }}>{isOpen?"▲":"▼"}</div>
                      </div>
                    </div>

                    {isOpen && round.winners && (
                      <div style={{ padding:isMobile?"12px 14px":"16px 22px", background:"rgba(191,95,255,0.02)", borderTop:"1px solid rgba(191,95,255,0.1)", animation:"slide-up 0.25s ease" }}>
                        <div style={{ fontFamily:"'Inter',sans-serif", fontSize:9, fontWeight:700, letterSpacing:4, color:"var(--grey)", marginBottom:12 }}>WINNERS BREAKDOWN</div>
                        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                          {round.winners.map((w, wi) => (
                            <div key={wi} style={{
                              display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
                              padding:"10px 14px",
                              background:wi===0?"rgba(191,95,255,0.06)":"rgba(255,255,255,0.02)",
                              borderRadius:3,
                              border:wi===0?"1px solid rgba(191,95,255,0.25)":"1px solid rgba(255,255,255,0.04)",
                              flexWrap:"wrap",
                            }}>
                              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                                <div style={{
                                  width:24, height:24, borderRadius:"50%", flexShrink:0,
                                  display:"flex", alignItems:"center", justifyContent:"center",
                                  background: wi===0
                                    ? "linear-gradient(135deg,#FF3366,#FF8C00,#FFD700,#39FF14,#00B4FF,#BF5FFF)"
                                    : "rgba(255,255,255,0.05)",
                                  backgroundSize: wi===0 ? "200% auto" : undefined,
                                  animation: wi===0 ? "rainbow-shift 3s linear infinite" : "none",
                                  fontFamily:"'Space Mono',monospace", fontSize:9, fontWeight:700,
                                  color:wi===0?"#000":"var(--grey-dim)",
                                  boxShadow:wi===0?"0 0 12px rgba(191,95,255,0.4)":"none",
                                }}>
                                  {wi===0?"★":wi+1}
                                </div>
                                <div>
                                  <WalletCell wallet={w.wallet} fontSize={isMobile?10:12} color={wi===0?"#BF5FFF":"var(--white)"}/>
                                  {w.txSig && (
                                    <a href={`https://solscan.io/tx/${w.txSig}`} target="_blank" rel="noreferrer" style={{ fontFamily:"'Inter',sans-serif", fontSize:9, color:"var(--grey-dim)", textDecoration:"underline" }}>TX ↗</a>
                                  )}
                                </div>
                              </div>
                              <div style={{ textAlign:"right" }}>
                                <div style={{ fontFamily:"'Space Mono',monospace", fontSize:isMobile?12:14, color:wi===0?"#BF5FFF":"var(--white)", fontWeight:700 }}>◎ {fmtSOL(w.payout)}</div>
                                <div style={{ fontFamily:"'Inter',sans-serif", fontSize:9, color:"var(--grey-dim)", marginTop:2 }}>{wi===0?"50%":"split"} of pot</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* HALL OF FAME TAB */}
        {activeTab === "halloffame" && (
          <div>
            {loading ? (
              <div style={{ textAlign:"center", padding:60, fontFamily:"'Space Mono',monospace", fontSize:11, color:"var(--grey-dim)", letterSpacing:3 }}>LOADING...</div>
            ) : hallOfFame.length === 0 ? (
              <div style={{ textAlign:"center", padding:80 }}>
                <div style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"var(--grey-dim)", letterSpacing:4, marginBottom:12 }}>NO DATA YET</div>
                <div style={{ fontFamily:"'Inter',sans-serif", fontSize:13, color:"var(--grey-dim)" }}>The hall of fame fills up as rounds complete.</div>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                {/* Top 3 podium */}
                {hallOfFame.length >= 1 && (
                  <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":`repeat(${Math.min(hallOfFame.length,3)},1fr)`, gap:8, marginBottom:8 }}>
                    {hallOfFame.slice(0,3).map((entry, i) => {
                      const medal = ["🥇","🥈","🥉"][i];
                      const borderColor = ["#FFD700","#C0C0C0","#CD7F32"][i];
                      return (
                        <div key={entry.wallet} style={{ padding:"20px 18px", border:`1px solid ${borderColor}40`, borderRadius:4, background:`${borderColor}06`, position:"relative", overflow:"hidden", animation:"pop-in 0.4s ease" }}>
                          <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,transparent,${borderColor},transparent)` }}/>
                          <div style={{ fontSize:isMobile?22:28, marginBottom:10 }}>{medal}</div>
                          <WalletCell wallet={entry.wallet} fontSize={isMobile?11:13} color="var(--white)"/>
                          <div style={{ marginTop:10, display:"flex", flexDirection:"column", gap:4 }}>
                            <div>
                              <div style={{ fontFamily:"'Inter',sans-serif", fontSize:8, letterSpacing:3, color:"var(--grey-dim)" }}>TOTAL WON</div>
                              <div style={{ fontFamily:"'Space Mono',monospace", fontSize:18, color:"#BF5FFF", fontWeight:700 }}>◎ {fmtSOL(entry.totalSol)}</div>
                            </div>
                            <div style={{ display:"flex", gap:16, marginTop:4 }}>
                              <div>
                                <div style={{ fontFamily:"'Inter',sans-serif", fontSize:8, letterSpacing:3, color:"var(--grey-dim)", marginBottom:2 }}>1ST PLACE</div>
                                <div style={{ fontFamily:"'Space Mono',monospace", fontSize:13, color:"var(--white)" }}>{entry.firstWins}x</div>
                              </div>
                              <div>
                                <div style={{ fontFamily:"'Inter',sans-serif", fontSize:8, letterSpacing:3, color:"var(--grey-dim)", marginBottom:2 }}>APPEARANCES</div>
                                <div style={{ fontFamily:"'Space Mono',monospace", fontSize:13, color:"var(--white)" }}>{entry.appearances}x</div>
                              </div>
                              <div>
                                <div style={{ fontFamily:"'Inter',sans-serif", fontSize:8, letterSpacing:3, color:"var(--grey-dim)", marginBottom:2 }}>BEST WIN</div>
                                <div style={{ fontFamily:"'Space Mono',monospace", fontSize:13, color:"var(--white)" }}>◎{fmtSOL(entry.biggest)}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Full table */}
                {hallOfFame.length > 3 && (
                  <div style={{ border:"1px solid var(--border)", borderRadius:4, overflow:"hidden" }}>
                    <div style={{ display:"grid", gridTemplateColumns:isMobile?"28px 1fr 80px 70px":"28px 1fr 110px 90px 90px 80px", gap:isMobile?8:12, padding:isMobile?"8px 14px":"10px 20px", background:"var(--bg3)", borderBottom:"1px solid var(--border)" }}>
                      {["#","WALLET","TOTAL WON",...(isMobile?["1ST"]:["1ST PLACE","APPEARANCES","BEST WIN"])].map((h,i) => (
                        <div key={i} style={{ fontFamily:"'Inter',sans-serif", fontSize:8, fontWeight:700, letterSpacing:3, color:"var(--grey-dim)", textAlign:i>1?"right":"left" }}>{h}</div>
                      ))}
                    </div>
                    {hallOfFame.slice(3).map((entry, i) => (
                      <div key={entry.wallet} style={{ display:"grid", gridTemplateColumns:isMobile?"28px 1fr 80px 70px":"28px 1fr 110px 90px 90px 80px", gap:isMobile?8:12, alignItems:"center", padding:isMobile?"10px 14px":"12px 20px", background:i%2===0?"var(--bg2)":"var(--bg3)", borderBottom:"1px solid rgba(255,255,255,0.03)", animation:"fade-in 0.3s ease" }}>
                        <div style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"var(--grey-dim)", fontWeight:700 }}>{i+4}</div>
                        <WalletCell wallet={entry.wallet} fontSize={isMobile?10:12}/>
                        <div style={{ textAlign:"right", fontFamily:"'Space Mono',monospace", fontSize:isMobile?11:13, color:"#BF5FFF", fontWeight:700 }}>◎{fmtSOL(entry.totalSol)}</div>
                        <div style={{ textAlign:"right", fontFamily:"'Space Mono',monospace", fontSize:isMobile?10:12, color:"var(--white)" }}>{entry.firstWins}x</div>
                        {!isMobile && <div style={{ textAlign:"right", fontFamily:"'Space Mono',monospace", fontSize:12, color:"var(--grey)" }}>{entry.appearances}x</div>}
                        {!isMobile && <div style={{ textAlign:"right", fontFamily:"'Space Mono',monospace", fontSize:12, color:"var(--grey)" }}>◎{fmtSOL(entry.biggest)}</div>}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ fontFamily:"'Inter',sans-serif", fontSize:10, color:"var(--grey-dim)", textAlign:"center", marginTop:4 }}>
                  {hallOfFame.length} unique wallet{hallOfFame.length!==1?"s":""} · from {rounds.length} round{rounds.length!==1?"s":""}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <footer style={{ borderTop:"1px solid var(--border)", padding:"18px 24px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"var(--grey-dim)" }}>
          LAST BUYER WINS — ON SOLANA
        </div>
        <button onClick={() => navigate("home")} className="btn btn-outline" style={{ fontSize:10, padding:"8px 18px" }}>← BACK TO GAME</button>
      </footer>
    </div>
  );
}
