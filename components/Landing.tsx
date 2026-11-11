"use client";
import { motion } from "framer-motion";

export function Nav({ onDemo }: { onDemo: () => void }) {
  return (
    <header className="sticky top-0 z-40 bg-bg/90 backdrop-blur hair-b" style={{ background: "color-mix(in srgb, var(--bg) 88%, transparent)" }}>
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-14 flex items-center gap-6">
        <a href="#top" className="flex items-center gap-2">
          <Logo />
          <span className="text-[16px] font-semibold tracking-tight">VitalSwitch</span>
        </a>
        <div className="flex-1" />
        <a href="#how" className="hidden sm:inline text-[14px] text-fg2 hover:text-fg">How it works</a>
        <button onClick={onDemo} className="btn btn-primary !h-8 !px-3 !text-[13px]">Try the demo</button>
      </div>
    </header>
  );
}

export function Logo({ size = 20 }: { size?: number }) {
  // A pulse line that switches track: the product in one mark.
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <rect width="20" height="20" rx="5" style={{ fill: "var(--fg)" }} />
      <path d="M3 11 H7 L8.5 6 L11 14.5 L12.5 9 H17" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--on-fg)" }} />
    </svg>
  );
}

/** Heartbeat that breaks (lab offline) and continues on a new track (rerouted). */
function Pulse() {
  const beat = (x: number) => `L${x},60 L${x + 10},60 L${x + 16},30 L${x + 24},88 L${x + 31},48 L${x + 37},60`;
  const a = `M0,60 ${beat(40)} ${beat(150)} L300,60 ${beat(300)} L400,60`;
  const b = `M400,60 L430,60`;
  const c = `M430,60 C470,60 470,110 510,110 ${beat(540).replace(/,60/g, ",110").replace(/,30/g, ",80").replace(/,88/g, ",138").replace(/,48/g, ",98")} L700,110 ${beat(700).replace(/,60/g, ",110").replace(/,30/g, ",80").replace(/,88/g, ",138").replace(/,48/g, ",98")} L860,110 C900,110 900,60 940,60 L1000,60`;
  const loop = { duration: 5.5, repeat: Infinity, repeatDelay: 1.2, ease: "linear" as const };
  return (
    <svg viewBox="0 0 1000 150" className="w-full h-auto" aria-hidden>
      <line x1="0" x2="1000" y1="60" y2="60" strokeDasharray="2 6" style={{ stroke: "var(--line-strong)" }} />
      <motion.path d={a} fill="none" strokeWidth="2.5" strokeLinejoin="round" style={{ stroke: "var(--fg)" }}
        initial={{ pathLength: 0 }} animate={{ pathLength: [0, 1, 1] }} transition={{ ...loop, times: [0, 0.4, 1] }} />
      <motion.path d={b} fill="none" strokeWidth="2.5" style={{ stroke: "var(--danger)" }}
        initial={{ pathLength: 0 }} animate={{ pathLength: [0, 0, 1, 1] }} transition={{ ...loop, times: [0, 0.4, 0.45, 1] }} />
      <motion.g initial={{ opacity: 0 }} animate={{ opacity: [0, 0, 1, 1] }} transition={{ ...loop, times: [0, 0.42, 0.46, 1] }}>
        <circle cx="430" cy="60" r="6" style={{ fill: "var(--danger)" }} />
        <text x="430" y="36" textAnchor="middle" fontSize="15" fontWeight="500" style={{ fill: "var(--danger)" }}>Lab offline</text>
      </motion.g>
      <motion.path d={c} fill="none" strokeWidth="2.5" strokeLinejoin="round" style={{ stroke: "var(--ok)" }}
        initial={{ pathLength: 0 }} animate={{ pathLength: [0, 0, 1, 1] }} transition={{ ...loop, times: [0, 0.48, 0.95, 1] }} />
      <motion.text x="660" y="148" textAnchor="middle" fontSize="15" fontWeight="500" style={{ fill: "var(--ok)" }}
        initial={{ opacity: 0 }} animate={{ opacity: [0, 0, 1, 1] }} transition={{ ...loop, times: [0, 0.6, 0.66, 1] }}>Rerouted by VitalSwitch</motion.text>
    </svg>
  );
}

export function Hero({ onDemo }: { onDemo: () => void }) {
  return (
    <section id="top" className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-20 sm:pt-28 pb-10">
      <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="text-[40px] sm:text-[60px] leading-[1.04] font-semibold tracking-[-0.035em] max-w-[20ch]">
        Keep hospital labs running through a cyberattack.
      </motion.h1>
      <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}
        className="text-[18px] text-fg2 mt-6 max-w-[64ch] leading-relaxed">
        VitalSwitch keeps hospital lab testing going during a cyberattack. When ransomware shuts down a hospital's main lab, urgent blood tests for heart attacks, strokes and sepsis are left with nowhere to go. VitalSwitch reads the incident report, checks what the hospital's own downtime rules allow, and sends each urgent test to a lab that still works, so doctors get results in time to treat their patients. A person approves the plan before anything moves.
      </motion.p>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }} className="mt-8 flex flex-wrap gap-3">
        <button onClick={onDemo} className="btn btn-primary btn-lg !px-6">Try the live demo</button>
        <a href="#how" className="btn btn-secondary btn-lg !px-6">How it works</a>
      </motion.div>
      <div className="mt-16"><Pulse /></div>
      <dl className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-y-6 hair-t pt-8">
        <div><dd className="text-[36px] font-semibold tracking-tight tnum">4 → 11</dd><dt className="text-[14px] text-fg2">urgent results on time, out of 12, in the demo outage</dt></div>
        <div><dd className="text-[36px] font-semibold tracking-tight tnum">5</dd><dt className="text-[14px] text-fg2">Clocked APIs turn the incident report into hard constraints</dt></div>
        <div><dd className="text-[36px] font-semibold tracking-tight tnum">&lt; 50 ms</dd><dt className="text-[14px] text-fg2">to re-plan when another lab goes down</dt></div>
      </dl>
    </section>
  );
}

/* ---------- how it works: three animated panels ---------- */

const inView = { initial: "hidden", whileInView: "show", viewport: { once: false, amount: 0.5 } } as const;

function ReadPanel() {
  const lines = [70, 92, 55, 88, 62, 80];
  return (
    <svg viewBox="0 0 240 150" className="w-full h-auto">
      <rect x="20" y="10" width="200" height="130" rx="8" style={{ fill: "var(--bg)", stroke: "var(--line-strong)" }} />
      {lines.map((w, i) => {
        const bad = i === 3;
        return (
          <g key={i}>
            <rect x="36" y={28 + i * 17} width={w * 1.6} height="6" rx="3" style={{ fill: bad ? "var(--danger-bg)" : "var(--bg-muted)" }} />
            {bad && (
              <motion.line x1="34" x2={38 + w * 1.6} y1={31 + i * 17} y2={31 + i * 17} strokeWidth="2" style={{ stroke: "var(--danger)" }}
                variants={{ hidden: { pathLength: 0 }, show: { pathLength: 1, transition: { delay: 0.4, duration: 0.5 } } }} />
            )}
            {(i === 1 || i === 4) && (
              <motion.rect x="36" y={28 + i * 17} width={w * 0.9} height="6" rx="3" style={{ fill: "var(--info)" }}
                variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { delay: 0.9 + i * 0.1 } } }} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function RulesPanel() {
  const cells = [1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1];
  return (
    <svg viewBox="0 0 240 150" className="w-full h-auto">
      {cells.map((ok, i) => {
        const x = 38 + (i % 5) * 34, y = 22 + Math.floor(i / 5) * 38;
        return (
          <motion.g key={i} variants={{ hidden: { opacity: 0, scale: 0.6 }, show: { opacity: 1, scale: 1, transition: { delay: 0.1 + i * 0.06 } } }} style={{ transformOrigin: `${x + 13}px ${y + 13}px` }}>
            <rect x={x} y={y} width="26" height="26" rx="6" style={{ fill: ok ? "var(--ok-bg)" : "var(--danger-bg)" }} />
            <text x={x + 13} y={y + 18} textAnchor="middle" fontSize="13" fontWeight="600" style={{ fill: ok ? "var(--ok)" : "var(--danger)" }}>{ok ? "✓" : "✕"}</text>
          </motion.g>
        );
      })}
    </svg>
  );
}

function ReroutePanel() {
  return (
    <svg viewBox="0 0 240 150" className="w-full h-auto">
      <rect x="14" y="58" width="60" height="34" rx="8" style={{ fill: "var(--bg)", stroke: "var(--line-strong)" }} />
      <text x="44" y="80" textAnchor="middle" fontSize="12" fontWeight="500" style={{ fill: "var(--fg)" }}>Ward</text>
      <rect x="166" y="16" width="60" height="34" rx="8" style={{ fill: "var(--danger-bg)", stroke: "var(--danger)" }} />
      <text x="196" y="38" textAnchor="middle" fontSize="12" fontWeight="500" style={{ fill: "var(--danger)" }}>Lab A</text>
      <rect x="166" y="100" width="60" height="34" rx="8" style={{ fill: "var(--bg)", stroke: "var(--ok)" }} strokeWidth="1.5" />
      <text x="196" y="122" textAnchor="middle" fontSize="12" fontWeight="500" style={{ fill: "var(--ok)" }}>Lab B</text>
      <path d="M74,75 C120,75 120,33 166,33" fill="none" strokeDasharray="3 5" style={{ stroke: "var(--danger)" }} />
      <motion.path d="M74,75 C120,75 120,117 166,117" fill="none" strokeWidth="2" style={{ stroke: "var(--ok)" }}
        variants={{ hidden: { pathLength: 0 }, show: { pathLength: 1, transition: { delay: 0.3, duration: 0.8 } } }} />
      <motion.circle r="5" style={{ fill: "var(--ok)" }}
        variants={{ hidden: { opacity: 0, cx: 74, cy: 75 }, show: { opacity: [0, 1, 1], cx: [74, 120, 166], cy: [75, 96, 117], transition: { delay: 1.1, duration: 1, repeat: Infinity, repeatDelay: 0.8 } } }} />
    </svg>
  );
}

export function HowItWorks() {
  const items = [
    { panel: <ReadPanel />, title: "Read the attack", body: "Clocked removes instructions planted by attackers, hides patient details, and works out exactly which labs and transport routes are down." },
    { panel: <RulesPanel />, title: "Check the rules", body: "Every possible backup route is checked against the hospital's approved downtime procedure. Anything it doesn't allow is off the table." },
    { panel: <ReroutePanel />, title: "Reroute, with sign-off", body: "The engine finds the plan that gets the most urgent results back in time. A coordinator approves it before anything moves." },
  ];
  return (
    <section id="how" className="max-w-[1200px] mx-auto px-4 sm:px-6 py-20 scroll-mt-14">
      <h2 className="text-[32px] sm:text-[40px] font-semibold tracking-[-0.03em]">How it works</h2>
      <div className="mt-10 grid md:grid-cols-3 gap-6">
        {items.map((it) => (
          <motion.div key={it.title} {...inView} className="box p-6">
            <div className="bg-subtle rounded-md">{it.panel}</div>
            <h3 className="text-[18px] font-semibold tracking-tight mt-5">{it.title}</h3>
            <p className="text-[15px] text-fg2 mt-2 leading-relaxed">{it.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
