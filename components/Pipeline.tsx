"use client";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Check } from "lucide-react";
import type { CallResult, GuardOutcome, ProtectOutcome, ExtractOutcome, DecideOutcome, ClaimKey } from "@/lib/clocked";
import { SITE_CRITERIA } from "@/lib/clocked";
import type { Authorization } from "@/lib/engine";
import { CATEGORY_LABEL, LABS } from "@/lib/scenario";
import type { Category } from "@/lib/scenario";

export interface Analysis {
  guard?: { call: CallResult; out: GuardOutcome };
  protect?: { call: CallResult; out: ProtectOutcome };
  extract?: { call: CallResult; out: ExtractOutcome };
  decide?: { call: CallResult; out: DecideOutcome };
  verify?: { call: CallResult; auth: Authorization; claims: ClaimKey[] };
  optimizer?: { evaluated: number; ms: number };
}
export type StepKey = keyof Analysis;

const STEPS: { key: StepKey; name: string; path: string; role: string }[] = [
  { key: "guard", name: "Guard", path: "/injection", role: "Checks the notice for instructions planted by the attacker" },
  { key: "protect", name: "Protect", path: "/pii", role: "Removes patient identifiers before anything else reads it" },
  { key: "extract", name: "Extract", path: "/extract", role: "Pulls the restoration estimate and affected systems" },
  { key: "decide", name: "Decide", path: "/decide", role: "Judges which sites and transport routes are down" },
  { key: "verify", name: "Verify", path: "/grounding", role: "Checks every backup route against the downtime procedure" },
  { key: "optimizer", name: "Continuity engine", path: "runs locally", role: "Searches legal plans against deadlines and capacity" },
];

export function ModeBadge({ call }: { call?: CallResult }) {
  if (!call) return null;
  const label = call.mode === "live" ? "Live" : call.mode === "recorded" ? "Recorded live" : "Offline stand-in";
  const color = call.mode === "emulated" ? "text-warn" : "text-fg3";
  return (
    <span title={call.error ?? undefined} className={`text-[12px] tnum ${color}`}>
      {label} · {call.ms} ms
    </span>
  );
}

const SITE_LABEL: Record<string, string> = {
  core_lab: "Core Lab", west_wing_lab: "West Wing Lab", poc_hub: "ED Point-of-Care", st_marys_lab: "St. Mary's",
  reference_lab: "Reference Lab", courier: "Courier", pneumatic_tube: "Pneumatic tube", lis: "Lab information system",
};

function Bar({ p, hot, label, uncertain }: { p: number; hot: boolean; label: string; uncertain: boolean }) {
  return (
    <div className="grid grid-cols-[148px_1fr_44px] items-center gap-3 text-[13px]">
      <span className={hot ? "text-danger font-medium" : "text-fg2"}>{label}</span>
      <div className="relative h-1 rounded-full bg-muted overflow-hidden">
        <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: hot ? "var(--danger)" : "var(--line-strong)" }}
          initial={{ width: 0 }} animate={{ width: `${Math.max(1, p * 100)}%` }} transition={{ duration: 0.6, ease: "easeOut" }} />
      </div>
      <span className={`text-right tnum ${hot ? "text-danger" : "text-fg3"}`}>
        {(p * 100).toFixed(0)}%{uncertain ? " ?" : ""}
      </span>
    </div>
  );
}

function StepBody({ k, a }: { k: StepKey; a: Analysis }) {
  if (k === "guard" && a.guard) {
    const g = a.guard.out;
    const bad = g.verdict === "injection";
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-fg2">
          <span className={`tnum font-semibold ${bad ? "text-danger" : "text-fg"}`}>{(g.injection * 100).toFixed(1)}%</span> injection probability
          {bad ? `, ${g.category}, severity ${g.severity}.` : ". The notice is safe to read."}
        </p>
        {g.quarantined.map((q, i) => (
          <div key={i} className="rounded-md border border-danger-line bg-danger-bg p-3 text-[12.5px] leading-relaxed">
            <div className="font-medium text-danger mb-1">Removed before any other step reads the notice</div>
            <mark className="q">{q.text}</mark>
          </div>
        ))}
      </div>
    );
  }
  if (k === "protect" && a.protect) {
    const ents = a.protect.out.entities;
    return (
      <div className="text-[13px] text-fg2">
        {ents.length} identifiers replaced:{" "}
        {ents.map((e, i) => (
          <span key={i} className="mono text-[12px] text-fg">
            {i > 0 && ", "}{e.type.replace(/_/g, " ")}
          </span>
        ))}
      </div>
    );
  }
  if (k === "extract" && a.extract) {
    const e = a.extract.out;
    return (
      <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-fg3">Incident</dt><dd className="mono text-[12.5px]">{e.incidentId ?? "Not stated"}</dd>
        <dt className="text-fg3">Restoration</dt>
        <dd>“{e.restorationText ?? "not stated"}” <span className="text-fg3">→ {Math.round(e.restorationMinutes / 6) / 10} h{e.restorationAssumed ? ", assumed" : ""}</span></dd>
        <dt className="text-fg3">Affected</dt><dd className="text-fg2">{e.affected.join("; ") || "None stated"}</dd>
      </dl>
    );
  }
  if (k === "decide" && a.decide) {
    const d = a.decide.out;
    return (
      <div className="space-y-1.5">
        {Object.keys(SITE_CRITERIA).map((key) => (
          <Bar key={key} label={SITE_LABEL[key]} p={d.probs[key] ?? 0} hot={d.selected.includes(key)} uncertain={d.uncertain.includes(key)} />
        ))}
        <p className="text-[12px] text-fg3 pt-1">Probability each is unavailable. Red means treated as down; “?” marks a value sent for human review.</p>
      </div>
    );
  }
  if (k === "verify" && a.verify) {
    const cats = Array.from(new Set(a.verify.claims.map((c) => c.category))) as Category[];
    const labs = LABS.filter((l) => l.kind !== "primary");
    return (
      <div className="overflow-x-auto">
        <table className="text-[12px] border-collapse">
          <thead>
            <tr>
              <th />
              {cats.map((c) => <th key={c} className="px-1.5 pb-1 font-normal text-fg3 text-left whitespace-nowrap">{CATEGORY_LABEL[c]}</th>)}
            </tr>
          </thead>
          <tbody>
            {labs.map((l) => (
              <tr key={l.id} className="hair-t">
                <td className="pr-3 py-1 text-fg2 whitespace-nowrap">{l.name.replace(" Satellite Lab", "").replace(" Partner Lab", "").replace(" Reference Lab", " Reference").replace("ED Point-of-Care Hub", "Point-of-Care")}</td>
                {cats.map((c) => {
                  const cell = a.verify!.auth[l.id]?.[c];
                  const [sym, cls] = !cell ? ["", "text-fg3"] : cell.verdict === "supported" ? ["Yes", "text-ok"] : cell.verdict === "contradicted" ? ["No", "text-danger"] : ["?", "text-warn"];
                  return (
                    <td key={c} className={`px-1.5 py-1 font-medium ${cls}`}
                      title={cell ? `${cell.verdict.replace("_", " ")}, ${(cell.supported * 100).toFixed(0)}% supported${cell.quote ? `\n“${cell.quote}”` : ""}` : "This site can't run this test"}>
                      {sym || <span className="text-fg3">–</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[12px] text-fg3 mt-2">Yes: procedure approves. No: procedure forbids. ?: not stated, treated as forbidden. Hover a cell for the quoted evidence.</p>
      </div>
    );
  }
  if (k === "optimizer" && a.optimizer) {
    return (
      <p className="text-[13px] text-fg2">
        Simulated <span className="tnum text-fg font-medium">{a.optimizer.evaluated.toLocaleString()}</span> candidate plans in{" "}
        <span className="tnum text-fg font-medium">{a.optimizer.ms.toFixed(0)} ms</span>. Every assignment respects capacity, transport and the verified procedure.
      </p>
    );
  }
  return null;
}

export default function Pipeline({ analysis, running }: { analysis: Analysis; running: StepKey | null }) {
  return (
    <ol className="divide-y divide-[var(--line)]">
      {STEPS.map((s, i) => {
        const done = !!analysis[s.key];
        const active = running === s.key;
        const pending = !done && !active;
        return (
          <li key={s.key} className={`py-3.5 grid grid-cols-[24px_1fr] gap-x-3 ${pending ? "opacity-40" : ""}`}>
            <div className="pt-0.5">
              {active ? <Loader2 size={16} className="animate-spin text-fg2" /> : done ? <Check size={16} className="text-ok" /> : <span className="text-[13px] text-fg3 tnum">{i + 1}</span>}
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[14px] font-medium">{s.name}</span>
                <span className="mono text-[12px] text-fg3">{s.path}</span>
                <span className="flex-1" />
                {s.key !== "optimizer" && <ModeBadge call={(analysis[s.key] as any)?.call} />}
              </div>
              <div className="text-[13px] text-fg3">{s.role}</div>
              <AnimatePresence>
                {done && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-2.5">
                    <StepBody k={s.key} a={analysis} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
