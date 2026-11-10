"use client";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldAlert, EyeOff, ScanText, Scale, BadgeCheck, Cpu, Loader2, Check } from "lucide-react";
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

const STEPS: { key: StepKey; name: string; path: string; icon: any; role: string }[] = [
  { key: "guard", name: "Guard", path: "/injection", icon: ShieldAlert, role: "Is anyone trying to hijack the response?" },
  { key: "protect", name: "Protect", path: "/pii", icon: EyeOff, role: "Strip patient identifiers before anything else reads it" },
  { key: "extract", name: "Extract", path: "/extract", icon: ScanText, role: "Pull the hard facts: restoration time, affected systems" },
  { key: "decide", name: "Decide", path: "/decide", icon: Scale, role: "Which sites and transport routes are actually down?" },
  { key: "verify", name: "Verify", path: "/grounding", icon: BadgeCheck, role: "Which backup routes does the approved procedure allow?" },
  { key: "optimizer", name: "Continuity engine", path: "local · deterministic", icon: Cpu, role: "Search every legal plan against deadlines & capacity" },
];

export function ModeBadge({ call }: { call?: CallResult }) {
  if (!call) return null;
  const live = call.mode === "live";
  const rec = call.mode === "recorded";
  return (
    <span
      title={call.error ?? (live ? "Live Clocked API response" : rec ? "Real Clocked API response, recorded for this static demo" : "Offline stand-in")}
      className={`mono text-[9px] px-1.5 py-0.5 rounded border ${live ? "border-vital/40 text-vital bg-vital/10" : rec ? "border-cyanx/40 text-cyanx bg-cyanx/10" : "border-amberx/40 text-amberx bg-amberx/10"}`}
    >
      {live ? "LIVE" : rec ? "RECORDED LIVE" : "EMULATED"} · {call.ms}ms
    </span>
  );
}

function Bar({ p, hot, label, uncertain }: { p: number; hot: boolean; label: string; uncertain: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className={`w-[118px] truncate ${hot ? "text-alarm" : "text-slate-400"}`}>{label}</span>
      <div className="relative h-1.5 flex-1 rounded-full bg-white/5 overflow-hidden">
        <motion.div
          className={`absolute inset-y-0 left-0 rounded-full ${hot ? "bg-alarm" : "bg-vital/70"}`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(2, p * 100)}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>
      <span className={`mono w-10 text-right ${hot ? "text-alarm" : "text-slate-500"}`}>{(p * 100).toFixed(0)}%</span>
      {uncertain && <span className="mono text-[9px] text-amberx">REVIEW</span>}
    </div>
  );
}

const SITE_LABEL: Record<string, string> = {
  core_lab: "Core Lab",
  west_wing_lab: "West Wing Lab",
  poc_hub: "ED Point-of-Care",
  st_marys_lab: "St. Mary's",
  reference_lab: "Reference Lab",
  courier: "Courier",
  pneumatic_tube: "Pneumatic tube",
  lis: "Lab info system",
};

function StepBody({ k, a }: { k: StepKey; a: Analysis }) {
  if (k === "guard" && a.guard) {
    const g = a.guard.out;
    const bad = g.verdict === "injection";
    return (
      <div className="space-y-2">
        <div className="flex items-baseline gap-3">
          <span className={`text-2xl font-bold mono ${bad ? "text-alarm text-glow-alarm" : "text-vital"}`}>{(g.injection * 100).toFixed(1)}%</span>
          <span className="text-xs text-slate-400">{bad ? `injection · ${g.category} · ${g.severity}` : "injection probability — notice is safe to read"}</span>
        </div>
        {g.quarantined.map((q, i) => (
          <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="rounded-lg border border-alarm/30 bg-alarm/[0.06] p-2 text-[11px] leading-relaxed">
            <div className="label !text-alarm mb-1">Quarantined before any downstream step</div>
            <mark className="q">{q.text}</mark>
          </motion.div>
        ))}
      </div>
    );
  }
  if (k === "protect" && a.protect) {
    const ents = a.protect.out.entities;
    return (
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-xs text-slate-400 mr-1">{ents.length} identifiers removed:</span>
        {ents.map((e, i) => (
          <motion.span key={i} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.08 }}
            className="mono text-[10px] rounded px-1.5 py-0.5 bg-cyanx/10 text-cyanx border border-cyanx/20">
            <span className="line-through opacity-50 mr-1">{e.value}</span>→ {e.type.toUpperCase()}
          </motion.span>
        ))}
      </div>
    );
  }
  if (k === "extract" && a.extract) {
    const e = a.extract.out;
    return (
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <span className="text-slate-500">incident</span><span className="mono text-slate-200">{e.incidentId ?? "—"}</span>
        <span className="text-slate-500">restoration</span>
        <span className="mono text-slate-200">
          “{e.restorationText ?? "not stated"}” <span className="text-amberx">→ {Math.round(e.restorationMinutes / 6) / 10} h{e.restorationAssumed ? " (assumed)" : ""}</span>
        </span>
        <span className="text-slate-500">affected</span>
        <span className="flex flex-wrap gap-1">
          {e.affected.map((x, i) => (
            <span key={i} className="mono text-[10px] rounded px-1.5 py-0.5 bg-alarm/10 text-alarm/90 border border-alarm/20">{x}</span>
          ))}
        </span>
      </div>
    );
  }
  if (k === "decide" && a.decide) {
    const d = a.decide.out;
    return (
      <div className="space-y-1">
        {Object.keys(SITE_CRITERIA).map((key) => (
          <Bar key={key} label={SITE_LABEL[key]} p={d.probs[key] ?? 0} hot={d.selected.includes(key)} uncertain={d.uncertain.includes(key)} />
        ))}
        {d.severityLabel && <div className="text-[11px] text-slate-400 pt-1">severity → <span className="text-amberx">{d.severityLabel}</span></div>}
      </div>
    );
  }
  if (k === "verify" && a.verify) {
    const cats = Array.from(new Set(a.verify.claims.map((c) => c.category))) as Category[];
    const labs = LABS.filter((l) => l.kind !== "primary");
    return (
      <div className="overflow-x-auto">
        <table className="text-[10px] mono">
          <thead>
            <tr>
              <th />
              {cats.map((c) => (
                <th key={c} className="px-1 pb-1 font-normal text-slate-500 text-left" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>{CATEGORY_LABEL[c]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labs.map((l, li) => (
              <tr key={l.id}>
                <td className="pr-2 text-slate-400 whitespace-nowrap">{l.short}</td>
                {cats.map((c, ci) => {
                  const cell = a.verify!.auth[l.id]?.[c];
                  const sym = !cell ? "·" : cell.verdict === "supported" ? "✓" : cell.verdict === "contradicted" ? "✕" : "?";
                  const cls = !cell ? "text-slate-700" : cell.verdict === "supported" ? "text-vital bg-vital/10" : cell.verdict === "contradicted" ? "text-alarm bg-alarm/10" : "text-amberx bg-amberx/10";
                  return (
                    <td key={c} className="p-0.5">
                      <motion.div
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: (li * cats.length + ci) * 0.025 }}
                        title={cell ? `${cell.verdict} (${(cell.supported * 100).toFixed(0)}% supported)${cell.quote ? `\n“${cell.quote}”` : ""}` : "site cannot run this test"}
                        className={`w-6 h-6 rounded flex items-center justify-center ${cls}`}
                      >
                        {sym}
                      </motion.div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-[10px] text-slate-500 mt-1">✓ procedure approves · ✕ procedure forbids · ? not stated (treated as forbidden) · hover for evidence</div>
      </div>
    );
  }
  if (k === "optimizer" && a.optimizer) {
    return (
      <div className="text-[11px] text-slate-300">
        Simulated <span className="mono text-vital">{a.optimizer.evaluated.toLocaleString()}</span> candidate plans in{" "}
        <span className="mono text-vital">{a.optimizer.ms.toFixed(0)} ms</span> — every assignment respects capacity, transport and the verified procedure.
      </div>
    );
  }
  return null;
}

export default function Pipeline({ analysis, running }: { analysis: Analysis; running: StepKey | null }) {
  return (
    <div className="space-y-2">
      {STEPS.map((s, i) => {
        const done = !!analysis[s.key];
        const active = running === s.key;
        const Icon = s.icon;
        if (!done && !active) {
          return (
            <div key={s.key} className="flex items-center gap-3 rounded-xl border border-white/5 px-3 py-2 opacity-35">
              <Icon size={15} className="text-slate-500" />
              <span className="text-xs text-slate-400">{s.name}</span>
              <span className="mono text-[10px] text-slate-600">{s.path}</span>
            </div>
          );
        }
        return (
          <motion.div
            key={s.key}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`relative rounded-xl border px-3 py-2.5 overflow-hidden ${active ? "border-cyanx/40 bg-cyanx/[0.04]" : "border-white/[0.08] bg-white/[0.02]"}`}
          >
            {active && <div className="absolute inset-0 shimmer pointer-events-none" />}
            <div className="flex items-center gap-2.5">
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${done ? "bg-vital/15 text-vital" : "bg-cyanx/15 text-cyanx"}`}>
                {active ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
              </div>
              <span className="text-[13px] font-semibold text-slate-100">{s.name}</span>
              <span className="mono text-[10px] text-slate-500">{s.path}</span>
              <span className="flex-1" />
              {s.key !== "optimizer" && <ModeBadge call={(analysis[s.key] as any)?.call} />}
              {done && <Check size={14} className="text-vital" />}
            </div>
            <div className="text-[11px] text-slate-500 ml-[34px] -mt-0.5">{s.role}</div>
            <AnimatePresence>
              {done && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="ml-[34px] mt-2">
                  <StepBody k={s.key} a={analysis} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}
