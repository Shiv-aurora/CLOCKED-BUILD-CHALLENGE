import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({ live: !!process.env.CLOCKED_API_KEY });
}
