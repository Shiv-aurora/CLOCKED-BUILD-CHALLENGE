import { NextRequest, NextResponse } from "next/server";
import { emulate } from "@/lib/emulator";

const ALLOWED = new Set(["injection", "pii", "extract", "decide", "grounding"]);
const BASE = "https://clocked.rezolve.ai/clocked";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ endpoint: string }> }) {
  const { endpoint } = await ctx.params;
  if (!ALLOWED.has(endpoint)) return NextResponse.json({ error: "unknown endpoint" }, { status: 404 });
  const body = await req.json();
  const forceEmulated = req.nextUrl.searchParams.get("mode") === "emulated";
  const key = process.env.CLOCKED_API_KEY;
  const t0 = Date.now();

  if (key && !forceEmulated) {
    const idem = crypto.randomUUID();
    let lastErr = "";
    // Bounded retry with the same idempotency key, per the Clocked errors & retries guide.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${BASE}/${endpoint}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idem,
          },
          body: JSON.stringify(body),
          cache: "no-store",
        });
        const text = await res.text();
        if (res.ok) {
          return NextResponse.json({
            mode: "live",
            ms: Date.now() - t0,
            requestId: res.headers.get("x-request-id") ?? undefined,
            data: JSON.parse(text),
          });
        }
        lastErr = `HTTP ${res.status}: ${text.slice(0, 300)}`;
        if (res.status < 500 && res.status !== 429) break; // not retryable
      } catch (e) {
        lastErr = String(e);
      }
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
    // Live call failed: degrade gracefully, but say so loudly.
    return NextResponse.json({ mode: "emulated", ms: Date.now() - t0, error: lastErr, data: emulate(endpoint, body) });
  }

  // No key: deterministic offline stand-in so the demo stays reproducible. Clearly labelled in the UI.
  await new Promise((r) => setTimeout(r, 350 + Math.random() * 250));
  return NextResponse.json({
    mode: "emulated",
    ms: Date.now() - t0,
    error: key ? undefined : "CLOCKED_API_KEY not set",
    data: emulate(endpoint, body),
  });
}
