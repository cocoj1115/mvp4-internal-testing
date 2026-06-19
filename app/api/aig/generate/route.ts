import { NextRequest, NextResponse } from "next/server";
import { getKCsByStandard } from "@/lib/aig/data";
import { AIG_METHODS, runAIGMethod } from "@/lib/aig/pipeline";
import type { AIGStimulusType } from "@/lib/aig/types";

export interface AIGGenerateRequest {
  standardCode: string;
  methodId: string;
  model: string;
  temperature: number;
  stimulusType?: AIGStimulusType;
  styleCheckEnabled?: boolean;
  retryEnabled?: boolean;
  maxAttempts?: number;
}

export async function POST(req: NextRequest) {
  try {
    const body: AIGGenerateRequest = await req.json();
    const {
      standardCode,
      methodId,
      model,
      temperature,
      stimulusType = "auto",
      styleCheckEnabled = false,
      retryEnabled = false,
      maxAttempts = 3,
    } = body;

    const kcs = getKCsByStandard(standardCode);
    if (kcs.length === 0) {
      return NextResponse.json(
        { error: `Standard not found: ${standardCode}` },
        { status: 400 }
      );
    }

    const method = AIG_METHODS[methodId];
    if (!method) {
      return NextResponse.json(
        { error: `Unknown method: ${methodId}` },
        { status: 400 }
      );
    }

    try {
      const result = await runAIGMethod(
        method,
        standardCode,
        model,
        temperature,
        { stimulusType },
        { styleCheckEnabled, retryEnabled, maxAttempts }
      );
      return NextResponse.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "Not implemented yet") {
        return NextResponse.json(
          { error: `Method "${method.label}" is not implemented yet.` },
          { status: 501 }
        );
      }
      throw err;
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/aig/generate]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
