import {
  CompareJudgeConfig,
  CompareModelConfig,
  CompareProvider,
} from "@/lib/compare/types";

const TEMPERATURES = [0, 0.5, 1] as const;

const BASE_MODELS: Array<{
  provider: CompareProvider;
  modelId: string;
  label: string;
  temperatureMode?: "configurable" | "provider-default";
}> = [
  {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
  },
  {
    provider: "anthropic",
    modelId: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    temperatureMode: "provider-default",
  },
  {
    provider: "openai",
    modelId: "gpt-5.4",
    label: "OpenAI GPT-5.4",
  },
  {
    provider: "openai",
    modelId: "gpt-5.4-mini",
    label: "OpenAI GPT-5.4 mini",
  },
  {
    provider: "openai",
    modelId: "gpt-5.4-nano",
    label: "OpenAI GPT-5.4 nano",
  },
  {
    provider: "google",
    modelId: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
  },
];

export const COMPARE_MODEL_CONFIGS: CompareModelConfig[] = BASE_MODELS.flatMap(
  (model) => {
    if (model.temperatureMode === "provider-default") {
      return [
        {
          id: `${model.provider}:${model.modelId}:default`,
          provider: model.provider,
          modelId: model.modelId,
          label: `${model.label} · provider default`,
          temperature: 1,
        },
      ];
    }

    return TEMPERATURES.map((temperature) => ({
      id: `${model.provider}:${model.modelId}:t${temperature}`,
      provider: model.provider,
      modelId: model.modelId,
      label: `${model.label} · temp ${temperature}`,
      temperature,
    }));
  }
);

export const COMPARE_JUDGE_MODELS: Array<CompareJudgeConfig & { label: string }> = [
  { provider: "openai", modelId: "gpt-5.4", label: "OpenAI GPT-5.4" },
  { provider: "openai", modelId: "gpt-5.4-mini", label: "OpenAI GPT-5.4 mini" },
  { provider: "anthropic", modelId: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { provider: "anthropic", modelId: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { provider: "google", modelId: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
];

export function isCompareProvider(value: unknown): value is CompareProvider {
  return value === "openai" || value === "anthropic" || value === "google";
}

export function normalizeModelConfig(value: unknown): CompareModelConfig | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!isCompareProvider(record.provider)) return null;
  if (typeof record.modelId !== "string" || record.modelId.trim() === "") return null;
  if (typeof record.temperature !== "number" || !Number.isFinite(record.temperature)) return null;

  return {
    id:
      typeof record.id === "string" && record.id.trim()
        ? record.id
        : `${record.provider}:${record.modelId}:t${record.temperature}`,
    label:
      typeof record.label === "string" && record.label.trim()
        ? record.label
        : `${record.provider} ${record.modelId} · temp ${record.temperature}`,
    provider: record.provider,
    modelId: record.modelId,
    temperature: Math.max(0, Math.min(2, record.temperature)),
  };
}

export function normalizeJudgeConfig(value: unknown): CompareJudgeConfig | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!isCompareProvider(record.provider)) return null;
  if (typeof record.modelId !== "string" || record.modelId.trim() === "") return null;
  return {
    provider: record.provider,
    modelId: record.modelId,
  };
}
