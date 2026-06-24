export interface KC {
  code: string;      // e.g. "3.1.9-12.A1"
  standard: string;  // e.g. "3.1.9-12.A"
  kcId: string;      // e.g. "A1"
  statement: string;
  vocab: string[];
  module: string;
  unit: string;
}

export interface TaxonomyEntry {
  definition: string;
  scaffolding: string;
  difficulty: number;
}

export interface Card {
  card_id: string;
  item_id: string;
  part: "A" | "B" | "C";
  source: string;
  prompt: string;
  primary_type: string;
  secondary_type: string;
  cognitive_demand: string;
  evidence_demand: string;
}

export interface Chunk {
  chunk_id: string;
  text: string;
}

export interface ABCPrior {
  item: string;
  sequence: string[];
}

export interface ItemRubric {
  item: string;
  alignment: string;
  dok: number;
  points_possible: number;
  scoring_guideline: string;
  credit_responses: Record<string, string[]>;
  sample_responses: Array<{
    score: number;
    responses: Record<string, string>;
    annotation: string;
  }>;
}

export interface ContextPack {
  standard: string;
  standardKCs: KC[];
  selectedCoreKC?: KC;
  studyGuideChunks: Array<{ chunk_id: string; text: string; score: number }>;
  relatedCards: Card[];
  taxonomyRows: Record<string, TaxonomyEntry>;
  relevantRubrics: ItemRubric[];
  grounding: {
    study_guide: { empty: boolean; chunk_ids: string[] };
    rubric: { empty: boolean; items: string[] };
    cards: { empty: boolean; card_ids: string[] };
  };
}

export interface BlueprintTaskPart {
  kc_code: string;
  task_type: string;
  function: string;
}

export interface Blueprint {
  target_standard: string;
  core_kc: string;
  supporting_kcs?: string[];
  cognitive_demand: string;
  key_concepts: string[];
  task_sequence: {
    "Part A": BlueprintTaskPart;
    "Part B": BlueprintTaskPart;
    "Part C"?: BlueprintTaskPart;
  };
  evidence_pattern: string;
  expected_response_elements: string[];
  common_incomplete_responses: string[];
}

export interface ItemPart {
  task_type: string;
  question: string;
}

export interface ScoringRubric {
  points_possible: 3;
  "3": string;
  "2": string;
  "1": string;
  "0": string;
}

export type StimulusAssetType =
  | "table"
  | "line_graph"
  | "bar_chart"
  | "diagram"
  | "illustration"
  | "scenario"
  | "none";

export interface StimulusAsset {
  type: StimulusAssetType;
  title: string;
  table_markdown?: string;
  chart_data?: {
    x_label: string;
    y_label: string;
    series: { name: string; points: [number | string, number][] }[];
  };
  diagram_spec?: string;
  illustration_prompt?: string;
  image_b64?: string;
  image_generation_error?: string;
  scenario_text?: string;
}

export interface GeneratedItem {
  target_standard?: string;
  core_kc?: string;
  supporting_kcs?: string[];
  stem: string;
  stimulus_asset: StimulusAsset;
  parts: {
    "Part A": ItemPart;
    "Part B": ItemPart;
    "Part C"?: ItemPart;
  };
  scoring_rubric: ScoringRubric;
}

export type AIGStimulusType =
  | "auto"
  | "table"
  | "line_graph"
  | "bar_chart"
  | "diagram"
  | "scenario"
  | "illustration"
  | "none";

export interface AIGRunOptions {
  stimulusType: AIGStimulusType;
  revisionInstructions?: string;
  fixedCoreKC?: string;
}

export interface StyleCheckCriterionResult {
  pass: boolean;
  flag: string | null;
}

export interface StyleCheckResult {
  passes: boolean;
  criteria_results: {
    stimulus_quality: StyleCheckCriterionResult;
    dok_progression: StyleCheckCriterionResult;
    keystone_register: StyleCheckCriterionResult;
    part_c_openness: StyleCheckCriterionResult;
    logical_progression: StyleCheckCriterionResult;
    standard_alignment: StyleCheckCriterionResult;
    kc_alignment: StyleCheckCriterionResult;
  };
  revision_instructions: string | null;
}
