import { NextRequest, NextResponse } from "next/server";
import { resolveGap } from "@/lib/methods/method1";

export async function POST(req: NextRequest) {
  try {
    const { diagnosedGap, attempt2Response } = await req.json();
    if (!diagnosedGap || !attempt2Response) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    const gapResolution = await resolveGap(diagnosedGap, attempt2Response);
    return NextResponse.json({ gapResolution });
  } catch (err) {
    console.error("[/api/resolve-gap] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
