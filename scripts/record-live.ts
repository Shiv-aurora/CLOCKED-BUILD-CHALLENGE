// Records real Clocked responses for the three built-in scenarios so a static build (no API key) can replay them.
// Usage: start the app with CLOCKED_API_KEY set (npm run dev), then: node --experimental-strip-types scripts/record-live.ts
import { writeFileSync } from "node:fs";
import * as C from "../lib/clocked.ts";
import { INCIDENT_PRESETS, DEFAULT_PLAYBOOK } from "../lib/scenario.ts";

const BASE = process.env.VS_URL ?? "http://localhost:3000";
const out: Record<string, { ms: number; data: unknown }> = {};
async function rec(endpoint: string, body: unknown) {
  const r = await fetch(`${BASE}/api/clocked/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (j.mode !== "live") throw new Error(`${endpoint} was not live: ${j.error}`);
  out[`${endpoint}|${JSON.stringify(body)}`] = { ms: j.ms, data: j.data };
  console.log(endpoint, j.ms + "ms");
  return j.data;
}
for (const p of INCIDENT_PRESETS) {
  const g = C.interpretGuard(p.text, await rec("injection", C.guardRequest(p.text)));
  const pr = C.interpretProtect(g.sanitized, await rec("pii", C.protectRequest(g.sanitized)));
  await rec("extract", C.extractRequest(pr.redacted));
  await rec("decide", C.decideRequest(pr.redacted));
}
await rec("grounding", C.verifyRequest(DEFAULT_PLAYBOOK, C.authorizationClaims()));
writeFileSync("lib/recorded.json", JSON.stringify({ recordedAt: new Date().toISOString(), model: "clocked-1.0", responses: out }));
console.log("saved", Object.keys(out).length, "responses");
