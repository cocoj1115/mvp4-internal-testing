export const DEFAULT_GRADING_MODEL = "gpt-5.4";

export const GRADING_MODELS = [
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    note: "Default",
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    note: "Fallback",
  },
] as const;

export type GradingModel = (typeof GRADING_MODELS)[number]["id"];

export function isGradingModel(value: unknown): value is GradingModel {
  return (
    typeof value === "string" &&
    GRADING_MODELS.some((model) => model.id === value)
  );
}
