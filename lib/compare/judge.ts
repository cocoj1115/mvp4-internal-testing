import { PartLabel, QUESTION_MAP } from "@/app/lib/questions";
import { callCompareLlm } from "@/lib/compare/llm";
import { CompareJudgeConfig, JudgeScores } from "@/lib/compare/types";

interface JudgeInput {
  questionId: "M1Q14";
  part: PartLabel;
  studentResponse: string;
  feedback: string;
  judge: CompareJudgeConfig;
}

export interface JudgeResult extends JudgeScores {
  latencyMs: number;
}

const JUDGE_SYSTEM_PROMPT = `You are an expert evaluator of formative feedback in science 
education. You will receive a student response to a biology 
question and the AI-generated feedback that followed.

Score the feedback on five dimensions using the rubrics below.
Be strict — a score of 4 should be rare and genuinely excellent.

Return ONLY valid JSON. No markdown. No explanation outside 
the rationale field.

Five Evaluation Dimensions

1. task_focus
Does the feedback address the task, not the learner?
1 = Uses personal or evaluative language ("you don't understand", "you failed to")
2 = Mostly task-focused but contains one evaluative phrase
3 = Task-focused throughout, no personal framing
4 = Addresses specific task features with zero personal language

2. specificity
Does the feedback name the exact missing reasoning step?
1 = Generic or vague — no missing step named ("try again", "think harder")
2 = Names a general concept but not the specific gap
3 = Names the missing step but without clear connection to what the student wrote
4 = Names the exact missing reasoning step and links it clearly to the student's response

3. manageability
Is the feedback focused on one thing?
1 = Addresses multiple gaps or provides a mini-lesson
2 = Addresses two issues, one is primary
3 = Focuses on one gap but includes one unnecessary add-on
4 = One clear focused revision target, nothing extra

4. answer_leakage
Does the feedback preserve productive struggle?
1 = Directly states the correct answer or key term
2 = Implies the answer strongly through leading questions
3 = Guides without revealing — one hint is slightly too direct
4 = Full productive struggle preserved — student must still reason to the answer

5. overall_quality
Holistic alignment with formative feedback principles.
1 = Unhelpful — likely to confuse or discourage
2 = Partially helpful — student may benefit with effort
3 = Helpful and likely to support revision
4 = Highly effective — specific, actionable, task-focused, struggle-preserving`;

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

  const t0 = Date.now();
  const userPrompt = [
    `QUESTION PART: ${input.part}`,
    `QUESTION PROMPT: ${part.prompt}`,
    `STUDENT RESPONSE: ${input.studentResponse}`,
    `AI FEEDBACK TO EVALUATE: ${input.feedback}`,
    "",
    "Return exactly this JSON structure:",
    '{"task_focus":1,"specificity":1,"manageability":1,"answer_leakage":1,"overall_quality":1,"rationale":"one sentence identifying the single biggest weakness in this feedback"}',
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

  return {
    task_focus: normalizeScore(parsed.task_focus),
    specificity: normalizeScore(parsed.specificity),
    manageability: normalizeScore(parsed.manageability),
    answer_leakage: normalizeScore(parsed.answer_leakage),
    overall_quality: normalizeScore(parsed.overall_quality),
    rationale:
      typeof parsed.rationale === "string" && parsed.rationale.trim()
        ? parsed.rationale.trim()
        : "No rationale returned.",
    latencyMs: Date.now() - t0,
  };
}
