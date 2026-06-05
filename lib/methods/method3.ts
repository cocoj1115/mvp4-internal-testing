/**
 * lib/methods/method3.ts
 *
 * Method 3: Error-aware feedback-first grading with boundary examples.
 *
 * The prompt uses the shared item-specific scoringGuidance as the scoring
 * authority, adds a small number of Keystone sampler boundary examples, then
 * forces this order: error analysis -> feedback -> score.
 */

import { PartLabel, QUESTION_MAP } from "@/app/lib/questions";
import { chatComplete } from "@/lib/llm";

type Confidence = "high" | "medium" | "low";

interface Method3RawResponse {
  error_analysis?: {
    conceptual_errors?: unknown;
    reasoning_gaps?: unknown;
    surface_errors?: unknown;
    off_task_or_vague?: unknown;
  };
  feedback?: unknown;
  student_feedback?: unknown;
  formative_feedback?: unknown;
  feedback_message?: unknown;
  message?: unknown;
  hint?: unknown;
  guiding_question?: unknown;
  next_step?: unknown;
  score?: unknown;
  confidence?: unknown;
}

export interface Method3Result {
  score: number;
  feedback: string;
  confidence: Confidence;
  tokenCount: number;
  latencyMs: number;
}

interface BoundaryExample {
  credited: string;
  notCredited: string;
  boundary: string;
}

const BOUNDARY_EXAMPLES: Record<string, Partial<Record<PartLabel, BoundaryExample[]>>> = {
  M1Q14: {
    A: [
      {
        credited: "The substance in the cell that determines the order of amino acids is DNA.",
        notCredited: "The substance that determines the order of amino acids is carboxylic.",
        boundary:
          "Credit identifies DNA or DNA-derived mRNA as the source of amino acid order; do not credit unrelated molecules or vague cell parts.",
      },
    ],
    B: [
      {
        credited:
          "The order dictates the folding pattern of the protein, which changes its shape and function.",
        notCredited:
          "The amino acid sequence affects the structure because however the sequence is determines the structure.",
        boundary:
          "Credit requires a real structural mechanism such as folding or 3-D shape; a circular restatement is not enough.",
      },
    ],
    C: [
      {
        credited:
          "Each protein serves a different unique function in the body, such as cell signaling and metabolism.",
        notCredited:
          "Different parts of the cell need different proteins.",
        boundary:
          "Credit connects protein variety to specific different functions; do not credit a vague need for different proteins without explaining functional diversity.",
      },
    ],
  },
  M1Q15: {
    A: [
      {
        credited: "The pupils are reacting to the amount of light that is available.",
        notCredited:
          "The lights changed quickly and the eyes did not adjust yet.",
        boundary:
          "Credit identifies the change in light as the stimulus; do not credit timing alone without connecting the eye change to light level.",
      },
    ],
    B: [
      {
        credited:
          "The room was dim so there could be a change and a difference when the bright light was turned on.",
        notCredited: "To show how the eyes are sensitive.",
        boundary:
          "Credit establishes an adjusted starting condition or comparison point; do not credit a generic statement about eye sensitivity.",
      },
    ],
    C: [
      {
        credited:
          "With less light, the pupils dilate and become larger to let in more light.",
        notCredited: "The eye would have to adjust between the dimness of the lights.",
        boundary:
          "Credit names the compensating response to dim light, especially pupil dilation; do not credit generic adjustment without the response.",
      },
    ],
  },
  M2Q14: {
    A: [
      {
        credited:
          "They can breed different-colored bearded dragons together to create a new color.",
        notCredited: "The bearded dragons have different amounts of melanin.",
        boundary:
          "Credit describes selective breeding or crossing; do not credit only naming color variation or pigment differences.",
      },
    ],
    B: [
      {
        credited:
          "Parents pass down genes and DNA to offspring, and the inherited traits affect color.",
        notCredited:
          "Dominant and non-dominant colors mix and create different colored offspring.",
        boundary:
          "Credit connects inherited parental DNA/genes/alleles to offspring traits; do not credit vague color mixing without DNA inheritance.",
      },
    ],
    C: [
      {
        credited:
          "Breed two dragons with recessive traits so the offspring express those recessive traits.",
        notCredited:
          "Use the recessive trait with dominant traits because it will create many different colored offspring.",
        boundary:
          "Credit requires both parents to contribute the recessive allele; do not credit crossing recessive with dominant without that inheritance logic.",
      },
    ],
  },
  M2Q15: {
    A: [
      {
        credited:
          "It would help more plants grow so animals would have more food and oxygen.",
        notCredited:
          "The plants could die, or the green infrastructure could affect plant growth, which is not good.",
        boundary:
          "Credit a clear ecosystem benefit; do not credit harm, speculation, or a benefit that is not actually beneficial.",
      },
    ],
    B: [
      {
        credited:
          "Measure stormwater volume before and after installation, and count flower numbers in the community.",
        notCredited:
          "Do an experiment somewhere isolated and a large experiment on a whole town.",
        boundary:
          "Credit concrete measurable indicators; do not credit vague experiment descriptions without a measurable outcome.",
      },
      {
        credited:
          "Measure how much water remains on the ground after storms.",
        notCredited:
          "Measure how much water is still on the ground and how much water is absorbed.",
        boundary:
          "For a two-point part, repeated versions of the same measurement earn only one distinct point.",
      },
    ],
  },
};

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

function normalizeMethod3Feedback(
  parsed: Method3RawResponse,
  score: number,
  maxScore: number
): string {
  const direct = extractFeedbackText(parsed.feedback);
  if (direct) return direct;

  const alternateKeys: Array<keyof Method3RawResponse> = [
    "student_feedback",
    "formative_feedback",
    "feedback_message",
    "message",
    "hint",
    "guiding_question",
    "next_step",
  ];

  for (const key of alternateKeys) {
    const text = extractFeedbackText(parsed[key]);
    if (text) return text;
  }

  return score >= maxScore
    ? "Your response addresses the main biological idea for this part. Check that your wording clearly connects your idea to the prompt."
    : "Your response needs a clearer connection to the biological idea this part is asking about. Reread the prompt and revise by explaining the relevant relationship, function, or mechanism.";
}

function normalizeConfidence(value: unknown): Confidence {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : "medium";
}

function formatBoundaryExamples(examples: BoundaryExample[]) {
  if (examples.length === 0) return "(No boundary examples available for this part.)";

  return examples
    .map(
      (example, index) =>
        [
          `Boundary Pair ${index + 1}`,
          `Credited response: "${example.credited}"`,
          `Not credited response: "${example.notCredited}"`,
          `Boundary rule: ${example.boundary}`,
        ].join("\n")
    )
    .join("\n\n");
}

export async function gradeWithMethod3(
  questionId: string,
  partLabel: PartLabel,
  studentResponse: string,
  model: string,
  temperature?: number
): Promise<Method3Result> {
  const question = QUESTION_MAP[questionId];
  if (!question) throw new Error(`Unknown questionId: ${questionId}`);

  const part = question.parts.find((p) => p.label === partLabel);
  if (!part) throw new Error(`Unknown partLabel: ${partLabel}`);

  const t0 = Date.now();
  const boundaryExamples = BOUNDARY_EXAMPLES[questionId]?.[partLabel] ?? [];

  const systemPrompt = [
    "You are an expert Keystone Biology constructed-response grader.",
    "Use the item-specific rubric as the sole scoring authority.",
    "Boundary examples illustrate how to apply the rubric; they do not override it.",
    "Surface errors such as spelling, grammar, and minor wording issues must not affect the score unless they prevent meaning.",
    "",
    "Your output order is mandatory:",
    "1. error_analysis",
    "2. feedback",
    "3. score",
    "4. confidence",
    "",
    "Error analysis rules:",
    "- conceptual_errors: biological misconceptions or incorrect concepts that affect score.",
    "- reasoning_gaps: missing links, mechanisms, or required details that affect score.",
    "- surface_errors: spelling, grammar, or wording issues that do not affect score.",
    "- off_task_or_vague: responses that are too vague or do not answer the prompt.",
    "",
    "Feedback rules:",
    "- Write 1-3 student-facing sentences.",
    "- Keep feedback task-focused, specific to the student's response, and non-judgmental.",
    "- Prioritize elaborated feedback: briefly explain why the current response is or is not sufficient, rather than only saying whether it is right or wrong.",
    "- Address three formative questions implicitly: what the prompt is asking, how the student's response currently matches or misses it, and what kind of revision move to try next.",
    "- If the response has a useful partial idea, name that idea briefly; do not add generic praise.",
    "- Do not comment on the student's ability, effort, intelligence, confidence, or personality.",
    "- If the response is not full credit, do NOT give away the exact missing answer, correct term, or full solution.",
    "- Instead, provide one actionable next step: compare two ideas, connect cause to effect, identify a function, specify a mechanism, or check whether the response answers the exact prompt.",
    "- Use at most one guiding question. It should be specific enough to guide revision but should not contain the answer.",
    "- For a conceptual error, point out the mismatch without naming the correct concept outright.",
    "- For a reasoning gap, ask for the missing relationship, mechanism, evidence, or comparison rather than supplying it.",
    "- For an off-task or vague response, redirect the student to what the prompt is asking them to explain.",
    "- Do not reveal rubric text, boundary example labels, scores, or internal analysis categories.",
    "- JSON contract: feedback must be one single student-facing string, not an object, array, list, or nested field.",
    "",
    `Score must be an integer from 0 to ${part.maxScore}.`,
    "",
    "Respond with ONLY valid JSON and no markdown:",
    '{"error_analysis":{"conceptual_errors":[],"reasoning_gaps":[],"surface_errors":[],"off_task_or_vague":[]},"feedback":"feedback string","score":0,"confidence":"high|medium|low"}',
  ].join("\n");

  const userPrompt = [
    `Question stimulus:\n${question.stem}`,
    "",
    `Part ${partLabel} prompt (${part.maxScore} point${part.maxScore > 1 ? "s" : ""}):\n${part.prompt}`,
    "",
    `Item-specific rubric:\n${part.scoringGuidance}`,
    "",
    `Boundary examples from the Keystone sampler:\n${formatBoundaryExamples(boundaryExamples)}`,
    "",
    `Student response:\n${studentResponse.trim() || "(no response)"}`,
  ].join("\n");

  const completion = await chatComplete({
    model,
    temperature,
    jsonMode: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = completion.content ?? "{}";
  const parsed = JSON.parse(raw) as Method3RawResponse;
  const score = normalizeScore(parsed.score, part.maxScore);
  const feedback = normalizeMethod3Feedback(parsed, score, part.maxScore);

  if (!extractFeedbackText(parsed.feedback)) {
    console.warn("[method3] Feedback was missing or not a direct string.", {
      questionId,
      partLabel,
      model,
      responseKeys: Object.keys(parsed),
      raw: raw.slice(0, 800),
    });
  }

  return {
    score,
    feedback,
    confidence: normalizeConfidence(parsed.confidence),
    tokenCount: completion.tokenCount,
    latencyMs: Date.now() - t0,
  };
}
