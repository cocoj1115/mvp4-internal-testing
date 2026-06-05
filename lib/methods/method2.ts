/**
 * lib/methods/method2.ts
 *
 * Method 2: Two-Stage LLM Grading
 *
 * Stage 1 — Scoring: score a single part using the item-specific rubric and
 * classify fully incorrect responses by failure type.
 * Stage 2 — Feedback: generate feedback for that same part based on the
 * Stage 1 score and failure type.
 *
 * Both calls use response_format: { type: "json_object" } and temperature 0.
 * tokenCount and latencyMs span the combined duration of both calls.
 */

import { chatComplete } from "@/lib/llm";
import { QUESTION_MAP, PartLabel } from "@/app/lib/questions";

// ── Internal stage types ──────────────────────────────────────────────────────

interface Stage1Response {
  score: number;
  failure_type: string | null;
}

interface Stage2Response {
  feedback: string;
}

// ── Public result type ────────────────────────────────────────────────────────

export interface Method2Result {
  score: number;
  feedback: string;
  tokenCount: number;
  latencyMs: number;
}

function normalizeScore(value: unknown, maxScore: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maxScore, Math.round(value)));
}

function extractFeedbackText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map(extractFeedbackText)
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(" ") : null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferredKeys = [
      "feedback",
      "student_feedback",
      "message",
      "text",
      "hint",
      "cue",
      "guiding_question",
      "next_step",
    ];

    for (const key of preferredKeys) {
      const text = extractFeedbackText(record[key]);
      if (text) return text;
    }

    const parts = Object.values(record)
      .map(extractFeedbackText)
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(" ") : null;
  }

  return null;
}

function normalizeFeedback(value: unknown): string {
  return extractFeedbackText(value) ?? "No feedback returned.";
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function gradeWithMethod2(
  questionId: string,
  partLabel: PartLabel,
  response: string,
  model: string,
  temperature?: number
): Promise<Method2Result> {
  const question = QUESTION_MAP[questionId];
  if (!question) throw new Error(`Unknown questionId: ${questionId}`);

  const part = question.parts.find((p) => p.label === partLabel);
  if (!part) throw new Error(`Unknown partLabel: ${partLabel}`);

  const t0 = Date.now();
  let totalTokens = 0;

  // ── Stage 1: Scoring ──────────────────────────────────────────────────────

  const stage1System = [
    "You are a scoring engine for Pennsylvania Keystone Biology",
    "constructed-response questions. You score student responses",
    "using item-specific scoring rubrics.",
    "",
    "YOUR ONLY JOB:",
    "Determine how many points the student's response earns for one",
    "part. Output a structured JSON score object only.",
    "Do not address the student. Do not provide feedback.",
    "Do not explain your reasoning in prose.",
    "",
    "THE CORE SCORING TEST:",
    "Ask exactly one question:",
    '"Is the correct biological concept present in this response?"',
    `Award an integer score from 0 to ${part.maxScore}.`,
    "",
    "The rubric's concept field defines what correct means.",
    "The student does not need exact wording or technical terms.",
    "Any accurate biological path to the same concept earns credit,",
    "including plain language descriptions.",
    "",
    "CEILING RULE:",
    "The concept field sets the ceiling, not the floor.",
    "Do NOT require scientific terminology if plain language conveys",
    "the same concept. Do NOT require multi-step explanations if the",
    "concept is stated simply. Do NOT require mechanisms the concept",
    "field does not mention. A short correct answer earns the same",
    "credit as a long one.",
    "",
    "PLAIN LANGUAGE RULE:",
    "Students are 9th-10th graders writing under timed conditions.",
    "Accept plain language equivalents of any concept the rubric lists.",
    "",
    "WHAT DOES NOT DISQUALIFY A RESPONSE:",
    "Spelling errors, grammar errors, plain language instead of",
    "scientific terminology, incomplete elaboration when the concept",
    "is present, brief responses when the concept is correct,",
    "circular phrasing when the correct concept is identifiable,",
    "additional incorrect information alongside a correct concept.",
    "",
    "FAILURE CLASSIFICATION (required when score is 0):",
    "Assign exactly one failure_type when score is 0:",
    '- "wrong_concept": student names a biologically incorrect concept',
    '- "vague": response contains no identifiable biological concept',
    '- "off_task": true biological fact but does not answer what was asked',
    '- "circular": response uses the conclusion as the reason',
    '- "copied_question": rephrases the question without adding biology',
    "",
    "SCORING RULE:",
    part.maxScore > 1
      ? `This part is worth ${part.maxScore} points. Award intermediate credit when the response addresses some, but not all, distinct scorable elements.`
      : "This part is worth exactly 1 point.",
    "",
    "Output JSON only, no markdown:",
    '{"score":0,"failure_type":null}',
  ].join("\n");

  const stage1User = [
    `Question stimulus: ${question.stem}`,
    "",
    `Part ${partLabel} prompt: ${part.prompt}`,
    "",
    "Rubric:",
    part.scoringGuidance,
    "",
    "Student response:",
    response.trim() || "(no response)",
  ].join("\n");

  const stage1Completion = await chatComplete({
    model,
    temperature,
    jsonMode: true,
    messages: [
      { role: "system", content: stage1System },
      { role: "user", content: stage1User },
    ],
  });

  totalTokens += stage1Completion.tokenCount;

  const stage1Raw = stage1Completion.content ?? "{}";
  const stage1 = JSON.parse(stage1Raw) as Stage1Response;

  // ── Stage 2: Feedback ─────────────────────────────────────────────────────

  const stage2System = [
    "You are a biology tutoring feedback agent for Keystone Biology",
    "constructed-response questions. Generate feedback for one",
    "scored part based on the score and failure type.",
    "",
    "FEEDBACK RULES BY FAILURE TYPE:",
    "",
    `Full credit (${part.maxScore}/${part.maxScore}): Write one sentence confirming what the student got right.`,
    "Be specific — name what they said that earned the point.",
    "",
    "Partial credit (score > 0 but not full credit):",
    "State what the student got right, then name the missing idea",
    "needed for full credit.",
    "",
    "Score 0 — wrong_concept:",
    "Name what the student said. State it is not the right concept",
    "for this question. Redirect without giving the answer.",
    'Template: "Your response mentions [what student said], but this',
    "part is asking about [correct territory]. Think about",
    '[orienting question pointing toward the concept]."',
    "",
    "Score 0 — vague:",
    "Acknowledge any direction if present. Ask one specific",
    "follow-up question pushing one level deeper toward naming",
    "a mechanism or structure.",
    'Template: "Your response does not name a specific biological',
    "process or mechanism. What specifically [mechanism-level",
    '[question about the topic]?"',
    "",
    "Score 0 — off_task:",
    "Name what their response describes. Clarify what the question",
    "is actually asking.",
    'Template: "Your response describes [what they wrote], which is',
    "accurate about [topic] — but this part is asking [what was",
    'actually asked]. Try focusing on [what kind of answer is needed]."',
    "",
    "Score 0 — circular:",
    "Tell the student their response uses the conclusion as the reason.",
    "Ask them to identify the underlying biological mechanism.",
    'Template: "Your response restates the outcome rather than',
    "explaining the biology behind it. Why does [concept from",
    'their response] happen at the molecular/cellular/organismal level?"',
    "",
    "Score 0 — copied_question:",
    "Tell the student they rephrased the question without adding",
    "biology. Ask them to explain the underlying science.",
    "",
    "FEEDBACK LENGTH: Maximum 2 sentences per part.",
    "",
    "JSON contract: feedback must be one single student-facing string, not an object, array, list, or nested field.",
    "",
    "Output JSON only, no markdown:",
    '{"feedback":"feedback string"}',
  ].join("\n");

  const stage2User = [
    `Question stimulus: ${question.stem}`,
    "",
    `Part ${partLabel} prompt: ${part.prompt}`,
    "",
    "Rubric:",
    part.scoringGuidance,
    "",
    "Student response:",
    response.trim() || "(no response)",
    "",
    "Scoring result:",
    JSON.stringify(stage1, null, 2),
  ].join("\n");

  const stage2Completion = await chatComplete({
    model,
    temperature,
    jsonMode: true,
    messages: [
      { role: "system", content: stage2System },
      { role: "user", content: stage2User },
    ],
  });

  totalTokens += stage2Completion.tokenCount;

  const stage2Raw = stage2Completion.content ?? "{}";
  const stage2 = JSON.parse(stage2Raw) as Stage2Response;

  const latencyMs = Date.now() - t0;

  return {
    score: normalizeScore(stage1.score, part.maxScore),
    feedback: normalizeFeedback(stage2.feedback),
    tokenCount: totalTokens,
    latencyMs,
  };
}
