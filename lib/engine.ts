// Deterministic continuity engine: discrete-event lab simulation + constraint-aware local search.
import {
  CATEGORY_LABEL,
  LABS,
  LIS_DOWNTIME_OVERHEAD,
  MANUAL_COORDINATION_DELAY,
  TESTS,
  labById,
  transportMinutes,
} from "./scenario.ts";
import type { Category, Conditions, LabId, Test } from "./scenario.ts";

export type Verdict = "supported" | "contradicted" | "not_stated" | "unchecked";
export interface AuthCell {
  verdict: Verdict;
  supported: number; // probability
  quote?: string;
}
export type Authorization = Partial<Record<LabId, Partial<Record<Category, AuthCell>>>>;

export type Destination = LabId | "wait";
export interface Assignment {
  testId: string;
  dest: Destination;
  dispatch: number;
}

export interface TestOutcome {
  test: Test;
  dest: Destination;
  lab: LabId; // where it is actually processed ("wait" -> core)
  dispatch: number;
  arrive: number;
  start: number;
  finish: number;
  onTime: boolean;
  late: number;
}

export interface PlanResult {
  outcomes: TestOutcome[];
  onTime: number;
  statOnTime: number;
  statTotal: number;
  weightedOnTime: number;
  minutesLate: number;
  meanResult: number;
}

export function isAuthorized(auth: Authorization, lab: LabId, cat: Category): boolean {
  if (lab === "core") return true;
  return auth[lab]?.[cat]?.verdict === "supported";
}

/** Why a lab cannot take a test, or null if it is a legal option. */
export function exclusionReason(test: Test, lab: LabId, c: Conditions, auth: Authorization): string | null {
  const L = labById(lab);
  if (c.labDown[lab]) return lab === "core" ? "Offline — ransomware containment" : "Offline";
  if (L.menu[test.category] === undefined) return `Cannot run ${CATEGORY_LABEL[test.category]}`;
  if (transportMinutes(test.ward, lab, c) === null) return "Courier unavailable";
  if (!isAuthorized(auth, lab, test.category)) {
    const cell = auth[lab]?.[test.category];
    if (!cell || cell.verdict === "unchecked") return "Not yet verified against procedure";
    return cell.verdict === "contradicted"
      ? `Procedure forbids ${CATEGORY_LABEL[test.category]} here`
      : `Procedure doesn't authorize ${CATEGORY_LABEL[test.category]} here`;
  }
  return null;
}

/** Discrete-event simulation of one plan. */
export function simulate(
  assignments: Assignment[],
  c: Conditions,
  discipline: "edf" | "fifo" = "edf",
): PlanResult {
  const byLab = new Map<LabId, { a: Assignment; test: Test; arrive: number }[]>();
  for (const a of assignments) {
    const test = TESTS.find((t) => t.id === a.testId)!;
    let lab: LabId;
    let arrive: number;
    if (a.dest === "wait") {
      lab = "core";
      arrive = Math.max(a.dispatch, c.restorationMinutes) + (transportMinutes(test.ward, "core", c) ?? 10);
    } else {
      lab = a.dest;
      arrive = a.dispatch + (transportMinutes(test.ward, lab, c) ?? 9999);
    }
    if (!byLab.has(lab)) byLab.set(lab, []);
    byLab.get(lab)!.push({ a, test, arrive });
  }

  const outcomes: TestOutcome[] = [];
  for (const [labId, items] of byLab) {
    const L = labById(labId);
    const free = Array(L.analyzers).fill(labId === "core" ? c.restorationMinutes : 0) as number[];
    const pending = [...items].sort((x, y) => x.arrive - y.arrive || x.test.id.localeCompare(y.test.id));
    const overhead = c.lisDown ? LIS_DOWNTIME_OVERHEAD : 0;
    while (pending.length) {
      // next analyzer to free up
      let k = 0;
      for (let i = 1; i < free.length; i++) if (free[i] < free[k]) k = i;
      const t0 = Math.max(free[k], pending[0].arrive);
      // among specimens arrived by t0, pick by discipline
      const ready = pending.filter((p) => p.arrive <= t0);
      let pick = ready[0];
      if (discipline === "edf") {
        for (const r of ready) {
          const score = r.test.deadline - r.test.priority * 1000;
          const best = pick.test.deadline - pick.test.priority * 1000;
          if (score < best) pick = r;
        }
      }
      pending.splice(pending.indexOf(pick), 1);
      const proc = L.menu[pick.test.category] ?? 30;
      const start = t0;
      const finish = start + proc + overhead + (L.kind === "external" ? 3 : 0);
      free[k] = start + proc;
      outcomes.push({
        test: pick.test,
        dest: pick.a.dest,
        lab: labId,
        dispatch: pick.a.dispatch,
        arrive: pick.arrive,
        start,
        finish,
        onTime: finish <= pick.test.deadline,
        late: Math.max(0, finish - pick.test.deadline),
      });
    }
  }
  outcomes.sort((a, b) => a.test.id.localeCompare(b.test.id));
  const stat = outcomes.filter((o) => o.test.priority === 3);
  return {
    outcomes,
    onTime: outcomes.filter((o) => o.onTime).length,
    statOnTime: stat.filter((o) => o.onTime).length,
    statTotal: stat.length,
    weightedOnTime: outcomes.reduce((s, o) => s + (o.onTime ? o.test.priority : 0), 0),
    minutesLate: outcomes.reduce((s, o) => s + o.late, 0),
    meanResult: Math.round(outcomes.reduce((s, o) => s + o.finish, 0) / outcomes.length),
  };
}

function objective(r: PlanResult, assignments: Assignment[]): number {
  // lexicographic: weighted on-time >> weighted lateness >> external courier use
  const wLate = r.outcomes.reduce((s, o) => s + o.late * o.test.priority, 0);
  const external = assignments.filter((a) => a.dest === "stmarys" || a.dest === "reference").length;
  return r.weightedOnTime * 1_000_000 - wLate * 100 - external;
}

/**
 * Status quo without decision support: after manual coordination, every specimen goes to the first
 * approved site in the procedure's order that can run it (no capacity balancing, no deadline awareness),
 * processed first-come-first-served. If nothing legal exists, it waits for the Core Lab.
 */
export const BASELINE_ORDER: LabId[] = ["west", "poc", "stmarys", "reference"];
export function baselinePlan(c: Conditions, auth: Authorization): Assignment[] {
  return TESTS.map((t) => {
    const lab = BASELINE_ORDER.find((l) => exclusionReason(t, l, c, auth) === null);
    return { testId: t.id, dest: lab ?? "wait", dispatch: MANUAL_COORDINATION_DELAY } as Assignment;
  });
}

export function legalDestinations(t: Test, c: Conditions, auth: Authorization): Destination[] {
  const out: Destination[] = LABS.filter((l) => exclusionReason(t, l.id, c, auth) === null).map((l) => l.id);
  out.push("wait");
  return out;
}

// Small deterministic PRNG so plans are reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OptimizeResult {
  assignments: Assignment[];
  result: PlanResult;
  evaluated: number;
  options: Record<string, Destination[]>;
}

/** Constraint-aware search: greedy EDF seed + steepest-ascent local search with deterministic restarts. */
export function optimize(c: Conditions, auth: Authorization, dispatchAt = 2): OptimizeResult {
  const options: Record<string, Destination[]> = {};
  for (const t of TESTS) options[t.id] = legalDestinations(t, c, auth);
  let evaluated = 0;
  const evalPlan = (as: Assignment[]) => {
    evaluated++;
    const r = simulate(as, c, "edf");
    return { r, s: objective(r, as) };
  };

  // Greedy seed: most urgent first, each picks the destination that maximises the objective so far.
  const order = [...TESTS].sort((a, b) => b.priority - a.priority || a.deadline - b.deadline);
  const seed: Assignment[] = TESTS.map((t) => ({ testId: t.id, dest: "wait", dispatch: dispatchAt }));
  for (const t of order) {
    let best = -Infinity;
    let bestDest: Destination = "wait";
    for (const d of options[t.id]) {
      const trial = seed.map((a) => (a.testId === t.id ? { ...a, dest: d } : a));
      const { s } = evalPlan(trial);
      if (s > best) {
        best = s;
        bestDest = d;
      }
    }
    seed.find((a) => a.testId === t.id)!.dest = bestDest;
  }

  const improve = (start: Assignment[]) => {
    let cur = start.map((a) => ({ ...a }));
    let { r: curR, s: curS } = evalPlan(cur);
    for (let iter = 0; iter < 60; iter++) {
      let bestMove: Assignment[] | null = null;
      let bestS = curS;
      let bestR = curR;
      for (const a of cur) {
        for (const d of options[a.testId]) {
          if (d === a.dest) continue;
          const trial = cur.map((x) => (x.testId === a.testId ? { ...x, dest: d } : x));
          const { r, s } = evalPlan(trial);
          if (s > bestS) {
            bestS = s;
            bestR = r;
            bestMove = trial;
          }
        }
      }
      // pairwise swaps of destinations
      for (let i = 0; i < cur.length; i++)
        for (let j = i + 1; j < cur.length; j++) {
          const a = cur[i], b = cur[j];
          if (a.dest === b.dest) continue;
          if (!options[a.testId].includes(b.dest) || !options[b.testId].includes(a.dest)) continue;
          const trial = cur.map((x, k) => (k === i ? { ...x, dest: b.dest } : k === j ? { ...x, dest: a.dest } : x));
          const { r, s } = evalPlan(trial);
          if (s > bestS) {
            bestS = s;
            bestR = r;
            bestMove = trial;
          }
        }
      if (!bestMove) break;
      cur = bestMove;
      curS = bestS;
      curR = bestR;
    }
    return { cur, curR, curS };
  };

  let best = improve(seed);
  const rand = mulberry32(7731);
  for (let restart = 0; restart < 6; restart++) {
    const perturbed = best.cur.map((a) => {
      if (rand() < 0.35) {
        const opts = options[a.testId];
        return { ...a, dest: opts[Math.floor(rand() * opts.length)] };
      }
      return { ...a };
    });
    const cand = improve(perturbed);
    if (cand.curS > best.curS) best = cand;
  }
  return { assignments: best.cur, result: best.curR, evaluated, options };
}

/** For explanation: what would happen to this test alone at each alternative destination. */
export function alternatives(
  testId: string,
  plan: Assignment[],
  c: Conditions,
  auth: Authorization,
): { lab: LabId; excluded: string | null; finish?: number; onTime?: boolean }[] {
  const t = TESTS.find((x) => x.id === testId)!;
  return LABS.map((l) => {
    const ex = exclusionReason(t, l.id, c, auth);
    if (ex) return { lab: l.id, excluded: ex };
    const trial = plan.map((a) => (a.testId === testId ? { ...a, dest: l.id as Destination } : a));
    const o = simulate(trial, c).outcomes.find((x) => x.test.id === testId)!;
    return { lab: l.id, excluded: null, finish: o.finish, onTime: o.onTime };
  });
}

export function clock(min: number, base = 14 * 60 + 2): string {
  const m = Math.round(base + min);
  const h = Math.floor(m / 60) % 24;
  const mm = ((m % 60) + 60) % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
