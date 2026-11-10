"use client";
import { motion } from "framer-motion";
import type { PlanResult, TestOutcome } from "@/lib/engine";
import { clock } from "@/lib/engine";
import { LAB_COLOR } from "./HospitalMap";
import { PRIORITY_LABEL, labById } from "@/lib/scenario";

const H = 210; // horizon minutes

function Row({ o, simT, compact }: { o: TestOutcome; simT: number; compact?: boolean }) {
  const pct = (m: number) => `${(Math.min(m, H) / H) * 100}%`;
  const color = LAB_COLOR[o.lab];
  const shown = Math.min(simT, H);
  const finished = simT >= o.finish;
  const missed = simT > o.test.deadline && !(finished && o.onTime);
  const seg = (from: number, to: number, cls: string, style: any = {}) => {
    const a = Math.min(from, shown), b = Math.min(to, shown);
    if (b <= a) return null;
    return <div className={`absolute top-1 bottom-1 ${cls}`} style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})`, ...style }} />;
  };
  return (
    <div className="flex items-center gap-2 h-[22px]">
      <div className={`w-[118px] shrink-0 truncate text-[10.5px] ${missed ? "text-alarm" : finished ? "text-vital" : "text-slate-300"}`}>
        <span className={`mono text-[8.5px] mr-1 px-1 rounded ${o.test.priority === 3 ? "bg-alarm/15 text-alarm" : "bg-amberx/10 text-amberx"}`}>{PRIORITY_LABEL[o.test.priority]}</span>
        {o.test.label}
      </div>
      <div className="relative flex-1 h-full rounded bg-white/[0.025]">
        {seg(0, o.dispatch, "bg-slate-500/25 rounded-l")}
        {seg(o.dispatch, o.arrive, "", { background: `repeating-linear-gradient(90deg, ${color}66 0 4px, transparent 4px 7px)` })}
        {seg(o.arrive, o.start, "", { background: `${color}33` })}
        {seg(o.start, o.finish, "rounded-r", { background: color, boxShadow: `0 0 10px ${color}66` })}
        <div className="absolute top-0 bottom-0 w-[2px] bg-white/70" style={{ left: pct(o.test.deadline) }} title={`deadline ${clock(o.test.deadline)}`} />
        {o.finish > H && simT >= H && (
          <span className="absolute right-1 top-0 mono text-[9px] text-alarm leading-[22px]">→ {clock(o.finish)}</span>
        )}
      </div>
      <div className="w-[52px] shrink-0 text-right mono text-[10px]">
        {finished ? (
          <span className={o.onTime ? "text-vital" : "text-alarm"}>{o.onTime ? "✓" : "✕"} {clock(o.finish)}</span>
        ) : missed ? (
          <span className="text-alarm">LATE</span>
        ) : (
          <span className="text-slate-600">{compact ? "" : labById(o.lab).short}</span>
        )}
      </div>
    </div>
  );
}

export function Counter({ value, total, tone }: { value: number; total: number; tone: "vital" | "alarm" }) {
  return (
    <div className="flex items-baseline gap-1">
      <motion.span key={value} initial={{ scale: 1.25, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }}
        className={`mono text-4xl font-bold ${tone === "vital" ? "text-vital text-glow-vital" : "text-alarm text-glow-alarm"}`}>
        {value}
      </motion.span>
      <span className="mono text-slate-500 text-lg">/{total}</span>
    </div>
  );
}

export default function Gantt({ title, sub, result, simT, tone }: { title: string; sub: string; result: PlanResult; simT: number; tone: "vital" | "alarm" }) {
  const onTimeSoFar = result.outcomes.filter((o) => o.onTime && simT >= o.finish).length;
  const lateSoFar = result.outcomes.filter((o) => simT > o.test.deadline && !(o.onTime && simT >= o.finish)).length;
  const order = [...result.outcomes].sort((a, b) => b.test.priority - a.test.priority || a.test.deadline - b.test.deadline);
  return (
    <div className={`panel p-4 ${tone === "vital" ? "!border-vital/20" : "!border-alarm/20"}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className={`label ${tone === "vital" ? "!text-vital" : "!text-alarm"}`}>{title}</div>
          <div className="text-[11px] text-slate-500 mt-0.5 max-w-[300px]">{sub}</div>
        </div>
        <div className="text-right">
          <Counter value={onTimeSoFar} total={result.outcomes.length} tone={tone} />
          <div className="text-[10px] text-slate-500 -mt-1">results on time · <span className="text-alarm">{lateSoFar} late</span></div>
        </div>
      </div>
      <div className="space-y-[3px]">
        {order.map((o) => (
          <Row key={o.test.id} o={o} simT={simT} />
        ))}
      </div>
      <div className="flex justify-between mono text-[9px] text-slate-600 mt-1 pl-[126px] pr-[60px]">
        {[0, 30, 60, 90, 120, 150, 180, 210].map((m) => <span key={m}>{clock(m)}</span>)}
      </div>
    </div>
  );
}
