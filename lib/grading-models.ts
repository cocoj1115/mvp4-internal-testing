export const DEFAULT_GRADING_MODEL = "gpt-5.4";

export const GRADING_MODELS = [
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    note: "Default",
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
    note: "Fallback",
  },
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1 mini",
    note: "Faster / cheaper",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    note: "Lowest cost",
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    note: "Baseline",
  },
] as const;

export type GradingModel = (typeof GRADING_MODELS)[number]["id"];

export function isGradingModel(value: unknown): value is GradingModel {
  return (
    typeof value === "string" &&
    GRADING_MODELS.some((model) => model.id === value)
  );
}
