import { NextResponse } from "next/server";
import { buildPlan } from "@/lib/orchestrator";
import { PlanRequestSchema } from "@/lib/validation";
import { authorizeLiveVisitor, LiveAccessError } from "@/lib/live-protection";

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
  // Offline modes and disabled/unconfigured Qloo never depend on Redis or identity headers.
  if (parsed.data.useQloo && !parsed.data.sampleOnly && process.env.QLOO_LIVE_ENABLED === "true" && process.env.QLOO_API_KEY?.trim()) {
    try { await authorizeLiveVisitor(request); }
    catch (error) {
      const limited = error instanceof LiveAccessError && error.code === "visitor-limit";
      const responseHeaders = limited && error.retryAfter ? { ...headers, "Retry-After": String(error.retryAfter) } : headers;
      return NextResponse.json({ error: limited ? "LIVE request limit reached. Please wait or choose SAMPLE ideas." : "LIVE planning is unavailable. Choose SAMPLE ideas or the generic plan.", code: limited ? "LIVE_RATE_LIMITED" : "LIVE_UNAVAILABLE" }, { status: limited ? 429 : 503, headers: responseHeaders });
    }
  }
  try {
    const { guests, ...options } = parsed.data;
    return NextResponse.json(await buildPlan(guests, options), { headers });
  } catch {
    // Never return or log upstream payloads, headers, seed text, or credentials.
    return NextResponse.json({ error: "We couldn't finish this plan. Please try again." }, { status: 500, headers });
  }
}
