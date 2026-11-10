"use client";
import { motion } from "framer-motion";
import { labById } from "@/lib/scenario";
import type { LabId, WardId, Conditions } from "@/lib/scenario";
import type { TestOutcome } from "@/lib/engine";

export const LAB_COLOR: Record<LabId, string> = {
  core: "var(--lab-core)",
  west: "var(--lab-west)",
  poc: "var(--lab-poc)",
  stmarys: "var(--lab-stmarys)",
  reference: "var(--lab-reference)",
};

export type MapMode = "normal" | "stranded" | "plan";

interface Props {
  mode: MapMode;
  conditions: Conditions | null;
  outcomes: TestOutcome[] | null;
  simT: number;
  loopT: number;
  userDown: Partial<Record<LabId, boolean>>;
  interactive: boolean;
  onToggleLab?: (id: LabId) => void;
  focusTest?: string | null;
}

// Two-column layout: wards on the left, laboratories on the right.
const W_X = 8, W_W = 196, L_X = 596, L_W = 236, NODE_H = 74;
const ROW_Y = [96, 196, 296, 396, 496];
const LAB_ORDER: LabId[] = ["poc", "west", "core", "stmarys", "reference"];
const WARD_ORDER: WardId[] = ["ed", "icu", "or", "maternity", "oncology"];
const WARD_LABEL: Record<WardId, string> = { ed: "Emergency", icu: "Intensive care", or: "Operating theatres", maternity: "Maternity", oncology: "Oncology" };

const wy = (w: WardId) => ROW_Y[WARD_ORDER.indexOf(w)];
const ly = (l: LabId) => ROW_Y[LAB_ORDER.indexOf(l)];

function curve(w: WardId, l: LabId) {
  const wi = WARD_ORDER.indexOf(w), li = LAB_ORDER.indexOf(l);
  const p0 = { x: W_X + W_W, y: wy(w) + (li - 2) * 6 };
  const p3 = { x: L_X, y: ly(l) + (wi - 2) * 6 };
  const dx = (p3.x - p0.x) * 0.5;
  return { p0, p1: { x: p0.x + dx, y: p0.y }, p2: { x: p3.x - dx, y: p3.y }, p3 };
}
type Curve = ReturnType<typeof curve>;
function at(c: Curve, t: number) {
  const u = 1 - t;
  const f = (k: "x" | "y") => u * u * u * c.p0[k] + 3 * u * u * t * c.p1[k] + 3 * u * t * t * c.p2[k] + t * t * t * c.p3[k];
  return { x: f("x"), y: f("y") };
}
const d = (c: Curve) => `M${c.p0.x},${c.p0.y} C${c.p1.x},${c.p1.y} ${c.p2.x},${c.p2.y} ${c.p3.x},${c.p3.y}`;

export default function HospitalMap({ mode, conditions, outcomes, simT, loopT, userDown, interactive, onToggleLab, focusTest }: Props) {
  const down = (id: LabId) => !!conditions?.labDown[id];
  const routes = new Map<string, { ward: WardId; lab: LabId }>();
  if (mode === "plan" && outcomes) for (const o of outcomes) routes.set(`${o.test.ward}-${o.lab}`, { ward: o.test.ward, lab: o.lab });
  else for (const w of WARD_ORDER) routes.set(`${w}-core`, { ward: w, lab: "core" });

  return (
    <svg viewBox="0 0 840 560" className="w-full h-auto block select-none" role="img" aria-label="Wards on the left send blood samples to laboratories on the right">
      <text x={W_X} y="36" fontSize="16" fontWeight="500" style={{ fill: "var(--fg-3)" }}>Wards</text>
      <text x={L_X} y="36" fontSize="16" fontWeight="500" style={{ fill: "var(--fg-3)" }}>Laboratories</text>
      <line x1={L_X - 24} x2={840} y1="346" y2="346" style={{ stroke: "var(--line)" }} strokeDasharray="4 4" />
      <text x={L_X - 28} y="341" fontSize="14" textAnchor="end" style={{ fill: "var(--fg-3)" }}>On campus ↑</text>
      <text x={L_X - 28} y="362" fontSize="14" textAnchor="end" style={{ fill: conditions && !conditions.courierAvailable ? "var(--danger)" : "var(--fg-3)" }}>
        {conditions && !conditions.courierAvailable ? "Courier stopped ↓" : "By courier ↓"}
      </text>

      {/* routes */}
      {[...routes.values()].map(({ ward, lab }) => {
        const c = curve(ward, lab);
        const dead = down(lab);
        const color = dead ? "var(--danger)" : mode === "plan" ? LAB_COLOR[lab] : "var(--line-strong)";
        return (
          <motion.path key={`${mode}-${ward}-${lab}`} d={d(c)} fill="none" strokeWidth={mode === "plan" ? 2 : 1.5}
            strokeDasharray={dead ? "4 6" : undefined}
            style={{ stroke: color, opacity: dead ? 0.6 : mode === "plan" ? 0.75 : 1 }}
            initial={{ pathLength: mode === "plan" ? 0 : 1 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: "easeInOut" }} />
        );
      })}

      {/* wards */}
      {WARD_ORDER.map((wid) => {
        const list = outcomes?.filter((o) => o.test.ward === wid) ?? [];
        const ok = mode === "plan" ? list.filter((o) => simT >= o.finish && o.onTime).length : 0;
        const late = mode === "plan" ? list.filter((o) => (simT >= o.finish && !o.onTime) || (simT > o.test.deadline && simT < o.finish)).length : 0;
        const stranded = mode === "stranded";
        return (
          <g key={wid} transform={`translate(${W_X},${wy(wid) - NODE_H / 2})`}>
            <rect width={W_W} height={NODE_H} rx="10" style={{ fill: "var(--bg)", stroke: stranded ? "var(--danger)" : "var(--line-strong)", transition: "stroke .4s" }} />
            <text x="16" y="31" fontSize="19" fontWeight="600" style={{ fill: "var(--fg)" }}>{WARD_LABEL[wid]}</text>
            <text x="16" y="56" fontSize="16" className="tnum" style={{ fill: stranded ? "var(--danger)" : "var(--fg-3)" }}>
              {stranded ? `${list.length} stuck` : mode === "plan" && (ok || late)
                ? <><tspan style={{ fill: "var(--ok)" }}>{ok} on time</tspan>{late ? <tspan style={{ fill: "var(--danger)" }}>{`  ${late} late`}</tspan> : null}</>
                : `${list.length} sample${list.length > 1 ? "s" : ""}`}
            </text>
          </g>
        );
      })}

      {/* labs */}
      {LAB_ORDER.map((id) => {
        const l = labById(id);
        const isDown = down(id);
        const knocked = !!userDown[id];
        const used = mode === "plan" && !!outcomes?.some((o) => o.lab === id);
        const running = outcomes?.filter((o) => o.lab === id && simT >= o.arrive && simT < o.finish).length ?? 0;
        const done = outcomes?.filter((o) => o.lab === id && simT >= o.finish).length ?? 0;
        const clickable = interactive && id !== "core";
        const sub = isDown
          ? knocked ? "Turned off by you" : id === "core" ? "Encrypted by ransomware" : "Offline"
          : mode === "plan"
            ? used ? (running ? `Testing ${running} now` : done ? `${done} results sent` : "Samples on the way") : "Not needed"
            : l.kind === "external" ? `${id === "stmarys" ? "18" : "60"} km away` : `${l.analyzers} analyzer${l.analyzers > 1 ? "s" : ""}`;
        const stroke = isDown ? "var(--danger)" : used ? LAB_COLOR[id] : "var(--line-strong)";
        return (
          <g key={id} transform={`translate(${L_X},${ly(id) - NODE_H / 2})`} data-tour={id === "stmarys" ? "lab-stmarys" : undefined}
            onClick={() => clickable && onToggleLab?.(id)} style={{ cursor: clickable ? "pointer" : "default" }}
            role={clickable ? "button" : undefined} aria-label={clickable ? `${isDown ? "Turn on" : "Turn off"} ${l.name}` : undefined}>
            <rect width={L_W} height={NODE_H} rx="10" strokeWidth={used || isDown ? 2 : 1}
              style={{ fill: isDown ? "var(--danger-bg)" : "var(--bg)", stroke, transition: "fill .4s, stroke .4s" }} />
            <circle cx="18" cy="25" r="6" style={{ fill: isDown ? "var(--danger)" : LAB_COLOR[id], opacity: mode === "plan" && !used && !isDown ? 0.35 : 1 }} />
            <text x="34" y="31" fontSize="19" fontWeight="600" style={{ fill: isDown ? "var(--danger)" : mode === "plan" && !used ? "var(--fg-3)" : "var(--fg)" }}>
              {l.name.replace(" Satellite Lab", " Lab").replace(" Partner Lab", "").replace("Regional ", "").replace("ED Point-of-Care Hub", "Point-of-Care")}
            </text>
            <text x="34" y="56" fontSize="16" style={{ fill: isDown ? "var(--danger)" : "var(--fg-3)" }}>{sub}</text>
            {isDown && (
              <g transform={`translate(${L_W - 30},14)`}>
                <rect width="16" height="12" y="8" rx="2" style={{ fill: "var(--danger)" }} />
                <path d="M3 8 V5 a5 5 0 0 1 10 0 V8" fill="none" strokeWidth="2" style={{ stroke: "var(--danger)" }} />
              </g>
            )}
          </g>
        );
      })}

      {/* samples */}
      {outcomes?.map((o, i) => {
        const wi = WARD_ORDER.indexOf(o.test.ward);
        const k = outcomes.filter((x) => x.test.ward === o.test.ward).indexOf(o);
        let p = { x: W_X + W_W - 16 - k * 14, y: ROW_Y[wi] + 20 };
        let color = "var(--fg-3)";
        if (mode === "normal") {
          p = at(curve(o.test.ward, "core"), (loopT * 0.14 + i * 0.137) % 1);
          color = "var(--lab-core)";
        } else if (mode === "stranded") {
          color = "var(--danger)";
        } else if (simT >= o.dispatch && simT < o.arrive) {
          p = at(curve(o.test.ward, o.lab), (simT - o.dispatch) / Math.max(1, o.arrive - o.dispatch));
          color = LAB_COLOR[o.lab];
        } else if (simT >= o.arrive) {
          const slot = outcomes.filter((x) => x.lab === o.lab).indexOf(o);
          p = { x: L_X + L_W - 16 - (slot % 7) * 13, y: ly(o.lab) + 20 };
          color = simT < o.finish ? LAB_COLOR[o.lab] : o.onTime ? "var(--ok)" : "var(--danger)";
        }
        const r = mode === "stranded" ? 5 * (1 + 0.2 * Math.sin(loopT * 5 + i)) : 5;
        return (
          <g key={o.test.id}>
            {focusTest === o.test.id && <circle cx={p.x} cy={p.y} r={10} fill="none" strokeWidth="1.5" style={{ stroke: "var(--fg)" }} />}
            <circle cx={p.x} cy={p.y} r={r} style={{ fill: color }} />
          </g>
        );
      })}

      {mode === "stranded" && (
        <motion.g initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} style={{ transformOrigin: "406px 285px" }}>
          <rect x="236" y="250" width="340" height="70" rx="12" style={{ fill: "var(--danger)" }} />
          <text x="406" y="281" textAnchor="middle" fontSize="20" fontWeight="600" fill="#fff">Ransomware: Core Lab offline</text>
          <text x="406" y="305" textAnchor="middle" fontSize="15" fill="#fff" opacity="0.85">12 samples have nowhere to go</text>
        </motion.g>
      )}
    </svg>
  );
}
