"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RotateCcw, X, Check, ChevronRight, Play } from "lucide-react";
import HospitalMap, { LAB_COLOR } from "@/components/HospitalMap";
import Pipeline, { Analysis, StepKey, ModeBadge } from "@/components/Pipeline";
import Gantt from "@/components/Gantt";
import { ConstraintStrip, EventFeed } from "@/components/Feed";
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
const PLAY_RATE = 16; // simulated minutes per real second
const HORIZON = 215;

const NORMAL_COND: Conditions = {
  labDown: { core: false, west: false, poc: false, stmarys: false, reference: false },
  courierAvailable: true, tubeAvailable: true, lisDown: false, restorationMinutes: 0,
};
const NORMAL_OUTCOMES = simulate(TESTS.map((t) => ({ testId: t.id, dest: "core", dispatch: 0 }) as Assignment), NORMAL_COND).outcomes;

const STEPS: { label: string; phases: Phase[] }[] = [
  { label: "Normal operations", phases: ["normal"] },
  { label: "Cyberattack", phases: ["attack"] },
  { label: "Clocked analysis", phases: ["analyzing"] },
  { label: "Approval", phases: ["plan"] },
  { label: "Outcome", phases: ["running", "done"] },
];

const HEADLINE: Record<Phase, { title: string; sub: string }> = {
  normal: { title: "Twelve urgent blood tests are on their way to the Core Lab", sub: "Each dot on the map is a patient's specimen. Pick a scenario, then start the attack." },
  attack: { title: "Ransomware has taken the Core Lab offline", sub: "The specimens have nowhere to go. This is now a patient-care problem, not only an IT one." },
  analyzing: { title: "VitalSwitch is reading the incident with Clocked", sub: "Each answer becomes a hard constraint for the continuity engine." },
  plan: { title: "A verified continuity plan is ready for approval", sub: "Nothing moves until the lab downtime coordinator signs off." },
  running: { title: "Same outage, same tests, two different plans", sub: "Left: the usual manual response. Right: the approved VitalSwitch plan." },
  done: { title: "Same outage, same tests, two different plans", sub: "Now disable a backup lab on the map. VitalSwitch re-plans from scratch." },
};

export default function Page() {
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
  const [focusTest, setFocusTest] = useState<string | null>(null);
  const [toast, setToast] = useState<{ title: string; body: string; tone: "ok" | "danger" } | null>(null);
  const [live, setLive] = useState<"live" | "offline" | "recorded" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState(0);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if ((globalThis as any).__VS_STATIC__) { setLive("recorded"); return; }
    fetch("/api/status").then((r) => r.json()).then((d) => setLive(d.live ? "live" : "offline")).catch(() => setLive("offline"));
  }, []);

  // animation clock
  useEffect(() => {
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
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

  // typewriter for the incident notice
  useEffect(() => {
    if (phase !== "attack") return;
    setTyped(0);
    const id = setInterval(() => setTyped((n) => (n >= report.length ? n : n + 9)), 16);
    return () => clearInterval(id);
  }, [phase, report]);

  // ---------- derived constraint model ----------
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

  // plan-diff toast when the judge removes resources
  const prevPlan = useRef<{ assignments: Assignment[]; onTime: number } | null>(null);
  useEffect(() => {
    if (!solved) return;
    const prev = prevPlan.current;
    if (prev && (phase === "done" || phase === "running" || phase === "plan")) {
      const moved = solved.opt.assignments.filter((a) => prev.assignments.find((p) => p.testId === a.testId)?.dest !== a.dest).length;
      const d = solved.opt.result.onTime - prev.onTime;
      setToast({
        title: moved ? `Re-planned: ${moved} specimen${moved > 1 ? "s" : ""} rerouted` : "Re-planned: routing unchanged",
        body: `On time ${prev.onTime} → ${solved.opt.result.onTime} of 12${d < 0 ? ". Fewer resources, so the outcome is worse." : d > 0 ? ". Capacity restored." : "."} ${solved.opt.evaluated.toLocaleString()} plans re-evaluated in ${solved.ms.toFixed(0)} ms.`,
        tone: d < 0 ? "danger" : "ok",
      });
      if (phase === "done") { setSimT(0); setPlaying(true); setPhase("running"); }
    }
    prevPlan.current = { assignments: solved.opt.assignments, onTime: solved.opt.result.onTime };
  }, [solved]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (toast) { const id = setTimeout(() => setToast(null), 5200); return () => clearTimeout(id); } }, [toast]);

  // ---------- actions ----------
  const pickPreset = (id: string) => {
    const p = INCIDENT_PRESETS.find((x) => x.id === id)!;
    setPresetId(id);
    setReport(p.text);
  };
  const reset = () => {
    setPhase("normal"); setAnalysis({}); setUserDown({}); setCourierStrike(false); setSimT(0); setPlaying(false);
    setRunning(null); setError(null); prevPlan.current = null;
  };
  const attack = () => {
    setFlash(true);
    setTimeout(() => { setFlash(false); setPhase("attack"); setSimT(0); }, 1400);
  };

  const runAnalysis = useCallback(async () => {
    setPhase("analyzing"); setAnalysis({}); setError(null); prevPlan.current = null;
    try {
      setRunning("guard");
      const g = await callClocked("injection", guardRequest(report));
      const gOut = interpretGuard(report, g.data);
      setAnalysis((a) => ({ ...a, guard: { call: g, out: gOut } }));
      await sleep(gOut.quarantined.length ? 1400 : 450);

      setRunning("protect");
      const p = await callClocked("pii", protectRequest(gOut.sanitized));
      const pOut = interpretProtect(gOut.sanitized, p.data);
      setAnalysis((a) => ({ ...a, protect: { call: p, out: pOut } }));
      await sleep(450);

      setRunning("extract");
      const e = await callClocked("extract", extractRequest(pOut.redacted));
      setAnalysis((a) => ({ ...a, extract: { call: e, out: interpretExtract(e.data) } }));
      await sleep(450);

      setRunning("decide");
      const d = await callClocked("decide", decideRequest(pOut.redacted));
      setAnalysis((a) => ({ ...a, decide: { call: d, out: interpretDecide(d.data) } }));
      await sleep(550);

      setRunning("verify");
      const claims = authorizationClaims();
      const v = await callClocked("grounding", verifyRequest(playbook, claims));
      setAnalysis((a) => ({ ...a, verify: { call: v, auth: interpretVerify(claims, v.data), claims } }));
      await sleep(700);

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

  const approve = () => { setPhase("running"); setSimT(0); setPlaying(true); };
  const replay = () => { setSimT(0); setPlaying(true); setPhase("running"); };
  const toggleLab = (id: LabId) => setUserDown((u) => ({ ...u, [id]: !u[id] }));

  // ---------- view helpers ----------
  const mapMode = phase === "normal" ? "normal" : phase === "attack" || phase === "analyzing" ? "stranded" : "plan";
  const mapOutcomes: TestOutcome[] | null = mapMode === "plan" ? solved?.opt.result.outcomes ?? null : NORMAL_OUTCOMES;
  const mapCond: Conditions | null = phase === "normal" ? NORMAL_COND : conditions ?? { ...NORMAL_COND, labDown: { ...NORMAL_COND.labDown, core: true } };
  const codeRed = phase === "attack" || phase === "analyzing";
  const postPlan = phase === "plan" || phase === "running" || phase === "done";
  const status = phase === "normal"
    ? { text: "All systems normal", color: "var(--ok)" }
    : codeRed ? { text: "Code red: Core Lab offline", color: "var(--danger)" } : { text: "Continuity plan active", color: "var(--warn)" };
  const calls = (["guard", "protect", "extract", "decide", "verify"] as const).map((k) => ({ k, v: analysis[k] as any })).filter((x) => x.v);
  const anyEmulated = calls.some((c) => c.v.call.mode === "emulated");
  const stepIdx = STEPS.findIndex((s) => s.phases.includes(phase));
  const clocked = live === "live" ? "Clocked: live" : live === "recorded" ? "Clocked: recorded live responses" : live === "offline" ? "Clocked: offline stand-in" : "";

  return (
    <main className="min-h-screen bg-bg">
      {/* ---------- header ---------- */}
      <header className="sticky top-0 z-30 bg-bg hair-b">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
          <div className="flex items-baseline gap-3 min-w-0">
            <span className="text-[16px] font-semibold tracking-tight">VitalSwitch</span>
            <span className="hidden md:inline text-[13px] text-fg3 truncate">Northgate General, a synthetic hospital</span>
          </div>
          <div className="flex-1" />
          <span className="hidden sm:flex items-center gap-2 text-[13px] font-medium" style={{ color: status.color }}>
            <span className="w-2 h-2 rounded-full" style={{ background: status.color }} />{status.text}
          </span>
          <span className="hidden lg:inline text-[13px] text-fg3" title={live === "recorded" ? "The built-in scenarios replay responses recorded from the live Clocked API. Edited inputs use the offline stand-in." : undefined}>{clocked}</span>
          <button onClick={() => setAudit(true)} className="btn btn-secondary !h-8 !px-3 !text-[13px]">
            API log{calls.length > 0 && <span className="text-fg3 tnum">{calls.length}</span>}
          </button>
          <button onClick={reset} aria-label="Start over" title="Start over" className="btn btn-secondary !h-8 !w-8 !p-0"><RotateCcw size={14} /></button>
        </div>
      </header>

      <div className="max-w-[1320px] mx-auto px-4 sm:px-6 pt-6 pb-16">
        {/* ---------- steps ---------- */}
        <ol className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]" aria-label="Demo steps">
          {STEPS.map((s, i) => (
            <li key={s.label} className={`flex items-center gap-2 ${i === stepIdx ? "text-fg font-medium" : "text-fg3"}`} aria-current={i === stepIdx ? "step" : undefined}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] tnum border ${i === stepIdx ? "border-fg bg-fg text-[var(--on-fg)]" : "border-strong"}`}>
                {i < stepIdx ? <Check size={11} /> : i + 1}
              </span>
              {s.label}
            </li>
          ))}
        </ol>

        <AnimatePresence mode="wait">
          <motion.div key={phase === "done" ? "running" : phase} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="mt-8 mb-8">
            <h1 className={`text-[28px] sm:text-[32px] leading-tight font-semibold tracking-[-0.02em] ${codeRed ? "text-danger" : ""}`}>{HEADLINE[phase].title}</h1>
            <p className="text-[15px] text-fg2 mt-2 max-w-[65ch]">{HEADLINE[phase].sub}</p>
          </motion.div>
        </AnimatePresence>

        <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-8 items-start">
          {/* ---------- map column ---------- */}
          <section className={`box overflow-hidden min-w-0 lg:sticky lg:top-[72px] ${codeRed ? "!border-[var(--danger-line)]" : ""}`}>
            <div className="bg-subtle p-3">
              <HospitalMap mode={mapMode} conditions={mapCond} outcomes={mapOutcomes} simT={simT} loopT={loopT} userDown={userDown}
                interactive={postPlan} onToggleLab={toggleLab} focusTest={focusTest} />
            </div>
            <div className="hair-t px-5 py-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-fg2">
              {LABS.map((l) => (
                <span key={l.id} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: LAB_COLOR[l.id] }} />{l.name}</span>
              ))}
              {postPlan && <span className="text-fg3">Select a backup lab on the map to disable it</span>}
            </div>
            {postPlan && conditions && (
              <div className="hair-t px-5 py-5 grid md:grid-cols-2 gap-8">
                <div className="min-w-0">
                  <h2 className="text-[14px] font-medium mb-2">What Clocked established</h2>
                  <ConstraintStrip analysis={analysis} conditions={conditions} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[14px] font-medium mb-2">Event log</h2>
                  {solved && <EventFeed plan={solved.opt.result} base={solved.base} simT={phase === "plan" ? 0 : simT} />}
                </div>
              </div>
            )}
          </section>

          {/* ---------- right column ---------- */}
          <section className="min-w-0">
            <AnimatePresence mode="wait">
              {phase === "normal" && (
                <motion.div key="normal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">
                  <div>
                    <h2 className="text-[16px] font-semibold tracking-tight mb-3">Choose a scenario</h2>
                    <div className="space-y-2" role="radiogroup">
                      {INCIDENT_PRESETS.map((p) => {
                        const on = presetId === p.id;
                        return (
                          <button key={p.id} role="radio" aria-checked={on} onClick={() => pickPreset(p.id)}
                            className={`w-full text-left rounded-md border px-4 py-3 flex items-start gap-3 transition-colors ${on ? "border-fg" : "border-line hover:border-strong"}`}>
                            <span className={`mt-1 w-3.5 h-3.5 rounded-full border shrink-0 ${on ? "border-[4px] border-fg" : "border-strong"}`} />
                            <span>
                              <span className="block text-[14px] font-medium">{p.name}</span>
                              <span className="block text-[13px] text-fg3">{p.blurb}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <button onClick={() => setEditor(true)} className="mt-3 text-[13px] text-fg2 underline underline-offset-4 decoration-[var(--line-strong)] hover:text-fg">
                      Write your own incident notice or procedure
                    </button>
                  </div>
                  <button onClick={attack} className="btn btn-danger btn-lg w-full">Simulate cyberattack</button>
                  <div>
                    <h2 className="text-[16px] font-semibold tracking-tight mb-2">Urgent tests in progress</h2>
                    <table className="w-full text-[13px]">
                      <thead><tr className="text-fg3 text-left"><th className="font-normal py-1.5">Test</th><th className="font-normal">Ward</th><th className="font-normal text-right">Needed within</th></tr></thead>
                      <tbody>
                        {TESTS.map((t) => (
                          <tr key={t.id} className="hair-t" onMouseEnter={() => setFocusTest(t.id)} onMouseLeave={() => setFocusTest(null)}>
                            <td className="py-1.5 pr-2">
                              <span className={t.priority === 3 ? "font-medium" : "text-fg2"}>{t.label}</span>
                              {t.priority === 3 && <span className="text-fg3 text-[11.5px] ml-1.5">STAT</span>}
                              <div className="text-[12px] text-fg3">{t.clinical}</div>
                            </td>
                            <td className="text-fg2 align-top py-1.5">{wardById(t.ward).short}</td>
                            <td className="text-right tnum align-top py-1.5">{t.deadline} min</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}

              {phase === "attack" && (
                <motion.div key="attack" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                  <dl className="grid grid-cols-3 box divide-x divide-[var(--line)]">
                    <Stat value="12" label="specimens stranded" danger />
                    <Stat value={String(TESTS.filter((t) => t.priority === 3).length)} label="STAT tests at risk" danger />
                    <Stat value={`${Math.min(...TESTS.map((t) => t.deadline))} min`} label="earliest deadline" />
                  </dl>
                  <div>
                    <h2 className="text-[14px] font-medium mb-2">Incident notice</h2>
                    <pre className="mono text-[12px] leading-relaxed whitespace-pre-wrap text-fg2 bg-subtle box p-4 h-[300px] overflow-auto">{report.slice(0, typed)}<span className="animate-pulse">▍</span></pre>
                  </div>
                  <p className="text-[14px] text-fg2">
                    A ventilated ICU patient needs a blood gas within <span className="text-fg font-medium">30 minutes</span>. A stroke patient needs clotting results before a clot-busting drug can be given.
                  </p>
                  <button onClick={runAnalysis} className="btn btn-primary btn-lg w-full">Activate VitalSwitch</button>
                </motion.div>
              )}

              {phase === "analyzing" && (
                <motion.div key="analyzing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <h2 className="text-[16px] font-semibold tracking-tight">Clocked analysis</h2>
                  <Pipeline analysis={analysis} running={running} />
                  {error && <p className="mt-3 text-[13px] text-danger">The analysis failed: {error}. <button className="underline" onClick={runAnalysis}>Try again</button></p>}
                </motion.div>
              )}

              {postPlan && solved && (
                <motion.div key="plan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-10">
                  <Recommendation solved={solved} phase={phase} onApprove={approve} onReplay={replay} conditions={conditions!} analysis={analysis} onHover={setFocusTest} />
                  {phase !== "plan" && <ProveIt userDown={userDown} toggleLab={toggleLab} courierStrike={courierStrike} setCourierStrike={setCourierStrike} conditions={conditions!} />}
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        </div>

        {/* ---------- payoff ---------- */}
        {phase === "done" && solved && (
          <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-12 grid sm:grid-cols-[auto_1fr] gap-x-8 gap-y-2 items-baseline">
            <div className="text-[56px] leading-none font-semibold tracking-[-0.03em] tnum text-ok">
              {solved.opt.result.onTime - solved.base.onTime >= 0 ? "+" : ""}{solved.opt.result.onTime - solved.base.onTime}
            </div>
            <div>
              <p className="text-[18px] font-medium">more urgent results on time during the same outage</p>
              <p className="text-[14px] text-fg2 mt-1">
                STAT results on time went from {solved.base.statOnTime} to {solved.opt.result.statOnTime} of {solved.opt.result.statTotal}. Total lateness fell from {solved.base.minutesLate} to {solved.opt.result.minutesLate} minutes. These numbers come from the simulation.
              </p>
            </div>
          </motion.section>
        )}

        {/* ---------- comparison ---------- */}
        {(phase === "running" || phase === "done") && solved && (
          <section className={`${phase === "done" ? "mt-8" : "mt-12"} grid lg:grid-cols-2 gap-6`}>
            <Gantt title="Without VitalSwitch" sub="25 minutes of phone triage, then each specimen goes to the first approved site that can run it. No capacity or deadline awareness." result={solved.base} simT={simT} tone="alarm" />
            <Gantt title="With VitalSwitch" sub="The verified, capacity-aware plan, dispatched 2 minutes after the notice and approved by the coordinator." result={solved.opt.result} simT={simT} tone="vital" />
          </section>
        )}

        {postPlan && (
          <details className="mt-10 hair-t pt-6 group">
            <summary className="cursor-pointer list-none flex items-center gap-2 text-[16px] font-semibold tracking-tight">
              <ChevronRight size={16} className="group-open:rotate-90 transition-transform" /> How Clocked shaped this plan
              {anyEmulated && <span className="text-[13px] font-normal text-warn">Some steps used the offline stand-in</span>}
            </summary>
            <div className="mt-2 max-w-3xl"><Pipeline analysis={analysis} running={null} /></div>
          </details>
        )}

        <footer className="mt-12 hair-t pt-6 text-[13px] text-fg3 max-w-[80ch]">
          VitalSwitch is a hackathon prototype running on a fully synthetic hospital. Patients, labs, timings and procedures are fictional, and the results are simulation outputs, not claims about real clinical outcomes. Clocked interprets text. Clinical priorities, deadlines and constraints come from the scenario data and the approved procedure. Every plan needs human approval.
        </footer>
      </div>

      {/* ---------- code red moment ---------- */}
      <AnimatePresence>
        {flash && (
          <motion.div key="flash" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--bg) 88%, transparent)" }}>
            <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.3, ease: "easeOut" }} className="text-center px-6">
              <div className="flex items-center justify-center gap-3">
                <span className="w-3 h-3 rounded-full bg-danger animate-pulse" />
                <span className="text-[56px] sm:text-[72px] font-semibold tracking-[-0.03em] text-danger leading-none">Code red</span>
              </div>
              <p className="mt-4 text-[17px] text-fg2">Ransomware detected at 13:48. The Core Laboratory is offline.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- toast ---------- */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} role="status"
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 box px-5 py-3 w-[min(520px,calc(100vw-32px))] shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
            <div className={`text-[14px] font-medium ${toast.tone === "danger" ? "text-danger" : "text-fg"}`}>{toast.title}</div>
            <div className="text-[13px] text-fg2 mt-0.5">{toast.body}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {editor && (
        <Editor report={report} playbook={playbook} onClose={() => setEditor(false)}
          onSave={(r: string, p: string) => { setReport(r); setPlaybook(p); setPresetId("custom"); setEditor(false); reset(); }} />
      )}
      {audit && <AuditLog calls={calls} onClose={() => setAudit(false)} />}
    </main>
  );
}

/* ================= sub components ================= */

function Stat({ value, label, danger }: { value: string; label: string; danger?: boolean }) {
  return (
    <div className="px-4 py-3">
      <dd className={`text-[24px] font-semibold tracking-tight tnum ${danger ? "text-danger" : ""}`}>{value}</dd>
      <dt className="text-[12.5px] text-fg3">{label}</dt>
    </div>
  );
}

function Recommendation({ solved, phase, onApprove, onReplay, conditions, analysis, onHover }: any) {
  const { opt, base } = solved;
  const [open, setOpen] = useState<string | null>(null);
  const gain = opt.result.onTime - base.onTime;
  const statGain = opt.result.statOnTime - base.statOnTime;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[16px] font-semibold tracking-tight">Recommended plan</h2>
        <span className="text-[12.5px] text-fg3 tnum">{opt.evaluated.toLocaleString()} plans in {solved.ms.toFixed(0)} ms</span>
      </div>
      <dl className="grid grid-cols-3 box divide-x divide-[var(--line)] mt-3">
        <div className="px-4 py-3"><dd className="text-[24px] font-semibold tracking-tight tnum">{base.onTime}<span className="text-fg3 text-[16px]"> / 12</span></dd><dt className="text-[12.5px] text-fg3">on time without</dt></div>
        <div className="px-4 py-3"><dd className="text-[24px] font-semibold tracking-tight tnum text-ok">{opt.result.onTime}<span className="text-fg3 text-[16px]"> / 12</span></dd><dt className="text-[12.5px] text-fg3">on time with VitalSwitch</dt></div>
        <div className="px-4 py-3"><dd className="text-[24px] font-semibold tracking-tight tnum">{gain >= 0 ? "+" : ""}{gain}</dd><dt className="text-[12.5px] text-fg3">results saved, {statGain >= 0 ? "+" : ""}{statGain} STAT</dt></div>
      </dl>

      <table className="w-full text-[13px] mt-4">
        <thead><tr className="text-fg3 text-left"><th className="font-normal py-1.5">Test</th><th className="font-normal">Route</th><th className="font-normal text-right">Result</th></tr></thead>
        <tbody>
          {opt.result.outcomes.slice()
            .sort((a: TestOutcome, b: TestOutcome) => b.test.priority - a.test.priority || a.test.deadline - b.test.deadline)
            .flatMap((o: TestOutcome) => {
              const isOpen = open === o.test.id;
              const rows = [
                <tr key={o.test.id} className="hair-t cursor-pointer hover:bg-subtle" onClick={() => setOpen(isOpen ? null : o.test.id)}
                  onMouseEnter={() => onHover(o.test.id)} onMouseLeave={() => onHover(null)} aria-expanded={isOpen}>
                  <td className="py-2 pr-2">
                    <ChevronRight size={12} className={`inline -mt-0.5 mr-1 text-fg3 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    <span className={o.test.priority === 3 ? "font-medium" : "text-fg2"}>{o.test.label}</span>
                    <span className="text-fg3 ml-1.5">{wardById(o.test.ward).short}</span>
                  </td>
                  <td className="py-2 font-medium" style={{ color: o.dest === "wait" ? "var(--fg-3)" : LAB_COLOR[o.lab] }}>
                    {o.dest === "wait" ? "Hold for Core Lab" : labById(o.lab).short}
                  </td>
                  <td className={`py-2 text-right tnum ${o.onTime ? "text-fg2" : "text-danger"}`}>{clock(o.finish)}{o.onTime ? "" : `, ${o.late} min late`}</td>
                </tr>,
              ];
              if (isOpen) rows.push(<tr key={o.test.id + "-why"}><td colSpan={3} className="pb-3"><Why o={o} solved={solved} conditions={conditions} analysis={analysis} /></td></tr>);
              return rows;
            })}
        </tbody>
      </table>

      <div className="mt-5">
        {phase === "plan"
          ? <button onClick={onApprove} className="btn btn-primary btn-lg w-full">Approve and dispatch</button>
          : <button onClick={onReplay} className="btn btn-secondary btn-lg w-full"><Play size={14} /> Replay the comparison</button>}
        <p className="text-[12.5px] text-fg3 mt-2">Sign-off by the lab downtime coordinator is simulated. Select a row to see why each route was chosen.</p>
      </div>
    </div>
  );
}

function Why({ o, solved, conditions, analysis }: any) {
  const alts = alternatives(o.test.id, solved.opt.assignments, conditions, analysis.verify.auth);
  return (
    <div className="ml-4 rounded-md bg-subtle px-4 py-3 text-[12.5px] space-y-1">
      <p className="text-fg2">{o.test.clinical}. Result needed by <span className="tnum text-fg">{clock(o.test.deadline)}</span>.</p>
      {alts.map((a: any) => {
        const chosen = a.lab === o.lab;
        return (
          <div key={a.lab} className={`grid grid-cols-[56px_1fr] gap-2 ${chosen ? "text-fg" : "text-fg3"}`}>
            <span className="mono font-medium" style={{ color: chosen ? LAB_COLOR[a.lab as LabId] : undefined }}>{labById(a.lab).short}</span>
            {a.excluded ? <span>Excluded: {a.excluded.toLowerCase()}</span> : (
              <span>
                {chosen ? "Chosen. " : ""}Ready {clock(a.finish)}, {a.onTime ? "on time" : <span className="text-danger">late</span>}
                {!chosen && a.onTime ? ". Capacity kept for more urgent tests." : ""}
              </span>
            )}
          </div>
        );
      })}
      {o.dest === "wait" && <p className="text-warn">No approved backup can meet this test, so it waits for the Core Lab (about {Math.round(conditions.restorationMinutes / 60)} h, from Extract).</p>}
    </div>
  );
}

function Switch({ on, onClick, disabled, label, note }: { on: boolean; onClick: () => void; disabled?: boolean; label: string; note: string }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} onClick={onClick}
      className={`w-full flex items-center gap-3 py-2.5 hair-t text-left ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px]">{label}</span>
        <span className={`block text-[12.5px] ${!on ? "text-danger" : "text-fg3"}`}>{note}</span>
      </span>
      <span className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${on ? "bg-fg" : "bg-muted border border-strong"}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${on ? "left-[18px] bg-[var(--on-fg)]" : "left-0.5 bg-[var(--fg-3)]"}`} />
      </span>
    </button>
  );
}

function ProveIt({ userDown, toggleLab, courierStrike, setCourierStrike, conditions }: any) {
  return (
    <div>
      <h2 className="text-[16px] font-semibold tracking-tight">Test it under pressure</h2>
      <p className="text-[13px] text-fg2 mt-1 mb-3">Turn off resources. The engine re-plans from scratch, and the outcome can get worse.</p>
      {LABS.filter((l) => l.id !== "core").map((l) => {
        const off = !!userDown[l.id];
        const byIncident = conditions?.labDown[l.id] && !off;
        return (
          <Switch key={l.id} on={!off && !byIncident} disabled={byIncident} onClick={() => toggleLab(l.id)} label={l.name}
            note={byIncident ? "Down in this incident" : off ? "Disabled by you" : "Available"} />
        );
      })}
      <Switch on={!courierStrike} onClick={() => setCourierStrike(!courierStrike)} label="Courier service" note={courierStrike ? "Stopped by you" : "Running"} />
    </div>
  );
}

function Editor({ report, playbook, onClose, onSave }: any) {
  const [r, setR] = useState(report);
  const [p, setP] = useState(playbook);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "color-mix(in srgb, var(--fg) 30%, transparent)" }} onClick={onClose}>
      <div className="box w-full max-w-5xl p-6 shadow-[0_16px_50px_rgba(0,0,0,0.15)]" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit inputs">
        <div className="flex items-start justify-between mb-4 gap-4">
          <div>
            <h2 className="text-[18px] font-semibold tracking-tight">Edit the inputs</h2>
            <p className="text-[13px] text-fg2">Clocked reads whatever you write. Try suspending the courier, or removing the West Wing approval for coagulation.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="btn btn-secondary !h-8 !w-8 !p-0 shrink-0"><X size={14} /></button>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-[13px] font-medium mb-1.5">Incident notice <span className="text-fg3 font-normal">read by Guard, Protect, Extract and Decide</span></span>
            <textarea id="notice" value={r} onChange={(e) => setR(e.target.value)} className="mono w-full h-[360px] text-[12px] bg-subtle box p-3 focus:outline-none" />
          </label>
          <label className="block">
            <span className="block text-[13px] font-medium mb-1.5">Downtime procedure <span className="text-fg3 font-normal">checked by Verify</span></span>
            <textarea id="procedure" value={p} onChange={(e) => setP(e.target.value)} className="mono w-full h-[360px] text-[12px] bg-subtle box p-3 focus:outline-none" />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => { setR(INCIDENT_PRESETS[0].text); setP(DEFAULT_PLAYBOOK); }} className="btn btn-secondary">Restore defaults</button>
          <button onClick={() => onSave(r, p)} className="btn btn-primary">Use these inputs</button>
        </div>
      </div>
    </div>
  );
}

function AuditLog({ calls, onClose }: { calls: { k: string; v: any }[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "color-mix(in srgb, var(--fg) 25%, transparent)" }} onClick={onClose}>
      <div className="w-full max-w-2xl h-full bg-bg border-l border-line p-6 overflow-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Clocked API log">
        <div className="flex items-start justify-between mb-5 gap-4">
          <div>
            <h2 className="text-[18px] font-semibold tracking-tight">Clocked API log</h2>
            <p className="text-[13px] text-fg2">The exact responses behind this run. Requests are built in <span className="mono text-[12px]">lib/clocked.ts</span>.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="btn btn-secondary !h-8 !w-8 !p-0 shrink-0"><X size={14} /></button>
        </div>
        {calls.length === 0 && <p className="text-[14px] text-fg3">No calls yet. Run a scenario first.</p>}
        {calls.map(({ k, v }) => (
          <details key={k} className="hair-t py-3">
            <summary className="cursor-pointer flex items-center gap-3 text-[14px]">
              <span className="font-medium capitalize">{k}</span><ModeBadge call={v.call} />
            </summary>
            {v.call.error && <p className="text-[12.5px] text-warn mt-2">{v.call.error}</p>}
            <pre className="mono text-[11.5px] text-fg2 mt-2 max-h-[420px] overflow-auto whitespace-pre-wrap bg-subtle rounded-md p-3">{JSON.stringify(v.call.data, null, 2)}</pre>
          </details>
        ))}
      </div>
    </div>
  );
}
