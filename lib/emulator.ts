// OFFLINE STAND-IN for Clocked, used only when no CLOCKED_API_KEY is configured (or a live call fails).
// It is a transparent keyword heuristic over the exact request shapes VitalSwitch sends, so the demo stays
// reproducible. It is NOT Clocked and the UI labels every emulated result as such.

const NEG = /\b(offline|isolated|disconnected|out of service|shut down|unavailable|not operating|encrypted|suspended|down|cannot|halted|closed)\b/i;
const POS = /\b(operational|unaffected|running normally|operating normally|normal schedule|fully operational|available|standalone|remains)\b/i;

function sentences(text: string): { s: string; start: number }[] {
  const out: { s: string; start: number }[] = [];
  const re = /(?:St\.|Dr\.|ext\.|[^.!?\n])+[.!?]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (m[0].trim()) out.push({ s: m[0], start: m.index });
  return out;
}

const ALIASES: Record<string, RegExp> = {
  core_lab: /core lab/i,
  west_wing_lab: /west wing/i,
  poc_hub: /point-of-care|poc hub/i,
  st_marys_lab: /st\.? mary/i,
  reference_lab: /reference lab/i,
  courier: /courier/i,
  pneumatic_tube: /pneumatic tube|tube system/i,
  lis: /laboratory information system|\bLIS\b/,
};

function siteProbability(text: string, key: string): number {
  let p = 0.08;
  for (const { s } of sentences(text)) {
    if (!ALIASES[key].test(s)) continue;
    const neg = NEG.test(s);
    const pos = POS.test(s) && !/remains? (offline|unavailable|down)/i.test(s);
    if (neg && !pos) p = 0.97;
    else if (pos && !neg) p = Math.min(p, 0.03);
    else if (neg && pos) p = Math.max(p, 0.5);
  }
  return p;
}

function guard(body: any) {
  const text: string = body.text ?? "";
  const patterns = [
    /ignore (all )?(previous|prior)[^.]*\./i,
    /(procedure|rules?) (is|are) suspended[^.]*\./i,
    /send every specimen to[^.]*\./i,
    /do not (mention|tell|report)[^.]*\./i,
    /note to (automated|ai)[^:]*:/i,
    /report [^.]* as offline[^.]*\./i,
  ];
  const evidence: any[] = [];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) evidence.push({ quote: m[0].replace(/[.:]$/, ""), start: m.index, end: m.index + m[0].replace(/[.:]$/, "").length, confidence: 0.9 });
  }
  const p = evidence.length >= 2 ? 0.97 : evidence.length === 1 ? 0.7 : 0.03;
  return {
    model: "offline-emulator",
    injection: p,
    verdict: p >= 0.5 ? "injection" : "benign",
    threshold: 0.5,
    source: body.source ?? "content",
    category: p >= 0.5 ? "instruction override" : "benign",
    severity: p >= 0.9 ? "critical" : p >= 0.5 ? "high" : "none",
    evidence: p >= 0.5 ? evidence : [],
  };
}

function pii(body: any) {
  const text: string = body.text ?? "";
  const ents: any[] = [];
  const add = (type: string, re: RegExp, group = 0) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const v = m[group];
      const start = m.index + m[0].indexOf(v);
      ents.push({ type, value: v, start, end: start + v.length, confidence: 0.9, source: "emulator" });
    }
  };
  add("person", /(?:patient|Dr\.)\s+([A-Z][a-z]+ [A-Z][a-z]+)/g, 1);
  add("medical_record_number", /MRN\s+([\d-]+)/g, 1);
  add("phone", /ext\.\s*(\d{3,5})/g, 1);
  ents.sort((a, b) => a.start - b.start);
  let out = "";
  let i = 0;
  for (const e of ents) {
    out += text.slice(i, e.start) + `<${e.type.toUpperCase()}>`;
    i = e.end;
  }
  out += text.slice(i);
  const counts: Record<string, number> = {};
  for (const e of ents) counts[e.type] = (counts[e.type] ?? 0) + 1;
  return { model: "offline-emulator", entities: ents, counts, anonymized_text: out, threshold: 0.5 };
}

function extract(body: any) {
  const text: string = body.text ?? "";
  const field = (re: RegExp, g = 0) => {
    const m = re.exec(text);
    if (!m) return { value: null, confidence: 0.8 };
    const v = m[g];
    const start = m.index + m[0].indexOf(v);
    return { value: v, start, end: start + v.length, confidence: 0.85 };
  };
  const affected: string[] = [];
  const names: [RegExp, string][] = [
    [/Core Laboratory analyzers/i, "Core Laboratory analyzers"],
    [/West Wing Satellite Lab/i, "West Wing Satellite Lab"],
    [/Laboratory Information System \(LIS\)/i, "Laboratory Information System (LIS)"],
    [/pneumatic tube (controller|system)/i, "pneumatic tube system"],
    [/St\.? Mary's Partner Lab/i, "St. Mary's Partner Lab"],
    [/courier service/i, "courier service"],
  ];
  for (const { s } of sentences(text)) {
    if (!NEG.test(s) || (POS.test(s) && !/shut down|disconnected/i.test(s))) continue;
    for (const [re, label] of names) if (re.test(s) && !affected.includes(label)) affected.push(label);
  }
  return {
    model: "offline-emulator",
    fields: {
      incident_id: field(/INC-\d+/),
      issued_at: field(/Issued:\s*(\d{1,2}:\d{2})/, 1),
      restoration_estimate: field(/restoration[^:]*:\s*([^\n.]+)/i, 1),
      affected_systems: { value: affected, items: affected.map((v) => ({ value: v, confidence: 0.8 })), confidence: 0.8 },
      containment_action: field(/(the Core Laboratory network segment has been isolated)/i, 1),
    },
  };
}

function decide(body: any) {
  const text: string = typeof body.state === "string" ? body.state : JSON.stringify(body.state);
  const crit = body.questions?.unavailable?.criteria ?? {};
  const probs: Record<string, number> = {};
  for (const k of Object.keys(crit)) probs[k] = ALIASES[k] ? siteProbability(text, k) : 0.1;
  const thr = body.questions?.unavailable?.threshold ?? 0.5;
  const labsDown = ["core_lab", "west_wing_lab", "poc_hub", "st_marys_lab", "reference_lab"].filter((k) => probs[k] >= thr).length;
  const sevIdx = labsDown >= 5 ? 3 : labsDown >= 2 || probs.pneumatic_tube >= thr ? 2 : labsDown === 1 ? 1 : 0;
  const legendArr: string[] = body.questions?.severity?.criteria ?? [];
  const legend: Record<string, string> = {};
  legendArr.forEach((l, i) => (legend[String(i)] = l));
  return {
    model: "offline-emulator",
    answers: {
      unavailable: { type: "multiselect", selected: Object.keys(probs).filter((k) => probs[k] >= thr), probabilities: probs, threshold: thr },
      severity: { type: "score", score: sevIdx + 0.04, legend, confidence: 0.8 },
    },
  };
}

function grounding(body: any) {
  const doc: string = body.documents?.[0]?.text ?? body.documents?.[0] ?? "";
  const claims: string[] = body.claims ?? [];
  const ss = sentences(doc).map((x) => x.s);
  return {
    model: "offline-emulator",
    claims: claims.map((claim) => {
      const m = claim.match(/downtime, (.+?) is approved to perform (.+?) testing/i);
      if (!m) return { claim, verdict: "not_stated", supported: 0.1, contradicted: 0.1, not_stated: 0.8 };
      const [, site, cat] = m;
      let verdict = "not_stated";
      let quote: string | undefined;
      for (const s of ss) {
        if (!s.toLowerCase().includes(site.toLowerCase())) continue;
        const low = s.toLowerCase();
        const notIdx = low.indexOf("not approved");
        const catIdx = low.indexOf(cat.toLowerCase());
        if (notIdx >= 0 && catIdx > notIdx) {
          verdict = "contradicted";
          quote = s.trim();
          break;
        }
        if (/approved/.test(low) && notIdx < 0) {
          if (catIdx >= 0 || /all test types/.test(low)) {
            verdict = "supported";
            quote = s.trim();
          } else if (/\bonly\b/.test(low)) {
            verdict = "contradicted";
            quote = s.trim();
          }
        }
      }
      const p = { supported: 0.04, contradicted: 0.04, not_stated: 0.04 } as Record<string, number>;
      p[verdict] = 0.92;
      const start = quote ? doc.indexOf(quote) : -1;
      return {
        claim,
        kind: "claim",
        counted: true,
        ...p,
        verdict,
        evidence: quote ? { document: "LAB-DT-04", quote, start, end: start + quote.length, confidence: 0.8 } : undefined,
      };
    }),
  };
}

export function emulate(endpoint: string, body: any) {
  switch (endpoint) {
    case "injection":
      return guard(body);
    case "pii":
      return pii(body);
    case "extract":
      return extract(body);
    case "decide":
      return decide(body);
    case "grounding":
      return grounding(body);
  }
  return {};
}
