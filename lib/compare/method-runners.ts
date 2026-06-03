import { QUESTION_MAP, PartLabel } from "@/app/lib/questions";
import { getAdaptationRules } from "@/lib/gstar";
import { retrieveFromKB } from "@/lib/retrieval";
import { callCompareLlm } from "@/lib/compare/llm";
import {
  CompareMethod,
  CompareModelConfig,
  CompareProvider,
} from "@/lib/compare/types";

interface MethodRunInput {
  questionId: "M1Q14";
  part: PartLabel;
  studentResponse: string;
  method: CompareMethod;
  candidate: CompareModelConfig;
}

export interface MethodRunResult {
  aiScore: number;
  feedback: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
}

interface ParsedFeedback {
  score?: unknown;
  feedback?: unknown;
  student_feedback?: unknown;
  formative_feedback?: unknown;
  feedback_message?: unknown;
  message?: unknown;
  hint?: unknown;
  guiding_question?: unknown;
  next_step?: unknown;
}

const kbCache = new Map<string, Awaited<ReturnType<typeof retrieveFromKB>>>();

function normalizeScore(value: unknown, maxScore: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maxScore, Math.round(value)));
}

function extractText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const parts = value.map(extractText).filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(" ") : null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = [
      "feedback",
      "student_feedback",
      "formative_feedback",
      "feedback_message",
      "message",
      "text",
      "hint",
      "cue",
      "guiding_question",
      "next_step",
    ];
    for (const key of keys) {
      const text = extractText(record[key]);
      if (text) return text;
    }
    const parts = Object.values(record)
      .map(extractText)
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(" ") : null;
  }
  return null;
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

function normalizedFeedback(parsed: ParsedFeedback): string {
  return (
    extractText(parsed.feedback) ??
    extractText(parsed.student_feedback) ??
    extractText(parsed.formative_feedback) ??
    extractText(parsed.feedback_message) ??
    extractText(parsed.message) ??
    extractText(parsed.hint) ??
    extractText(parsed.guiding_question) ??
    extractText(parsed.next_step) ??
    "No feedback returned."
  );
}

function feedbackGuidelines() {
  return [
    "Feedback style:",
    "- Write 1-3 student-facing sentences.",
    "- Keep feedback task-focused, specific to the student's response, and non-judgmental.",
    "- Prioritize elaborated feedback: briefly explain why the current response is or is not sufficient.",
    "- Do not comment on ability, effort, intelligence, confidence, or personality.",
    "- If not full credit, do not give away the exact missing answer, correct term, or full solution.",
    "- Provide one actionable next step, cue, or guiding question that helps revision.",
    "- Do not mention rubrics, scores, internal categories, or boundary labels.",
    "- Return feedback as one single string.",
  ].join("\n");
}

async function getKbContext(partPrompt: string, studentResponse: string) {
  const key = `${partPrompt}\n---\n${studentResponse}`;
  if (!kbCache.has(key)) {
    kbCache.set(key, await retrieveFromKB(partPrompt, studentResponse, 2));
  }
  return kbCache.get(key) ?? null;
}

async function runMethod1(input: MethodRunInput): Promise<MethodRunResult> {
  const question = QUESTION_MAP[input.questionId];
  const part = question.parts.find((candidate) => candidate.label === input.part);
  if (!part) throw new Error(`Unknown part: ${input.part}`);

  const t0 = Date.now();
  const adaptationRules = getAdaptationRules(question.standard, input.part);
  const kbContext = await getKbContext(part.prompt, input.studentResponse);

  const systemPrompt = [
    "You are an expert biology teacher grading a Pennsylvania Keystone Biology Constructed Response item.",
    "Use the provided scoring guidance as the scoring authority.",
    adaptationRules
      ? "Use GradeOpt adaptation rules where they refine the base scoring guidance."
      : null,
    kbContext
      ? "Use retrieved standard/rubric/example context only to apply the criteria; do not expand the criteria."
      : null,
    `Score must be an integer from 0 to ${part.maxScore}.`,
    feedbackGuidelines(),
    "Respond with ONLY valid JSON:",
    '{"score":0,"feedback":"feedback string"}',
  ]
    .filter(Boolean)
    .join("\n");

  const userPrompt = [
    `QUESTION STEM:\n${question.stem}`,
    `PART ${input.part} PROMPT:\n${part.prompt}`,
    `SCORING GUIDANCE:\n${part.scoringGuidance}`,
    adaptationRules ? `GRADEOPT ADAPTATION RULES:\n${adaptationRules}` : null,
    kbContext ? `STEELS STANDARD CONTEXT:\n${kbContext.kd1}` : null,
    kbContext ? `RUBRIC CONTEXT:\n${kbContext.kd2}` : null,
    kbContext ? `SIMILAR SCORED EXAMPLES:\n${kbContext.ke}` : null,
    `STUDENT RESPONSE:\n${input.studentResponse}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await callCompareLlm({
    provider: input.candidate.provider,
    modelId: input.candidate.modelId,
    temperature: input.candidate.temperature,
    jsonMode: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const parsed = parseJsonObject(res.text) as ParsedFeedback;

  return {
    aiScore: normalizeScore(parsed.score, part.maxScore),
    feedback: normalizedFeedback(parsed),
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    totalTokens: res.totalTokens,
    latencyMs: Date.now() - t0,
  };
}

async function runMethod2(input: MethodRunInput): Promise<MethodRunResult> {
  const question = QUESTION_MAP[input.questionId];
  const part = question.parts.find((candidate) => candidate.label === input.part);
  if (!part) throw new Error(`Unknown part: ${input.part}`);

  const t0 = Date.now();
  const stage1System = [
    "You are a scoring engine for Pennsylvania Keystone Biology constructed-response questions.",
    "Score exactly one part using the item-specific rubric.",
    "Do not provide feedback in this stage.",
    `Award an integer score from 0 to ${part.maxScore}.`,
    "When score is 0, classify failure_type as one of wrong_concept, vague, off_task, circular, copied_question.",
    'Output JSON only: {"score":0,"failure_type":null}',
  ].join("\n");
  const stage1User = [
    `Question stimulus: ${question.stem}`,
    `Part ${input.part} prompt: ${part.prompt}`,
    `Rubric: ${part.scoringGuidance}`,
    `Student response: ${input.studentResponse}`,
  ].join("\n\n");

  const stage1 = await callCompareLlm({
    provider: input.candidate.provider,
    modelId: input.candidate.modelId,
    temperature: input.candidate.temperature,
    jsonMode: true,
    messages: [
      { role: "system", content: stage1System },
      { role: "user", content: stage1User },
    ],
  });
  const stage1Parsed = parseJsonObject(stage1.text);
  const score = normalizeScore(stage1Parsed.score, part.maxScore);

  const stage2System = [
    "You are a biology tutoring feedback agent for Keystone Biology constructed-response questions.",
    "Generate feedback based on the score and failure type.",
    feedbackGuidelines(),
    'Output JSON only: {"feedback":"feedback string"}',
  ].join("\n");
  const stage2User = [
    `Question stimulus: ${question.stem}`,
    `Part ${input.part} prompt: ${part.prompt}`,
    `Rubric: ${part.scoringGuidance}`,
    `Student response: ${input.studentResponse}`,
    `Scoring result: ${JSON.stringify(stage1Parsed)}`,
  ].join("\n\n");

  const stage2 = await callCompareLlm({
    provider: input.candidate.provider,
    modelId: input.candidate.modelId,
    temperature: input.candidate.temperature,
    jsonMode: true,
    messages: [
      { role: "system", content: stage2System },
      { role: "user", content: stage2User },
    ],
  });
  const stage2Parsed = parseJsonObject(stage2.text) as ParsedFeedback;

  return {
    aiScore: score,
    feedback: normalizedFeedback(stage2Parsed),
    inputTokens: stage1.inputTokens + stage2.inputTokens,
    outputTokens: stage1.outputTokens + stage2.outputTokens,
    totalTokens: stage1.totalTokens + stage2.totalTokens,
    latencyMs: Date.now() - t0,
  };
}

async function runMethod3(input: MethodRunInput): Promise<MethodRunResult> {
  const question = QUESTION_MAP[input.questionId];
  const part = question.parts.find((candidate) => candidate.label === input.part);
  if (!part) throw new Error(`Unknown part: ${input.part}`);

  const t0 = Date.now();
  const systemPrompt = [
    "You are an expert Keystone Biology constructed-response grader.",
    "Use the item-specific rubric as the sole scoring authority.",
    "Your output order is mandatory: error_analysis, feedback, score, confidence.",
    "Surface errors must not affect the score unless they prevent meaning.",
    "Error analysis categories: conceptual_errors, reasoning_gaps, surface_errors, off_task_or_vague.",
    feedbackGuidelines(),
    `Score must be an integer from 0 to ${part.maxScore}.`,
    "Respond with ONLY valid JSON:",
    '{"error_analysis":{"conceptual_errors":[],"reasoning_gaps":[],"surface_errors":[],"off_task_or_vague":[]},"feedback":"feedback string","score":0,"confidence":"high|medium|low"}',
  ].join("\n");
  const userPrompt = [
    `Question stimulus:\n${question.stem}`,
    `Part ${input.part} prompt:\n${part.prompt}`,
    `Item-specific rubric:\n${part.scoringGuidance}`,
    `Student response:\n${input.studentResponse}`,
  ].join("\n\n");

  const res = await callCompareLlm({
    provider: input.candidate.provider,
    modelId: input.candidate.modelId,
    temperature: input.candidate.temperature,
    jsonMode: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const parsed = parseJsonObject(res.text) as ParsedFeedback;

  return {
    aiScore: normalizeScore(parsed.score, part.maxScore),
    feedback: normalizedFeedback(parsed),
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    totalTokens: res.totalTokens,
    latencyMs: Date.now() - t0,
  };
}

export async function runComparisonMethod(input: MethodRunInput): Promise<MethodRunResult> {
  if (input.method === "1") return runMethod1(input);
  if (input.method === "2") return runMethod2(input);
  return runMethod3(input);
}

export function providerDisplayName(provider: CompareProvider): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic";
  return "Google";
}
