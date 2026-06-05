import { COMPARE_MODEL_CONFIGS } from "@/lib/compare/models";
import { CompareMethod, CompareModelConfig } from "@/lib/compare/types";

export type StudentMethod = Extract<CompareMethod, "1" | "2" | "3">;
export type GradingModelConfig = CompareModelConfig;

export const DEFAULT_GRADING_MODEL_IDS: Record<StudentMethod, string> = {
  "1": "anthropic:claude-opus-4-8:default",
  "2": "openai:gpt-5.4:t1",
  "3": "anthropic:claude-sonnet-4-6:t0",
};

const SECOND_CHOICE_GRADING_MODEL_IDS: Record<StudentMethod, string> = {
  "1": "openai:gpt-5.4-nano:t0",
  "2": "openai:gpt-5.4:t0",
  "3": "anthropic:claude-opus-4-8:default",
};

export const DEFAULT_GRADING_MODEL = DEFAULT_GRADING_MODEL_IDS["2"];

function modelById(id: string): GradingModelConfig {
  const model = COMPARE_MODEL_CONFIGS.find((config) => config.id === id);
  if (!model) throw new Error(`Missing grading model config: ${id}`);
  return model;
}

function orderedModelsForMethod(method: StudentMethod): GradingModelConfig[] {
  const preferredIds = [
    DEFAULT_GRADING_MODEL_IDS[method],
    SECOND_CHOICE_GRADING_MODEL_IDS[method],
  ];
  const preferred = preferredIds.map(modelById);
  const remaining = COMPARE_MODEL_CONFIGS.filter((config) => !preferredIds.includes(config.id));
  return [...preferred, ...remaining];
}

export const STUDENT_GRADING_MODEL_OPTIONS: Record<StudentMethod, GradingModelConfig[]> = {
  "1": orderedModelsForMethod("1"),
  "2": orderedModelsForMethod("2"),
  "3": orderedModelsForMethod("3"),
};

export const GRADING_MODELS = STUDENT_GRADING_MODEL_OPTIONS["2"];

export function defaultGradingModelForMethod(method: StudentMethod): GradingModelConfig {
  return modelById(DEFAULT_GRADING_MODEL_IDS[method]);
}

export function findGradingModelConfig(id: string): GradingModelConfig | null {
  return COMPARE_MODEL_CONFIGS.find((model) => model.id === id) ?? null;
}

export function isGradingModel(value: unknown): value is string {
  return typeof value === "string" && Boolean(findGradingModelConfig(value));
}

export function normalizeGradingModelConfig(value: unknown): GradingModelConfig | null {
  if (typeof value === "string") {
    return (
      findGradingModelConfig(value) ??
      COMPARE_MODEL_CONFIGS.find(
        (model) => model.provider === "openai" && model.modelId === value && model.temperature === 0
      ) ??
      null
    );
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<GradingModelConfig>;
  if (typeof record.id === "string") {
    const byId = findGradingModelConfig(record.id);
    if (byId) return byId;
  }
  if (
    typeof record.provider === "string" &&
    typeof record.modelId === "string" &&
    typeof record.temperature === "number"
  ) {
    return (
      COMPARE_MODEL_CONFIGS.find(
        (model) =>
          model.provider === record.provider &&
          model.modelId === record.modelId &&
          model.temperature === record.temperature
      ) ?? null
    );
  }
  return null;
}
