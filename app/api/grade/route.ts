import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { QUESTION_MAP } from "@/app/lib/questions";
import { getAdaptationRules } from "@/lib/gstar";
import { retrieveContext } from "@/lib/retrieval";
import { gradeWithMethod2 } from "@/lib/methods/method2";
import { gradeWithMethod3 } from "@/lib/methods/method3";
import {
  DEFAULT_GRADING_MODEL,
  GradingModel,
  isGradingModel,
} from "@/lib/grading-models";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface GradeRequest {
  questionId: string;
  partLabel: "A" | "B" | "C";
  studentResponse: string;
  method?: string;
  model?: string;
  attemptNumber?: 1 | 2;
  attempt1Feedback?: string;
  attempt1Gap?: string;
}

export interface GradeResponse {
  score: number;
  feedback: string;
  tokenCount?: number;
  model?: GradingModel;
  diagnosedGap: string;
  resolution?: "fully" | "partially" | "not_at_all";
}

// ── Helper: classify how well the student addressed attempt 1 gap ──────────

async function classifyResolution(
  attempt1Gap: string,
  attempt2Response: string,
  model: string
): Promise<"fully" | "partially" | "not_at_all"> {
  const res = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "Classify whether a student's revised biology response addresses a specific reasoning gap. Respond with exactly one of: fully / partially / not_at_all",
      },
      {
        role: "user",
        content: `Gap from attempt 1: ${attempt1Gap}\n\nStudent attempt 2: ${attempt2Response}`,
      },
    ],
  });
  const raw = res.choices[0].message.content?.trim().toLowerCase() ?? "";
  if (raw.startsWith("not") || raw.includes("not_at_all") || raw.includes("not at all"))
    return "not_at_all";
  if (raw.startsWith("partial") || raw.includes("partial")) return "partially";
  return "fully";
}

// ── Helper: generate attempt 2 feedback routed by resolution ──────────────

async function generateAttempt2Feedback(
  resolution: "fully" | "partially" | "not_at_all",
  attempt1Feedback: string,
  questionStem: string,
  partLabel: string,
  partPrompt: string,
  studentResponse: string,
  model: string
): Promise<string> {
  const instruction =
    resolution === "fully"
      ? "The student has addressed the gap. Acknowledge specifically what improved. 1–2 sentences."
      : resolution === "partially"
      ? "The student partially addressed the gap. Acknowledge the progress, then note what is still missing. 2 sentences."
      : "The student did not address the gap. Reframe from a completely different angle. 2 sentences max.";

  const res = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: [
          "You are giving feedback on a student's second attempt at a Keystone Biology constructed-response question.",
          instruction,
          "Be encouraging but precise. Do not mention internal scoring criteria or diagnostic labels.",
          `HARD CONSTRAINT: Do not reuse any phrases, sentence structures, or vocabulary from this previous feedback: "${attempt1Feedback}"`,
          "Return only the feedback text — no JSON, no labels, no extra formatting.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Question: ${questionStem}`,
          `Part ${partLabel}: ${partPrompt}`,
          `Student response: ${studentResponse}`,
        ].join("\n"),
      },
    ],
  });
  return res.choices[0].message.content?.trim() ?? "No feedback returned.";
}

// ── Error helpers ─────────────────────────────────────────────────────────

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

// ── Main handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body: GradeRequest = await req.json();
    const {
      questionId,
      partLabel,
      studentResponse,
      method,
      model,
      attemptNumber = 1,
      attempt1Feedback,
      attempt1Gap,
    } = body;

    const gradingModel = model ?? DEFAULT_GRADING_MODEL;
    if (!isGradingModel(gradingModel)) {
      return NextResponse.json({ error: `Unsupported grading model: ${String(gradingModel)}` }, { status: 400 });
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
        model: gradingModel,
      });
    }

    // ── Method 2 ──────────────────────────────────────────────────────────
    if (method === "2") {
      const result = await gradeWithMethod2(questionId, partLabel, studentResponse, gradingModel);
      const diagnosedGap = result.score >= part.maxScore ? "none" : result.feedback;

      if (attemptNumber === 2 && attempt1Gap) {
        const resolution = await classifyResolution(attempt1Gap, studentResponse, gradingModel);
        const feedback = await generateAttempt2Feedback(
          resolution, attempt1Feedback ?? "", question.stem, partLabel, part.prompt, studentResponse, gradingModel
        );
        return NextResponse.json<GradeResponse>({
          score: result.score, feedback, tokenCount: result.tokenCount,
          model: gradingModel, diagnosedGap, resolution,
        });
      }

      return NextResponse.json<GradeResponse>({
        score: result.score, feedback: result.feedback,
        tokenCount: result.tokenCount, model: gradingModel, diagnosedGap,
      });
    }

    // ── Method 3 ──────────────────────────────────────────────────────────
    if (method === "3") {
      const result = await gradeWithMethod3(questionId, partLabel, studentResponse, gradingModel);
      const diagnosedGap = result.score >= part.maxScore ? "none" : result.feedback;

      if (attemptNumber === 2 && attempt1Gap) {
        const resolution = await classifyResolution(attempt1Gap, studentResponse, gradingModel);
        const feedback = await generateAttempt2Feedback(
          resolution, attempt1Feedback ?? "", question.stem, partLabel, part.prompt, studentResponse, gradingModel
        );
        return NextResponse.json<GradeResponse>({
          score: result.score, feedback, tokenCount: result.tokenCount,
          model: gradingModel, diagnosedGap, resolution,
        });
      }

      return NextResponse.json<GradeResponse>({
        score: result.score, feedback: result.feedback,
        tokenCount: result.tokenCount, model: gradingModel, diagnosedGap,
      });
    }

    // ── Method 1 (and fallback): GradeOpt + RAG ───────────────────────────

    const adaptationRules = method === "1"
      ? getAdaptationRules(question.standard, partLabel)
      : null;
    const useGradeOpt = !!adaptationRules;

    const ragContext = await retrieveContext(`${part.prompt}\n${studentResponse}`, 3);

    const isMultiPoint = part.maxScore > 1;

    // ── Gap resolution check for attempt 2 ──────────────────────────────
    let resolution: "fully" | "partially" | "not_at_all" | undefined;
    if (attemptNumber === 2 && attempt1Gap) {
      resolution = await classifyResolution(attempt1Gap, studentResponse, gradingModel);
    }

    // ── System prompt ────────────────────────────────────────────────────
    const receiveItems: string[] = [
      "1. The question stem",
      "2. The sub-part prompt",
    ];
    let itemNum = 2;
    if (!useGradeOpt) receiveItems.push(`${++itemNum}. Official scoring guidance`);
    if (useGradeOpt)  receiveItems.push(`${++itemNum}. GradeOpt Adaptation Rules`);
    if (ragContext)   receiveItems.push(`${++itemNum}. Knowledge base context`);
    if (attemptNumber === 2) receiveItems.push(`${++itemNum}. Attempt 1 feedback (do not reuse)`);
    receiveItems.push(`${++itemNum}. Student response`);

    const attempt2FeedbackInstruction = resolution
      ? [
          "",
          "ATTEMPT 2 — FEEDBACK ROUTING:",
          `Gap resolution: ${resolution}`,
          resolution === "fully"
            ? "Acknowledge specifically what the student improved. 1–2 sentences."
            : resolution === "partially"
            ? "Acknowledge progress, then note what is still missing. 2 sentences."
            : "Reframe from a completely different angle. 2 sentences max.",
          attempt1Feedback
            ? `HARD CONSTRAINT: Do not reuse any phrases, sentence structures, or vocabulary from this previous feedback: "${attempt1Feedback}"`
            : "",
        ].filter(Boolean).join("\n")
      : null;

    const systemPrompt = [
      "You are an expert biology teacher grading a Pennsylvania Keystone Biology Constructed Response (CR) item.",
      "",
      "You will receive:",
      ...receiveItems,
      "",
      "Scoring rules:",
      isMultiPoint
        ? `• This part is worth ${part.maxScore} points. Award 0, 1, or ${part.maxScore} based on distinct scorable elements.`
        : "• This part is worth 1 point. Award 0 or 1.",
      !useGradeOpt ? "• Base your score on the scoring guidance." : null,
      useGradeOpt ? "• Adaptation Rules take precedence where they conflict with base guidance." : null,
      ragContext ? "• Use knowledge base context to inform judgment; do not quote it directly." : null,
      attempt2FeedbackInstruction,
      "",
      "Feedback rules (when not overridden by attempt 2 routing above):",
      "• 1–3 sentences. Acknowledge what was correct, identify what is missing.",
      "• Be encouraging but precise. Never mention internal scoring criteria.",
      "",
      "diagnosedGap: one specific sentence identifying the exact reasoning step or concept missing.",
      "Write 'none' if score equals maximum.",
      "",
      "Respond with ONLY valid JSON — no markdown, no extra keys:",
      '{"score": <integer>, "feedback": "<string>", "diagnosedGap": "<string>"}',
    ].filter((l) => l !== null).join("\n");

    // ── User prompt ──────────────────────────────────────────────────────
    const userParts = [
      `QUESTION STEM:\n${question.stem}`,
      `SUB-PART ${partLabel} (worth ${part.maxScore} pt${part.maxScore > 1 ? "s" : ""}):\n${part.prompt}`,
      !useGradeOpt ? `SCORING GUIDANCE:\n${part.scoringGuidance}` : null,
      useGradeOpt ? `GRADEOPT ADAPTATION RULES:\n${adaptationRules}` : null,
      ragContext ? `KNOWLEDGE BASE CONTEXT:\n${ragContext}` : null,
      attemptNumber === 2 && attempt1Feedback
        ? `ATTEMPT 1 FEEDBACK (do not reuse):\n${attempt1Feedback}`
        : null,
      `STUDENT RESPONSE:\n${studentResponse.trim()}`,
    ].filter(Boolean);

    const completion = await client.chat.completions.create({
      model: gradingModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userParts.join("\n\n") },
      ],
    });

    const raw = completion.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(raw) as { score?: unknown; feedback?: string; diagnosedGap?: string };

    const rawScore = typeof parsed.score === "number" ? parsed.score : 0;
    const score = Math.max(0, Math.min(part.maxScore, Math.round(rawScore)));
    const feedback =
      typeof parsed.feedback === "string" && parsed.feedback.length > 0
        ? parsed.feedback
        : "No feedback returned.";
    const diagnosedGap =
      typeof parsed.diagnosedGap === "string" && parsed.diagnosedGap.trim()
        ? parsed.diagnosedGap.trim()
        : "none";

    return NextResponse.json<GradeResponse>({
      score,
      feedback,
      diagnosedGap,
      tokenCount: completion.usage?.total_tokens,
      model: gradingModel,
      resolution,
    });
  } catch (err) {
    console.error("[/api/grade] Error:", err);
    const openAiResponse = openAiErrorResponse(err);
    if (openAiResponse) return openAiResponse;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
