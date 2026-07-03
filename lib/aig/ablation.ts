import {
  AIG_METHODS,
  assembleContextForCoreKC,
  attachGeneratedIllustration,
  generateItem,
  runAIGMethod,
  type MethodRunResult,
} from "@/lib/aig/pipeline";
import type { AIGRunOptions, AIGStimulusType, Blueprint } from "@/lib/aig/types";

export type AblationConfigId = "C0" | "C1" | "C2" | "C3" | "C4" | "M1" | "M1R";

export interface AblationConfig {
  id: AblationConfigId;
  label: string;
  methodFamily: "method2" | "method1";
  methodId: keyof typeof AIG_METHODS;
  useBlueprint: boolean;
  useStudyGuideRag: boolean;
  telerLevel?: 2 | 3 | 4;
  styleCheckEnabled: boolean;
  retryEnabled: boolean;
  maxAttempts: number;
  hypothesis?: string;
  hypothesizedDimensions?: number[];
}

export const ABLATION_STANDARDS = [
  "3.1.9-12.A",
  "3.1.9-12.B",
  "3.1.9-12.D",
  "3.1.9-12.N",
] as const;

export const ABLATION_CONFIGS: AblationConfig[] = [
  {
    id: "C0",
    label: "Method2 Full",
    methodFamily: "method2",
    methodId: "method_blueprint_l3",
    useBlueprint: true,
    useStudyGuideRag: true,
    telerLevel: 3,
    styleCheckEnabled: false,
    retryEnabled: false,
    maxAttempts: 1,
  },
  {
    id: "C1",
    label: "Method2 -Blueprint",
    methodFamily: "method2",
    methodId: "method_blueprint_direct_l3",
    useBlueprint: false,
    useStudyGuideRag: true,
    telerLevel: 3,
    styleCheckEnabled: false,
    retryEnabled: false,
    maxAttempts: 1,
    hypothesis: "H1",
    hypothesizedDimensions: [1, 3, 8, 10],
  },
  {
    id: "C2",
    label: "Method2 -RAG",
    methodFamily: "method2",
    methodId: "method_blueprint_l3",
    useBlueprint: true,
    useStudyGuideRag: false,
    telerLevel: 3,
    styleCheckEnabled: false,
    retryEnabled: false,
    maxAttempts: 1,
    hypothesis: "H2",
    hypothesizedDimensions: [2, 4, 6],
  },
  {
    id: "C3",
    label: "Method2 TELeR L2",
    methodFamily: "method2",
    methodId: "method_blueprint_l3",
    useBlueprint: true,
    useStudyGuideRag: true,
    telerLevel: 2,
    styleCheckEnabled: false,
    retryEnabled: false,
    maxAttempts: 1,
    hypothesis: "H3",
    hypothesizedDimensions: [1, 9, 10],
  },
  {
    id: "C4",
    label: "Method2 TELeR L4",
    methodFamily: "method2",
    methodId: "method_blueprint_l3",
    useBlueprint: true,
    useStudyGuideRag: true,
    telerLevel: 4,
    styleCheckEnabled: false,
    retryEnabled: false,
    maxAttempts: 1,
    hypothesis: "H4",
    hypothesizedDimensions: [3, 7, 10],
  },
  {
    id: "M1",
    label: "Method1 Raw",
    methodFamily: "method1",
    methodId: "method_simple_direct",
    useBlueprint: false,
    useStudyGuideRag: false,
    styleCheckEnabled: false,
    retryEnabled: false,
    maxAttempts: 1,
  },
  {
    id: "M1R",
    label: "Method1 + Retry",
    methodFamily: "method1",
    methodId: "method_simple_direct",
    useBlueprint: false,
    useStudyGuideRag: false,
    styleCheckEnabled: true,
    retryEnabled: true,
    maxAttempts: 3,
  },
];

export const ABLATION_STIMULUS_TYPES: Exclude<AIGStimulusType, "auto" | "none">[] = [
  "table",
  "line_graph",
  "bar_chart",
  "diagram",
  "scenario",
  "illustration",
];

export function getAblationConfig(id: string): AblationConfig | null {
  return ABLATION_CONFIGS.find((config) => config.id === id) ?? null;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function pickDeterministicIndex(length: number, key: string): number {
  if (length <= 0) return 0;
  return hashString(key) % length;
}

export function pickDeterministicStimulusType(
  standardCode: string,
  replicateIndex: number
): Exclude<AIGStimulusType, "auto" | "none"> {
  return ABLATION_STIMULUS_TYPES[
    pickDeterministicIndex(ABLATION_STIMULUS_TYPES.length, `${standardCode}:${replicateIndex}:stimulus`)
  ];
}

export interface AblationRunInput {
  configId: AblationConfigId;
  standardCode: string;
  replicateIndex: number;
  model: string;
  temperature: number;
  fixedCoreKC: string;
  stimulusType: Exclude<AIGStimulusType, "auto" | "none">;
  baselineBlueprint?: Blueprint;
}

export async function runAblationGeneration(input: AblationRunInput): Promise<{
  config: AblationConfig;
  generation: MethodRunResult;
}> {
  const config = getAblationConfig(input.configId);
  if (!config) throw new Error(`Unknown ablation config: ${input.configId}`);
  const method = AIG_METHODS[config.methodId];
  if (!method) throw new Error(`Unknown AIG method: ${config.methodId}`);

  const options: AIGRunOptions = {
    stimulusType: input.stimulusType,
    fixedCoreKC: input.fixedCoreKC,
    useStudyGuideRag: config.useStudyGuideRag,
    telerLevel: config.telerLevel,
  };

  if ((config.id === "C3" || config.id === "C4") && input.baselineBlueprint) {
    const ctx = await assembleContextForCoreKC(input.standardCode, input.fixedCoreKC, {
      useStudyGuideRag: true,
    });
    const item = await generateItem(
      input.baselineBlueprint,
      ctx,
      input.model,
      input.temperature,
      config.telerLevel ?? 3,
      options
    );
    const generation = await attachGeneratedIllustration({
      blueprint: input.baselineBlueprint,
      item,
      grounding: ctx.grounding,
    });
    return { config, generation };
  }

  const generation = await runAIGMethod(
    method,
    input.standardCode,
    input.model,
    input.temperature,
    options,
    {
      styleCheckEnabled: config.styleCheckEnabled,
      retryEnabled: config.retryEnabled,
      maxAttempts: config.maxAttempts,
    }
  );

  return { config, generation };
}
