"use client";
import { motion, AnimatePresence } from "framer-motion";
import type { Analysis } from "./Pipeline";
import type { Conditions } from "@/lib/scenario";
import { LIS_DOWNTIME_OVERHEAD, labById } from "@/lib/scenario";
import type { PlanResult } from "@/lib/engine";
import { clock } from "@/lib/engine";

/** Which simulation constraints came from which Clocked endpoint. */
export function ConstraintStrip({ analysis, conditions }: { analysis: Analysis; conditions: Conditions }) {
  const rows: { src: string; text: string; tone?: "danger" | "warn" }[] = [];
  const g = analysis.guard?.out;
  if (g) rows.push(g.quarantined.length
    ? { src: "Guard", text: `${g.quarantined.length} planted paragraph removed from the notice`, tone: "danger" }
    : { src: "Guard", text: "No injection found in the notice" });
  const p = analysis.protect?.out;
  if (p) rows.push({ src: "Protect", text: `${p.entities.length} patient identifiers withheld from later steps` });
  const e = analysis.extract?.out;
  if (e) rows.push({ src: "Extract", text: `Core Lab back in about ${Math.round(e.restorationMinutes / 6) / 10} h${e.restorationAssumed ? " (assumed)" : ""}` });
  const d = analysis.decide?.out;
  if (d) {
    const down = Object.entries(conditions.labDown).filter(([, v]) => v).map(([k]) => labById(k as any).name);
    rows.push({ src: "Decide", text: `Offline: ${down.join(", ") || "none"}`, tone: "danger" });
    const extra: string[] = [];
    if (conditions.lisDown) extra.push(`lab information system down, +${LIS_DOWNTIME_OVERHEAD} min paperwork per test`);
    if (!conditions.tubeAvailable) extra.push("tube system down, porters carry specimens");
    if (!conditions.courierAvailable) extra.push("courier stopped");
    if (extra.length) rows.push({ src: "Decide", text: extra.join("; "), tone: "warn" });
    if (d.uncertain.length) rows.push({ src: "Decide", text: `${d.uncertain.length} uncertain answer(s) flagged for review`, tone: "warn" });
  }
  const v = analysis.verify;
  if (v) {
    const cells = Object.values(v.auth).flatMap((m) => Object.values(m ?? {}));
    rows.push({ src: "Verify", text: `${cells.filter((c) => c?.verdict === "supported").length} of ${cells.length} backup routes approved by the procedure` });
  }
  return (
    <dl className="grid grid-cols-[72px_1fr] gap-x-4 text-[13px]">
      {rows.map((r, i) => (
        <div key={i} className="contents">
          <dt className="mono text-[12px] text-fg3 py-1.5 hair-t">{r.src}</dt>
          <dd className={`py-1.5 hair-t ${r.tone === "danger" ? "text-danger" : r.tone === "warn" ? "text-warn" : "text-fg2"}`}>{r.text}</dd>
        </div>
      ))}
    </dl>
  );
}

interface Ev { t: number; key: string; text: string; tone: "ok" | "danger" | "muted" | "plain" }

export function EventFeed({ plan, base, simT }: { plan: PlanResult; base: PlanResult; simT: number }) {
  const evs: Ev[] = [];
  const sites = new Set(plan.outcomes.map((o) => o.lab));
  evs.push({ t: 2, key: "dispatch", text: `Plan dispatched: 12 specimens to ${sites.size} sites`, tone: "plain" });
  evs.push({ t: 25, key: "manual", text: "Without VitalSwitch, phone triage ends and specimens start moving", tone: "muted" });
  for (const o of plan.outcomes) {
    if (o.dest !== "wait") evs.push({ t: o.arrive, key: "a" + o.test.id, text: `${o.test.label} arrives at ${labById(o.lab).name}`, tone: "plain" });
    evs.push({
      t: o.finish, key: "f" + o.test.id,
      text: o.onTime ? `${o.test.label} resulted, ${o.test.deadline - o.finish} min to spare` : `${o.test.label} resulted ${o.late} min late`,
      tone: o.onTime ? "ok" : "danger",
    });
  }
  for (const o of base.outcomes) if (!o.onTime) evs.push({ t: o.test.deadline, key: "b" + o.test.id, text: `Without VitalSwitch, ${o.test.label} (${o.test.id}) misses its deadline`, tone: "muted" });
  const shown = evs.filter((e) => e.t <= simT).sort((a, b) => b.t - a.t).slice(0, 6);
  const cls = { ok: "text-ok", danger: "text-danger", muted: "text-fg3", plain: "text-fg2" };
  return (
    <div className="h-[168px] overflow-hidden text-[13px]">
      <AnimatePresence initial={false}>
        {shown.map((e) => (
          <motion.div key={e.key} layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={`grid grid-cols-[48px_1fr] gap-3 py-1 ${cls[e.tone]}`}>
            <span className="tnum text-fg3">{clock(e.t)}</span>
            <span className="truncate">{e.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
      {shown.length === 0 && <p className="text-fg3">Approve the plan to start the clock.</p>}
    </div>
  );
}
