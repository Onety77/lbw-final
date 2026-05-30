import { useState, useEffect, useRef } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";

const fmtTime = (ms) => {
  if (ms <= 0) return "00:00";
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2,"0")}:${String(s % 60).padStart(2,"0")}`;
};

export default function FloatingTimer({ navigate }) {
  const [countdown, setCountdown] = useState(60_000);
  const [visible,   setVisible]   = useState(true);
  const [soundOn,   setSoundOn]   = useState(false);
  const [resetSec,  setResetSec]  = useState(60);
  const [atFloor,   setAtFloor]   = useState(false);
  const [nextShrinkSec, setNextShrinkSec] = useState(null);

  const winAtRef     = useRef(null);
  const lastSecRef   = useRef(null);
  const audioCtxRef  = useRef(null);
  const soundOnRef   = useRef(false);
  const lockedRef    = useRef(false);
  const wasLockedRef = useRef(false);

  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);

  const ensureAudioCtx = () => {
    if (!audioCtxRef.current)
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtxRef.current.state === "suspended") audioCtxRef.current.resume();
    return audioCtxRef.current;
  };

  const playTick = (urgent) => {
    try {
      const ctx  = ensureAudioCtx();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = urgent ? 1000 : 520;
      gain.gain.setValueAtTime(urgent ? 0.12 : 0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.08);
    } catch {}
  };

  // Firestore listener
  useEffect(() => {
    return onSnapshot(doc(db, "lbw_stats", "global"), snap => {
      if (!snap.exists()) return;
      const d = snap.data();

      if (d.currentResetMs) {
        const rs = Math.round(d.currentResetMs / 1000);
        setResetSec(rs);
        setAtFloor(rs <= 10);
      }

      if (d.roundElapsedMs != null && d.currentResetMs) {
        const elapsedMin  = Math.floor(d.roundElapsedMs / 60_000);
        const nextShrinkMs = ((elapsedMin + 1) * 60_000) - d.roundElapsedMs;
        const rs = Math.round(d.currentResetMs / 1000);
        if (rs > 10) setNextShrinkSec(Math.ceil(nextShrinkMs / 1000));
        else         setNextShrinkSec(null);
      }

      if (d.nextWinAt) {
        const nextMs = d.nextWinAt.toMillis();
        if (nextMs > Date.now()) {
          if (lockedRef.current || wasLockedRef.current) {
            setVisible(true);
            wasLockedRef.current = false;
          }
          winAtRef.current  = nextMs;
          lockedRef.current = false;
          lastSecRef.current = null;
        }
      }
    });
  }, []);

  // Countdown interval + page title
  useEffect(() => {
    const id = setInterval(() => {
      if (!winAtRef.current) return;
      const rem = winAtRef.current - Date.now();

      if (rem <= 0) {
        setCountdown(0);
        if (!lockedRef.current) {
          lockedRef.current    = true;
          wasLockedRef.current = true;
          lastSecRef.current   = null;
          document.title       = "⏳ LAST BUYER WINS";
        }
        return;
      }

      if (lockedRef.current) return;
      setCountdown(rem);
      document.title = `[${fmtTime(rem)}] LAST BUYER WINS`;

      if (soundOnRef.current) {
        const sec = Math.floor(rem / 1000);
        if (sec !== lastSecRef.current) {
          lastSecRef.current = sec;
          playTick(rem < 15_000);
        }
      }
    }, 200);
    return () => {
      clearInterval(id);
      document.title = "LAST BUYER WINS";
    };
  }, []);

  if (!visible) return null;

  const urgent  = countdown > 0 && countdown < 15_000;
  const warning = countdown > 0 && countdown < 30_000 && !urgent;
  const color   = urgent ? "#FF2020" : warning ? "#FFB800" : "#39FF14";

  return (
    <div style={{ position:"fixed", bottom:24, right:24, zIndex:999, display:"flex", flexDirection:"column", alignItems:"flex-end", gap:5 }}>

      {/* Shrink info pill */}
      {!atFloor && nextShrinkSec && (
        <div style={{
          padding:"4px 11px", background:"rgba(13,13,13,0.92)",
          border:"1px solid rgba(255,255,255,0.06)", borderRadius:20,
          backdropFilter:"blur(8px)",
        }}>
          <span style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"#555", letterSpacing:1 }}>
            resets {resetSec}s
          </span>
          <span style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"#333", margin:"0 5px" }}>·</span>
          <span style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"#444", letterSpacing:1 }}>
            shrinks in {nextShrinkSec}s
          </span>
        </div>
      )}
      {atFloor && (
        <div style={{
          padding:"4px 11px", background:"rgba(13,13,13,0.92)",
          border:"1px solid rgba(255,255,255,0.06)", borderRadius:20,
          backdropFilter:"blur(8px)",
        }}>
          <span style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color: urgent?"#FF2020":"#FFB800", letterSpacing:1 }}>
            floor · resets {resetSec}s
          </span>
        </div>
      )}

      {/* Main pill */}
      <div style={{
        display:"flex", alignItems:"center", gap:10,
        padding:"10px 16px",
        background:"rgba(13,13,13,0.95)",
        border:`1px solid ${color}44`,
        borderRadius:40, backdropFilter:"blur(12px)",
        boxShadow: urgent
          ? `0 0 24px rgba(255,32,32,0.4), 0 4px 20px rgba(0,0,0,0.5)`
          : `0 0 16px ${color}22, 0 4px 20px rgba(0,0,0,0.5)`,
        animation: urgent ? "urgent-shake 0.4s ease infinite" : "fade-in 0.4s ease",
        transition:"border-color 0.3s, box-shadow 0.3s",
        userSelect:"none",
      }}>
        <div style={{ width:8, height:8, borderRadius:"50%", background:color, boxShadow:`0 0 8px ${color}`, animation:"blink 1.5s ease infinite", flexShrink:0 }}/>

        <div style={{
          fontFamily:"'Space Mono',monospace", fontSize:18, fontWeight:700,
          color, letterSpacing:"-0.02em", lineHeight:1,
          animation: urgent ? "countdown-pulse 0.5s ease infinite" : "none",
        }}>
          {fmtTime(countdown)}
        </div>

        <button
          onClick={()=>{ ensureAudioCtx(); setSoundOn(s=>!s); }}
          title={soundOn ? "Mute ticking" : "Enable ticking"}
          style={{ background:"none", border:"none", cursor:"pointer", fontSize:12, lineHeight:1, padding:"0 2px", opacity:soundOn?1:0.35, transition:"opacity 0.2s" }}
        >🔔</button>

        <button
          onClick={()=>setVisible(false)}
          title="Hide until next round"
          style={{ background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.3)", fontSize:13, lineHeight:1, padding:"0 0 0 2px", transition:"color 0.2s" }}
          onMouseEnter={e=>e.currentTarget.style.color="rgba(255,255,255,0.7)"}
          onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.3)"}
        >×</button>
      </div>
    </div>
  );
}
