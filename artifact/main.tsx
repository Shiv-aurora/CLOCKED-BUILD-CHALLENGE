// Entry for the static, single-file build (hosted demo). No API key ships in this bundle:
// the three built-in scenarios replay responses recorded from the live Clocked API (lib/recorded.json);
// anything else falls back to the clearly labelled offline stand-in.
import { createRoot } from "react-dom/client";
import Page from "../app/page";
import recorded from "../lib/recorded.json";
import { emulate } from "../lib/emulator";

const responses = (recorded as any).responses as Record<string, { ms: number; data: unknown }>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(globalThis as any).__VS_STATIC__ = async (endpoint: string, body: unknown) => {
  const hit = responses[`${endpoint}|${JSON.stringify(body)}`];
  if (hit) {
    await sleep(Math.max(250, Math.min(hit.ms, 700)));
    return { mode: "recorded", ms: hit.ms, data: hit.data };
  }
  await sleep(400);
  return {
    mode: "emulated",
    ms: 0,
    error: "Edited input has no recorded Clocked response in this static demo; offline stand-in used. Run the repo with an API key for live calls.",
    data: emulate(endpoint, body),
  };
};

createRoot(document.getElementById("root")!).render(<Page />);
