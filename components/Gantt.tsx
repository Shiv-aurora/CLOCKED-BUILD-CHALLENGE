"use client";
import type { PlanResult, TestOutcome } from "@/lib/engine";
import { clock } from "@/lib/engine";
import { LAB_COLOR } from "./HospitalMap";
import { labById } from "@/lib/scenario";

const H = 210; // horizon, minutes

function Row({ o, simT }: { o: TestOutcome; simT: number }) {
  const pct = (m: number) => `${(Math.min(m, H) / H) * 100}%`;
  const color = LAB_COLOR[o.lab];
  const shown = Math.min(simT, H);
  const finished = simT >= o.finish;
  const missed = simT > o.test.deadline && !(finished && o.onTime);
  const seg = (from: number, to: number, style: React.CSSProperties) => {
    const a = Math.min(from, shown), b = Math.min(to, shown);
    if (b <= a) return null;
    return <div className="absolute top-[5px] bottom-[5px]" style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})`, ...style }} />;
  };
  return (
    <div className="grid grid-cols-[150px_1fr_64px] items-center gap-3 h-7 text-[13px]">
      <div className="truncate">
        <span className={o.test.priority === 3 ? "text-fg font-medium" : "text-fg2"}>{o.test.label}</span>
        {o.test.priority === 3 && <span className="text-fg3 text-[11.5px] ml-1.5">STAT</span>}
      </div>
      <div className="relative h-full">
        <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--line)]" />
        {seg(0, o.dispatch, { background: "var(--bg-muted)" })}
        {seg(o.dispatch, o.arrive, { background: `repeating-linear-gradient(90deg, ${color} 0 2px, transparent 2px 5px)`, opacity: 0.55 })}
        {seg(o.arrive, o.start, { background: color, opacity: 0.2 })}
        {seg(o.start, o.finish, { background: color, borderRadius: 2 })}
        <div className="absolute top-0 bottom-0 w-px" style={{ left: pct(o.test.deadline), background: "var(--fg)" }} title={`Deadline ${clock(o.test.deadline)}`} />
      </div>
      <div className="text-right tnum text-[12.5px]">
        {finished ? (
          <span className={o.onTime ? "text-ok" : "text-danger"}>{clock(o.finish)}</span>
        ) : missed ? (
          <span className="text-danger">Late</span>
        ) : o.finish > H && simT >= H ? (
          <span className="text-danger">{clock(o.finish)}</span>
        ) : (
          <span className="text-fg3">{o.dest === "wait" ? "Hold" : labById(o.lab).short}</span>
        )}
      </div>
    </div>
  );
}

export default function Gantt({ title, sub, result, simT, tone }: { title: string; sub: string; result: PlanResult; simT: number; tone: "vital" | "alarm" }) {
  const onTime = result.outcomes.filter((o) => o.onTime && simT >= o.finish).length;
  const late = result.outcomes.filter((o) => simT > o.test.deadline && !(o.onTime && simT >= o.finish)).length;
  const order = [...result.outcomes].sort((a, b) => b.test.priority - a.test.priority || a.test.deadline - b.test.deadline);
  return (
    <section className="box p-5 min-w-0">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
          <p className="text-[13px] text-fg3 mt-0.5 max-w-[46ch]">{sub}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[32px] leading-none font-semibold tracking-tight tnum">
            <span className={tone === "vital" ? "text-ok" : "text-fg"}>{onTime}</span><span className="text-fg3 text-[20px]"> / {result.outcomes.length}</span>
          </div>
          <div className="text-[12.5px] text-fg3 mt-1">on time · <span className={late ? "text-danger" : ""}>{late} late</span></div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          {order.map((o) => <Row key={o.test.id} o={o} simT={simT} />)}
          <div className="grid grid-cols-[150px_1fr_64px] gap-3 mt-1">
            <span />
            <div className="flex justify-between text-[11.5px] text-fg3 tnum">
              {[0, 60, 120, 180].map((m) => <span key={m}>{clock(m)}</span>)}
            </div>
            <span />
          </div>
        </div>
      </div>
    </section>
  );
}
