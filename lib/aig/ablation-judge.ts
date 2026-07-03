import { callCompareLlm } from "@/lib/compare/llm";
import type { CompareJudgeConfig } from "@/lib/compare/types";
import type { Blueprint, GeneratedItem } from "@/lib/aig/types";

export const ABLATION_DIMENSIONS = [
  { id: 1, key: "kc_standard_alignment", label: "KC / Standard Alignment", weight: 15 },
  { id: 2, key: "scientific_accuracy", label: "Scientific Accuracy", weight: 15 },
  { id: 3, key: "cognitive_demand_task_type_fit", label: "Cognitive Demand & Task-Type Fit", weight: 10 },
  { id: 4, key: "relevance_context_grounding", label: "Relevance / Context Grounding", weight: 8 },
  { id: 5, key: "appropriateness_accessibility", label: "Appropriateness & Accessibility", weight: 7 },
  { id: 6, key: "stimulus_data_quality", label: "Stimulus / Data Quality", weight: 10 },
  { id: 7, key: "answerability_evidence_sufficiency", label: "Answerability & Evidence Sufficiency", weight: 10 },
  { id: 8, key: "multi_part_coherence", label: "Multi-Part Coherence", weight: 5 },
  { id: 9, key: "clarity_grammaticality", label: "Clarity & Grammaticality", weight: 5 },
  { id: 10, key: "rubric_alignment_scorability", label: "Rubric Alignment & Scorability", weight: 10 },
  { id: 11, key: "annotated_response_quality", label: "Annotated Response Quality", weight: 3 },
  { id: 12, key: "novelty_non_duplication", label: "Novelty / Non-Duplication", weight: 2 },
] as const;

export type AblationDimensionKey = (typeof ABLATION_DIMENSIONS)[number]["key"];

export type AblationHardGateKey =
  | "scientific_accuracy"
  | "kc_steels_alignment"
  | "answerability"
  | "no_answer_leakage";

export interface AblationGateResult {
  pass: boolean;
  rationale: string;
}

export interface AblationDimensionScore {
  score: number;
  rationale: string;
}

export interface AblationJudgeResult {
  hard_gates: Record<AblationHardGateKey, AblationGateResult>;
  dimension_scores: Record<AblationDimensionKey, AblationDimensionScore>;
  weighted_score: number;
  hard_gates_pass: boolean;
  decision: "Ready for SME review / pilot" | "Minor revision" | "Major revision" | "Reject or regenerate";
  rationale: string;
  latencyMs: number;
}

interface JudgeInput {
  standardCode: string;
  standardStatement: string;
  coreKC: string;
  item: GeneratedItem;
  blueprint?: Blueprint;
  configLabel: string;
  judge: CompareJudgeConfig;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function clampScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Judge score must be a number, got ${String(value)}`);
  }
  return Math.max(1, Math.min(5, Math.round(value)));
}

function normalizeRationale(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Judge rationale must be a non-empty string.");
  }
  return value.trim();
}

function normalizeGate(value: unknown): AblationGateResult {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (typeof record.pass !== "boolean") {
    throw new Error("Judge hard gate pass value must be boolean.");
  }
  return {
    pass: record.pass,
    rationale: normalizeRationale(record.rationale),
  };
}

function normalizeDimension(value: unknown): AblationDimensionScore {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    score: clampScore(record.score),
    rationale: normalizeRationale(record.rationale),
  };
}

function validateParsedJudgeObject(parsed: Record<string, unknown> | null): Record<string, unknown> {
  if (!parsed) throw new Error("Judge returned invalid JSON.");
  if (!parsed.hard_gates || typeof parsed.hard_gates !== "object") {
    throw new Error("Judge JSON missing hard_gates.");
  }
  if (!parsed.dimension_scores || typeof parsed.dimension_scores !== "object") {
    throw new Error("Judge JSON missing dimension_scores.");
  }
  if (typeof parsed.rationale !== "string" || !parsed.rationale.trim()) {
    throw new Error("Judge JSON missing top-level rationale.");
  }

  const rawGates = parsed.hard_gates as Record<string, unknown>;
  for (const key of ["scientific_accuracy", "kc_steels_alignment", "answerability", "no_answer_leakage"]) {
    if (!rawGates[key]) throw new Error(`Judge JSON missing hard gate: ${key}`);
  }

  const rawDimensions = parsed.dimension_scores as Record<string, unknown>;
  for (const dimension of ABLATION_DIMENSIONS) {
    if (!rawDimensions[dimension.key]) {
      throw new Error(`Judge JSON missing dimension score: ${dimension.key}`);
    }
  }

  return parsed;
}

export function computeWeightedScore(
  scores: Record<AblationDimensionKey, AblationDimensionScore>
): number {
  const total = ABLATION_DIMENSIONS.reduce((sum, dimension) => {
    return sum + scores[dimension.key].score * dimension.weight;
  }, 0);
  return Number((total / 5).toFixed(2));
}

export function computeDecision(
  weightedScore: number,
  hardGatesPass: boolean
): AblationJudgeResult["decision"] {
  if (!hardGatesPass || weightedScore < 70) return "Reject or regenerate";
  if (weightedScore < 80) return "Major revision";
  if (weightedScore < 90) return "Minor revision";
  return "Ready for SME review / pilot";
}

function itemForJudge(item: GeneratedItem): GeneratedItem {
  if (!item.stimulus_asset.image_b64) return item;
  return {
    ...item,
    stimulus_asset: {
      ...item.stimulus_asset,
      image_b64: undefined,
    },
  };
}

function stimulusRenderingStatus(item: GeneratedItem): Record<string, unknown> {
  const asset = item.stimulus_asset;
  return {
    type: asset.type,
    title: asset.title,
    has_rendered_image: Boolean(asset.image_b64),
    image_b64_omitted_from_judge_prompt: Boolean(asset.image_b64),
    image_generation_error: asset.image_generation_error ?? null,
    has_text_stimulus_data: Boolean(
      asset.table_markdown ||
      asset.chart_data ||
      asset.diagram_spec ||
      asset.scenario_text ||
      asset.illustration_prompt
    ),
  };
}

const JUDGE_SYSTEM = [
  "You are an expert Pennsylvania Keystone Biology item-quality judge.",
  "Evaluate generated constructed-response assessment items for item bank readiness.",
  "Be strict. A score of 5 means SME-review ready for that dimension, not merely acceptable.",
  "For cognitive demand, 5 means matches the target difficulty; harder is not better.",
  "For illustration items, image_b64 may be intentionally omitted from the text prompt. If has_rendered_image=true and image_generation_error is null, do not penalize the item as missing a rendered asset. Evaluate the available stimulus specification and note any remaining visual-review uncertainty.",
  "Return only valid JSON. No markdown.",
].join("\n");

export async function judgeAblationItem(input: JudgeInput): Promise<AblationJudgeResult> {
  const t0 = Date.now();
  const schema = {
    hard_gates: {
      scientific_accuracy: { pass: true, rationale: "short reason" },
      kc_steels_alignment: { pass: true, rationale: "short reason" },
      answerability: { pass: true, rationale: "short reason" },
      no_answer_leakage: { pass: true, rationale: "short reason" },
    },
    dimension_scores: Object.fromEntries(
      ABLATION_DIMENSIONS.map((dimension) => [
        dimension.key,
        { score: 3, rationale: `short reason for ${dimension.label}` },
      ])
    ),
    rationale: "one-paragraph summary of the most important quality issue",
  };

  const user = [
    "Evaluate the generated item against the hard gates and weighted matrix.",
    "",
    "SCORING SCALE:",
    "1 = severe flaw, unusable",
    "2 = multiple problems, major rework needed",
    "3 = usable, but needs clear revision",
    "4 = high quality, minor revision only",
    "5 = in question/bank SME-review ready",
    "",
    "HARD GATES:",
    "- scientific_accuracy: no factual or mechanism errors in stem, stimulus, data, or expected answers",
    "- kc_steels_alignment: actually measures the target KC/standard, not just topic-related",
    "- answerability: student can form a reasonable answer from the item, materials, and expected course knowledge",
    "- no_answer_leakage: no later part, label, or stem reveals an earlier answer",
    "",
    "DIMENSIONS:",
    ...ABLATION_DIMENSIONS.map((dimension) => `${dimension.id}. ${dimension.label} (weight ${dimension.weight})`),
    "",
    "TARGET:",
    `Config: ${input.configLabel}`,
    `Standard: ${input.standardCode}`,
    `Standard statement: ${input.standardStatement}`,
    `Core KC: ${input.coreKC}`,
    "",
    "BLUEPRINT:",
    input.blueprint ? JSON.stringify(input.blueprint, null, 2) : "(No separate blueprint)",
    "",
    "STIMULUS RENDERING STATUS:",
    JSON.stringify(stimulusRenderingStatus(input.item), null, 2),
    "",
    "Important: the generated item below includes the stem and stimulus specification. Binary image data is omitted from this judge prompt when present.",
    "",
    "GENERATED ITEM:",
    JSON.stringify(itemForJudge(input.item), null, 2),
    "",
    "Return exactly this JSON shape:",
    JSON.stringify(schema, null, 2),
  ].join("\n");

  let parsed: Record<string, unknown> | null = null;
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await callCompareLlm({
      provider: input.judge.provider,
      modelId: input.judge.modelId,
      temperature: 0,
      jsonMode: true,
      maxTokens: 4096,
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        {
          role: "user",
          content: attempt === 1
            ? user
            : [
                user,
                "",
                `PREVIOUS JUDGE RESPONSE WAS INVALID: ${lastError}`,
                "Return complete valid JSON only. Include every hard gate and every dimension score.",
              ].join("\n"),
        },
      ],
    });
    try {
      parsed = validateParsedJudgeObject(parseJsonObject(res.text));
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt === 2) {
        throw new Error(`Ablation judge failed to return valid scoring JSON: ${lastError}`);
      }
    }
  }

  if (!parsed) {
    throw new Error("Ablation judge failed to return valid scoring JSON.");
  }

  const rawGates = parsed.hard_gates && typeof parsed.hard_gates === "object"
    ? parsed.hard_gates as Record<string, unknown>
    : {};
  const rawDimensions = parsed.dimension_scores && typeof parsed.dimension_scores === "object"
    ? parsed.dimension_scores as Record<string, unknown>
    : {};

  const hard_gates: AblationJudgeResult["hard_gates"] = {
    scientific_accuracy: normalizeGate(rawGates.scientific_accuracy),
    kc_steels_alignment: normalizeGate(rawGates.kc_steels_alignment),
    answerability: normalizeGate(rawGates.answerability),
    no_answer_leakage: normalizeGate(rawGates.no_answer_leakage),
  };

  const dimension_scores = Object.fromEntries(
    ABLATION_DIMENSIONS.map((dimension) => [
      dimension.key,
      normalizeDimension(rawDimensions[dimension.key]),
    ])
  ) as Record<AblationDimensionKey, AblationDimensionScore>;

  const weighted_score = computeWeightedScore(dimension_scores);
  const hard_gates_pass = Object.values(hard_gates).every((gate) => gate.pass);
  const decision = computeDecision(weighted_score, hard_gates_pass);

  return {
    hard_gates,
    dimension_scores,
    weighted_score,
    hard_gates_pass,
    decision,
    rationale: normalizeRationale(parsed.rationale),
    latencyMs: Date.now() - t0,
  };
}
