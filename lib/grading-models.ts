export const DEFAULT_GRADING_MODEL = "gpt-4.1-mini";

export const GRADING_MODELS = [
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1 mini",
    note: "Recommended",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    note: "Lowest cost",
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
    note: "High quality",
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    note: "Existing baseline",
  },
] as const;

export type GradingModel = (typeof GRADING_MODELS)[number]["id"];

export function isGradingModel(value: unknown): value is GradingModel {
  return (
    typeof value === "string" &&
    GRADING_MODELS.some((model) => model.id === value)
  );
}
