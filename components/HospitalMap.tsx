"use client";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, FlaskConical, Truck, Ban } from "lucide-react";
import { LABS, WARDS, labById, wardById } from "@/lib/scenario";
import type { LabId, WardId, Conditions } from "@/lib/scenario";
import type { TestOutcome } from "@/lib/engine";

export const LAB_COLOR: Record<LabId, string> = {
  core: "#5cc8ff",
  west: "#a78bfa",
  poc: "#ffb547",
  stmarys: "#2ef2b0",
  reference: "#f472b6",
};

type MapMode = "normal" | "stranded" | "plan";

interface Props {
  mode: MapMode;
  conditions: Conditions | null;
  outcomes: TestOutcome[] | null;
  simT: number; // minutes
  loopT: number; // free-running seconds for idle animation
  userDown: Partial<Record<LabId, boolean>>;
  interactive: boolean;
  onToggleLab?: (id: LabId) => void;
  focusTest?: string | null;
}

function anchor(id: WardId | LabId, side: "out" | "in") {
  const w = WARDS.find((x) => x.id === id);
  if (w) return { x: w.x + (side === "out" ? 52 : 0), y: w.y };
  const l = labById(id as LabId);
  return { x: l.x, y: l.y };
}

function ctrl(a: { x: number; y: number }, b: { x: number; y: number }, bend: number) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: mx - (dy / len) * bend, y: my + (dx / len) * bend };
}

function bez(a: any, c: any, b: any, s: number) {
  const u = 1 - s;
  return { x: u * u * a.x + 2 * u * s * c.x + s * s * b.x, y: u * u * a.y + 2 * u * s * c.y + s * s * b.y };
}

const BEND: Record<LabId, number> = { core: 18, west: -30, poc: -24, stmarys: 40, reference: -40 };

export default function HospitalMap({ mode, conditions, outcomes, simT, loopT, userDown, interactive, onToggleLab, focusTest }: Props) {
  const down = (id: LabId) => !!conditions?.labDown[id];
  const routes = new Map<string, { ward: WardId; lab: LabId }>();
  if (mode === "plan" && outcomes) for (const o of outcomes) routes.set(`${o.test.ward}-${o.lab}`, { ward: o.test.ward, lab: o.lab });
  if (mode !== "plan") for (const w of WARDS) routes.set(`${w.id}-core`, { ward: w.id, lab: "core" });

  const wardStats = (wid: WardId) => {
    const list = outcomes?.filter((o) => o.test.ward === wid) ?? [];
    return {
      waiting: mode === "plan" ? list.filter((o) => simT < o.dispatch).length : list.length,
      ok: mode === "plan" ? list.filter((o) => simT >= o.finish && o.onTime).length : 0,
      late: mode === "plan" ? list.filter((o) => (simT >= o.finish && !o.onTime) || (simT > o.test.deadline && simT < o.finish)).length : 0,
    };
  };

  return (
    <div className="relative w-full overflow-hidden rounded-2xl">
      <svg viewBox="0 0 1000 600" className="w-full h-auto select-none">
        <defs>
          <radialGradient id="glowRed"><stop offset="0%" stopColor="#ff3b4e" stopOpacity="0.55" /><stop offset="100%" stopColor="#ff3b4e" stopOpacity="0" /></radialGradient>
          <radialGradient id="glowVital"><stop offset="0%" stopColor="#2ef2b0" stopOpacity="0.35" /><stop offset="100%" stopColor="#2ef2b0" stopOpacity="0" /></radialGradient>
          <filter id="soft"><feGaussianBlur stdDeviation="3" /></filter>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#ff3b4e" strokeOpacity="0.35" strokeWidth="2" /></pattern>
        </defs>

        {/* campus */}
        <rect x="30" y="20" width="620" height="560" rx="28" fill="rgba(92,200,255,0.025)" stroke="rgba(92,200,255,0.16)" strokeDasharray="2 6" />
        <text x="380" y="566" className="mono" fontSize="11" fill="#5c6a86" letterSpacing="3">NORTHGATE GENERAL · CAMPUS</text>
        <rect x="690" y="20" width="290" height="560" rx="28" fill="rgba(46,242,176,0.015)" stroke="rgba(255,255,255,0.06)" strokeDasharray="2 6" />
        <text x="760" y="566" className="mono" fontSize="11" fill="#5c6a86" letterSpacing="3">PARTNER NETWORK</text>
        {/* road */}
        <path d="M650 300 C 700 300, 700 170, 770 170" stroke="#1c2538" strokeWidth="10" fill="none" strokeLinecap="round" />
        <path d="M650 300 C 720 300, 740 450, 810 450" stroke="#1c2538" strokeWidth="10" fill="none" strokeLinecap="round" />
        <text x="668" y="226" fontSize="10" className="mono" fill="#46536d">18 km</text>
        <text x="690" y="400" fontSize="10" className="mono" fill="#46536d">60 km</text>
        {conditions && !conditions.courierAvailable && (
          <g><circle cx="680" cy="300" r="14" fill="#2a0d12" stroke="#ff3b4e" /><text x="680" y="304" textAnchor="middle" fontSize="12" fill="#ff3b4e">✕</text></g>
        )}

        {/* routes */}
        {[...routes.values()].map(({ ward, lab }) => {
          const a = anchor(ward, "out"), b = anchor(lab, "in");
          const c = ctrl(a, b, BEND[lab]);
          const dead = down(lab);
          const color = dead ? "#ff3b4e" : mode === "plan" ? LAB_COLOR[lab] : "#5cc8ff";
          return (
            <motion.path
              key={`${ward}-${lab}-${mode}`}
              d={`M${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`}
              fill="none"
              stroke={color}
              strokeOpacity={dead ? 0.45 : mode === "plan" ? 0.55 : 0.32}
              strokeWidth={mode === "plan" ? 2.2 : 1.4}
              className={dead ? "" : "dash-flow"}
              strokeDasharray={dead ? "3 7" : undefined}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
            />
          );
        })}

        {/* labs */}
        {LABS.map((l) => {
          const isDown = down(l.id);
          const knocked = !!userDown[l.id];
          const col = isDown ? "#ff3b4e" : LAB_COLOR[l.id];
          const busy = outcomes?.filter((o) => o.lab === l.id && simT >= o.arrive && simT < o.finish).length ?? 0;
          const done = outcomes?.filter((o) => o.lab === l.id && simT >= o.finish).length ?? 0;
          const used = mode === "plan" && outcomes?.some((o) => o.lab === l.id);
          return (
            <g
              key={l.id}
              transform={`translate(${l.x},${l.y})`}
              onClick={() => interactive && l.id !== "core" && onToggleLab?.(l.id)}
              style={{ cursor: interactive && l.id !== "core" ? "pointer" : "default" }}
            >
              {isDown && <circle r="70" fill="url(#glowRed)" className="animate-pulse" />}
              {!isDown && used && <circle r="60" fill="url(#glowVital)" />}
              <circle r="38" fill="#0a0e18" stroke={col} strokeWidth="2" strokeOpacity={isDown ? 0.9 : 0.8} />
              {isDown && <circle r="38" fill="url(#hatch)" />}
              {!isDown && busy > 0 && (
                <motion.circle r="44" fill="none" stroke={col} strokeWidth="2" strokeDasharray="6 10"
                  animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 4, ease: "linear" }} />
              )}
              <g className={isDown ? "glitch" : ""}>
                <foreignObject x="-14" y="-24" width="28" height="28">
                  <div style={{ color: col }} className="flex items-center justify-center w-7 h-7">
                    {isDown ? (knocked ? <Ban size={20} /> : <Lock size={20} />) : l.kind === "external" ? <Truck size={20} /> : <FlaskConical size={20} />}
                  </div>
                </foreignObject>
                <text y="18" textAnchor="middle" fontSize="12" fontWeight="700" fill={col} className="mono" letterSpacing="1">{l.short}</text>
              </g>
              <text y="58" textAnchor="middle" fontSize="11.5" fill={isDown ? "#ff8a96" : "#c9d3e6"} fontWeight="600">{l.name}</text>
              <text y="73" textAnchor="middle" fontSize="10" fill={isDown ? "#ff3b4e" : "#64748b"} className="mono">
                {isDown ? (knocked ? "KNOCKED OUT BY YOU" : l.id === "core" ? "ENCRYPTED · ISOLATED" : "OFFLINE") : `${l.analyzers} analyzer${l.analyzers > 1 ? "s" : ""}${mode === "plan" ? ` · ${done} done` : ""}`}
              </text>
              {interactive && knocked && (
                <text y="-48" textAnchor="middle" fontSize="9.5" fill="#ff8a96" className="mono">click to restore</text>
              )}
            </g>
          );
        })}

        {/* wards */}
        {WARDS.map((w) => {
          const st = wardStats(w.id);
          const stranded = mode === "stranded";
          return (
            <g key={w.id} transform={`translate(${w.x - 62},${w.y - 26})`}>
              <rect width="114" height="52" rx="12" fill="#0a0e18" stroke={stranded ? "#ff3b4e" : "rgba(255,255,255,0.12)"} strokeOpacity={stranded ? 0.7 : 1} />
              <text x="12" y="21" fontSize="12" fontWeight="700" fill="#e6ebf5" className="mono">{w.short}</text>
              <text x="12" y="38" fontSize="9.5" fill="#7c8aa5">{w.name.split(" ")[0]}</text>
              <g transform="translate(78,10)">
                {st.waiting > 0 && <text x="0" y="12" fontSize="11" fill={stranded ? "#ff3b4e" : "#94a3b8"} className="mono" fontWeight="700">{st.waiting}⧗</text>}
                {st.ok > 0 && <text x="0" y="27" fontSize="11" fill="#2ef2b0" className="mono" fontWeight="700">{st.ok}✓</text>}
                {st.late > 0 && <text x={st.ok > 0 ? 22 : 0} y="27" fontSize="11" fill="#ff3b4e" className="mono" fontWeight="700">{st.late}✕</text>}
              </g>
            </g>
          );
        })}

        {/* specimens */}
        <AnimatePresence>
          {outcomes?.map((o, i) => {
            const ward = wardById(o.test.ward);
            const a = anchor(o.test.ward, "out"), b = anchor(o.lab, "in");
            const c = ctrl(a, b, BEND[o.lab]);
            let p = { x: a.x - 6, y: a.y - 14 + (i % 3) * 9 };
            let color = o.test.priority === 3 ? "#ff6b7a" : "#ffd08a";
            let r = 5;
            if (mode === "normal") {
              const s = ((loopT * 0.18 + i * 0.137) % 1);
              p = bez(a, c, b, s);
              color = "#5cc8ff";
              r = 3.5;
            } else if (mode === "stranded") {
              const jitter = Math.sin(loopT * 3 + i) * 1.5;
              p = { x: ward.x + 58 + (i % 2) * 9, y: ward.y - 8 + Math.floor((i % 4) / 2) * 12 + jitter };
              color = "#ff3b4e";
              r = 4.5;
            } else {
              if (simT < o.dispatch) {
                // waiting at ward
              } else if (simT < o.arrive) {
                const s = (simT - o.dispatch) / Math.max(1, o.arrive - o.dispatch);
                p = bez(a, c, b, Math.min(1, s));
                color = LAB_COLOR[o.lab];
              } else if (simT < o.finish) {
                const ang = (i / 12) * Math.PI * 2 + loopT * 1.5;
                p = { x: b.x + Math.cos(ang) * 46, y: b.y + Math.sin(ang) * 46 };
                color = LAB_COLOR[o.lab];
              } else {
                const ang = (i / 12) * Math.PI * 2;
                p = { x: b.x + Math.cos(ang) * 50, y: b.y + Math.sin(ang) * 50 };
                color = o.onTime ? "#2ef2b0" : "#ff3b4e";
                r = 4;
              }
            }
            const focused = focusTest === o.test.id;
            return (
              <g key={o.test.id}>
                {focused && <circle cx={p.x} cy={p.y} r={12} fill="none" stroke="#fff" strokeOpacity="0.8" />}
                <circle cx={p.x} cy={p.y} r={r + 4} fill={color} opacity={0.18} filter="url(#soft)" />
                <circle cx={p.x} cy={p.y} r={r} fill={color} />
              </g>
            );
          })}
        </AnimatePresence>
      </svg>
    </div>
  );
}
