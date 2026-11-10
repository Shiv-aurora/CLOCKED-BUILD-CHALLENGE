// Sanity check: run the engine on the three conditions without any API calls.
import { optimize, baselinePlan, simulate, clock, type Authorization } from "../lib/engine.ts";
import type { Conditions } from "../lib/scenario.ts";

const S = { verdict: "supported", supported: 0.99 } as const;
const auth: Authorization = {
  west: { blood_gas: S, electrolytes: S, lactate: S, hematology: S, coagulation: S },
  poc: { blood_gas: S, electrolytes: S, lactate: S, troponin: S },
  stmarys: { blood_gas: S, electrolytes: S, lactate: S, troponin: S, coagulation: S, hematology: S, crossmatch: S },
  reference: { hematology: S, coagulation: S },
};
const base: Conditions = {
  labDown: { core: true, west: false, poc: false, stmarys: false, reference: false },
  courierAvailable: true, tubeAvailable: true, lisDown: true, restorationMinutes: 360,
};
const cases: [string, Conditions][] = [
  ["core only", base],
  ["west+tube down", { ...base, labDown: { ...base.labDown, west: true }, tubeAvailable: false, restorationMinutes: 600 }],
  ["core + stmarys down", { ...base, labDown: { ...base.labDown, stmarys: true } }],
  ["core + poc down", { ...base, labDown: { ...base.labDown, poc: true } }],
];
for (const [name, c] of cases) {
  const t0 = performance.now();
  const opt = optimize(c, auth);
  const b = simulate(baselinePlan(c, auth), c, "fifo");
  console.log(`\n== ${name}: baseline ${b.onTime}/12 (STAT ${b.statOnTime}/${b.statTotal}) | VitalSwitch ${opt.result.onTime}/12 (STAT ${opt.result.statOnTime}/${opt.result.statTotal}) | ${opt.evaluated} plans in ${(performance.now()-t0).toFixed(0)}ms`);
  for (const o of opt.result.outcomes) console.log(`  ${o.test.id} ${o.test.label.padEnd(20)} -> ${o.dest.padEnd(9)} ${clock(o.finish)} dl ${clock(o.test.deadline)} ${o.onTime ? "OK" : "LATE " + o.late}`);
}
