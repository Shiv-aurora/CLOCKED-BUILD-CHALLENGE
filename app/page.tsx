"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, AlertTriangle, ShieldCheck, Play, RotateCcw, FileText, Pencil, X, Zap, CheckCircle2, Terminal, Truck, Info, ChevronRight,
} from "lucide-react";
import HospitalMap, { LAB_COLOR } from "@/components/HospitalMap";
import Pipeline, { Analysis, StepKey, ModeBadge } from "@/components/Pipeline";
import Gantt from "@/components/Gantt";
import { ConstraintStrip, EventFeed } from "@/components/Feed";
import {
  DEFAULT_PLAYBOOK, INCIDENT_PRESETS, LABS, PRIORITY_LABEL, TESTS, labById, wardById, CATEGORY_LABEL,
} from "@/lib/scenario";
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

const CAPTION: Record<Phase, { tag: string; text: string }> = {
  normal: { tag: "SCENE 1 · NORMAL OPERATIONS", text: "12 urgent blood tests are on their way to the Core Lab. Every dot is a patient's specimen." },
  attack: { tag: "SCENE 2 · CODE RED", text: "Ransomware just encrypted the Core Lab. Twelve urgent tests now have nowhere to go." },
  analyzing: { tag: "SCENE 3 · VITALSWITCH INTERVENES", text: "Clocked reads the incident and the downtime procedure; the engine turns its answers into hard constraints." },
  plan: { tag: "SCENE 3 · HUMAN IN THE LOOP", text: "A verified continuity plan is ready. Nothing moves until the coordinator approves." },
  running: { tag: "SCENE 4 · THE PAYOFF", text: "Same outage. Same twelve tests. The only difference is the plan." },
  done: { tag: "SCENE 5 · PROVE IT ISN'T SCRIPTED", text: "Click any backup lab on the map to knock it out. VitalSwitch re-plans instantly." },
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
  const [toast, setToast] = useState<{ title: string; body: string; tone: "vital" | "alarm" } | null>(null);
  const [live, setLive] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState(0);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then((d) => setLive(d.live)).catch(() => setLive(false));
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

  // plan-diff toast for Scene 5
  const prevPlan = useRef<{ assignments: Assignment[]; onTime: number } | null>(null);
  useEffect(() => {
    if (!solved) return;
    const prev = prevPlan.current;
    if (prev && (phase === "done" || phase === "running" || phase === "plan")) {
      const moved = solved.opt.assignments.filter((a) => prev.assignments.find((p) => p.testId === a.testId)?.dest !== a.dest).length;
      const d = solved.opt.result.onTime - prev.onTime;
      setToast({
        title: moved ? `Re-planned · ${moved} specimen${moved > 1 ? "s" : ""} rerouted` : "Re-planned · routing unchanged",
        body: `On-time results ${prev.onTime} → ${solved.opt.result.onTime}${d < 0 ? " — fewer resources, honestly worse." : d > 0 ? " — capacity restored." : "."} ${solved.opt.evaluated.toLocaleString()} plans re-evaluated in ${solved.ms.toFixed(0)} ms.`,
        tone: d < 0 ? "alarm" : "vital",
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
    setTimeout(() => { setFlash(false); setPhase("attack"); setSimT(0); }, 1500);
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
  const mapCond: Conditions | null = phase === "normal" ? NORMAL_COND : conditions ?? (phase === "attack" || phase === "analyzing" ? { ...NORMAL_COND, labDown: { ...NORMAL_COND.labDown, core: true } } : null);
  const statusPill = phase === "normal"
    ? { t: "ALL SYSTEMS NORMAL", c: "text-vital border-vital/30 bg-vital/10" }
    : phase === "attack" || phase === "analyzing"
      ? { t: "CODE RED · LAB OFFLINE", c: "text-alarm border-alarm/40 bg-alarm/10 animate-pulse" }
      : { t: "CONTINUITY PLAN ACTIVE", c: "text-amberx border-amberx/30 bg-amberx/10" };
  const calls = (["guard", "protect", "extract", "decide", "verify"] as const).map((k) => ({ k, v: analysis[k] as any })).filter((x) => x.v);
  const anyEmulated = calls.some((c) => c.v.call.mode === "emulated");
  const codeRed = phase === "attack" || phase === "analyzing";

  return (
    <main className="min-h-screen grid-bg relative">
      {codeRed && <div className="vignette-red" />}
      <AnimatePresence>
        {flash && (
          <motion.div key="flash" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-alarm/20 backdrop-blur-[2px] pointer-events-none">
            <motion.div initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }} className="text-center glitch">
              <div className="mono text-[11px] tracking-[0.5em] text-alarm mb-3">INC-7731 · 14:02</div>
              <div className="text-6xl sm:text-8xl font-black tracking-tight text-white text-glow-alarm">CODE RED</div>
              <div className="mt-3 text-lg text-red-100/90">Ransomware detected · Core Laboratory offline</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- header ---------- */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur-xl">
        <div className="max-w-[1500px] mx-auto px-4 lg:px-6 h-14 flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="relative w-8 h-8 rounded-lg bg-vital/10 border border-vital/30 flex items-center justify-center">
              <Activity size={17} className="text-vital" />
            </div>
            <div className="leading-tight">
              <div className="font-bold tracking-tight">Vital<span className="text-vital">Switch</span></div>
              <div className="text-[10px] text-slate-500 hidden sm:block">Clinical continuity during cyberattacks</div>
            </div>
          </div>
          <div className="hidden md:block h-6 w-px bg-white/10" />
          <div className="hidden md:block text-[11px] text-slate-400">Northgate General <span className="text-slate-600">· synthetic hospital</span></div>
          <div className="flex-1" />
          <div className="mono text-sm text-slate-300 tabular-nums">{clock(phase === "running" || phase === "done" ? simT : 0)}</div>
          <span className={`mono text-[10px] px-2 py-1 rounded-md border ${statusPill.c}`}>{statusPill.t}</span>
          <span
            title={live ? "CLOCKED_API_KEY configured: calls go to the live Clocked API" : "No CLOCKED_API_KEY: an offline stand-in emulates the responses"}
            className={`hidden sm:inline mono text-[10px] px-2 py-1 rounded-md border ${live ? "text-vital border-vital/30" : "text-amberx border-amberx/30"}`}
          >
            CLOCKED · {live === null ? "…" : live ? "LIVE" : "OFFLINE MODE"}
          </span>
          <button onClick={() => setAudit(true)} className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-300 hover:text-white px-2 py-1 rounded-md border border-white/10 hover:border-white/25">
            <Terminal size={13} /> API log {calls.length > 0 && <span className="mono text-vital">{calls.length}</span>}
          </button>
          <button onClick={reset} title="Reset" className="p-1.5 rounded-md border border-white/10 text-slate-400 hover:text-white"><RotateCcw size={14} /></button>
        </div>
      </header>

      <div className="max-w-[1500px] mx-auto px-4 lg:px-6 py-5">
        {/* ---------- narrative caption ---------- */}
        <AnimatePresence mode="wait">
          <motion.div key={phase} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="mb-4 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
            <span className={`mono text-[10px] tracking-[0.2em] ${codeRed ? "text-alarm" : phase === "normal" ? "text-cyanx" : "text-vital"}`}>{CAPTION[phase].tag}</span>
            <span className="text-lg sm:text-xl font-semibold tracking-tight text-slate-100">{CAPTION[phase].text}</span>
          </motion.div>
        </AnimatePresence>

        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
          {/* ---------- map ---------- */}
          <section className={`panel p-3 relative scanlines ${codeRed ? "!border-alarm/30" : ""}`}>
            <HospitalMap
              mode={mapMode}
              conditions={mapCond}
              outcomes={mapOutcomes}
              simT={simT}
              loopT={loopT}
              userDown={userDown}
              interactive={phase === "done" || phase === "plan" || phase === "running"}
              onToggleLab={toggleLab}
              focusTest={focusTest}
            />
            <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 pb-1 text-[10px] text-slate-500">
              {LABS.map((l) => (
                <span key={l.id} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: LAB_COLOR[l.id] }} />{l.name}</span>
              ))}
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#ff6b7a]" />STAT specimen</span>
            </div>
            {(phase === "plan" || phase === "running" || phase === "done") && conditions && (
              <div className="mx-2 mt-3 pt-3 border-t border-white/[0.06] space-y-3">
                <div>
                  <div className="label mb-1.5">Constraints Clocked established</div>
                  <ConstraintStrip analysis={analysis} conditions={conditions} />
                </div>
                {solved && phase !== "plan" && (
                  <div>
                    <div className="label mb-1.5">Live event feed</div>
                    <EventFeed plan={solved.opt.result} base={solved.base} simT={simT} />
                  </div>
                )}
              </div>
            )}
            {(phase === "plan" || phase === "done" || phase === "running") && (
              <div className="absolute top-5 right-5 flex items-center gap-2 text-[10.5px] text-slate-300 bg-ink-900/90 border border-white/10 rounded-lg px-2.5 py-1.5">
                <Zap size={12} className="text-amberx" /> Click a backup lab to knock it out
              </div>
            )}
          </section>

          {/* ---------- right column ---------- */}
          <section className="flex flex-col gap-4 min-w-0">
            <AnimatePresence mode="wait">
              {phase === "normal" && (
                <motion.div key="normal" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="panel p-4 space-y-4">
                  <div>
                    <div className="label mb-2">Choose the attack</div>
                    <div className="grid grid-cols-3 gap-2">
                      {INCIDENT_PRESETS.map((p) => (
                        <button key={p.id} onClick={() => pickPreset(p.id)}
                          className={`text-left rounded-xl border p-2.5 transition ${presetId === p.id ? "border-alarm/50 bg-alarm/[0.07]" : "border-white/[0.08] hover:border-white/20"}`}>
                          <div className="text-[12px] font-semibold text-slate-100">{p.name}</div>
                          <div className="text-[10.5px] text-slate-500 mt-0.5 leading-snug">{p.blurb}</div>
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setEditor(true)} className="mt-2 text-[11px] text-slate-400 hover:text-white flex items-center gap-1"><Pencil size={11} /> Edit the incident notice or downtime procedure yourself</button>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={attack}
                    className="w-full rounded-xl py-3.5 font-bold tracking-wide text-white bg-gradient-to-r from-alarm to-[#ff6b3b] shadow-[0_0_40px_-8px_rgba(255,59,78,0.7)] flex items-center justify-center gap-2"
                  >
                    <AlertTriangle size={18} /> SIMULATE CYBERATTACK
                  </motion.button>
                  <TestQueue onHover={setFocusTest} />
                </motion.div>
              )}

              {phase === "attack" && (
                <motion.div key="attack" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="panel p-4 space-y-4 !border-alarm/30">
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label="Specimens stranded" value="12" tone="alarm" />
                    <Stat label="STAT tests at risk" value={String(TESTS.filter((t) => t.priority === 3).length)} tone="alarm" />
                    <Stat label="Earliest deadline" value={`${Math.min(...TESTS.map((t) => t.deadline))} min`} tone="amber" />
                  </div>
                  <div className="rounded-xl bg-black/50 border border-alarm/20 p-3 h-[300px] overflow-auto">
                    <div className="label !text-alarm mb-2 flex items-center gap-1.5"><FileText size={11} /> Incoming incident notice</div>
                    <pre className="mono text-[11px] leading-relaxed whitespace-pre-wrap text-slate-300">{report.slice(0, typed)}<span className="animate-pulse text-alarm">▍</span></pre>
                  </div>
                  <div className="text-[12px] text-slate-400 leading-relaxed">
                    This is no longer an IT problem: a ventilated ICU patient needs a blood gas within <b className="text-alarm">30 minutes</b>, a stroke patient needs clotting results before a clot-busting drug can be given.
                  </div>
                  <motion.button
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
                    whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={runAnalysis}
                    className="w-full rounded-xl py-3.5 font-bold tracking-wide text-ink-950 bg-vital shadow-[0_0_40px_-6px_rgba(46,242,176,0.7)] flex items-center justify-center gap-2"
                  >
                    <ShieldCheck size={18} /> ACTIVATE VITALSWITCH
                  </motion.button>
                </motion.div>
              )}

              {phase === "analyzing" && (
                <motion.div key="analyzing" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="panel p-4">
                  <div className="label mb-3">Clocked analysis pipeline</div>
                  <Pipeline analysis={analysis} running={running} />
                  {error && <div className="mt-3 text-[12px] text-alarm">Analysis failed: {error} <button className="underline" onClick={runAnalysis}>retry</button></div>}
                </motion.div>
              )}

              {(phase === "plan" || phase === "running" || phase === "done") && solved && (
                <motion.div key="plan" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-4">
                  <Recommendation solved={solved} phase={phase} onApprove={approve} onReplay={replay} conditions={conditions!} analysis={analysis} onHover={setFocusTest} />
                  {phase !== "plan" && (
                    <ProveIt userDown={userDown} toggleLab={toggleLab} courierStrike={courierStrike} setCourierStrike={setCourierStrike} conditions={conditions!} />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        </div>

        {/* ---------- payoff banner ---------- */}
        <AnimatePresence>
          {phase === "done" && solved && (
            <motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
              className="mt-4 panel !border-vital/30 px-5 py-4 flex flex-col md:flex-row md:items-center gap-3 md:gap-8 bg-gradient-to-r from-vital/[0.08] to-transparent">
              <div className="mono text-5xl font-black text-vital text-glow-vital">
                {solved.opt.result.onTime - solved.base.onTime >= 0 ? "+" : ""}{solved.opt.result.onTime - solved.base.onTime}
              </div>
              <div className="flex-1">
                <div className="text-lg font-semibold text-slate-100">
                  more urgent results on time during the same outage
                </div>
                <div className="text-[12.5px] text-slate-400">
                  STAT results on time: <span className="text-alarm mono">{solved.base.statOnTime}/{solved.base.statTotal}</span> → <span className="text-vital mono">{solved.opt.result.statOnTime}/{solved.opt.result.statTotal}</span>
                  {" · "}total lateness: <span className="text-alarm mono">{solved.base.minutesLate} min</span> → <span className="text-vital mono">{solved.opt.result.minutesLate} min</span>
                  {" · "}computed by simulation, not estimated.
                </div>
              </div>
              <div className="text-[11.5px] text-amberx flex items-center gap-1.5"><Zap size={13} /> Now knock out a backup lab on the map →</div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ---------- comparison ---------- */}
        {(phase === "running" || phase === "done") && solved && (
          <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mt-4 grid lg:grid-cols-2 gap-4">
            <Gantt title="Without VitalSwitch" sub={`Manual downtime: ${25} min to coordinate by phone, then each specimen goes to the first approved site that can run it — no capacity or deadline awareness.`} result={solved.base} simT={simT} tone="alarm" />
            <Gantt title="With VitalSwitch" sub="Verified, capacity-aware plan dispatched 2 minutes after the notice, approved by the coordinator." result={solved.opt.result} simT={simT} tone="vital" />
          </motion.section>
        )}

        {(phase === "plan" || phase === "running" || phase === "done") && (
          <details className="mt-4 panel p-4 group">
            <summary className="cursor-pointer text-[12px] text-slate-300 flex items-center gap-2 list-none">
              <ChevronRight size={14} className="group-open:rotate-90 transition" /> How Clocked shaped this plan
              {anyEmulated && <span className="mono text-[10px] text-amberx">· offline stand-in responses (no API key)</span>}
            </summary>
            <div className="mt-3 max-w-3xl"><Pipeline analysis={analysis} running={null} /></div>
          </details>
        )}

        <footer className="mt-6 text-[11px] text-slate-600 leading-relaxed max-w-4xl">
          <Info size={11} className="inline mr-1 -mt-0.5" />
          VitalSwitch is a hackathon prototype running on a fully synthetic hospital. Patients, labs, timings and procedures are fictional; results are simulation outputs, not claims about real clinical outcomes. Clocked interprets text; clinical priorities, deadlines and constraints come from the scenario data and the approved procedure. Every plan needs human approval.
        </footer>
      </div>

      {/* ---------- toast ---------- */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }}
            className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 panel !bg-ink-900/95 px-5 py-3 max-w-lg ${toast.tone === "alarm" ? "!border-alarm/40" : "!border-vital/40"}`}>
            <div className={`text-sm font-semibold ${toast.tone === "alarm" ? "text-alarm" : "text-vital"}`}>{toast.title}</div>
            <div className="text-[12px] text-slate-300 mt-0.5">{toast.body}</div>
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

function Stat({ label, value, tone }: { label: string; value: string; tone: "alarm" | "amber" | "vital" }) {
  const c = tone === "alarm" ? "text-alarm text-glow-alarm" : tone === "amber" ? "text-amberx" : "text-vital text-glow-vital";
  return (
    <div className="rounded-xl border border-white/[0.07] bg-black/30 p-2.5">
      <div className={`mono text-2xl font-bold ${c}`}>{value}</div>
      <div className="text-[10px] text-slate-500 leading-tight">{label}</div>
    </div>
  );
}

function TestQueue({ onHover }: { onHover: (id: string | null) => void }) {
  return (
    <div>
      <div className="label mb-2">Urgent tests in flight</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[330px] overflow-auto pr-1">
        {TESTS.map((t) => (
          <div key={t.id} onMouseEnter={() => onHover(t.id)} onMouseLeave={() => onHover(null)}
            className="rounded-lg border border-white/[0.06] bg-white/[0.015] px-2.5 py-1.5 hover:border-white/20 transition">
            <div className="flex items-center gap-1.5">
              <span className={`mono text-[8.5px] px-1 rounded ${t.priority === 3 ? "bg-alarm/15 text-alarm" : "bg-amberx/10 text-amberx"}`}>{PRIORITY_LABEL[t.priority]}</span>
              <span className="text-[11.5px] font-medium text-slate-200 truncate">{t.label}</span>
              <span className="flex-1" />
              <span className="mono text-[10px] text-slate-500">{wardById(t.ward).short}</span>
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
              <span className="truncate mr-2">{t.clinical}</span>
              <span className="mono shrink-0">≤{t.deadline}m</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Recommendation({ solved, phase, onApprove, onReplay, conditions, analysis, onHover }: any) {
  const { opt, base } = solved;
  const [open, setOpen] = useState<string | null>(null);
  const gain = opt.result.onTime - base.onTime;
  const statGain = opt.result.statOnTime - base.statOnTime;
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between">
        <div className="label !text-vital">Continuity recommendation</div>
        <div className="mono text-[10px] text-slate-500">{opt.evaluated.toLocaleString()} plans · {solved.ms.toFixed(0)} ms</div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="rounded-xl border border-alarm/20 bg-alarm/[0.04] p-2.5">
          <div className="mono text-2xl font-bold text-alarm">{base.onTime}<span className="text-sm text-slate-500">/12</span></div>
          <div className="text-[10px] text-slate-400">on time without</div>
        </div>
        <div className="rounded-xl border border-vital/25 bg-vital/[0.05] p-2.5">
          <div className="mono text-2xl font-bold text-vital text-glow-vital">{opt.result.onTime}<span className="text-sm text-slate-500">/12</span></div>
          <div className="text-[10px] text-slate-400">on time with VitalSwitch</div>
        </div>
        <div className="rounded-xl border border-white/10 p-2.5">
          <div className={`mono text-2xl font-bold ${gain >= 0 ? "text-vital" : "text-alarm"}`}>{gain >= 0 ? "+" : ""}{gain}</div>
          <div className="text-[10px] text-slate-400">results saved · STAT {statGain >= 0 ? "+" : ""}{statGain}</div>
        </div>
      </div>

      <div className="mt-3 space-y-1 max-h-[280px] overflow-auto pr-1">
        {opt.result.outcomes
          .slice()
          .sort((a: TestOutcome, b: TestOutcome) => b.test.priority - a.test.priority || a.test.deadline - b.test.deadline)
          .map((o: TestOutcome) => {
            const isOpen = open === o.test.id;
            return (
              <div key={o.test.id} onMouseEnter={() => onHover(o.test.id)} onMouseLeave={() => onHover(null)}>
                <button onClick={() => setOpen(isOpen ? null : o.test.id)} className="w-full flex items-center gap-2 text-left rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                  <span className={`mono text-[8.5px] px-1 rounded ${o.test.priority === 3 ? "bg-alarm/15 text-alarm" : "bg-amberx/10 text-amberx"}`}>{PRIORITY_LABEL[o.test.priority]}</span>
                  <span className="text-[11.5px] text-slate-200 w-[124px] truncate">{o.test.label}</span>
                  <span className="mono text-[10px] text-slate-500 w-8">{wardById(o.test.ward).short}</span>
                  <ChevronRight size={11} className="text-slate-600" />
                  <span className="mono text-[10.5px] font-semibold px-1.5 rounded" style={{ color: LAB_COLOR[o.lab], background: LAB_COLOR[o.lab] + "18" }}>
                    {o.dest === "wait" ? "HOLD → CORE" : labById(o.lab).short}
                  </span>
                  <span className="flex-1" />
                  <span className={`mono text-[10.5px] ${o.onTime ? "text-vital" : "text-alarm"}`}>{clock(o.finish)} {o.onTime ? "✓" : `+${o.late}m`}</span>
                </button>
                <AnimatePresence>
                  {isOpen && <Why o={o} solved={solved} conditions={conditions} analysis={analysis} />}
                </AnimatePresence>
              </div>
            );
          })}
      </div>

      {phase === "plan" ? (
        <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={onApprove}
          className="mt-3 w-full rounded-xl py-3 font-bold tracking-wide text-ink-950 bg-vital shadow-[0_0_40px_-6px_rgba(46,242,176,0.7)] flex items-center justify-center gap-2">
          <CheckCircle2 size={18} /> APPROVE &amp; DISPATCH PLAN
        </motion.button>
      ) : (
        <button onClick={onReplay} className="mt-3 w-full rounded-xl py-2.5 text-[12px] font-semibold text-slate-200 border border-white/10 hover:border-white/25 flex items-center justify-center gap-2">
          <Play size={14} /> Replay side-by-side
        </button>
      )}
      <div className="text-[10px] text-slate-500 mt-2 text-center">Signed off by: Lab Downtime Coordinator (simulated) · click any row to see why</div>
    </div>
  );
}

function Why({ o, solved, conditions, analysis }: any) {
  const alts = alternatives(o.test.id, solved.opt.assignments, conditions, analysis.verify.auth);
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
      className="ml-6 mb-2 rounded-lg border border-white/[0.06] bg-black/30 p-2.5 text-[10.5px] space-y-1 overflow-hidden">
      <div className="text-slate-400">{o.test.clinical}. Result needed by <span className="mono text-slate-200">{clock(o.test.deadline)}</span>.</div>
      {alts.map((a: any) => {
        const chosen = a.lab === o.lab;
        return (
          <div key={a.lab} className={`flex items-center gap-2 ${chosen ? "text-slate-100" : "text-slate-500"}`}>
            <span className="mono w-10" style={{ color: chosen ? LAB_COLOR[a.lab as LabId] : undefined }}>{labById(a.lab).short}</span>
            {a.excluded ? (
              <span className="text-alarm/80">✕ {a.excluded}</span>
            ) : (
              <span>
                {chosen ? "▶ chosen · " : ""}ready {clock(a.finish)} {a.onTime ? <span className="text-vital">on time</span> : <span className="text-alarm">late</span>}
                {!chosen && a.onTime && <span className="text-slate-600"> (capacity reserved for more urgent tests)</span>}
              </span>
            )}
          </div>
        );
      })}
      {o.dest === "wait" && <div className="text-amberx">No legal backup can meet this test; held for Core Lab restoration ({Math.round(conditions.restorationMinutes / 60)} h, from Extract).</div>}
    </motion.div>
  );
}

function ProveIt({ userDown, toggleLab, courierStrike, setCourierStrike, conditions }: any) {
  return (
    <div className="panel p-4">
      <div className="label !text-amberx mb-1">Prove it isn't scripted</div>
      <div className="text-[11.5px] text-slate-400 mb-3">Take resources away. The engine re-plans from scratch; outcomes can honestly get worse.</div>
      <div className="grid grid-cols-2 gap-2">
        {LABS.filter((l) => l.id !== "core").map((l) => {
          const off = !!userDown[l.id];
          const offByIncident = conditions?.labDown[l.id] && !off;
          return (
            <button key={l.id} disabled={offByIncident} onClick={() => toggleLab(l.id)}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[11.5px] transition ${off ? "border-alarm/50 bg-alarm/10 text-alarm" : offByIncident ? "border-white/5 text-slate-600" : "border-white/10 hover:border-white/25 text-slate-200"}`}>
              <span className="w-2 h-2 rounded-full" style={{ background: off || offByIncident ? "#ff3b4e" : LAB_COLOR[l.id as LabId] }} />
              <span className="flex-1 truncate">{l.name}</span>
              <span className="mono text-[9px]">{off ? "OFF" : offByIncident ? "DOWN" : "ON"}</span>
            </button>
          );
        })}
        <button onClick={() => setCourierStrike(!courierStrike)}
          className={`col-span-2 flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[11.5px] ${courierStrike ? "border-alarm/50 bg-alarm/10 text-alarm" : "border-white/10 hover:border-white/25 text-slate-200"}`}>
          <Truck size={13} /> <span className="flex-1">Courier service</span><span className="mono text-[9px]">{courierStrike ? "STOPPED" : "RUNNING"}</span>
        </button>
      </div>
    </div>
  );
}

function Editor({ report, playbook, onClose, onSave }: any) {
  const [r, setR] = useState(report);
  const [p, setP] = useState(playbook);
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="panel !bg-ink-900 w-full max-w-5xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Edit the inputs — Clocked will read whatever you write</div>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="block">
            <div className="label mb-1">Incident notice (read by Guard, Protect, Extract, Decide)</div>
            <textarea value={r} onChange={(e) => setR(e.target.value)} className="mono w-full h-[380px] text-[11px] bg-black/50 border border-white/10 rounded-lg p-3 text-slate-200 focus:outline-none focus:border-cyanx/50" />
          </label>
          <label className="block">
            <div className="label mb-1">Approved downtime procedure (checked by Verify)</div>
            <textarea value={p} onChange={(e) => setP(e.target.value)} className="mono w-full h-[380px] text-[11px] bg-black/50 border border-white/10 rounded-lg p-3 text-slate-200 focus:outline-none focus:border-cyanx/50" />
          </label>
        </div>
        <div className="text-[11px] text-slate-500 mt-2">Try: say St. Mary's courier is suspended, or remove the West Wing approval for coagulation. The plan will change.</div>
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={() => { setR(INCIDENT_PRESETS[0].text); setP(DEFAULT_PLAYBOOK); }} className="px-3 py-1.5 text-[12px] text-slate-400">Restore defaults</button>
          <button onClick={() => onSave(r, p)} className="px-4 py-1.5 rounded-lg bg-vital text-ink-950 text-[12px] font-bold">Use these inputs</button>
        </div>
      </div>
    </div>
  );
}

function AuditLog({ calls, onClose }: { calls: { k: string; v: any }[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end" onClick={onClose}>
      <motion.div initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="w-full max-w-2xl h-full bg-ink-900 border-l border-white/10 p-5 overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-semibold">Clocked API log</div>
            <div className="text-[11px] text-slate-500">Exact responses that drove this run. Requests are built in <span className="mono">lib/clocked.ts</span>.</div>
          </div>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        {calls.length === 0 && <div className="text-sm text-slate-500">No calls yet — run the scenario.</div>}
        {calls.map(({ k, v }) => (
          <details key={k} className="mb-2 rounded-lg border border-white/10 p-3" open={false}>
            <summary className="cursor-pointer flex items-center gap-2 text-[12px]">
              <span className="font-semibold capitalize">{k}</span><ModeBadge call={v.call} />
              {v.call.error && <span className="text-[10px] text-amberx truncate">{v.call.error}</span>}
            </summary>
            <pre className="mono text-[10px] text-slate-300 mt-2 max-h-[400px] overflow-auto whitespace-pre-wrap">{JSON.stringify(v.call.data, null, 2)}</pre>
          </details>
        ))}
      </motion.div>
    </div>
  );
}
