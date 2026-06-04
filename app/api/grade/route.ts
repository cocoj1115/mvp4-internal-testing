import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { QUESTION_MAP } from "@/app/lib/questions";
import { getAdaptationRules } from "@/lib/gstar";
import { retrieveFromKB } from "@/lib/retrieval";
import { gradeWithMethod1 } from "@/lib/methods/method1";
import { gradeWithMethod2 } from "@/lib/methods/method2";
import { gradeWithMethod3 } from "@/lib/methods/method3";
import { classifyResolution, handleAttempt2 } from "@/lib/attempt2";
import {
  defaultGradingModelForMethod,
  normalizeGradingModelConfig,
  type GradingModelConfig,
  type StudentMethod,
} from "@/lib/grading-models";

export interface GradeRequest {
  questionId: string;
  partLabel: "A" | "B" | "C";
  studentResponse: string;
  method?: string;
  model?: string;
  modelConfig?: GradingModelConfig;
  attemptNumber?: 1 | 2;
  attempt1Feedback?: string;
  attempt1Gap?: string;
  priorGaps?: Record<string, string>;
  taskType?: string;
}

export interface GradeResponse {
  score: number;
  feedback: string;
  tokenCount?: number;
  model?: string;
  modelConfig?: GradingModelConfig;
  diagnosedGap: string;
  resolution?: "fully" | "partially" | "not_at_all";
}

function openAiErrorResponse(err: unknown) {
  if (!(err instanceof OpenAI.APIError)) return null;
  const code = typeof err.code === "string" ? err.code : undefined;
  const status = err.status ?? 500;
  if (status === 429 && code === "insufficient_quota") {
    return NextResponse.json(
      { error: "OpenAI quota exceeded. Check billing and usage limits.", code },
      { status: 429 }
    );
  }
  if (status === 429) {
    return NextResponse.json(
      { error: "OpenAI rate limit reached. Please wait and try again.", code: code ?? "rate_limit" },
      { status: 429 }
    );
  }
  if (status === 401 || status === 403) {
    return NextResponse.json(
      { error: "OpenAI authentication failed. Check OPENAI_API_KEY.", code: code ?? "auth_error" },
      { status }
    );
  }
  return NextResponse.json(
    { error: "OpenAI request failed. Check server logs.", code: code ?? "openai_error" },
    { status }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body: GradeRequest = await req.json();
    const {
      questionId,
      partLabel,
      studentResponse,
      method,
      model,
      modelConfig,
      attemptNumber = 1,
      attempt1Feedback,
      attempt1Gap,
      priorGaps,
      taskType,
    } = body;

    const methodId: StudentMethod = method === "2" || method === "3" ? method : "1";
    const gradingModel =
      normalizeGradingModelConfig(modelConfig) ??
      normalizeGradingModelConfig(model) ??
      defaultGradingModelForMethod(methodId);
    if (!gradingModel) {
      return NextResponse.json({ error: "Unsupported grading model configuration." }, { status: 400 });
    }

    const question = QUESTION_MAP[questionId];
    if (!question) return NextResponse.json({ error: "Unknown question ID" }, { status: 400 });

    const part = question.parts.find((p) => p.label === partLabel);
    if (!part) return NextResponse.json({ error: "Unknown part label" }, { status: 400 });

    if (!studentResponse || studentResponse.trim().length === 0) {
      return NextResponse.json<GradeResponse>({
        score: 0,
        feedback: "No response was submitted.",
        diagnosedGap: "Student submitted empty response.",
        model: gradingModel.modelId,
        modelConfig: gradingModel,
      });
    }

    // ── Dispatch to method handler ─────────────────────────────────────────

    let score: number;
    let feedback: string;
    let diagnosedGap: string;
    let tokenCount: number;

    if (methodId === "2") {
      const result = await gradeWithMethod2(questionId, partLabel, studentResponse, gradingModel);
      score = result.score;
      feedback = result.feedback;
      diagnosedGap = result.score >= part.maxScore ? "none" : result.feedback;
      tokenCount = result.tokenCount;
    } else if (methodId === "3") {
      const result = await gradeWithMethod3(questionId, partLabel, studentResponse, gradingModel);
      score = result.score;
      feedback = result.feedback;
      diagnosedGap = result.score >= part.maxScore ? "none" : result.feedback;
      tokenCount = result.tokenCount;
    } else {
      const adaptationRules = method === "1"
        ? getAdaptationRules(question.standard, partLabel)
        : null;
      const kbContext = await retrieveFromKB(part.prompt, studentResponse, 2);

      const result = await gradeWithMethod1(questionId, partLabel, studentResponse, gradingModel, {
        adaptationRules,
        kbContext,
        priorGaps: priorGaps ?? {},
        taskType,
        part: { prompt: part.prompt, maxScore: part.maxScore, scoringGuidance: part.scoringGuidance },
        questionStem: question.stem,
      });
      score = result.score;
      feedback = result.feedback;
      diagnosedGap = result.diagnosedGap;
      tokenCount = result.tokenCount;
    }

    // ── Attempt 1: return immediately ──────────────────────────────────────
    if (attemptNumber === 1) {
      return NextResponse.json<GradeResponse>({
        score,
        feedback,
        diagnosedGap,
        tokenCount,
        model: gradingModel.modelId,
        modelConfig: gradingModel,
      });
    }

    // ── Attempt 2: classify resolution + generate feedback ─────────────────
    const resolution = await classifyResolution(
      attempt1Gap ?? diagnosedGap,
      studentResponse,
      gradingModel
    );

    const attempt2Result = await handleAttempt2({
      resolution,
      attempt1Feedback: attempt1Feedback ?? "",
      attempt1Gap: attempt1Gap ?? diagnosedGap,
      questionStem: question.stem,
      partLabel,
      partPrompt: part.prompt,
      studentResponse,
      model: gradingModel,
    });

    return NextResponse.json<GradeResponse>({
      score,
      feedback: attempt2Result.feedback,
      diagnosedGap,
      tokenCount: tokenCount + attempt2Result.tokenCount,
      model: gradingModel.modelId,
      modelConfig: gradingModel,
      resolution,
    });
  } catch (err) {
    console.error("[/api/grade] Error:", err);
    const openAiResponse = openAiErrorResponse(err);
    if (openAiResponse) return openAiResponse;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
