# VitalSwitch

**Keep hospital labs running through a cyberattack.**

VitalSwitch keeps hospital lab testing going during a cyberattack. When ransomware shuts down a hospital's main lab, urgent blood tests for heart attacks, strokes and sepsis are left with nowhere to go. VitalSwitch reads the incident report, checks what the hospital's own downtime rules allow, and sends each urgent test to a lab that still works, so doctors get results in time to treat their patients. A person approves the plan before anything moves.

Built for the Clocked Build Challenge 2026.

> **Everything runs on a synthetic hospital.** Patients, labs, timings and procedures are fictional. The before/after numbers are simulation outputs, not claims about real clinical outcomes.

---

## Try it

**Live app:** https://vitalswitch-shiv-aroras-projects-083eab8d.vercel.app. Every Clocked call is live; the key is held server-side on Vercel.

**Static demo:** https://claude.ai/artifact/UTp4KwYZWLXCJbx5JcJRaR. This build replays real Clocked responses that were recorded with a live key, so no key is exposed. See [Static build](#static-build).

**Run it locally with live Clocked calls:**

```bash
npm install
cp .env.example .env.local   # then set CLOCKED_API_KEY
npm run dev                  # http://localhost:3000
```

Get a key at clocked.rezolve.ai/account. Every Clocked call goes through the server route `app/api/clocked/[endpoint]`, so the key never reaches the browser.

## The demo

The page opens with a short explanation and a three-step "How it works", then an embedded live demo. A guided tour (driver.js) points out the key moments.

1. **Normal day.** Twelve urgent samples (troponin, blood gas, crossmatch and others) flow from five wards to the Core Lab.
2. **Launch the attack.** Pick a scenario. The Core Lab locks and the samples are stuck. The incident notice streams in, and VitalSwitch starts by itself.
3. **Clocked reads the incident.** Five Clocked calls run in sequence (below), and then the engine compares about 1,000 legal plans in about 20 ms.
4. **Approve.** Nothing moves until a person approves the plan.
5. **Outcome.** The samples travel the new routes, and two timelines compare the result with the usual manual response. In the default scenario that's **4 of 12 on time without VitalSwitch and 11 of 12 with it**.
6. **Try to break it.** Switch off any backup lab, or the courier, and the plan is rebuilt from scratch. It can honestly get worse: with St. Mary's off, the crossmatch has no approved backup and has to wait for the Core Lab.

| Scenario | What happens | On time, without → with |
|---|---|---|
| Core Lab ransomware | Main lab encrypted, backups intact | 4 → 11 |
| Spreading outage | West Wing lab and pneumatic tube also go down | 4 → 9 |
| Poisoned bulletin | The attacker hides routing instructions in the notice; Guard removes them | 4 → 11 |

You can also write your own incident notice and downtime procedure. Clocked reads whatever you write, and the plan changes.

## How Clocked drives the app

Every Clocked answer changes what the engine is allowed to do.

```
incident notice ─► Guard ─► Protect ─► Extract ─┐
                                    └► Decide ──┼─► constraints ─► continuity engine ─► plan ─► human approval
downtime procedure ─► Verify ───────────────────┘
```

| Endpoint | What we send (`lib/clocked.ts`) | How the answer is used |
|---|---|---|
| **Guard** `/injection` | The incident notice as `source: "content"`, with a security context for a lab-routing assistant | If it flags an injection, every paragraph containing an `evidence` span is **removed before any other step reads the notice**. In "Poisoned bulletin" that paragraph tries to mark two working labs offline and send samples to a fake lab. |
| **Protect** `/pii` | The cleaned notice. Entities: `person`, `phone`, and a custom `medical_record_number`. `anonymize: "replace"` | Only the anonymized text goes on to Extract and Decide, so patient details stay at the intake step. |
| **Extract** `/extract` | Fields: incident ID, issue time, restoration estimate, affected systems (list), containment action | The restoration estimate is parsed into minutes. It decides when the Core Lab comes back, which matters for any sample with no approved backup. |
| **Decide** `/decide` | A `multiselect` over 8 criteria (5 labs, courier, pneumatic tube, lab IT system) plus a severity `score` | The selected labels switch labs off, cut courier routes, move transport to porters (tube down) and add paperwork time to every test (lab IT system down). Probabilities between 0.25 and 0.75 are flagged for human review. |
| **Verify** `/grounding` | The downtime procedure as the source, plus one claim for every backup lab and test type the lab can physically run (22 claims) | Builds the approval table. Only `supported` routes are allowed. `contradicted` and `not_stated` are blocked, so it fails closed. The West Wing lab can physically run troponin, but the procedure forbids it, so the plan never sends troponin there. |

**Handling failures and uncertain results:**
- Uncertain Decide answers are flagged for review.
- A missing restoration estimate falls back to 6 hours and is labelled as assumed.
- Every live call carries an `Idempotency-Key` and is retried a limited number of times.
- If a live call still fails, that step falls back to a clearly labelled offline stand-in (`lib/emulator.ts`), so the demo never silently fakes a result.
- The demo's **API responses** panel shows the exact JSON behind each run.

## The continuity engine (`lib/engine.ts`)

- **Simulation:** each lab is simulated with parallel analyzers, a processing time per test, transport by tube, porter, hand delivery or courier, and extra paperwork time when the lab IT system is down. Queues run most-urgent-first.
- **Search:** a greedy seed ordered by urgency, then local search (moving and swapping assignments) with seeded restarts, so the same inputs always give the same plan. It optimizes, in order: priority-weighted on-time results, then priority-weighted lateness, then courier use.
- **Without VitalSwitch:** this is a realistic manual response, not a strawman. Staff spend 25 minutes coordinating by phone, then each sample goes to the first approved site that can run it, first come first served, with no awareness of capacity or deadlines. It uses the same Clocked-derived constraints, so the comparison is fair.
- `npm run test:engine` prints the plans for several outage conditions without calling any API.

## Static build

`npm run record` saves real Clocked responses for the three built-in scenarios to `lib/recorded.json`. Run it with the app running and a key set. `npm run build:artifact` then bundles everything into one self-contained page, `dist-artifact/vitalswitch.html`, which needs no server and no key.

In that build, the built-in scenarios replay the recorded live responses. A custom scenario has no recording, so it uses the labelled offline stand-in.

## Project layout

```
app/page.tsx                    landing page: nav, hero, how it works, demo
app/api/clocked/[endpoint]      server proxy to Clocked (key stays on the server), retries, fallback
components/Landing.tsx          nav, hero, animated how-it-works panels
components/Demo.tsx             demo flow, guided tour, approval, try-to-break-it controls
components/HospitalMap.tsx      animated ward-to-lab diagram
components/Gantt.tsx            side-by-side outcome timelines
components/Pipeline.tsx         per-endpoint detail view
lib/scenario.ts                 synthetic hospital: labs, wards, 12 tests, scenarios, procedure
lib/clocked.ts                  request builders + interpreters (Clocked answers → constraints)
lib/engine.ts                   simulation, optimizer, baseline
lib/emulator.ts                 offline stand-in, used only without a key or after a failed call
lib/recorded.json               recorded live responses for the static build
```

Stack: Next.js 15, React 19, Tailwind CSS on the Geist design system, Framer Motion, driver.js. There's no database, and the engine runs in the browser, so re-planning is instant.

## Limits

- Clocked interprets text. Clinical priorities, deadlines, lab menus and capacities come from the synthetic scenario data. Which routes are allowed comes only from the approved procedure.
- VitalSwitch only recommends. Every plan needs human approval, and it never touches real infrastructure.
- The layout is built for desktop screens.
