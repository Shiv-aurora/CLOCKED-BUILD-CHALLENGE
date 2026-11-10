// Runs the full Guard -> Protect -> Extract -> Decide -> Verify -> optimize chain through the offline emulator.
import { emulate } from "../lib/emulator.ts";
import * as C from "../lib/clocked.ts";
import { optimize, baselinePlan, simulate } from "../lib/engine.ts";
import { INCIDENT_PRESETS, DEFAULT_PLAYBOOK } from "../lib/scenario.ts";

const claims = C.authorizationClaims();
const auth = C.interpretVerify(claims, emulate("grounding", C.verifyRequest(DEFAULT_PLAYBOOK, claims)));
console.log("claims:", claims.length, Object.entries(auth).map(([l, m]) => l + ":" + Object.entries(m!).map(([c, v]) => c + "=" + v!.verdict[0]).join(",")).join(" | "));
for (const p of INCIDENT_PRESETS) {
  const g = C.interpretGuard(p.text, emulate("injection", C.guardRequest(p.text)));
  const pr = C.interpretProtect(g.sanitized, emulate("pii", C.protectRequest(g.sanitized)));
  const ex = C.interpretExtract(emulate("extract", C.extractRequest(pr.redacted)));
  const de = C.interpretDecide(emulate("decide", C.decideRequest(pr.redacted)));
  const cond = C.conditionsFrom(de, ex, {});
  const opt = optimize(cond, auth);
  const b = simulate(baselinePlan(cond, auth), cond, "fifo");
  console.log(`\n## ${p.name}: guard=${g.verdict} quarantined=${g.quarantined.length} pii=${pr.entities.length}`);
  console.log(" restore:", ex.restorationText, ex.restorationMinutes, "affected:", ex.affected);
  console.log(" unavailable:", de.selected, "sev:", de.severityLabel);
  console.log(` baseline ${b.onTime}/12 | VitalSwitch ${opt.result.onTime}/12`);
}
