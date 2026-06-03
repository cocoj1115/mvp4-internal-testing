import {
  RawComparisonRow,
  SummaryComparisonRow,
} from "@/lib/compare/types";

export const CSV_COLUMNS = [
  "run_id",
  "timestamp",
  "question_id",
  "part",
  "test_case_id",
  "student_response",
  "official_score",
  "model",
  "provider",
  "temperature",
  "method",
  "ai_score",
  "score_match",
  "feedback",
  "grading_latency_ms",
  "grading_token_count",
  "judge_run",
  "task_focus",
  "specificity",
  "manageability",
  "answer_leakage",
  "overall_quality",
  "judge_rationale",
  "judge_latency_ms",
  "pass_task_focus",
  "pass_specificity",
  "pass_manageability",
  "pass_answer_leakage",
  "pass_overall",
] as const;

type CsvColumn = (typeof CSV_COLUMNS)[number];

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function average(values: Array<number | "" | null>): number | null {
  const numbers = values.filter(isNumber);
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function rate(values: Array<boolean | "" | null>): number | null {
  const booleans = values.filter((value): value is boolean => typeof value === "boolean");
  if (booleans.length === 0) return null;
  return booleans.filter(Boolean).length / booleans.length;
}

export function passTaskFocus(value: number | ""): boolean | "" {
  return isNumber(value) ? value >= 3.0 : "";
}

export function passSpecificity(value: number | ""): boolean | "" {
  return isNumber(value) ? value >= 3.0 : "";
}

export function passManageability(value: number | ""): boolean | "" {
  return isNumber(value) ? value >= 3.0 : "";
}

export function passAnswerLeakage(value: number | ""): boolean | "" {
  return isNumber(value) ? value >= 3.0 : "";
}

export function passOverall(row: RawComparisonRow): boolean | "" {
  const checks = [
    passTaskFocus(row.task_focus),
    passSpecificity(row.specificity),
    passManageability(row.manageability),
    passAnswerLeakage(row.answer_leakage),
  ];
  return checks.every((value) => value === true) ? true : checks.some((value) => value === "") ? "" : false;
}

export function aggregateRows(rows: RawComparisonRow[]): SummaryComparisonRow[] {
  const groups = new Map<string, RawComparisonRow[]>();
  for (const row of rows) {
    const key = `${row.method}|${row.provider}|${row.model}|${row.temperature}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return Array.from(groups.entries())
    .map(([key, group]) => {
      const successful = group.filter((row) => row.status === "success");
      return {
        key,
        method: group[0].method,
        provider: group[0].provider,
        model: group[0].model,
        temperature: group[0].temperature,
        totalRows: group.length,
        successRows: successful.length,
        scoreMatchRate: rate(successful.map((row) => row.score_match)),
        taskFocusMean: average(successful.map((row) => row.task_focus)),
        specificityMean: average(successful.map((row) => row.specificity)),
        manageabilityMean: average(successful.map((row) => row.manageability)),
        answerLeakageMean: average(successful.map((row) => row.answer_leakage)),
        overallQualityMean: average(successful.map((row) => row.overall_quality)),
        averageLatencyMs: average(successful.map((row) => row.grading_latency_ms)),
        averageTokens: average(successful.map((row) => row.grading_token_count)),
        passOverallRate: rate(successful.map(passOverall)),
      };
    })
    .sort((a, b) => (b.overallQualityMean ?? -1) - (a.overallQualityMean ?? -1));
}

function csvValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
  return `"${String(value).replace(/"/g, '""')}"`;
}

function csvRowValue(row: RawComparisonRow, column: CsvColumn) {
  if (column === "pass_task_focus") return passTaskFocus(row.task_focus);
  if (column === "pass_specificity") return passSpecificity(row.specificity);
  if (column === "pass_manageability") return passManageability(row.manageability);
  if (column === "pass_answer_leakage") return passAnswerLeakage(row.answer_leakage);
  if (column === "pass_overall") return passOverall(row);
  return row[column as keyof RawComparisonRow];
}

export function buildComparisonCsv(rows: RawComparisonRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const body = rows.map((row) =>
    CSV_COLUMNS.map((column) => csvValue(csvRowValue(row, column))).join(",")
  );
  return `\uFEFF${[header, ...body].join("\r\n")}\r\n`;
}

export function comparisonCsvFilename(partLabel: string = "all", date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `KB Tutor_eval_${yyyy}-${mm}-${dd}_${partLabel}.csv`;
}
