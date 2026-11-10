# VitalSwitch

**Cybersecurity protects computers. VitalSwitch protects the people who depend on them.**

When ransomware takes a hospital's primary laboratory offline, the attack has already succeeded. The question is no longer "how do we block it?" but "what happens to the twelve urgent blood tests that were on their way there?"

VitalSwitch reads the incident notice with Clocked. It checks every backup route against the hospital's approved downtime procedure and builds a capacity-aware, deadline-aware rerouting plan for a coordinator to approve. It then simulates the result side by side with the status-quo manual response.

> Built for the Clocked Build Challenge 2026. **Everything runs on a fully synthetic hospital.** Patients, labs, timings and procedures are fictional, and the results are simulation outputs, not claims about real clinical outcomes.

---

## The 90-second demo

| Scene | What you do | What you see |
|---|---|---|
| 1. Normal | Pick an attack scenario | 12 urgent specimens (troponin, blood gas, crossmatch…) flow to the Core Lab |
| 2. Code red | **Simulate cyberattack** | Core Lab encrypted; specimens stranded; the incident notice streams in |
| 3. VitalSwitch | **Activate VitalSwitch** | Five Clocked calls run in sequence, then the continuity engine searches ~1,000 legal plans in ~20 ms |
| 3b. Human in the loop | **Approve & dispatch** | The plan doesn't run until the coordinator approves; each row has a "why" breakdown |
| 4. Payoff | Watch | Side-by-side timelines: **without VitalSwitch 4/12 on time → with VitalSwitch 11/12** (default scenario) |
| 5. Prove it | Click a backup lab on the map | Instant re-plan from scratch. It can honestly get worse: knock out St. Mary's and the crossmatch has no legal route left |

Three built-in scenarios: **Core Lab ransomware**, **Spreading outage** (the West Wing lab and the pneumatic tube go down), and **Poisoned bulletin** (the attacker hides routing instructions inside the incident notice). You can also edit the notice and the downtime procedure yourself, and Clocked reads whatever you write.

## How Clocked drives the app

Every Clocked output changes what the engine does. None of it is decorative commentary.

```
incident notice ──► GUARD /injection ──► PROTECT /pii ──► EXTRACT /extract ──┐
                     quarantine flagged     redact patient   restoration ETA,  │
                     paragraphs             identifiers      affected systems  ├─► constraints ─► continuity engine ─► plan ─► human approval
                                                           ► DECIDE /decide ───┘   (Conditions)     (deterministic       │
                                                             which sites/routes                      search + discrete-  ▼
downtime procedure ─► VERIFY /grounding ─► authorization matrix (lab × test type) event simulation)  side-by-side outcome
```

| Endpoint | Request (see `lib/clocked.ts`) | How the output changes the app |
|---|---|---|
| **Guard** `/injection` | The incident notice, as `source: "content"`, with a security context for a lab-routing assistant | If the verdict is `injection`, every paragraph overlapping an `evidence` span is **removed before any other endpoint sees the text**. In "Poisoned bulletin", the attacker's paragraph claims St. Mary's and the point-of-care hub are offline and redirects specimens to a fake lab. Guard stops it. |
| **Protect** `/pii` | The sanitized notice; entities `person`, `phone`, custom `medical_record_number`; `anonymize: "replace"` | Only `anonymized_text` goes on to Extract and Decide, so patient identifiers never leave the intake step. |
| **Extract** `/extract` | Fields `incident_id`, `issued_at`, `restoration_estimate`, `affected_systems` (list), `containment_action` | `restoration_estimate` is parsed into minutes and sets **when the Core Lab comes back**, which is the fallback for any specimen with no legal backup and the baseline's horizon. |
| **Decide** `/decide` | A `multiselect` over 8 criteria (5 labs, courier, pneumatic tube, LIS) plus a `score` for severity | The selected labels switch labs off, cut courier routes (external labs become unreachable), slow transport to porters (tube down) and add paper-downtime overhead per test (LIS down). Probabilities between 0.25 and 0.75 are flagged **REVIEW** for a human. |
| **Verify** `/grounding` | The downtime procedure as the document, plus one explicit claim per (backup lab × test type the lab can physically run), 22 claims in all | Builds the **authorization matrix**. Only `supported` routes are legal for the optimizer, and `contradicted` / `not_stated` routes are forbidden. Example: the West Wing can physically run troponin, but the procedure forbids it, so the plan never sends troponin there. Edit the procedure and the plan changes. |

**Uncertainty and failure handling:**
- Decide probabilities in the uncertain band are flagged for review in the UI.
- A missing restoration estimate falls back to 6 h and is labelled "assumed".
- Verify's `not_stated` is treated as *not authorized* (fail-closed).
- Live calls use an `Idempotency-Key` with bounded retries.
- If a live call fails, the app degrades to the offline stand-in and the badge says so.

### The continuity engine (`lib/engine.ts`)
- **Discrete-event simulation** of each lab: parallel analyzers, per-test processing times, transport by tube, porter, hand delivery or courier, and LIS-downtime overhead. Queues are earliest-deadline-first.
- **Search:** a greedy urgency-ordered seed, then steepest-ascent local search (moves and pairwise swaps) with 6 deterministic restarts (seeded PRNG, so results are reproducible). Objective, in order of priority: priority-weighted on-time results, then priority-weighted lateness, then courier use.
- **Baseline (without VitalSwitch):** realistic manual downtime handling. 25 minutes of phone coordination, then each specimen goes to the first approved site that can run it, with first-in-first-out processing and no capacity or deadline awareness. It uses the same Clocked-derived constraints, so the comparison is fair.
- Run `npm run test:engine` to see the plans for several outage conditions without any API calls.

## Run it

```bash
npm install
cp .env.example .env.local   # add your CLOCKED_API_KEY
npm run dev                  # http://localhost:3000
```

- **With `CLOCKED_API_KEY`:** every call goes to the live Clocked API through the server route `app/api/clocked/[endpoint]`, so the key never reaches the browser. The badges show `LIVE · <ms>`. The **API log** button shows the exact JSON responses that drove the run.
- **Without a key:** an **offline stand-in** (`lib/emulator.ts`, a transparent keyword heuristic over the same request shapes) keeps the demo reproducible. It is *not* Clocked, and every result it produces is labelled `EMULATED` in the UI.

Stack: Next.js 15, React 19, Tailwind, Framer Motion. There's no database, and the engine runs in the browser, so re-planning is instant.

## Project layout

```
app/page.tsx                    scene state machine, recommendation, prove-it controls
app/api/clocked/[endpoint]      server proxy to Clocked (key stays server-side) + fallback
components/HospitalMap.tsx      animated SVG campus: wards, labs, routes, specimens
components/Pipeline.tsx         the Clocked analysis pipeline view
components/Gantt.tsx            side-by-side outcome timelines
components/Feed.tsx             constraints-from-Clocked strip + live event feed
lib/scenario.ts                 synthetic hospital: labs, wards, 12 tests, presets, procedure
lib/clocked.ts                  request builders + response interpreters (Clocked → constraints)
lib/engine.ts                   simulation + optimizer + baseline
lib/emulator.ts                 offline stand-in used only without an API key
```

## Honesty notes
- Clocked interprets text. Clinical priorities, deadlines, lab menus and capacities come from the synthetic scenario data, and authorization comes only from the approved procedure.
- Nothing is autonomous: every plan requires coordinator approval, and VitalSwitch never touches real infrastructure.
- The before/after numbers are computed by the simulation. Change the inputs and they change.
