import { NextRequest, NextResponse } from "next/server";
import {
  ABLATION_STANDARDS,
  getAblationConfig,
  pickDeterministicIndex,
  pickDeterministicStimulusType,
  runAblationGeneration,
  type AblationConfigId,
} from "@/lib/aig/ablation";
import { judgeAblationItem } from "@/lib/aig/ablation-judge";
import { getKCsByStandard, getStandardInfo } from "@/lib/aig/data";
import { normalizeJudgeConfig } from "@/lib/compare/models";
import type { AIGStimulusType, Blueprint } from "@/lib/aig/types";

interface RunOneRequest {
  runId: string;
  configId: AblationConfigId;
  standardCode: string;
  replicateIndex: number;
  model: string;
  temperature: number;
  judge: unknown;
  fixedCoreKC?: string;
  stimulusType?: Exclude<AIGStimulusType, "auto" | "none">;
  baselineBlueprint?: Blueprint;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const body: RunOneRequest = await req.json();
    const config = getAblationConfig(body.configId);
    if (!config) {
      return NextResponse.json({ error: `Unknown config: ${body.configId}` }, { status: 400 });
    }
    if (!ABLATION_STANDARDS.includes(body.standardCode as (typeof ABLATION_STANDARDS)[number])) {
      return NextResponse.json({ error: `Unsupported ablation standard: ${body.standardCode}` }, { status: 400 });
    }
    if (!body.model || typeof body.model !== "string") {
      return NextResponse.json({ error: "model is required" }, { status: 400 });
    }
    if (typeof body.temperature !== "number" || !Number.isFinite(body.temperature)) {
      return NextResponse.json({ error: "temperature must be a number" }, { status: 400 });
    }
    if (!Number.isInteger(body.replicateIndex) || body.replicateIndex < 0) {
      return NextResponse.json({ error: "replicateIndex must be a non-negative integer" }, { status: 400 });
    }

    const judge = normalizeJudgeConfig(body.judge);
    if (!judge) {
      return NextResponse.json({ error: "judge config is invalid" }, { status: 400 });
    }

    const kcs = getKCsByStandard(body.standardCode);
    if (kcs.length === 0) {
      return NextResponse.json({ error: `Standard not found: ${body.standardCode}` }, { status: 400 });
    }
    const fixedCoreKC =
      body.fixedCoreKC && kcs.some((kc) => kc.code === body.fixedCoreKC)
        ? body.fixedCoreKC
        : kcs[pickDeterministicIndex(kcs.length, `${body.standardCode}:${body.replicateIndex}:core-kc`)].code;
    const stimulusType = body.stimulusType ?? pickDeterministicStimulusType(body.standardCode, body.replicateIndex);

    const { generation } = await runAblationGeneration({
      configId: config.id,
      standardCode: body.standardCode,
      replicateIndex: body.replicateIndex,
      model: body.model,
      temperature: body.temperature,
      fixedCoreKC,
      stimulusType,
      baselineBlueprint: body.baselineBlueprint,
    });

    const standardInfo = getStandardInfo(body.standardCode);
    const judgeResult = await judgeAblationItem({
      standardCode: body.standardCode,
      standardStatement: standardInfo?.statement ?? "",
      coreKC: fixedCoreKC,
      item: generation.item,
      blueprint: generation.blueprint,
      configLabel: `${config.id} ${config.label}`,
      judge,
    });

    return NextResponse.json({
      run_id: body.runId,
      timestamp: new Date().toISOString(),
      config,
      standard_code: body.standardCode,
      replicate_index: body.replicateIndex,
      fixed_core_kc: fixedCoreKC,
      stimulus_type: stimulusType,
      model: body.model,
      temperature: body.temperature,
      judge,
      generation,
      judge_result: judgeResult,
      latency_ms: Date.now() - startedAt,
      status: "success",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/aig/ablation/run-one]", err);
    return NextResponse.json(
      {
        error: message,
        latency_ms: Date.now() - startedAt,
        status: "failed",
      },
      { status: 500 }
    );
  }
}
