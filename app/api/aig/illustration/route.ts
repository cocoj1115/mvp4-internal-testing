import { NextRequest, NextResponse } from "next/server";
import { generateIllustrationB64 } from "@/lib/aig/illustration";

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json() as { prompt: string };
    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const b64 = await generateIllustrationB64(prompt);
    return NextResponse.json({ b64 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/aig/illustration]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
