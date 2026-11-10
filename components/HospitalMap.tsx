"use client";
import { LABS, WARDS, labById, wardById } from "@/lib/scenario";
import type { LabId, WardId, Conditions } from "@/lib/scenario";
import type { TestOutcome } from "@/lib/engine";

export const LAB_COLOR: Record<LabId, string> = {
  core: "var(--lab-core)",
  west: "var(--lab-west)",
  poc: "var(--lab-poc)",
  stmarys: "var(--lab-stmarys)",
  reference: "var(--lab-reference)",
};

type MapMode = "normal" | "stranded" | "plan";

interface Props {
  mode: MapMode;
  conditions: Conditions | null;
  outcomes: TestOutcome[] | null;
  simT: number;
  loopT: number;
  userDown: Partial<Record<LabId, boolean>>;
  interactive: boolean;
  onToggleLab?: (id: LabId) => void;
  focusTest?: string | null;
}

const WARD_W = 124, WARD_H = 52, LAB_R = 32;

function anchor(id: WardId | LabId) {
  const w = WARDS.find((x) => x.id === id);
  if (w) return { x: w.x - 62 + WARD_W, y: w.y };
  const l = labById(id as LabId);
  return { x: l.x, y: l.y };
}
function ctrl(a: { x: number; y: number }, b: { x: number; y: number }, bend: number) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: mx - (dy / len) * bend, y: my + (dx / len) * bend };
}
function bez(a: any, c: any, b: any, s: number) {
  const u = 1 - s;
  return { x: u * u * a.x + 2 * u * s * c.x + s * s * b.x, y: u * u * a.y + 2 * u * s * c.y + s * s * b.y };
}
// trim the curve so it ends at the lab's circle edge, not its centre
function endAt(a: any, c: any, b: any) {
  const s = 1 - (LAB_R + 4) / Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  return bez(a, c, b, s);
}
const BEND: Record<LabId, number> = { core: 14, west: -26, poc: -20, stmarys: 30, reference: -30 };

export default function HospitalMap({ mode, conditions, outcomes, simT, loopT, userDown, interactive, onToggleLab, focusTest }: Props) {
  const down = (id: LabId) => !!conditions?.labDown[id];
  const routes = new Map<string, { ward: WardId; lab: LabId }>();
  if (mode === "plan" && outcomes) for (const o of outcomes) routes.set(`${o.test.ward}-${o.lab}`, { ward: o.test.ward, lab: o.lab });
  if (mode !== "plan") for (const w of WARDS) routes.set(`${w.id}-core`, { ward: w.id, lab: "core" });

  const wardStats = (wid: WardId) => {
    const list = outcomes?.filter((o) => o.test.ward === wid) ?? [];
    if (mode !== "plan") return { waiting: list.length, ok: 0, late: 0 };
    return {
      waiting: list.filter((o) => simT < o.finish && !(simT > o.test.deadline)).length,
      ok: list.filter((o) => simT >= o.finish && o.onTime).length,
      late: list.filter((o) => (simT >= o.finish && !o.onTime) || (simT > o.test.deadline && simT < o.finish)).length,
    };
  };

  return (
    <svg viewBox="0 0 1000 600" className="w-full h-auto select-none block" role="img" aria-label="Hospital campus map: wards on the left, laboratories in the centre and right">
      {/* zones */}
      <rect x="20" y="16" width="640" height="568" rx="10" style={{ fill: "var(--bg)", stroke: "var(--line)" }} />
      <text x="40" y="46" fontSize="16" fontWeight="500" style={{ fill: "var(--fg-2)" }}>Northgate General campus</text>
      <rect x="680" y="16" width="300" height="568" rx="10" style={{ fill: "var(--bg)", stroke: "var(--line)" }} />
      <text x="700" y="46" fontSize="16" fontWeight="500" style={{ fill: "var(--fg-2)" }}>Partner network</text>
      <text x="700" y="66" fontSize="14" style={{ fill: "var(--fg-3)" }}>Reached by courier</text>

      {conditions && !conditions.courierAvailable && (
        <g>
          <rect x="702" y="544" width="140" height="26" rx="6" style={{ fill: "var(--danger-bg)", stroke: "var(--danger-line)" }} />
          <text x="772" y="562" textAnchor="middle" fontSize="14" fontWeight="500" style={{ fill: "var(--danger)" }}>Courier stopped</text>
        </g>
      )}

      {/* routes */}
      {[...routes.values()].map(({ ward, lab }) => {
        const a = anchor(ward), b = anchor(lab);
        const c = ctrl(a, b, BEND[lab]);
        const e = endAt(a, c, b);
        const dead = down(lab);
        const color = dead ? "var(--danger)" : mode === "plan" ? LAB_COLOR[lab] : "var(--line-strong)";
        return (
          <path
            key={`${ward}-${lab}-${mode}`}
            d={`M${a.x},${a.y} Q${c.x},${c.y} ${e.x},${e.y}`}
            fill="none"
            style={{ stroke: color, opacity: dead ? 0.5 : 1 }}
            strokeWidth={mode === "plan" ? 1.5 : 1.25}
            className={dead ? "" : "dash-flow"}
            strokeDasharray={dead ? "2 4" : undefined}
          />
        );
      })}

      {/* labs */}
      {LABS.map((l) => {
        const isDown = down(l.id);
        const knocked = !!userDown[l.id];
        const done = outcomes?.filter((o) => o.lab === l.id && simT >= o.finish).length ?? 0;
        const busy = outcomes?.filter((o) => o.lab === l.id && simT >= o.arrive && simT < o.finish).length ?? 0;
        const used = mode === "plan" && !!outcomes?.some((o) => o.lab === l.id);
        const clickable = interactive && l.id !== "core";
        const status = isDown
          ? knocked ? "Disabled by you" : l.id === "core" ? "Encrypted, isolated" : "Offline"
          : mode === "plan" ? (used ? `${busy ? `${busy} running · ` : ""}${done} resulted` : "Not used") : `${l.analyzers} analyzer${l.analyzers > 1 ? "s" : ""}`;
        return (
          <g
            key={l.id}
            transform={`translate(${l.x},${l.y})`}
            onClick={() => clickable && onToggleLab?.(l.id)}
            style={{ cursor: clickable ? "pointer" : "default" }}
            role={clickable ? "button" : undefined}
            aria-label={clickable ? `${isDown ? "Restore" : "Disable"} ${l.name}` : undefined}
          >
            {clickable && <circle r={LAB_R + 10} style={{ fill: "transparent" }} />}
            <circle r={LAB_R} strokeWidth={isDown ? 1.5 : used ? 2 : 1}
              style={{ fill: isDown ? "var(--danger-bg)" : "var(--bg)", stroke: isDown ? "var(--danger)" : used ? LAB_COLOR[l.id] : "var(--line-strong)" }} />
            <text y="5" textAnchor="middle" fontSize="14" fontWeight="600" className="mono"
              style={{ fill: isDown ? "var(--danger)" : mode === "plan" && !used ? "var(--fg-3)" : LAB_COLOR[l.id] }}>{l.short}</text>
            <text y={LAB_R + 22} textAnchor="middle" fontSize="16" fontWeight="500" style={{ fill: "var(--fg)" }}>{l.name}</text>
            <text y={LAB_R + 41} textAnchor="middle" fontSize="14" style={{ fill: isDown ? "var(--danger)" : "var(--fg-3)" }}>{status}</text>
          </g>
        );
      })}

      {/* wards */}
      {WARDS.map((w) => {
        const st = wardStats(w.id);
        const stranded = mode === "stranded";
        return (
          <g key={w.id} transform={`translate(${w.x - 62},${w.y - WARD_H / 2})`}>
            <rect width={WARD_W} height={WARD_H} rx="6" style={{ fill: "var(--bg)", stroke: stranded ? "var(--danger-line)" : "var(--line-strong)" }} />
            <text x="12" y="22" fontSize="16" fontWeight="600" style={{ fill: "var(--fg)" }}>{w.short}</text>
            <text x="12" y="41" fontSize="13.5" style={{ fill: "var(--fg-3)" }}>{w.name.split(" ")[0]}</text>
            <text x={WARD_W - 10} y="22" textAnchor="end" fontSize="14" className="mono tnum">
              {st.ok > 0 && <tspan style={{ fill: "var(--ok)" }}>{st.ok}✓ </tspan>}
              {st.late > 0 && <tspan style={{ fill: "var(--danger)" }}>{st.late}✕ </tspan>}
              {st.waiting > 0 && <tspan style={{ fill: stranded ? "var(--danger)" : "var(--fg-3)" }}>{st.waiting}</tspan>}
            </text>
          </g>
        );
      })}

      {/* specimens */}
      {outcomes?.map((o, i) => {
        const ward = wardById(o.test.ward);
        const a = anchor(o.test.ward), b = anchor(o.lab);
        const c = ctrl(a, b, BEND[o.lab]);
        let p = { x: ward.x + 52 - (i % 3) * 10, y: ward.y + 15 };
        let color = "var(--fg-3)";
        let r = 4.5;
        if (mode === "normal") {
          p = bez(a, c, b, (loopT * 0.16 + i * 0.137) % 1);
          color = "var(--lab-core)";
        } else if (mode === "stranded") {
          p = { x: ward.x + 52 - (i % 4) * 10, y: ward.y + 15 };
          color = "var(--danger)";
        } else if (simT < o.dispatch) {
          color = "var(--fg-3)";
        } else if (simT < o.arrive) {
          p = bez(a, c, b, Math.min(1, (simT - o.dispatch) / Math.max(1, o.arrive - o.dispatch)));
          color = LAB_COLOR[o.lab];
        } else {
          const ang = (i / 12) * Math.PI * 2 + (simT < o.finish ? loopT * 0.8 : 0);
          p = { x: b.x + Math.cos(ang) * (LAB_R + 9), y: b.y + Math.sin(ang) * (LAB_R + 9) };
          color = simT < o.finish ? LAB_COLOR[o.lab] : o.onTime ? "var(--ok)" : "var(--danger)";
        }
        return (
          <g key={o.test.id}>
            {focusTest === o.test.id && <circle cx={p.x} cy={p.y} r={8} fill="none" style={{ stroke: "var(--fg)" }} />}
            <circle cx={p.x} cy={p.y} r={r} style={{ fill: color }} />
          </g>
        );
      })}
    </svg>
  );
}
