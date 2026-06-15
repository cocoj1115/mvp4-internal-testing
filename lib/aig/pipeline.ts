import { chatComplete } from "@/lib/llm";
import {
  getTaxonomy,
  getCards,
  getRubrics,
  getKCsByStandard,
  retrieveStudyGuide,
} from "./data";
import { buildBlueprintPrompt, buildItemPrompt } from "./prompts";
import type {
  Card,
  ContextPack,
  Blueprint,
  GeneratedItem,
} from "./types";

// ── Vocab overlap helper ──────────────────────────────────────────────────────

function vocabOverlap(text: string, vocab: string[]): number {
  const lower = text.toLowerCase();
  return vocab.filter((v) => lower.includes(v.toLowerCase())).length;
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
  standardKCCodes: string[]
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

  const supporting = bp.supporting_kcs;
  if (supporting !== undefined) {
    if (!Array.isArray(supporting)) return "supporting_kcs must be an array";
    for (const code of supporting as string[]) {
      if (!standardKCCodes.includes(code)) {
        return `supporting_kcs contains unknown KC code: "${code}"`;
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
  "illustration",
  "none",
]);

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
  if (typeof asset.caption !== "string") return "stimulus_asset.caption must be a string";
  if (asset.type === "table" && typeof asset.table_markdown !== "string") {
    return "stimulus_asset.table_markdown required when type=table";
  }
  if ((asset.type === "line_graph" || asset.type === "bar_chart") && !asset.chart_data) {
    return "stimulus_asset.chart_data required when type=line_graph or bar_chart";
  }
  if (asset.type === "diagram" && typeof asset.diagram_spec !== "string") {
    return "stimulus_asset.diagram_spec required when type=diagram";
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
  return null;
}

// ── LLM call with 1 retry ─────────────────────────────────────────────────────

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

  const content1 = await call(user);
  const { value: parsed1, error: parseErr1 } = tryParse(content1);
  const error1 = parseErr1 ?? validate(parsed1);
  if (!error1) return parsed1 as T;

  const content2 = await call(
    `${user}\n\nPREVIOUS ATTEMPT FAILED: ${error1}\nPlease fix and return corrected JSON.`
  );
  const { value: parsed2, error: parseErr2 } = tryParse(content2);
  const error2 = parseErr2 ?? validate(parsed2);
  if (!error2) return parsed2 as T;
  throw new Error(`AIG generation failed after retry: ${error2}`);
}

// ── generateBlueprint ─────────────────────────────────────────────────────────

export async function generateBlueprint(
  ctx: ContextPack,
  model: string,
  temperature: number
): Promise<Blueprint> {
  const { system, user } = buildBlueprintPrompt(ctx);
  const taxonomyTypes = Object.keys(ctx.taxonomyRows);
  const standardKCCodes = ctx.standardKCs.map((kc) => kc.code);
  return callWithRetry<Blueprint>(
    system,
    user,
    (p) => validateBlueprint(p, taxonomyTypes, standardKCCodes),
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
  telerLevel: number = 3
): Promise<GeneratedItem> {
  const { system, user } = buildItemPrompt(bp, ctx, telerLevel);
  return callWithRetry<GeneratedItem>(
    system,
    user,
    validateItem,
    model,
    temperature
  );
}

// ── Method registry ───────────────────────────────────────────────────────────

export interface MethodRunResult {
  blueprint: Blueprint;
  item: GeneratedItem;
  grounding: ContextPack["grounding"];
}

export interface AIGMethod {
  label: string;
  run(standard: string, model: string, temperature: number): Promise<MethodRunResult>;
}

export const AIG_METHODS: Record<string, AIGMethod> = {
  method_blueprint_l3: {
    label: "Blueprint + TELeR L3",
    async run(standard, model, temperature) {
      const ctx = await assembleContext(standard);
      const blueprint = await generateBlueprint(ctx, model, temperature);
      const item = await generateItem(blueprint, ctx, model, temperature, 3);
      return { blueprint, item, grounding: ctx.grounding };
    },
  },
  method_2: {
    label: "(placeholder)",
    async run() {
      throw new Error("Not implemented yet");
    },
  },
  method_3: {
    label: "(placeholder)",
    async run() {
      throw new Error("Not implemented yet");
    },
  },
};
