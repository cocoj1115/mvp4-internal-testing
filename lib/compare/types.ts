import { PartLabel } from "@/app/lib/questions";

export type CompareProvider = "openai" | "anthropic" | "google";
export type CompareMethod = "1" | "2" | "3";

export interface CompareModelConfig {
  id: string;
  label: string;
  provider: CompareProvider;
  modelId: string;
  temperature: number;
}

export interface CompareJudgeConfig {
  provider: CompareProvider;
  modelId: string;
}

export interface CompareInput {
  questionId: "M1Q14";
  part: PartLabel;
  testCaseId: string;
  studentResponse: string;
  officialScore: number;
}

export interface CompareRequest {
  questionId: "M1Q14";
  inputs: CompareInput[];
  methods: CompareMethod[];
  candidates: CompareModelConfig[];
  repeats: number;
  judge: CompareJudgeConfig;
}

export interface JudgeScores {
  task_focus: number | null;
  specificity: number | null;
  manageability: number | null;
  answer_leakage: number | null;
  overall_quality: number | null;
  rationale: string;
}

export interface RawComparisonRow {
  run_id: string;
  timestamp: string;
  question_id: "M1Q14";
  part: PartLabel;
  test_case_id: string;
  student_response: string;
  official_score: number;
  model: string;
  provider: CompareProvider;
  temperature: number;
  method: number;
  repeat_index: number;
  ai_score: number | "";
  score_match: boolean | "";
  feedback: string;
  grading_latency_ms: number | "";
  grading_token_count: number | "";
  judge_run: boolean;
  task_focus: number | "";
  specificity: number | "";
  manageability: number | "";
  answer_leakage: number | "";
  overall_quality: number | "";
  judge_rationale: string;
  judge_latency_ms: number | "";
  status: "success" | "failed";
  error: string;
}

export interface SummaryComparisonRow {
  key: string;
  method: number;
  provider: CompareProvider;
  model: string;
  temperature: number;
  totalRows: number;
  successRows: number;
  scoreMatchRate: number | null;
  taskFocusMean: number | null;
  specificityMean: number | null;
  manageabilityMean: number | null;
  answerLeakageMean: number | null;
  overallQualityMean: number | null;
  averageLatencyMs: number | null;
  averageTokens: number | null;
  passOverallRate: number | null;
}

export interface TestCasePart {
  response: string;
  official_score?: number;
}

export interface M1Q14TestCase {
  id: string;
  label: string;
  responses: Partial<Record<PartLabel, TestCasePart>>;
}
