/**
 * POST /api/vectorstore
 *
 * Accepts { parseResult: ParseResult } and builds the in-memory vector store
 * from the parsed PDF content. Called automatically by the Step 1 wizard
 * after /api/parse completes, before the user advances to Step 2.
 *
 * Returns { success: true, counts: { kd1, kd2, ke } } on success.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  buildVectorStore,
  getCounts,
  type ParseResult,
} from "@/lib/vectorstore";

export async function POST(req: NextRequest) {
  try {
    const { parseResult } = (await req.json()) as { parseResult: ParseResult };

    if (!parseResult?.g0) {
      return NextResponse.json(
        { error: "Missing or invalid parseResult" },
        { status: 400 }
      );
    }

    await buildVectorStore(parseResult);
    const counts = getCounts();

    return NextResponse.json({ success: true, counts });
  } catch (err) {
    console.error("[/api/vectorstore] Error:", err);
    return NextResponse.json(
      { error: "Failed to build vector store" },
      { status: 500 }
    );
  }
}
