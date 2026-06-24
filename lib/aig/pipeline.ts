import { chatComplete } from "@/lib/llm";
import {
  getTaxonomy,
  getCards,
  getRubrics,
  getKCsByStandard,
  retrieveStudyGuide,
} from "./data";
import { buildBlueprintPrompt, buildItemPrompt, buildKeystoneDirectPrompt } from "./prompts";
import { generateIllustrationB64 } from "./illustration";
import type {
  AIGRunOptions,
  Card,
  ContextPack,
  Blueprint,
  GeneratedItem,
  StyleCheckResult,
} from "./types";

// ── Vocab overlap helper ──────────────────────────────────────────────────────

function vocabOverlap(text: string, vocab: string[]): number {
  const lower = text.toLowerCase();
  return vocab.filter((v) => lower.includes(v.toLowerCase())).length;
}

function sampleWithoutReplacement<T>(items: T[], count: number): T[] {
  const pool = [...items];
  const selected: T[] = [];
  while (pool.length > 0 && selected.length < count) {
    const index = Math.floor(Math.random() * pool.length);
    selected.push(pool[index]);
    pool.splice(index, 1);
  }
  return selected;
}

function selectRandomKC(standardKCs: ContextPack["standardKCs"]): ContextPack["standardKCs"][number] {
  if (standardKCs.length === 0) {
    throw new Error("Cannot select a core KC because the standard has no KCs.");
  }
  return standardKCs[Math.floor(Math.random() * standardKCs.length)];
}

function selectStudyGuideChunksForCoreKC(
  chunks: Array<{ chunk_id: string; text: string; score: number }>
): Array<{ chunk_id: string; text: string; score: number }> {
  const fixed = chunks.slice(0, 2);
  const randomized = sampleWithoutReplacement(chunks.slice(2, 8), 2);
  return [...fixed, ...randomized].sort((a, b) => b.score - a.score);
}

// ── assembleContext ───────────────────────────────────────────────────────────

export async function assembleContext(standard: string): Promise<ContextPack> {
  const taxonomy = getTaxonomy();
  const allCards = getCards();
  const { item_specific: itemRubrics } = getRubrics();
  const standardKCs = getKCsByStandard(standard);

  const combinedVocab = Array.from(new Set(standardKCs.flatMap((kc) => kc.vocab)));

  // Use vocab terms as query — tighter signal than concatenating all KC statements,
  // which dilutes the embedding when a standard has many KCs.
  const studyGuideQuery = combinedVocab.length > 0
    ? combinedVocab.join(", ")
    : standardKCs.map((kc) => kc.statement).join(". ");

  const studyGuideChunks = await retrieveStudyGuide(studyGuideQuery, 4, 0.25);

  const { getABCPriors } = await import("./data");
  const priors = getABCPriors();
  const priorTypes = new Set(priors.flatMap((p) => p.sequence));

  // Content (vocab) is primary; task-type match is a tiebreaker only.
  // Cards with zero vocab overlap and no task-type match are excluded entirely.
  const relatedCards: Card[] = allCards
    .map((c) => ({
      card: c,
      score: vocabOverlap(c.prompt, combinedVocab) * 3 + (priorTypes.has(c.primary_type) ? 1 : 0),
    }))
    .filter((sc) => sc.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((sc) => sc.card);

  const matched = itemRubrics.filter(
    (r) =>
      r.alignment === standard ||
      vocabOverlap(r.scoring_guideline, combinedVocab) >= 2
  );
  // Rubric style is domain-general; fall back to all anchors so the model always
  // has concrete examples to align its bullet format against.
  const relevantRubrics = matched.length > 0 ? matched : itemRubrics;

  const grounding = {
    study_guide: {
      empty: studyGuideChunks.length === 0,
      chunk_ids: studyGuideChunks.map((c) => c.chunk_id),
    },
    rubric: {
      empty: relevantRubrics.length === 0,
      items: relevantRubrics.map((r) => r.item),
    },
    cards: {
      empty: relatedCards.length === 0,
      card_ids: relatedCards.map((c) => c.card_id),
    },
  };

  return {
    standard,
    standardKCs,
    studyGuideChunks,
    relatedCards,
    taxonomyRows: taxonomy,
    relevantRubrics,
    grounding,
  };
}

export async function assembleContextForCoreKC(
  standard: string,
  coreKCCode: string
): Promise<ContextPack> {
  const taxonomy = getTaxonomy();
  const allCards = getCards();
  const { item_specific: itemRubrics } = getRubrics();
  const standardKCs = getKCsByStandard(standard);
  const selectedCoreKC = standardKCs.find((kc) => kc.code === coreKCCode);

  if (!selectedCoreKC) {
    throw new Error(`Core KC "${coreKCCode}" is not valid for standard "${standard}".`);
  }

  const coreVocab = Array.from(new Set(selectedCoreKC.vocab));
  const queryParts = [selectedCoreKC.statement, ...coreVocab].filter(Boolean);
  const studyGuideQuery = queryParts.join(". ");
  const candidateChunks = await retrieveStudyGuide(studyGuideQuery, 8, 0.25);
  const studyGuideChunks = selectStudyGuideChunksForCoreKC(candidateChunks);

  const { getABCPriors } = await import("./data");
  const priors = getABCPriors();
  const priorTypes = new Set(priors.flatMap((p) => p.sequence));

  const relatedCards: Card[] = allCards
    .map((c) => ({
      card: c,
      score: vocabOverlap(c.prompt, coreVocab) * 3 + (priorTypes.has(c.primary_type) ? 1 : 0),
    }))
    .filter((sc) => sc.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((sc) => sc.card);

  const matched = itemRubrics.filter(
    (r) =>
      r.alignment === standard ||
      vocabOverlap(r.scoring_guideline, coreVocab) >= 2
  );
  const relevantRubrics = matched.length > 0 ? matched : itemRubrics;

  const grounding = {
    study_guide: {
      empty: studyGuideChunks.length === 0,
      chunk_ids: studyGuideChunks.map((c) => c.chunk_id),
    },
    rubric: {
      empty: relevantRubrics.length === 0,
      items: relevantRubrics.map((r) => r.item),
    },
    cards: {
      empty: relatedCards.length === 0,
      card_ids: relatedCards.map((c) => c.card_id),
    },
  };

  return {
    standard,
    standardKCs,
    selectedCoreKC,
    studyGuideChunks,
    relatedCards,
    taxonomyRows: taxonomy,
    relevantRubrics,
    grounding,
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

const REQUIRED_BP_KEYS = [
  "target_standard",
  "core_kc",
  "cognitive_demand",
  "key_concepts",
  "task_sequence",
  "evidence_pattern",
  "expected_response_elements",
  "common_incomplete_responses",
];

function validateBlueprint(
  parsed: unknown,
  taxonomyTypes: string[],
  standardKCCodes: string[],
  fixedCoreKC?: string
): string | null {
  if (!parsed || typeof parsed !== "object") return "Response is not an object";
  const bp = parsed as Record<string, unknown>;

  for (const key of REQUIRED_BP_KEYS) {
    if (!(key in bp)) return `Missing key: ${key}`;
  }

  const coreKC = bp.core_kc;
  if (typeof coreKC !== "string" || !standardKCCodes.includes(coreKC)) {
    return `core_kc must be a valid KC code under this standard: "${coreKC}"`;
  }
  if (fixedCoreKC && coreKC !== fixedCoreKC) {
    return `core_kc must equal the preselected core KC: "${fixedCoreKC}"`;
  }

  const supporting = bp.supporting_kcs;
  if (supporting !== undefined) {
    if (!Array.isArray(supporting)) return "supporting_kcs must be an array";
    for (const code of supporting as string[]) {
      if (!standardKCCodes.includes(code)) {
        return `supporting_kcs contains unknown KC code: "${code}"`;
      }
      if (code === coreKC) {
        return "supporting_kcs must not repeat core_kc";
      }
    }
  }

  const validKCCodes = new Set<string>([coreKC, ...((supporting as string[] | undefined) ?? [])]);

  const seq = bp.task_sequence as Record<string, { kc_code?: string; task_type?: string } | undefined>;
  if (!seq["Part A"]) return `Missing "Part A" in task_sequence`;
  if (!seq["Part B"]) return `Missing "Part B" in task_sequence`;

  const presentParts = ["Part A", "Part B", "Part C"].filter((p) => seq[p]);
  if (presentParts.length > 3) return "task_sequence may have at most 3 parts";

  for (const part of presentParts) {
    const p = seq[part]!;
    if (!p.task_type || !taxonomyTypes.includes(p.task_type)) {
      return `Invalid or missing task_type for ${part}: "${p.task_type}"`;
    }
    if (!p.kc_code || !validKCCodes.has(p.kc_code)) {
      return `Invalid or missing kc_code for ${part}: "${p.kc_code}" (must be core_kc or one of supporting_kcs)`;
    }
  }

  return null;
}

const VALID_STIMULUS_TYPES = new Set([
  "table",
  "line_graph",
  "bar_chart",
  "diagram",
  "scenario",
  "illustration",
  "none",
]);

function containsRubricPlaceholder(text: unknown): boolean {
  if (typeof text !== "string") return false;
  return /\[[^\]]+\]/.test(text) || /<[^>]+>/.test(text);
}

function validateItem(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return "Response is not an object";
  const item = parsed as Record<string, unknown>;
  for (const key of ["stem", "stimulus_asset", "parts", "scoring_rubric"]) {
    if (!(key in item)) return `Missing key: ${key}`;
  }

  const asset = item.stimulus_asset as Record<string, unknown>;
  if (!asset || typeof asset !== "object") return "stimulus_asset must be an object";
  if (typeof asset.type !== "string" || !VALID_STIMULUS_TYPES.has(asset.type)) {
    return `stimulus_asset.type must be one of: ${Array.from(VALID_STIMULUS_TYPES).join(", ")}`;
  }
  if (typeof asset.title !== "string" || !asset.title.trim()) {
    return "stimulus_asset.title must be a non-empty string";
  }
  if (asset.type === "table" && typeof asset.table_markdown !== "string") {
    return "stimulus_asset.table_markdown required when type=table";
  }
  if ((asset.type === "line_graph" || asset.type === "bar_chart") && !asset.chart_data) {
    return "stimulus_asset.chart_data required when type=line_graph or bar_chart";
  }
  if (asset.type === "diagram" && typeof asset.diagram_spec !== "string") {
    return "stimulus_asset.diagram_spec required when type=diagram";
  }
  if (asset.type === "scenario" && typeof asset.scenario_text !== "string") {
    return "stimulus_asset.scenario_text required when type=scenario";
  }
  if (asset.type === "illustration" && typeof asset.illustration_prompt !== "string") {
    return "stimulus_asset.illustration_prompt required when type=illustration";
  }

  const parts = item.parts as Record<string, unknown>;
  for (const part of ["Part A", "Part B"]) {
    if (!parts[part]) return `Missing ${part} in parts`;
  }
  // Part C is optional (2-part items are valid)
  const rubric = item.scoring_rubric as Record<string, unknown>;
  if (!rubric["3"] || !rubric["2"] || !rubric["1"] || !rubric["0"]) {
    return `scoring_rubric must have keys "0", "1", "2", "3"`;
  }
  for (const score of ["3", "2", "1", "0"] as const) {
    if (typeof rubric[score] !== "string") {
      return `scoring_rubric.${score} must be a string`;
    }
  }
  if (
    containsRubricPlaceholder(rubric["3"]) ||
    containsRubricPlaceholder(rubric["2"]) ||
    containsRubricPlaceholder(rubric["1"]) ||
    containsRubricPlaceholder(rubric["0"])
  ) {
    return "scoring_rubric contains unresolved placeholder text";
  }
  return null;
}

function validateDirectItemKCSelection(
  parsed: unknown,
  targetStandard: string,
  standardKCCodes: string[]
): string | null {
  const baseError = validateItem(parsed);
  if (baseError) return baseError;

  const item = parsed as Record<string, unknown>;

  if (item.target_standard !== undefined) {
    if (typeof item.target_standard !== "string" || item.target_standard !== targetStandard) {
      return `target_standard must exactly match the requested standard: "${targetStandard}"`;
    }
  }

  const coreKC = item.core_kc;
  if (typeof coreKC !== "string" || !standardKCCodes.includes(coreKC)) {
    return `core_kc must be a valid KC code under this standard: "${coreKC}"`;
  }

  const supporting = item.supporting_kcs;
  if (supporting !== undefined) {
    if (!Array.isArray(supporting)) return "supporting_kcs must be an array";
    for (const code of supporting as unknown[]) {
      if (typeof code !== "string" || !standardKCCodes.includes(code)) {
        return `supporting_kcs contains unknown KC code: "${String(code)}"`;
      }
      if (code === coreKC) {
        return "supporting_kcs must not repeat core_kc";
      }
    }
  }

  return null;
}

// ── LLM call with schema-aware retries ───────────────────────────────────────

async function callWithRetry<T>(
  system: string,
  user: string,
  validate: (parsed: unknown) => string | null,
  model: string,
  temperature: number
): Promise<T> {
  const tryParse = (text: string): { value: unknown; error: null } | { value: null; error: string } => {
    try {
      return { value: JSON.parse(text), error: null };
    } catch (e) {
      return { value: null, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
  };

  const call = async (userMsg: string): Promise<string> => {
    const res = await chatComplete({
      model,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMsg },
      ],
      jsonMode: true,
    });
    return res.content;
  };

  let lastError = "Unknown validation error";

  for (let attempt = 1; attempt <= 3; attempt++) {
    const userMsg = attempt === 1
      ? user
      : [
          user,
          "",
          `PREVIOUS ATTEMPT FAILED: ${lastError}`,
          "Return corrected JSON only.",
          "Do not omit any required keys from the schema.",
          "If a key was missing, include it explicitly even if the value feels obvious.",
        ].join("\n");

    const content = await call(userMsg);
    const { value: parsed, error: parseErr } = tryParse(content);
    const validationError = parseErr ?? validate(parsed);
    if (!validationError) return parsed as T;
    lastError = validationError;
  }

  throw new Error(`AIG generation failed after retry: ${lastError}`);
}

// ── generateBlueprint ─────────────────────────────────────────────────────────

export async function generateBlueprint(
  ctx: ContextPack,
  model: string,
  temperature: number,
  options?: AIGRunOptions
): Promise<Blueprint> {
  const { system, user } = buildBlueprintPrompt(ctx, options);
  const taxonomyTypes = Object.keys(ctx.taxonomyRows);
  const standardKCCodes = ctx.standardKCs.map((kc) => kc.code);
  const fixedCoreKC = ctx.selectedCoreKC?.code;
  return callWithRetry<Blueprint>(
    system,
    user,
    (p) => validateBlueprint(p, taxonomyTypes, standardKCCodes, fixedCoreKC),
    model,
    temperature
  );
}

// ── generateItem ──────────────────────────────────────────────────────────────

export async function generateItem(
  bp: Blueprint,
  ctx: ContextPack,
  model: string,
  temperature: number,
  telerLevel: number = 3,
  options?: AIGRunOptions
): Promise<GeneratedItem> {
  const { system, user } = buildItemPrompt(bp, ctx, telerLevel, options);
  return callWithRetry<GeneratedItem>(
    system,
    user,
    validateItem,
    model,
    temperature
  );
}

export async function generateKeystoneDirectItem(
  standard: string,
  model: string,
  temperature: number,
  options: AIGRunOptions
): Promise<GeneratedItem> {
  const standardKCs = getKCsByStandard(standard);
  const { system, user } = buildKeystoneDirectPrompt(
    { standard, standardKCs },
    options
  );
  return callWithRetry<GeneratedItem>(
    system,
    user,
    (parsed) => validateDirectItemKCSelection(parsed, standard, standardKCs.map((kc) => kc.code)),
    model,
    temperature
  );
}

function emptyGrounding(): ContextPack["grounding"] {
  return {
    study_guide: { empty: true, chunk_ids: [] },
    rubric: { empty: true, items: [] },
    cards: { empty: true, card_ids: [] },
  };
}

function itemForTextReview(item: GeneratedItem): GeneratedItem {
  if (!item.stimulus_asset.image_b64) return item;
  return {
    ...item,
    stimulus_asset: {
      ...item.stimulus_asset,
      image_b64: undefined,
    },
  };
}

function styleCheckPrompt(item: GeneratedItem, standard: string): string {
  const reviewItem = itemForTextReview(item);
  return [
    "You are a Pennsylvania Keystone Biology assessment quality reviewer.",
    "Evaluate the generated item below against Keystone-specific criteria.",
    "",
    "GENERATED ITEM:",
    JSON.stringify(reviewItem, null, 2),
    "",
    `TARGET STANDARD: ${standard}`,
    "",
    "EVALUATION CRITERIA:",
    "",
    "1. STIMULUS_QUALITY",
    "PASS: stimulus has specific data, named organisms, labeled conditions, or concrete observations that a student could cite as evidence.",
    "FAIL: stimulus is vague, has no concrete data, or lacks a usable stimulus.",
    "",
    "2. DOK_PROGRESSION",
    "PASS: Part A is answerable from stimulus with minimal inference, Part B connects stimulus to a biological mechanism, and Part C requires knowledge not directly present in the stimulus.",
    "FAIL: Part C can be answered from the stimulus alone, or all parts have the same difficulty.",
    "",
    "3. KEYSTONE_REGISTER",
    "PASS: verbs and language are Keystone-appropriate, precise, and exam-like.",
    "FAIL: yes/no questions, opinion questions, informal phrasing, or vague command verbs.",
    "",
    "4. PART_C_OPENNESS",
    "PASS: Part C allows more than one defensible correct answer or justification path.",
    "FAIL: Part C has only one narrow correct answer.",
    "",
    "5. LOGICAL_PROGRESSION",
    "PASS: each part builds logically on the previous one.",
    "FAIL: parts feel disconnected or could be answered in any order.",
    "",
    "6. STANDARD_ALIGNMENT",
    "PASS: item clearly targets the biological concepts in the target standard.",
    "FAIL: item drifts to unrelated concepts or a different standard.",
    "",
    "7. KC_ALIGNMENT",
    "No target KC is provided in this app version. Mark this criterion pass with flag null unless the item clearly avoids all KCs from the standard.",
    "",
    "Set top-level passes=true ONLY if every criterion pass value is true.",
    "If any criterion pass value is false, top-level passes MUST be false.",
    "",
    "Return strict JSON exactly in this shape:",
    JSON.stringify({
      passes: true,
      criteria_results: {
        stimulus_quality: { pass: true, flag: null },
        dok_progression: { pass: true, flag: null },
        keystone_register: { pass: true, flag: null },
        part_c_openness: { pass: true, flag: null },
        logical_progression: { pass: true, flag: null },
        standard_alignment: { pass: true, flag: null },
        kc_alignment: { pass: true, flag: null },
      },
      revision_instructions: null,
    }),
  ].join("\n");
}

function validateStyleCheck(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return "Response is not an object";
  const result = parsed as Record<string, unknown>;
  if (typeof result.passes !== "boolean") return "passes must be boolean";
  if (!result.criteria_results || typeof result.criteria_results !== "object") {
    return "criteria_results must be an object";
  }
  const criteria = result.criteria_results as Record<string, unknown>;
  for (const key of [
    "stimulus_quality",
    "dok_progression",
    "keystone_register",
    "part_c_openness",
    "logical_progression",
    "standard_alignment",
    "kc_alignment",
  ]) {
    const criterion = criteria[key] as Record<string, unknown> | undefined;
    if (!criterion || typeof criterion !== "object") return `Missing criterion: ${key}`;
    if (typeof criterion.pass !== "boolean") return `${key}.pass must be boolean`;
    if (criterion.flag !== null && typeof criterion.flag !== "string") {
      return `${key}.flag must be string or null`;
    }
  }
  return null;
}

function normalizeStyleCheck(check: StyleCheckResult): StyleCheckResult {
  const passes = Object.values(check.criteria_results).every((criterion) => criterion.pass);
  return {
    ...check,
    passes,
  };
}

export async function styleCheckItem(
  item: GeneratedItem,
  standard: string,
  model: string,
  temperature: number
): Promise<StyleCheckResult> {
  const check = await callWithRetry<StyleCheckResult>(
    "You are a Keystone Biology assessment reviewer. Always respond with valid JSON only.",
    styleCheckPrompt(item, standard),
    validateStyleCheck,
    model,
    temperature
  );
  return normalizeStyleCheck(check);
}

export function buildRevisionInstructions(check: StyleCheckResult): string {
  const priorityOrder = [
    "kc_alignment",
    "dok_progression",
    "stimulus_quality",
    "part_c_openness",
    "standard_alignment",
    "keystone_register",
    "logical_progression",
  ];
  const entries = Object.entries(check.criteria_results)
    .filter(([, details]) => !details.pass && details.flag)
    .sort(([a], [b]) => {
      const ai = priorityOrder.indexOf(a);
      const bi = priorityOrder.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  if (entries.length === 0) {
    return check.revision_instructions ?? "";
  }

  return [
    "Fix the following issues in this order:",
    ...entries.map(([criterion, details], i) => `${i + 1}. ${criterion.toUpperCase()}: ${details.flag}`),
    "",
    "Do not change passing parts unless required to fix a listed issue.",
  ].join("\n");
}

// ── Method registry ───────────────────────────────────────────────────────────

export interface MethodRunResult {
  blueprint?: Blueprint;
  item: GeneratedItem;
  grounding: ContextPack["grounding"];
  style_check?: StyleCheckResult;
  attempts?: Array<{
    attempt: number;
    item: GeneratedItem;
    blueprint?: Blueprint;
    style_check?: StyleCheckResult;
    revision_instructions?: string;
  }>;
  metadata?: {
    style_check_enabled: boolean;
    retry_enabled: boolean;
    max_attempts: number;
    attempts: number;
    final_status: "not_checked" | "passed" | "failed" | "max_attempts_reached";
  };
}

export interface AIGMethod {
  label: string;
  selectCoreKCBeforeRun?: boolean;
  run(
    standard: string,
    model: string,
    temperature: number,
    options: AIGRunOptions
  ): Promise<MethodRunResult>;
}

export interface AIGReviewOptions {
  styleCheckEnabled: boolean;
  retryEnabled: boolean;
  maxAttempts: number;
}

async function attachGeneratedIllustration(result: MethodRunResult): Promise<MethodRunResult> {
  const asset = result.item.stimulus_asset;
  if (asset.type !== "illustration" || !asset.illustration_prompt || asset.image_b64) {
    return result;
  }

  try {
    const imageB64 = await generateIllustrationB64(asset.illustration_prompt);
    return {
      ...result,
      item: {
        ...result.item,
        stimulus_asset: {
          ...asset,
          image_b64: imageB64,
        },
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Image generation failed";
    return {
      ...result,
      item: {
        ...result.item,
        stimulus_asset: {
          ...asset,
          image_generation_error: message,
        },
      },
    };
  }
}

export async function runAIGMethod(
  method: AIGMethod,
  standard: string,
  model: string,
  temperature: number,
  options: AIGRunOptions,
  review: AIGReviewOptions
): Promise<MethodRunResult> {
  const maxAttempts = review.styleCheckEnabled && review.retryEnabled
    ? Math.max(1, Math.min(5, Math.floor(review.maxAttempts || 1)))
    : 1;
  const runOptions: AIGRunOptions = method.selectCoreKCBeforeRun && !options.fixedCoreKC
    ? {
        ...options,
        fixedCoreKC: selectRandomKC(getKCsByStandard(standard)).code,
      }
    : options;

  const attempts: MethodRunResult["attempts"] = [];
  let revisionInstructions: string | undefined;
  let best: MethodRunResult | null = null;
  let bestFailureCount = Number.POSITIVE_INFINITY;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await method.run(standard, model, temperature, {
      ...runOptions,
      revisionInstructions,
    });
    const resultWithAsset = await attachGeneratedIllustration(result);

    if (!review.styleCheckEnabled) {
      return {
        ...resultWithAsset,
        attempts: [{ attempt, item: resultWithAsset.item, blueprint: resultWithAsset.blueprint }],
        metadata: {
          style_check_enabled: false,
          retry_enabled: false,
          max_attempts: 1,
          attempts: attempt,
          final_status: "not_checked",
        },
      };
    }

    const check = await styleCheckItem(resultWithAsset.item, standard, model, temperature);
    const failureCount = Object.values(check.criteria_results).filter((r) => !r.pass).length;
    attempts.push({
      attempt,
      item: resultWithAsset.item,
      blueprint: resultWithAsset.blueprint,
      style_check: check,
      revision_instructions: revisionInstructions,
    });

    const checkedResult: MethodRunResult = {
      ...resultWithAsset,
      style_check: check,
      attempts,
    };

    if (failureCount < bestFailureCount) {
      bestFailureCount = failureCount;
      best = checkedResult;
    }

    if (failureCount === 0) {
      return {
        ...checkedResult,
        metadata: {
          style_check_enabled: true,
          retry_enabled: review.retryEnabled,
          max_attempts: maxAttempts,
          attempts: attempt,
          final_status: "passed",
        },
      };
    }

    if (!review.retryEnabled || attempt === maxAttempts) {
      return {
        ...(best ?? checkedResult),
        attempts,
        metadata: {
          style_check_enabled: true,
          retry_enabled: review.retryEnabled,
          max_attempts: maxAttempts,
          attempts: attempt,
          final_status: review.retryEnabled ? "max_attempts_reached" : "failed",
        },
      };
    }

    revisionInstructions = buildRevisionInstructions(check);
  }

  return best!;
}

export const AIG_METHODS: Record<string, AIGMethod> = {
  method_blueprint_l3: {
    label: "Blueprint + TELeR L3",
    selectCoreKCBeforeRun: true,
    async run(standard, model, temperature, options) {
      const coreKC = options.fixedCoreKC ?? selectRandomKC(getKCsByStandard(standard)).code;
      const ctx = await assembleContextForCoreKC(standard, coreKC);
      const blueprint = await generateBlueprint(ctx, model, temperature, options);
      const item = await generateItem(blueprint, ctx, model, temperature, 3, options);
      return { blueprint, item, grounding: ctx.grounding };
    },
  },
  method_simple_direct: {
    label: "Simple Direct",
    async run(standard, model, temperature, options) {
      const item = await generateKeystoneDirectItem(standard, model, temperature, options);
      return { item, grounding: emptyGrounding() };
    },
  },
  method_3: {
    label: "(placeholder)",
    async run() {
      throw new Error("Not implemented yet");
    },
  },
  method_4: {
    label: "(placeholder)",
    async run() {
      throw new Error("Not implemented yet");
    },
  },
};
