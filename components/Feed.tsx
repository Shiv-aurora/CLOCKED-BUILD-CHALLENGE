"use client";
import { motion, AnimatePresence } from "framer-motion";
import type { Analysis } from "./Pipeline";
import type { Conditions } from "@/lib/scenario";
import { LIS_DOWNTIME_OVERHEAD, labById } from "@/lib/scenario";
import type { PlanResult } from "@/lib/engine";
import { clock } from "@/lib/engine";
import { LAB_COLOR } from "./HospitalMap";

/** Shows, chip by chip, which simulation constraints came from which Clocked endpoint. */
export function ConstraintStrip({ analysis, conditions }: { analysis: Analysis; conditions: Conditions }) {
  const chips: { src: string; text: string; tone: "alarm" | "vital" | "amber" | "cyan" }[] = [];
  const g = analysis.guard?.out;
  if (g) chips.push(g.quarantined.length
    ? { src: "Guard", text: `${g.quarantined.length} injected paragraph quarantined`, tone: "alarm" }
    : { src: "Guard", text: "no injection in notice", tone: "vital" });
  const p = analysis.protect?.out;
  if (p) chips.push({ src: "Protect", text: `${p.entities.length} patient identifiers withheld`, tone: "cyan" });
  const e = analysis.extract?.out;
  if (e) chips.push({ src: "Extract", text: `Core Lab back in ≈${Math.round(e.restorationMinutes / 6) / 10} h${e.restorationAssumed ? " (assumed)" : ""}`, tone: "amber" });
  const d = analysis.decide?.out;
  if (d) {
    const down = Object.entries(conditions.labDown).filter(([, v]) => v).map(([k]) => labById(k as any).short);
    chips.push({ src: "Decide", text: `offline: ${down.join(", ") || "none"}`, tone: "alarm" });
    if (conditions.lisDown) chips.push({ src: "Decide", text: `LIS down → +${LIS_DOWNTIME_OVERHEAD} min paper / test`, tone: "amber" });
    if (!conditions.tubeAvailable) chips.push({ src: "Decide", text: "tube down → porters", tone: "amber" });
    if (!conditions.courierAvailable) chips.push({ src: "Decide", text: "courier stopped", tone: "alarm" });
    if (d.uncertain.length) chips.push({ src: "Decide", text: `${d.uncertain.length} uncertain → flagged for human review`, tone: "amber" });
  }
  const v = analysis.verify;
  if (v) {
    const cells = Object.values(v.auth).flatMap((m) => Object.values(m ?? {}));
    const ok = cells.filter((c) => c?.verdict === "supported").length;
    chips.push({ src: "Verify", text: `${ok}/${cells.length} backup routes approved by procedure`, tone: "vital" });
  }
  const tone = { alarm: "text-alarm border-alarm/25 bg-alarm/[0.06]", vital: "text-vital border-vital/25 bg-vital/[0.06]", amber: "text-amberx border-amberx/25 bg-amberx/[0.06]", cyan: "text-cyanx border-cyanx/25 bg-cyanx/[0.06]" };
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c, i) => (
        <motion.span key={c.src + c.text} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
          className={`text-[10.5px] rounded-md border px-2 py-1 ${tone[c.tone]}`}>
          <span className="mono text-[9px] opacity-70 mr-1.5">{c.src.toUpperCase()}</span>{c.text}
        </motion.span>
      ))}
    </div>
  );
}

interface Ev { t: number; key: string; text: React.ReactNode; tone: "vital" | "alarm" | "muted" | "lab"; color?: string }

export function EventFeed({ plan, base, simT }: { plan: PlanResult; base: PlanResult; simT: number }) {
  const evs: Ev[] = [];
  const sites = new Set(plan.outcomes.map((o) => o.lab));
  evs.push({ t: 2, key: "dispatch", text: <>VitalSwitch dispatches 12 specimens to {sites.size} site{sites.size > 1 ? "s" : ""}</>, tone: "vital" });
  evs.push({ t: 25, key: "manual", text: <>Without VitalSwitch: phone triage finishes, specimens start moving</>, tone: "muted" });
  for (const o of plan.outcomes) {
    if (o.dest !== "wait") evs.push({ t: o.arrive, key: "a" + o.test.id, text: <>{o.test.label} ({o.test.id}) arrives at <b style={{ color: LAB_COLOR[o.lab] }}>{labById(o.lab).short}</b></>, tone: "lab", color: LAB_COLOR[o.lab] });
    evs.push({
      t: o.finish, key: "f" + o.test.id,
      text: o.onTime
        ? <>✓ {o.test.label} resulted {o.test.deadline - o.finish} min before deadline — {o.test.clinical.toLowerCase()}</>
        : <>✕ {o.test.label} late by {o.late} min</>,
      tone: o.onTime ? "vital" : "alarm",
    });
  }
  for (const o of base.outcomes) {
    if (!o.onTime) evs.push({ t: o.test.deadline, key: "b" + o.test.id, text: <>Without VitalSwitch: {o.test.label} ({o.test.id}) misses its {o.test.deadline}-min deadline</>, tone: "muted" });
  }
  const shown = evs.filter((e) => e.t <= simT).sort((a, b) => b.t - a.t).slice(0, 7);
  const cls = { vital: "text-vital", alarm: "text-alarm", muted: "text-slate-500", lab: "text-slate-300" };
  return (
    <div className="space-y-1 h-[176px] overflow-hidden">
      <AnimatePresence initial={false}>
        {shown.map((e) => (
          <motion.div key={e.key} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
            className={`flex gap-3 text-[11.5px] ${cls[e.tone]}`}>
            <span className="mono text-slate-600 shrink-0">{clock(e.t)}</span>
            <span className="truncate">{e.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
      {shown.length === 0 && <div className="text-[11.5px] text-slate-500">Approve the plan to start the clock.</div>}
    </div>
  );
}
