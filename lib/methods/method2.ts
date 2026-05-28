/**
 * lib/methods/method2.ts
 *
 * Method 2: Two-Stage GPT-4o Grading
 *
 * Stage 1 — Scoring: score all three parts simultaneously using a binary
 *   concept-presence test with failure-type classification.
 * Stage 2 — Feedback: generate per-part feedback and an optional CER
 *   coaching note driven by the Stage 1 scores and failure types.
 *
 * Both calls use response_format: { type: "json_object" } and temperature 0.
 * tokenCount and latencyMs span the combined duration of both calls.
 */

import OpenAI from "openai";
import { QUESTION_MAP } from "@/app/lib/questions";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Internal stage types ──────────────────────────────────────────────────────

interface Stage1PartResult {
  score: 0 | 1;
  failure_type: string | null;
}

interface Stage1Response {
  parts: Partial<Record<"A" | "B" | "C", Stage1PartResult>>;
  total_score: number;
}

interface Stage2Response {
  feedback: Partial<Record<"A" | "B" | "C", string>>;
  cer_note: string | null;
}

// ── Public result type ────────────────────────────────────────────────────────

export interface Method2Result {
  scores: { A: number; B: number; C: number };
  feedback: { A: string; B: string; C: string };
  cerNote: string | null;
  tokenCount: number;
  latencyMs: number;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function gradeWithMethod2(
  questionId: string,
  responses: { A: string; B: string; C: string }
): Promise<Method2Result> {
  const question = QUESTION_MAP[questionId];
  if (!question) throw new Error(`Unknown questionId: ${questionId}`);

  const getPart = (label: "A" | "B" | "C") =>
    question.parts.find((p) => p.label === label);

  const partA = getPart("A");
  const partB = getPart("B");
  const partC = getPart("C");

  const t0 = Date.now();
  let totalTokens = 0;

  // ── Stage 1: Scoring ──────────────────────────────────────────────────────

  const stage1System = [
    "You are a scoring engine for Pennsylvania Keystone Biology",
    "constructed-response questions. You score student responses",
    "using item-specific scoring rubrics.",
    "",
    "YOUR ONLY JOB:",
    "Determine whether each part of a student response satisfies",
    "its scoring criterion. Output a structured JSON score object only.",
    "Do not address the student. Do not provide feedback.",
    "Do not explain your reasoning in prose.",
    "",
    "THE CORE SCORING TEST:",
    "Ask exactly one question for each part:",
    '"Is the correct biological concept present in this response?"',
    "YES → score: 1",
    "NO  → score: 0",
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
    "Assign exactly one failure_type per zero-scored part:",
    '- "wrong_concept": student names a biologically incorrect concept',
    '- "vague": response contains no identifiable biological concept',
    '- "off_task": true biological fact but does not answer what was asked',
    '- "circular": response uses the conclusion as the reason',
    '- "copied_question": rephrases the question without adding biology',
    "",
    "SCORING IS ADDITIVE AND INDEPENDENT:",
    "Each part is worth exactly 1 point. Parts are scored independently.",
    "Total score = sum of parts earned (maximum 3).",
    "",
    "Output JSON only, no markdown:",
    '{"parts":{"A":{"score":0,"failure_type":null},"B":{"score":0,"failure_type":null},"C":{"score":0,"failure_type":null}},"total_score":0}',
  ].join("\n");

  const stage1User = [
    `Question stimulus: ${question.stem}`,
    "",
    `Part A prompt: ${partA?.prompt ?? "(not present)"}`,
    `Part B prompt: ${partB?.prompt ?? "(not present)"}`,
    `Part C prompt: ${partC?.prompt ?? "(not present)"}`,
    "",
    "Rubrics:",
    `Part A concept: ${partA?.scoringGuidance ?? "(not present)"}`,
    `Part B concept: ${partB?.scoringGuidance ?? "(not present)"}`,
    `Part C concept: ${partC?.scoringGuidance ?? "(not present)"}`,
    "",
    "Student responses:",
    `Part A: ${responses.A.trim() || "(no response)"}`,
    `Part B: ${responses.B.trim() || "(no response)"}`,
    `Part C: ${responses.C.trim() || "(no response)"}`,
  ].join("\n");

  const stage1Completion = await client.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: stage1System },
      { role: "user", content: stage1User },
    ],
  });

  totalTokens += stage1Completion.usage?.total_tokens ?? 0;

  const stage1Raw = stage1Completion.choices[0].message.content ?? "{}";
  const stage1 = JSON.parse(stage1Raw) as Stage1Response;

  // ── Stage 2: Feedback ─────────────────────────────────────────────────────

  const stage2System = [
    "You are a biology tutoring feedback agent for Keystone Biology",
    "constructed-response questions. Generate feedback for each",
    "scored part based on the failure type.",
    "",
    "FEEDBACK RULES BY FAILURE TYPE:",
    "",
    "Score 1: Write one sentence confirming what the student got right.",
    "Be specific — name what they said that earned the point.",
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
    "CER COACHING LAYER:",
    "Add a CER coaching note ONLY when total_score is 0 or 1.",
    "Do NOT add it when total_score is 2 or 3.",
    "The coaching note addresses the weakest CER component across",
    "the full response.",
    "",
    'No claim present: "Across your response, try starting each part',
    'by directly stating your answer before explaining it."',
    'Claim but no evidence: "You are making claims, but try connecting',
    'them to a specific biological fact, named structure, or data point."',
    'Claim and evidence but no reasoning: "You have identified what',
    'happens — now explain why, using a biological mechanism."',
    "",
    "FEEDBACK LENGTH: Maximum 2 sentences per part.",
    "",
    "Output JSON only, no markdown:",
    '{"feedback":{"A":"feedback string","B":"feedback string","C":"feedback string"},"cer_note":"coaching note string or null"}',
  ].join("\n");

  const stage2User = [
    `Question stimulus: ${question.stem}`,
    "",
    `Part A prompt: ${partA?.prompt ?? "(not present)"}`,
    `Part B prompt: ${partB?.prompt ?? "(not present)"}`,
    `Part C prompt: ${partC?.prompt ?? "(not present)"}`,
    "",
    "Student responses:",
    `Part A: ${responses.A.trim() || "(no response)"}`,
    `Part B: ${responses.B.trim() || "(no response)"}`,
    `Part C: ${responses.C.trim() || "(no response)"}`,
    "",
    "Scores:",
    JSON.stringify(stage1, null, 2),
  ].join("\n");

  const stage2Completion = await client.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: stage2System },
      { role: "user", content: stage2User },
    ],
  });

  totalTokens += stage2Completion.usage?.total_tokens ?? 0;

  const stage2Raw = stage2Completion.choices[0].message.content ?? "{}";
  const stage2 = JSON.parse(stage2Raw) as Stage2Response;

  const latencyMs = Date.now() - t0;

  return {
    scores: {
      A: stage1.parts?.A?.score ?? 0,
      B: stage1.parts?.B?.score ?? 0,
      C: stage1.parts?.C?.score ?? 0,
    },
    feedback: {
      A: stage2.feedback?.A ?? "No feedback returned.",
      B: stage2.feedback?.B ?? "No feedback returned.",
      C: stage2.feedback?.C ?? "No feedback returned.",
    },
    cerNote: stage2.cer_note ?? null,
    tokenCount: totalTokens,
    latencyMs,
  };
}
