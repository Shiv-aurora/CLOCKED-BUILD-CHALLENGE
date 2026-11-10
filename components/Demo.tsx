"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronRight, Loader2, Play, RotateCcw, X } from "lucide-react";
import { driver, type DriveStep } from "driver.js";
import HospitalMap, { LAB_COLOR } from "./HospitalMap";
import Pipeline, { Analysis, StepKey, ModeBadge } from "./Pipeline";
import Gantt from "./Gantt";
import { ConstraintStrip } from "./Feed";
import { DEFAULT_PLAYBOOK, INCIDENT_PRESETS, LABS, TESTS, labById, wardById } from "@/lib/scenario";
import type { Conditions, LabId } from "@/lib/scenario";
import {
  callClocked, guardRequest, interpretGuard, protectRequest, interpretProtect, extractRequest, interpretExtract,
  decideRequest, interpretDecide, authorizationClaims, verifyRequest, interpretVerify, conditionsFrom,
} from "@/lib/clocked";
import { optimize, simulate, baselinePlan, alternatives, clock } from "@/lib/engine";
import type { Assignment, TestOutcome } from "@/lib/engine";

type Phase = "normal" | "attack" | "analyzing" | "plan" | "running" | "done";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PLAY_RATE = 18;
const HORIZON = 215;

const NORMAL_COND: Conditions = {
  labDown: { core: false, west: false, poc: false, stmarys: false, reference: false },
  courierAvailable: true, tubeAvailable: true, lisDown: false, restorationMinutes: 0,
};
const NORMAL_OUTCOMES = simulate(TESTS.map((t) => ({ testId: t.id, dest: "core", dispatch: 0 }) as Assignment), NORMAL_COND).outcomes;
const STAT_COUNT = TESTS.filter((t) => t.priority === 3).length;

const STEP_ROWS: { key: StepKey; name: string }[] = [
  { key: "guard", name: "Guard" },
  { key: "protect", name: "Protect" },
  { key: "extract", name: "Extract" },
  { key: "decide", name: "Decide" },
  { key: "verify", name: "Verify" },
  { key: "optimizer", name: "Plan" },
];

function summary(k: StepKey, a: Analysis): string {
  switch (k) {
    case "guard": {
      const g = a.guard!.out;
      return g.quarantined.length ? `Planted instructions found and removed (${(g.injection * 100).toFixed(0)}%)` : "No planted instructions";
    }
    case "protect": return `${a.protect!.out.entities.length} patient details hidden`;
    case "extract": return `Core Lab back in about ${Math.round(a.extract!.out.restorationMinutes / 60)} hours`;
    case "decide": {
      const names: Record<string, string> = { core_lab: "Core Lab", west_wing_lab: "West Wing Lab", poc_hub: "Point-of-Care", st_marys_lab: "St. Mary's", reference_lab: "Reference Lab", courier: "courier", pneumatic_tube: "tube system", lis: "lab IT system" };
      return `Down: ${a.decide!.out.selected.map((s) => names[s] ?? s).join(", ")}`;
    }
    case "verify": {
      const cells = Object.values(a.verify!.auth).flatMap((m) => Object.values(m ?? {}));
      return `${cells.filter((c) => c?.verdict === "supported").length} of ${cells.length} backup routes allowed`;
    }
    case "optimizer": return `${a.optimizer!.evaluated.toLocaleString()} plans compared in ${a.optimizer!.ms.toFixed(0)} ms`;
  }
}

export interface DemoHandle { start: () => void }

const Demo = forwardRef<DemoHandle>(function Demo(_, ref) {
  const [started, setStarted] = useState(false);
  const [phase, setPhase] = useState<Phase>("normal");
  const [presetId, setPresetId] = useState(INCIDENT_PRESETS[0].id);
  const [report, setReport] = useState(INCIDENT_PRESETS[0].text);
  const [playbook, setPlaybook] = useState(DEFAULT_PLAYBOOK);
  const [analysis, setAnalysis] = useState<Analysis>({});
  const [running, setRunning] = useState<StepKey | null>(null);
  const [userDown, setUserDown] = useState<Partial<Record<LabId, boolean>>>({});
  const [courierStrike, setCourierStrike] = useState(false);
  const [simT, setSimT] = useState(0);
  const [loopT, setLoopT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [editor, setEditor] = useState(false);
  const [audit, setAudit] = useState(false);
  const [showRoutes, setShowRoutes] = useState(false);
  const [toast, setToast] = useState<{ title: string; body: string; tone: "ok" | "danger" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState(0);
  const toured = useRef<Set<string>>(new Set());
  const sectionRef = useRef<HTMLElement>(null);

  useImperativeHandle(ref, () => ({
    start: () => {
      setStarted(true);
      setTimeout(() => sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
    },
  }));

  // animation clock
  useEffect(() => {
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setLoopT((t) => t + dt);
      if (playing) {
        setSimT((t) => {
          const n = t + dt * PLAY_RATE;
          if (n >= HORIZON) { setPlaying(false); setPhase((p) => (p === "running" ? "done" : p)); return HORIZON; }
          return n;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    if (phase !== "attack") return;
    setTyped(0);
    const id = setInterval(() => setTyped((n) => (n >= report.length ? n : n + 14)), 16);
    return () => clearInterval(id);
  }, [phase, report]);

  // ---------- constraint model ----------
  const conditions: Conditions | null = useMemo(() => {
    if (!analysis.decide || !analysis.extract) return null;
    const c = conditionsFrom(analysis.decide.out, analysis.extract.out, userDown);
    if (courierStrike) c.courierAvailable = false;
    return c;
  }, [analysis.decide, analysis.extract, userDown, courierStrike]);

  const solved = useMemo(() => {
    if (!conditions || !analysis.verify) return null;
    const t0 = performance.now();
    const opt = optimize(conditions, analysis.verify.auth);
    const ms = performance.now() - t0;
    const base = simulate(baselinePlan(conditions, analysis.verify.auth), conditions, "fifo");
    return { opt, base, ms };
  }, [conditions, analysis.verify]);

  const prevPlan = useRef<{ assignments: Assignment[]; onTime: number } | null>(null);
  useEffect(() => {
    if (!solved) return;
    const prev = prevPlan.current;
    if (prev && (phase === "done" || phase === "running")) {
      const moved = solved.opt.assignments.filter((a) => prev.assignments.find((p) => p.testId === a.testId)?.dest !== a.dest).length;
      const d = solved.opt.result.onTime - prev.onTime;
      setToast({
        title: moved ? `Re-planned in ${solved.ms.toFixed(0)} ms: ${moved} sample${moved > 1 ? "s" : ""} rerouted` : "Re-planned: no change needed",
        body: `On time: ${prev.onTime} → ${solved.opt.result.onTime} of 12${d < 0 ? ". Fewer labs, so the result is honestly worse." : d > 0 ? "." : "."}`,
        tone: d < 0 ? "danger" : "ok",
      });
      setSimT(0); setPlaying(true); setPhase("running");
    }
    prevPlan.current = { assignments: solved.opt.assignments, onTime: solved.opt.result.onTime };
  }, [solved]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (toast) { const id = setTimeout(() => setToast(null), 4500); return () => clearTimeout(id); } }, [toast]);

  // ---------- guided tour (driver.js), three short moments ----------
  const tour = useCallback((key: string, steps: DriveStep[]) => {
    if (toured.current.has(key)) return;
    toured.current.add(key);
    setTimeout(() => {
      const present = steps.filter((s) => !s.element || document.querySelector(s.element as string));
      if (!present.length) return;
      const d = driver({
        steps: present, showProgress: present.length > 1, allowClose: true, overlayOpacity: 0.35, stagePadding: 6, stageRadius: 10,
        popoverClass: "vs-tour", nextBtnText: "Next", prevBtnText: "Back", doneBtnText: "Got it",
      });
      d.drive();
    }, 450);
  }, []);

  useEffect(() => {
    if (!started) return;
    if (phase === "normal") tour("intro", [
      { element: "[data-tour=map]", popover: { title: "A hospital on a normal day", description: "Each dot is a patient's blood sample travelling from a ward to the Core Lab.", side: "bottom", align: "center" } },
      { element: "[data-tour=launch]", popover: { title: "Now attack it", description: "Pick a scenario and launch a ransomware attack on the Core Lab.", side: "top", align: "center" } },
    ]);
    if (phase === "plan") tour("plan", [
      { element: "[data-tour=pipeline]", popover: { title: "Clocked read the incident", description: "Five Clocked calls turned the incident notice and the hospital's rules into hard constraints.", side: "left", align: "start" } },
      { element: "[data-tour=approve]", popover: { title: "A person stays in charge", description: "VitalSwitch only recommends. Approve the plan to dispatch the samples.", side: "top", align: "center" } },
    ]);
    if (phase === "done") tour("prove", [
      { element: "[data-tour=lab-stmarys]", popover: { title: "Try to break it", description: "Click any backup lab to take it offline. VitalSwitch re-plans from scratch.", side: "left", align: "center" } },
    ]);
  }, [phase, started, tour]);

  // ---------- actions ----------
  const pickPreset = (id: string) => { setPresetId(id); setReport(INCIDENT_PRESETS.find((x) => x.id === id)!.text); };
  const reset = () => {
    setPhase("normal"); setAnalysis({}); setUserDown({}); setCourierStrike(false); setSimT(0); setPlaying(false);
    setRunning(null); setError(null); setShowRoutes(false); prevPlan.current = null;
  };

  const runAnalysis = useCallback(async () => {
    setPhase("analyzing"); setAnalysis({}); setError(null); prevPlan.current = null;
    try {
      setRunning("guard");
      const g = await callClocked("injection", guardRequest(report));
      const gOut = interpretGuard(report, g.data);
      setAnalysis((a) => ({ ...a, guard: { call: g, out: gOut } }));
      await sleep(gOut.quarantined.length ? 900 : 350);
      setRunning("protect");
      const p = await callClocked("pii", protectRequest(gOut.sanitized));
      const pOut = interpretProtect(gOut.sanitized, p.data);
      setAnalysis((a) => ({ ...a, protect: { call: p, out: pOut } }));
      await sleep(300);
      setRunning("extract");
      const e = await callClocked("extract", extractRequest(pOut.redacted));
      setAnalysis((a) => ({ ...a, extract: { call: e, out: interpretExtract(e.data) } }));
      await sleep(300);
      setRunning("decide");
      const d = await callClocked("decide", decideRequest(pOut.redacted));
      setAnalysis((a) => ({ ...a, decide: { call: d, out: interpretDecide(d.data) } }));
      await sleep(350);
      setRunning("verify");
      const claims = authorizationClaims();
      const v = await callClocked("grounding", verifyRequest(playbook, claims));
      setAnalysis((a) => ({ ...a, verify: { call: v, auth: interpretVerify(claims, v.data), claims } }));
      await sleep(400);
      setRunning("optimizer");
      await sleep(500);
      setRunning(null);
      setPhase("plan");
    } catch (err) {
      setRunning(null);
      setError(String(err));
    }
  }, [report, playbook]);

  useEffect(() => {
    if (solved && running === "optimizer") setAnalysis((a) => ({ ...a, optimizer: { evaluated: solved.opt.evaluated, ms: solved.ms } }));
  }, [solved, running]);

  // the attack plays out, then VitalSwitch responds on its own
  const launch = () => {
    setPhase("attack");
    setTimeout(() => runAnalysis(), 2800);
  };
  const approve = () => { setPhase("running"); setSimT(0); setPlaying(true); };
  const replay = () => { setSimT(0); setPlaying(true); setPhase("running"); };
  const toggleLab = (id: LabId) => setUserDown((u) => ({ ...u, [id]: !u[id] }));

  // ---------- view ----------
  const mapMode = phase === "normal" ? "normal" : phase === "attack" || phase === "analyzing" ? "stranded" : "plan";
  const mapOutcomes: TestOutcome[] | null = mapMode === "plan" ? solved?.opt.result.outcomes ?? null : NORMAL_OUTCOMES;
  const mapCond: Conditions | null = phase === "normal" ? NORMAL_COND : conditions ?? { ...NORMAL_COND, labDown: { ...NORMAL_COND.labDown, core: true } };
  const codeRed = phase === "attack" || phase === "analyzing";
  const postPlan = phase === "plan" || phase === "running" || phase === "done";
  const calls = (["guard", "protect", "extract", "decide", "verify"] as const).map((k) => ({ k, v: analysis[k] as any })).filter((x) => x.v);
  const liveLabel = calls[0]?.v.call.mode === "live" ? "Live Clocked API" : calls[0]?.v.call.mode === "recorded" ? "Recorded live Clocked responses" : calls.length ? "Offline stand-in" : "";

  const onTimeNow = (r: { outcomes: TestOutcome[] }) => r.outcomes.filter((o) => o.onTime && simT >= o.finish).length;

  return (
    <section id="demo" ref={sectionRef} className="max-w-[1200px] mx-auto px-4 sm:px-6 pb-24 scroll-mt-16">
      <div className="flex items-end justify-between gap-4 mb-6">
        <h2 className="text-[32px] sm:text-[40px] font-semibold tracking-[-0.03em]">Live demo</h2>
        {started && (
          <div className="flex items-center gap-2">
            {calls.length > 0 && <button onClick={() => setAudit(true)} className="btn btn-secondary !h-8 !px-3 !text-[13px]">API responses</button>}
            <button onClick={reset} className="btn btn-secondary !h-8 !px-3 !text-[13px]"><RotateCcw size={13} /> Restart</button>
          </div>
        )}
      </div>

      <div className={`box overflow-hidden transition-colors ${codeRed ? "!border-[var(--danger)]" : ""}`}>
        {!started ? (
          <div className="relative">
            <div className="bg-subtle p-4 sm:p-6 opacity-40 pointer-events-none" aria-hidden>
              <HospitalMap mode="normal" conditions={NORMAL_COND} outcomes={NORMAL_OUTCOMES} simT={0} loopT={loopT} userDown={{}} interactive={false} />
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <button onClick={() => setStarted(true)} className="btn btn-primary btn-lg !px-8 shadow-[0_8px_30px_rgba(0,0,0,0.12)]"><Play size={16} /> Start the demo</button>
            </div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            {/* stage */}
            <div className="bg-subtle p-4 sm:p-6 min-w-0" data-tour="map">
              <HospitalMap mode={mapMode} conditions={mapCond} outcomes={mapOutcomes} simT={simT} loopT={loopT} userDown={userDown}
                interactive={phase === "running" || phase === "done"} onToggleLab={toggleLab} />
            </div>

            {/* side panel */}
            <div className="p-5 sm:p-6 lg:border-l border-line min-w-0 flex flex-col">
              <AnimatePresence mode="wait">
                {phase === "normal" && (
                  <motion.div key="n" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-6 h-full">
                    <Numbers items={[["12", "urgent samples"], [String(STAT_COUNT), "life-critical"], ["30 min", "tightest deadline"]]} />
                    <div>
                      <div className="text-[13px] text-fg3 mb-2">Attack scenario</div>
                      <div className="space-y-1.5" role="radiogroup">
                        {INCIDENT_PRESETS.map((p) => {
                          const on = presetId === p.id;
                          return (
                            <button key={p.id} role="radio" aria-checked={on} onClick={() => pickPreset(p.id)}
                              className={`w-full text-left rounded-md border px-3 py-2.5 flex items-center gap-3 transition-colors ${on ? "border-fg" : "border-line hover:border-strong"}`}>
                              <span className={`w-3.5 h-3.5 rounded-full border shrink-0 ${on ? "border-[4px] border-fg" : "border-strong"}`} />
                              <span className="min-w-0">
                                <span className="block text-[14px] font-medium">{p.name}</span>
                                <span className="block text-[12.5px] text-fg3 truncate">{p.blurb}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <button onClick={() => setEditor(true)} className="mt-2 text-[13px] text-fg3 hover:text-fg underline underline-offset-4 decoration-[var(--line-strong)]">Or write your own</button>
                    </div>
                    <div className="mt-auto">
                      <button data-tour="launch" onClick={launch} className="btn btn-danger btn-lg w-full">Launch ransomware attack</button>
                    </div>
                  </motion.div>
                )}

                {phase === "attack" && (
                  <motion.div key="a" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-5">
                    <Numbers danger items={[["12", "samples stuck"], [String(STAT_COUNT), "life-critical"], ["30 min", "until the first is late"]]} />
                    <div>
                      <div className="text-[13px] text-fg3 mb-2">Incident notice arriving</div>
                      <pre className="mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-fg2 bg-subtle rounded-md p-3 h-[260px] overflow-hidden">{report.slice(0, typed)}</pre>
                    </div>
                    <div className="flex items-center gap-2 text-[13px] text-fg2"><Loader2 size={14} className="animate-spin" /> VitalSwitch is starting</div>
                  </motion.div>
                )}

                {(phase === "analyzing" || postPlan) && (
                  <motion.div key="p" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-6">
                    {postPlan && solved && (
                      <div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="text-[13px] text-fg3">Without VitalSwitch</div>
                            <div className="text-[34px] font-semibold tracking-tight tnum leading-tight">{phase === "plan" ? solved.base.onTime : onTimeNow(solved.base)}<span className="text-[18px] text-fg3"> / 12</span></div>
                          </div>
                          <div>
                            <div className="text-[13px] text-fg3">With VitalSwitch</div>
                            <div className="text-[34px] font-semibold tracking-tight tnum leading-tight text-ok">{phase === "plan" ? solved.opt.result.onTime : onTimeNow(solved.opt.result)}<span className="text-[18px] text-fg3"> / 12</span></div>
                          </div>
                        </div>
                        <div className="text-[13px] text-fg3 mt-1">urgent results back in time</div>
                      </div>
                    )}

                    <div data-tour="pipeline">
                      <div className="text-[13px] text-fg3 mb-1">{phase === "analyzing" ? "Clocked is reading the incident" : "What Clocked worked out"}{liveLabel && <span> · {liveLabel}</span>}</div>
                      <ol>
                        {STEP_ROWS.map((s) => {
                          const done = !!analysis[s.key];
                          const active = running === s.key;
                          return (
                            <li key={s.key} className={`flex items-start gap-3 py-2 hair-t text-[13.5px] ${!done && !active ? "opacity-35" : ""}`}>
                              <span className="w-4 pt-0.5 shrink-0">{active ? <Loader2 size={14} className="animate-spin text-fg2" /> : done ? <Check size={14} className="text-ok" /> : null}</span>
                              <span className="w-16 shrink-0 font-medium">{s.name}</span>
                              <span className={`min-w-0 ${s.key === "guard" && analysis.guard?.out.quarantined.length ? "text-danger" : "text-fg2"}`}>{done ? summary(s.key, analysis) : active ? "Working" : ""}</span>
                            </li>
                          );
                        })}
                      </ol>
                      {error && <p className="mt-2 text-[13px] text-danger">Analysis failed: {error}. <button className="underline" onClick={runAnalysis}>Try again</button></p>}
                    </div>

                    {phase === "plan" && (
                      <button data-tour="approve" onClick={approve} className="btn btn-primary btn-lg w-full">Approve plan</button>
                    )}
                    {(phase === "running" || phase === "done") && (
                      <div>
                        <div className="text-[13px] text-fg3 mb-1">Take labs away (or click them on the map)</div>
                        {LABS.filter((l) => l.id !== "core").map((l) => {
                          const off = !!userDown[l.id];
                          const byIncident = conditions?.labDown[l.id] && !off;
                          return <Switch key={l.id} on={!off && !byIncident} disabled={!!byIncident} onClick={() => toggleLab(l.id)} label={l.name} />;
                        })}
                        <Switch on={!courierStrike} onClick={() => setCourierStrike(!courierStrike)} label="Courier service" />
                        <button onClick={replay} className="mt-3 text-[13px] text-fg2 hover:text-fg flex items-center gap-1.5"><Play size={12} /> Replay</button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      {/* impact */}
      <AnimatePresence>
        {(phase === "running" || phase === "done") && solved && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-10">
            <AnimatePresence>
              {phase === "done" && (
                <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-[28px] sm:text-[36px] font-semibold tracking-[-0.03em] mb-8 max-w-[28ch]">
                  <span className="text-ok tnum">{solved.opt.result.onTime - solved.base.onTime >= 0 ? "+" : ""}{solved.opt.result.onTime - solved.base.onTime}</span> patients get their results in time, during the same attack.
                </motion.p>
              )}
            </AnimatePresence>
            <div className="grid lg:grid-cols-2 gap-6">
              <Gantt title="Without VitalSwitch" sub="Phone triage, then each sample goes to the first lab that can run it." result={solved.base} simT={simT} tone="alarm" />
              <Gantt title="With VitalSwitch" sub="The approved plan, sent two minutes after the notice." result={solved.opt.result} simT={simT} tone="vital" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {postPlan && solved && conditions && (
        <div className="mt-8 hair-t">
          <button onClick={() => setShowRoutes(!showRoutes)} className="w-full flex items-center gap-2 py-4 text-[15px] font-medium" aria-expanded={showRoutes}>
            <ChevronRight size={16} className={`transition-transform ${showRoutes ? "rotate-90" : ""}`} /> Details: every route, and why
          </button>
          {showRoutes && (
            <div className="grid lg:grid-cols-2 gap-10 pb-6">
              <RouteTable solved={solved} conditions={conditions} analysis={analysis} />
              <div className="min-w-0 space-y-8">
                <div><h3 className="text-[15px] font-medium mb-2">Constraints from Clocked</h3><ConstraintStrip analysis={analysis} conditions={conditions} /></div>
                <div><h3 className="text-[15px] font-medium">Each Clocked call</h3><Pipeline analysis={analysis} running={null} /></div>
              </div>
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} role="status"
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 box px-5 py-3 w-[min(460px,calc(100vw-32px))] shadow-[0_8px_30px_rgba(0,0,0,0.1)]">
            <div className={`text-[14px] font-medium ${toast.tone === "danger" ? "text-danger" : ""}`}>{toast.title}</div>
            <div className="text-[13px] text-fg2">{toast.body}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {editor && <Editor report={report} playbook={playbook} onClose={() => setEditor(false)}
        onSave={(r: string, p: string) => { setReport(r); setPlaybook(p); setPresetId("custom"); setEditor(false); reset(); }} />}
      {audit && <AuditLog calls={calls} onClose={() => setAudit(false)} />}
    </section>
  );
});
export default Demo;

/* ================= pieces ================= */

function Numbers({ items, danger }: { items: [string, string][]; danger?: boolean }) {
  return (
    <dl className="grid grid-cols-3 gap-3">
      {items.map(([v, l], i) => (
        <motion.div key={l} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
          <dd className={`text-[26px] font-semibold tracking-tight tnum leading-tight ${danger && i < 2 ? "text-danger" : ""}`}>{v}</dd>
          <dt className="text-[12.5px] text-fg3 leading-snug">{l}</dt>
        </motion.div>
      ))}
    </dl>
  );
}

function Switch({ on, onClick, disabled, label }: { on: boolean; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} onClick={onClick}
      className={`w-full flex items-center gap-3 py-2 hair-t text-left text-[13.5px] ${disabled ? "opacity-45 cursor-not-allowed" : ""}`}>
      <span className={`flex-1 min-w-0 truncate ${!on && !disabled ? "text-danger" : ""}`}>{label}{disabled ? " (down in this attack)" : ""}</span>
      <span className={`relative w-8 h-[18px] rounded-full transition-colors shrink-0 ${on ? "bg-fg" : "bg-muted border border-strong"}`}>
        <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full transition-all ${on ? "left-[15px] bg-[var(--on-fg)]" : "left-[2px] bg-[var(--fg-3)]"}`} />
      </span>
    </button>
  );
}

function RouteTable({ solved, conditions, analysis }: any) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="min-w-0">
      <h3 className="text-[15px] font-medium mb-2">Every route</h3>
      <table className="w-full text-[13px]">
        <tbody>
          {solved.opt.result.outcomes.slice()
            .sort((a: TestOutcome, b: TestOutcome) => b.test.priority - a.test.priority || a.test.deadline - b.test.deadline)
            .flatMap((o: TestOutcome) => {
              const isOpen = open === o.test.id;
              const rows = [
                <tr key={o.test.id} className="hair-t cursor-pointer hover:bg-subtle" onClick={() => setOpen(isOpen ? null : o.test.id)}>
                  <td className="py-2 pr-2"><ChevronRight size={12} className={`inline -mt-0.5 mr-1 text-fg3 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    <span className={o.test.priority === 3 ? "font-medium" : "text-fg2"}>{o.test.label}</span><span className="text-fg3 ml-1.5">{wardById(o.test.ward).short}</span></td>
                  <td className="py-2 font-medium" style={{ color: o.dest === "wait" ? "var(--fg-3)" : LAB_COLOR[o.lab] }}>{o.dest === "wait" ? "Hold" : labById(o.lab).short}</td>
                  <td className={`py-2 text-right tnum ${o.onTime ? "text-fg2" : "text-danger"}`}>{clock(o.finish)}{o.onTime ? "" : `, ${o.late} min late`}</td>
                </tr>,
              ];
              if (isOpen) {
                const alts = alternatives(o.test.id, solved.opt.assignments, conditions, analysis.verify.auth);
                rows.push(
                  <tr key={o.test.id + "w"}><td colSpan={3} className="pb-3">
                    <div className="ml-4 rounded-md bg-subtle px-4 py-3 text-[12.5px] space-y-1">
                      <p className="text-fg2">{o.test.clinical}. Needed by <span className="tnum text-fg">{clock(o.test.deadline)}</span>.</p>
                      {alts.map((a: any) => (
                        <div key={a.lab} className={`grid grid-cols-[48px_1fr] gap-2 ${a.lab === o.lab ? "text-fg" : "text-fg3"}`}>
                          <span className="mono font-medium" style={{ color: a.lab === o.lab ? LAB_COLOR[a.lab as LabId] : undefined }}>{labById(a.lab).short}</span>
                          {a.excluded ? <span>No: {a.excluded.toLowerCase()}</span> : <span>{a.lab === o.lab ? "Chosen. " : ""}Ready {clock(a.finish)}, {a.onTime ? "on time" : "late"}{a.lab !== o.lab && a.onTime ? ", kept free for more urgent tests" : ""}</span>}
                        </div>
                      ))}
                    </div>
                  </td></tr>,
                );
              }
              return rows;
            })}
        </tbody>
      </table>
    </div>
  );
}

function Editor({ report, playbook, onClose, onSave }: any) {
  const [r, setR] = useState(report);
  const [p, setP] = useState(playbook);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "color-mix(in srgb, var(--fg) 30%, transparent)" }} onClick={onClose}>
      <div className="box w-full max-w-5xl p-6 shadow-[0_16px_50px_rgba(0,0,0,0.15)]" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Write your own scenario">
        <div className="flex items-start justify-between mb-4 gap-4">
          <h2 className="text-[18px] font-semibold tracking-tight">Write your own scenario</h2>
          <button onClick={onClose} aria-label="Close" className="btn btn-secondary !h-8 !w-8 !p-0 shrink-0"><X size={14} /></button>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-[13px] font-medium mb-1.5">Incident notice</span>
            <textarea id="notice" value={r} onChange={(e) => setR(e.target.value)} className="mono w-full h-[360px] text-[12px] bg-subtle box p-3 focus:outline-none" />
          </label>
          <label className="block">
            <span className="block text-[13px] font-medium mb-1.5">Downtime procedure</span>
            <textarea id="procedure" value={p} onChange={(e) => setP(e.target.value)} className="mono w-full h-[360px] text-[12px] bg-subtle box p-3 focus:outline-none" />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => { setR(INCIDENT_PRESETS[0].text); setP(DEFAULT_PLAYBOOK); }} className="btn btn-secondary">Reset text</button>
          <button onClick={() => onSave(r, p)} className="btn btn-primary">Use this scenario</button>
        </div>
      </div>
    </div>
  );
}

function AuditLog({ calls, onClose }: { calls: { k: string; v: any }[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "color-mix(in srgb, var(--fg) 25%, transparent)" }} onClick={onClose}>
      <div className="w-full max-w-2xl h-full bg-bg border-l border-line p-6 overflow-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Clocked API responses">
        <div className="flex items-start justify-between mb-5 gap-4">
          <h2 className="text-[18px] font-semibold tracking-tight">Clocked API responses</h2>
          <button onClick={onClose} aria-label="Close" className="btn btn-secondary !h-8 !w-8 !p-0 shrink-0"><X size={14} /></button>
        </div>
        {calls.map(({ k, v }) => (
          <details key={k} className="hair-t py-3">
            <summary className="cursor-pointer flex items-center gap-3 text-[14px]"><span className="font-medium capitalize">{k}</span><ModeBadge call={v.call} /></summary>
            {v.call.error && <p className="text-[12.5px] text-warn mt-2">{v.call.error}</p>}
            <pre className="mono text-[11.5px] text-fg2 mt-2 max-h-[420px] overflow-auto whitespace-pre-wrap bg-subtle rounded-md p-3">{JSON.stringify(v.call.data, null, 2)}</pre>
          </details>
        ))}
      </div>
    </div>
  );
}
