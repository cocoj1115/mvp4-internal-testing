import { PartLabel, QUESTION_MAP } from "@/app/lib/questions";
import { callCompareLlm } from "@/lib/compare/llm";
import { CompareJudgeConfig, JudgeScores, JudgeTrack } from "@/lib/compare/types";

interface JudgeInput {
  questionId: "M1Q14";
  part: PartLabel;
  taskType: string;
  studentResponse: string;
  feedback: string;
  aiScore: number;
  maxScore: number;
  judge: CompareJudgeConfig;
}

export interface JudgeResult extends JudgeScores {
  latencyMs: number;
}

const JUDGE_SYSTEM_PROMPT = `You are an expert evaluator of formative feedback in science education.

You will receive:
- A biology question part and prompt
- The student's response
- The AI score (0 = incorrect, 1 = correct)
- The task type (recall_identify or explain_mechanism)
- The AI-generated feedback to evaluate

If score = 1: apply Track A rubric (confirmation_clarity, scope_control).
If score = 0: apply Track B rubric (task_focus, specificity, manageability, answer_leakage). For specificity and manageability, apply the row that matches the task type provided.

Be strict — a score of 4 should be rare and genuinely excellent.
Return ONLY valid JSON matching the track format. No markdown.`;

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

function normalizeScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(4, Math.round(value)));
}

export async function judgeFeedback(input: JudgeInput): Promise<JudgeResult> {
  const question = QUESTION_MAP[input.questionId];
  const part = question.parts.find((candidate) => candidate.label === input.part);
  if (!part) throw new Error(`Unknown part: ${input.part}`);

  const track: JudgeTrack = input.aiScore >= input.maxScore ? "correct" : "incorrect";

  const t0 = Date.now();

  const trackAFormat = `{"track":"correct","confirmation_clarity":1,"scope_control":1,"overall_quality":1,"rationale":"one sentence on biggest weakness"}`;
  const trackBFormat = `{"track":"incorrect","task_focus":1,"specificity":1,"manageability":1,"answer_leakage":1,"overall_quality":1,"rationale":"one sentence on biggest weakness"}`;

  const userPrompt = [
    `QUESTION PART: ${input.part}`,
    `TASK TYPE: ${input.taskType}`,
    `QUESTION PROMPT: ${part.prompt}`,
    `STUDENT RESPONSE: ${input.studentResponse}`,
    `AI SCORE: ${input.aiScore}`,
    `AI FEEDBACK TO EVALUATE: ${input.feedback}`,
    "",
    `Return exactly this JSON structure: ${track === "correct" ? trackAFormat : trackBFormat}`,
  ].join("\n");

  const res = await callCompareLlm({
    provider: input.judge.provider,
    modelId: input.judge.modelId,
    temperature: 0,
    jsonMode: true,
    messages: [
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });
  const parsed = parseJsonObject(res.text);
  const latencyMs = Date.now() - t0;

  const rationale =
    typeof parsed.rationale === "string" && parsed.rationale.trim()
      ? parsed.rationale.trim()
      : "No rationale returned.";

  if (track === "correct") {
    return {
      track: "correct",
      confirmation_clarity: normalizeScore(parsed.confirmation_clarity),
      scope_control: normalizeScore(parsed.scope_control),
      task_focus: null,
      specificity: null,
      manageability: null,
      answer_leakage: null,
      overall_quality: normalizeScore(parsed.overall_quality),
      rationale,
      latencyMs,
    };
  }

  return {
    track: "incorrect",
    confirmation_clarity: null,
    scope_control: null,
    task_focus: normalizeScore(parsed.task_focus),
    specificity: normalizeScore(parsed.specificity),
    manageability: normalizeScore(parsed.manageability),
    answer_leakage: normalizeScore(parsed.answer_leakage),
    overall_quality: normalizeScore(parsed.overall_quality),
    rationale,
    latencyMs,
  };
}
