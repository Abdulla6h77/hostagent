import { NextResponse } from "next/server";
import { buildPlan } from "@/lib/orchestrator";
import { PlanRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_BYTES = 16_384;
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  let body: unknown;
  try {
    if (Number(request.headers.get("content-length")) > MAX_BYTES) {
      return NextResponse.json({ error: "Request is too large." }, { status: 413, headers });
    }
    // Stream with a hard byte cap rather than buffering an arbitrary request body.
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: "Send a JSON request body." }, { status: 400, headers });
    const decoder = new TextDecoder();
    let text = ""; let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return NextResponse.json({ error: "Request is too large." }, { status: 413, headers }); }
      text += decoder.decode(value, { stream: true });
    }
    body = JSON.parse(text + decoder.decode());
  } catch { return NextResponse.json({ error: "Send valid JSON." }, { status: 400, headers }); }
  const parsed = PlanRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Check guest names and add 3–5 different tastes per guest.", details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }, { status: 400, headers });
  try {
    const { guests, ...options } = parsed.data;
    return NextResponse.json(await buildPlan(guests, options), { headers });
  } catch {
    // Never return or log upstream payloads, headers, seed text, or credentials.
    return NextResponse.json({ error: "We couldn't finish this plan. Please try again." }, { status: 500, headers });
  }
}
