"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { QUESTION_MAP, PartLabel } from "@/app/lib/questions";
import {
  COMPARE_JUDGE_MODELS,
  COMPARE_MODEL_CONFIGS,
} from "@/lib/compare/models";
import {
  aggregateRows,
  buildComparisonCsv,
  comparisonCsvFilename,
  passAnswerLeakage,
  passManageability,
  passOverall,
  passSpecificity,
  passTaskFocus,
} from "@/lib/compare/results";
import {
  CompareInput,
  CompareJudgeConfig,
  CompareMethod,
  CompareModelConfig,
  M1Q14TestCase,
  RawComparisonRow,
  SummaryComparisonRow,
} from "@/lib/compare/types";

const QUESTION = QUESTION_MAP.M1Q14;
const PARTS = ["A", "B", "C"] as const;
const METHODS: Array<{ id: CompareMethod; label: string }> = [
  { id: "1", label: "Method 1 · GradeOpt + RAG" },
  { id: "2", label: "Method 2 · Two-stage" },
  { id: "3", label: "Method 3 · Feedback-first" },
];
const RESULT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "explorer", label: "Feedback Explorer" },
  { id: "failures", label: "Failures" },
  { id: "raw", label: "Raw Rows" },
] as const;

type ResultTab = (typeof RESULT_TABS)[number]["id"];
type FilterValue = "all" | string;

function QuestionImage({ src }: { src: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) {
    return (
      <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-5 py-4 text-xs text-gray-400">
        Place image at <code className="rounded bg-gray-100 px-1">public{src}</code>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Question diagram"
      onError={() => setMissing(true)}
      className="w-full rounded-lg border border-gray-200 bg-white object-contain"
    />
  );
}

function numeric(value: number | null | "") {
  if (value === "" || value === null) return "—";
  return value.toFixed(2);
}

function percent(value: number | null) {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

function hasOfficialScore(testCase: M1Q14TestCase) {
  return PARTS.some((part) => typeof testCase.responses[part]?.official_score === "number");
}

function disabledReason(testCase: M1Q14TestCase) {
  const missing = PARTS.filter((part) => typeof testCase.responses[part]?.official_score !== "number");
  if (missing.length === PARTS.length) return "Official score required";
  if (missing.length > 0) return `Missing official score for ${missing.join(", ")}`;
  return "";
}

function buildPresetInputs(testCases: M1Q14TestCase[], selectedIds: Set<string>): CompareInput[] {
  return testCases
    .filter((testCase) => selectedIds.has(testCase.id))
    .flatMap((testCase) =>
      PARTS.flatMap((part) => {
        const candidate = testCase.responses[part];
        if (!candidate || typeof candidate.official_score !== "number" || !candidate.response.trim()) {
          return [];
        }
        return [
          {
            questionId: "M1Q14" as const,
            part,
            testCaseId: testCase.id,
            studentResponse: candidate.response.trim(),
            officialScore: candidate.official_score,
          },
        ];
      })
    );
}

function groupModelConfigs() {
  const groups = new Map<
    string,
    {
      key: string;
      provider: string;
      modelId: string;
      label: string;
      configs: CompareModelConfig[];
    }
  >();

  for (const config of COMPARE_MODEL_CONFIGS) {
    const key = `${config.provider}:${config.modelId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.configs.push(config);
    } else {
      groups.set(key, {
        key,
        provider: config.provider,
        modelId: config.modelId,
        label: config.label.replace(/\s·\stemp\s.+$/, ""),
        configs: [config],
      });
    }
  }

  return Array.from(groups.values());
}

function downloadCsv(rows: RawComparisonRow[]) {
  const csv = buildComparisonCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = comparisonCsvFilename("all");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function providerLabel(provider: string) {
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Claude";
  if (provider === "google") return "Gemini";
  return provider;
}

function heatColor(value: number | null) {
  if (value === null) return "border-gray-200 bg-gray-50 text-gray-400";
  if (value >= 3) return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (value >= 2.75) return "border-lime-300 bg-lime-50 text-lime-900";
  if (value >= 2.5) return "border-amber-300 bg-amber-50 text-amber-900";
  if (value >= 2) return "border-orange-300 bg-orange-50 text-orange-900";
  return "border-rose-300 bg-rose-50 text-rose-900";
}

function meanJudgeScore(row: SummaryComparisonRow | null) {
  if (!row) return null;
  const values = [
    row.taskFocusMean,
    row.specificityMean,
    row.manageabilityMean,
    row.answerLeakageMean,
    row.overallQualityMean,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function heatmapGroups(summaryRows: SummaryComparisonRow[]) {
  const groups = new Map<
    string,
    {
      key: string;
      provider: string;
      model: string;
      temperature: number;
      cells: Partial<Record<CompareMethod, SummaryComparisonRow>>;
    }
  >();

  for (const row of summaryRows) {
    const key = `${row.provider}|${row.model}|${row.temperature}`;
    const existing =
      groups.get(key) ??
      {
        key,
        provider: row.provider,
        model: row.model,
        temperature: row.temperature,
        cells: {},
      };
    existing.cells[String(row.method) as CompareMethod] = row;
    groups.set(key, existing);
  }

  return Array.from(groups.values()).sort((a, b) => {
    const provider = a.provider.localeCompare(b.provider);
    if (provider !== 0) return provider;
    const model = a.model.localeCompare(b.model);
    if (model !== 0) return model;
    return a.temperature - b.temperature;
  });
}

function bestSummary(
  rows: SummaryComparisonRow[],
  picker: (row: SummaryComparisonRow) => number | null,
  mode: "max" | "min" = "max"
) {
  const candidates = rows.filter((row) => picker(row) !== null);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, row) => {
    const bestValue = picker(best) ?? (mode === "max" ? -Infinity : Infinity);
    const rowValue = picker(row) ?? (mode === "max" ? -Infinity : Infinity);
    return mode === "max" ? (rowValue > bestValue ? row : best) : rowValue < bestValue ? row : best;
  });
}

function configLabel(summary: SummaryComparisonRow | null) {
  if (!summary) return "—";
  return `Method ${summary.method} · ${summary.model} · temp ${summary.temperature}`;
}

function passText(value: boolean | "") {
  if (value === "") return "—";
  return value ? "true" : "false";
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export default function ComparePage() {
  const [testCases, setTestCases] = useState<M1Q14TestCase[]>([]);
  const [selectedTestCaseIds, setSelectedTestCaseIds] = useState<Set<string>>(new Set());
  const [expandedTestCaseIds, setExpandedTestCaseIds] = useState<Set<string>>(new Set());
  const [selectedMethods, setSelectedMethods] = useState<Set<CompareMethod>>(
    new Set<CompareMethod>(["1", "2", "3"])
  );
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(
    new Set(COMPARE_MODEL_CONFIGS.map((config) => config.id))
  );
  const [repeats, setRepeats] = useState(5);
  const [judge, setJudge] = useState<CompareJudgeConfig>({
    provider: "openai",
    modelId: "gpt-5.4",
  });
  const [includeCustom, setIncludeCustom] = useState(false);
  const [customResponses, setCustomResponses] = useState<Record<PartLabel, string>>({
    A: "",
    B: "",
    C: "",
  });
  const [customOfficialScores, setCustomOfficialScores] = useState<Record<PartLabel, string>>({
    A: "",
    B: "",
    C: "",
  });
  const [rows, setRows] = useState<RawComparisonRow[]>([]);
  const [summaryRows, setSummaryRows] = useState<SummaryComparisonRow[]>([]);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [currentStatus, setCurrentStatus] = useState("Idle");
  const [running, setRunning] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [error, setError] = useState("");
  const [questionContextOpen, setQuestionContextOpen] = useState(true);
  const [resultTab, setResultTab] = useState<ResultTab>("overview");
  const [explorerMethod, setExplorerMethod] = useState<FilterValue>("all");
  const [explorerModel, setExplorerModel] = useState<FilterValue>("all");
  const [explorerTemperature, setExplorerTemperature] = useState<FilterValue>("all");
  const [explorerTestCase, setExplorerTestCase] = useState<FilterValue>("all");
  const [explorerPart, setExplorerPart] = useState<FilterValue>("all");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/compare-feedback")
      .then((res) => res.json())
      .then((data: { testCases?: M1Q14TestCase[] }) => {
        if (!cancelled) setTestCases(data.testCases ?? []);
      })
      .catch(() => {
        if (!cancelled) setTestCases([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCandidates = useMemo(
    () => COMPARE_MODEL_CONFIGS.filter((config) => selectedCandidateIds.has(config.id)),
    [selectedCandidateIds]
  );

  const presetInputs = useMemo(
    () => buildPresetInputs(testCases, selectedTestCaseIds),
    [testCases, selectedTestCaseIds]
  );

  const customInputs = useMemo<CompareInput[]>(() => {
    if (!includeCustom) return [];
    const inputs: CompareInput[] = [];
    for (const part of PARTS) {
      const partDef = QUESTION.parts.find((candidate) => candidate.label === part);
      const score = Number(customOfficialScores[part]);
      const response = customResponses[part].trim();
      if (
        !partDef ||
        !response ||
        !Number.isFinite(score) ||
        score < 0 ||
        score > partDef.maxScore
      ) {
        return [];
      }
      inputs.push({
        questionId: "M1Q14",
        part,
        testCaseId: "custom",
        studentResponse: response,
        officialScore: score,
      });
    }
    return inputs;
  }, [customOfficialScores, customResponses, includeCustom]);

  const allInputs = useMemo(
    () => [...presetInputs, ...customInputs],
    [customInputs, presetInputs]
  );

  const estimatedRows =
    allInputs.length * selectedMethods.size * selectedCandidates.length * repeats;
  const customComplete = !includeCustom || customInputs.length === PARTS.length;
  const canRun =
    allInputs.length > 0 &&
    customComplete &&
    selectedMethods.size > 0 &&
    selectedCandidates.length > 0 &&
    repeats >= 1 &&
    repeats <= 10 &&
    !running;

  function toggleMethod(method: CompareMethod) {
    setSelectedMethods((prev) => {
      const next = new Set(prev);
      if (next.has(method)) next.delete(method);
      else next.add(method);
      return next;
    });
  }

  function toggleCandidate(id: string) {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTestCase(id: string) {
    setSelectedTestCaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function stopRun() {
    abortControllerRef.current?.abort();
  }

  async function runComparison() {
    if (!canRun) return;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setRunning(true);
    setError("");
    setRows([]);
    setSummaryRows([]);
    setProgress({ completed: 0, total: estimatedRows });
    setCurrentStatus("Starting comparison run...");

    try {
      const res = await fetch("/api/compare-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: "M1Q14",
          inputs: allInputs,
          methods: Array.from(selectedMethods),
          candidates: selectedCandidates,
          repeats,
          judge,
        }),
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Comparison request failed.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const nextRows: RawComparisonRow[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as
            | { type: "result"; row: RawComparisonRow }
            | { type: "progress"; completed: number; total: number }
            | { type: "aggregate"; rows: SummaryComparisonRow[] }
            | { type: "status"; stage: string; message: string }
            | { type: "start"; total: number }
            | { type: "stopped" }
            | { type: "done" };

          if (event.type === "result") {
            nextRows.push(event.row);
            setRows([...nextRows]);
          } else if (event.type === "progress") {
            setProgress({ completed: event.completed, total: event.total });
          } else if (event.type === "aggregate") {
            setSummaryRows(event.rows);
          } else if (event.type === "status") {
            setCurrentStatus(event.message);
          } else if (event.type === "stopped") {
            setCurrentStatus("Run stopped.");
            setSummaryRows((prev) => (prev.length > 0 ? prev : aggregateRows(nextRows)));
          } else if (event.type === "done") {
            setCurrentStatus("Comparison run complete.");
          }
        }
      }

      setSummaryRows((prev) => (prev.length > 0 ? prev : aggregateRows(nextRows)));
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setCurrentStatus("Run stopped.");
        setSummaryRows((prev) => (prev.length > 0 ? prev : aggregateRows(rows)));
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong.");
        setCurrentStatus("Run failed.");
      }
    } finally {
      setRunning(false);
      abortControllerRef.current = null;
    }
  }

  const liveSummary = summaryRows.length > 0 ? summaryRows : aggregateRows(rows);
  const heatmap = useMemo(() => heatmapGroups(liveSummary), [liveSummary]);
  const modelGroups = useMemo(() => groupModelConfigs(), []);
  const liveRows = rows.slice(-12).reverse();
  const failureRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.status === "failed" ||
          Boolean(row.error) ||
          row.feedback.trim() === "" ||
          row.feedback === "No feedback returned." ||
          !row.judge_run
      ),
    [rows]
  );
  const explorerOptions = useMemo(
    () => ({
      models: uniqueSorted(rows.map((row) => row.model)),
      temperatures: uniqueSorted(rows.map((row) => String(row.temperature))),
      testCases: uniqueSorted(rows.map((row) => row.test_case_id)),
      parts: uniqueSorted(rows.map((row) => row.part)),
    }),
    [rows]
  );
  const explorerRows = useMemo(
    () =>
      rows.filter((row) => {
        if (explorerMethod !== "all" && String(row.method) !== explorerMethod) return false;
        if (explorerModel !== "all" && row.model !== explorerModel) return false;
        if (explorerTemperature !== "all" && String(row.temperature) !== explorerTemperature) return false;
        if (explorerTestCase !== "all" && row.test_case_id !== explorerTestCase) return false;
        if (explorerPart !== "all" && row.part !== explorerPart) return false;
        return true;
      }),
    [explorerMethod, explorerModel, explorerPart, explorerTemperature, explorerTestCase, rows]
  );
  const overviewStats = useMemo(
    () => ({
      bestMeanJudgeScore: bestSummary(liveSummary, meanJudgeScore),
      bestMatch: bestSummary(liveSummary, (row) => row.scoreMatchRate),
      fastest: bestSummary(liveSummary, (row) => row.averageLatencyMs, "min"),
      lowestTokens: bestSummary(liveSummary, (row) => row.averageTokens, "min"),
    }),
    [liveSummary]
  );

  function toggleTestCaseDetails(id: string) {
    setExpandedTestCaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-indigo-600">
              BioBridge Evaluation
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Feedback Comparison Workbench</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
              Compare Method 1, Method 2, and Method 3 feedback across model-temperature combinations for M1Q14.
            </p>
          </div>
          <a
            href="/"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Back to student flow
          </a>
        </div>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex gap-3 border-b border-gray-100 pb-4">
            <button
              type="button"
              onClick={() => setQuestionContextOpen((value) => !value)}
              className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-500 transition hover:bg-gray-50"
              aria-expanded={questionContextOpen}
              aria-label={questionContextOpen ? "Collapse question context" : "Expand question context"}
            >
              <svg
                className={`h-4 w-4 transition-transform ${questionContextOpen ? "rotate-90" : ""}`}
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M7.2 4.8a1 1 0 0 1 1.4 0l4.5 4.5a1 1 0 0 1 0 1.4l-4.5 4.5a1 1 0 1 1-1.4-1.4l3.8-3.8-3.8-3.8a1 1 0 0 1 0-1.4Z" />
              </svg>
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-indigo-50 px-2 py-1 font-semibold text-indigo-700">
                  {QUESTION.id}
                </span>
                <span className="text-gray-500">Standard {QUESTION.standard}</span>
                <span className="text-gray-400">·</span>
                <span className="text-gray-600">{QUESTION.topic}</span>
              </div>
              <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Question Context</h2>
                <span className="text-xs text-gray-400">
                  {questionContextOpen ? "Full context shown" : "Collapsed to stem only"}
                </span>
              </div>
            </div>
          </div>

          {!questionContextOpen ? (
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Stem</p>
              <p className="mt-2 text-sm leading-6 text-gray-700">{QUESTION.stem}</p>
            </div>
          ) : (
            <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Stem and diagram</p>
                <p className="mt-3 text-sm leading-6 text-gray-700">{QUESTION.stem}</p>
                {QUESTION.imageUrl && (
                  <div className="mt-4">
                    <QuestionImage src={QUESTION.imageUrl} />
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Part prompts</p>
                <div className="mt-3 space-y-3">
                  {QUESTION.parts.map((part) => (
                    <div key={part.label} className="rounded-xl border border-gray-200 bg-white p-4">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
                          {part.label}
                        </span>
                        <p className="text-sm font-semibold text-gray-700">Part {part.label}</p>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-gray-600">{part.prompt}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="space-y-6">
          <section className="space-y-6">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Test Cases</h2>
                <span className="text-xs text-gray-500">{testCases.length} loaded</span>
              </div>
              {testCases.length === 0 ? (
                <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  No preset test cases yet.
                </p>
              ) : (
                <div className="mt-4 grid gap-3">
                  {testCases.map((testCase) => {
                    const disabled = !hasOfficialScore(testCase);
                    const reason = disabledReason(testCase);
                    const expanded = expandedTestCaseIds.has(testCase.id);
                    return (
                      <div
                        key={testCase.id}
                        className={`rounded-xl border p-4 ${
                          disabled
                            ? "border-gray-200 bg-gray-50 opacity-60"
                            : "border-gray-300 bg-white hover:border-indigo-300"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={selectedTestCaseIds.has(testCase.id)}
                            onChange={() => toggleTestCase(testCase.id)}
                            className="mt-1 h-4 w-4"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">{testCase.label}</span>
                                {reason && (
                                  <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                                    {reason}
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleTestCaseDetails(testCase.id)}
                                className="self-start rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 md:self-auto"
                              >
                                {expanded ? "Hide responses" : "Show responses"}
                              </button>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                              {PARTS.map((part) => (
                                <span key={part} className="rounded bg-gray-50 px-2 py-1">
                                  Part {part}:{" "}
                                  {typeof testCase.responses[part]?.official_score === "number"
                                    ? `score ${testCase.responses[part]?.official_score}`
                                    : "score required"}
                                </span>
                              ))}
                            </div>
                            {expanded && (
                              <div className="mt-3 grid gap-3">
                              {PARTS.map((part) => (
                                <div key={part} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-xs font-semibold text-indigo-600">Part {part}</span>
                                    <span className="text-xs text-gray-500">
                                      {typeof testCase.responses[part]?.official_score === "number"
                                        ? `Official score: ${testCase.responses[part]?.official_score}`
                                        : "Official score required"}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-sm leading-5 text-gray-600">
                                    {testCase.responses[part]?.response ?? "No response provided."}
                                  </p>
                                </div>
                              ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={includeCustom}
                    onChange={(event) => setIncludeCustom(event.target.checked)}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="block font-semibold text-gray-900">Custom Test Case</span>
                    <span className="mt-0.5 block text-sm text-gray-500">
                      Enter Part A, B, and C responses with official scores.
                    </span>
                  </span>
                </label>
              {includeCustom && (
                <div className="mt-4 grid gap-4">
                  {PARTS.map((part) => {
                    const partDef = QUESTION.parts.find((candidate) => candidate.label === part);
                    return (
                      <div key={part} className="rounded-lg border border-gray-200 bg-white p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <p className="text-sm font-semibold text-indigo-600">Part {part}</p>
                          <label className="text-sm">
                            <span className="mr-2 text-gray-600">Official score</span>
                            <input
                              type="number"
                              min={0}
                              max={partDef?.maxScore ?? 1}
                              step={1}
                              value={customOfficialScores[part]}
                              onChange={(event) =>
                                setCustomOfficialScores((prev) => ({
                                  ...prev,
                                  [part]: event.target.value,
                                }))
                              }
                              className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-gray-900"
                            />
                          </label>
                        </div>
                        <textarea
                          value={customResponses[part]}
                          onChange={(event) =>
                            setCustomResponses((prev) => ({
                              ...prev,
                              [part]: event.target.value,
                            }))
                          }
                          rows={3}
                          placeholder={`Enter the custom response for Part ${part}...`}
                          className="mt-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Model × Temperature Matrix</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Select the exact model-temperature conditions to compare. Each checked cell runs once per method, part, test case, and repeat.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedCandidateIds(new Set(COMPARE_MODEL_CONFIGS.map((config) => config.id)))}
                    className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => setSelectedCandidateIds(new Set())}
                    className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-indigo-50 px-3 py-1 font-semibold text-indigo-700">
                  {selectedCandidates.length} / {COMPARE_MODEL_CONFIGS.length} conditions selected
                </span>
                <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">
                  Claude Opus 4.8 uses Anthropic provider default temperature
                </span>
              </div>
              <div className="mt-4 overflow-hidden rounded-xl border border-gray-200">
                <div className="grid grid-cols-[minmax(220px,1fr)_repeat(3,96px)] bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <span>Model</span>
                  <span className="text-center">Temp 0</span>
                  <span className="text-center">Temp 0.5</span>
                  <span className="text-center">Temp 1</span>
                </div>
                <div className="divide-y divide-gray-100 bg-white">
                  {modelGroups.map((group) => {
                    const configsByTemp = new Map(group.configs.map((config) => [config.temperature, config]));
                    return (
                      <div key={group.key} className="grid grid-cols-[minmax(220px,1fr)_repeat(3,96px)] items-center px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{group.label}</p>
                          <p className="text-xs text-gray-400">
                            {providerLabel(group.provider)} · {group.modelId}
                          </p>
                        </div>
                        {[0, 0.5, 1].map((temperature) => {
                          const config = configsByTemp.get(temperature);
                          return (
                            <label key={temperature} className="flex justify-center">
                              {config ? (
                                <span
                                  className={`inline-flex h-9 w-14 items-center justify-center rounded-lg border ${
                                    selectedCandidateIds.has(config.id)
                                      ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                                      : "border-gray-200 bg-white text-gray-400"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedCandidateIds.has(config.id)}
                                    onChange={() => toggleCandidate(config.id)}
                                    className="h-4 w-4"
                                    aria-label={`${group.label} temperature ${temperature}`}
                                  />
                                </span>
                              ) : (
                                <span className="text-xs text-gray-300">—</span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Run Settings</h2>
              <p className="mt-1 text-sm text-gray-500">
                Choose methods, repeats, and judge model before starting the comparison run.
              </p>
            </div>
            <span className="text-xs text-gray-400">Judge temperature is fixed at 0</span>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Configuration
              </p>
              <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(240px,0.9fr)_minmax(320px,1fr)]">
                <div>
                  <p className="mb-3 text-sm font-medium text-gray-700">Methods</p>
                  <div className="space-y-3">
                    {METHODS.map((method) => (
                      <label
                        key={method.id}
                        className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedMethods.has(method.id)}
                          onChange={() => toggleMethod(method.id)}
                          className="h-4 w-4"
                        />
                        <span>{method.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid content-start gap-4">
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-gray-700">Repeats</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={repeats}
                      onChange={(event) => setRepeats(Number(event.target.value))}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900"
                    />
                    <span className="mt-1 block text-xs text-gray-400">Default 5, max 10.</span>
                  </label>

                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-gray-700">Judge model</span>
                    <select
                      value={`${judge.provider}:${judge.modelId}`}
                      onChange={(event) => {
                        const [provider, modelId] = event.target.value.split(":");
                        setJudge({ provider: provider as CompareJudgeConfig["provider"], modelId });
                      }}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900"
                    >
                      {COMPARE_JUDGE_MODELS.map((model) => (
                        <option key={`${model.provider}:${model.modelId}`} value={`${model.provider}:${model.modelId}`}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Run
              </p>
              <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
                <div className="flex justify-between gap-4">
                  <span>Inputs</span>
                  <span className="font-semibold text-gray-900">{allInputs.length}</span>
                </div>
                <div className="mt-2 flex justify-between gap-4">
                  <span>Model-temperature candidates</span>
                  <span className="font-semibold text-gray-900">{selectedCandidates.length}</span>
                </div>
                <div className="mt-2 flex justify-between gap-4">
                  <span>Feedback rows</span>
                  <span className="font-semibold text-gray-900">{estimatedRows}</span>
                </div>
                <div className="mt-2 flex justify-between gap-4">
                  <span>Judge calls</span>
                  <span className="font-semibold text-gray-900">{estimatedRows}</span>
                </div>
              </div>
              {running ? (
                <button
                  onClick={stopRun}
                  className="mt-4 w-full rounded-xl bg-rose-600 px-4 py-3 font-semibold text-white hover:bg-rose-700"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={runComparison}
                  disabled={!canRun}
                  className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Run Grading
                </button>
              )}
              {progress && (
                <div className="mt-4 space-y-2">
                  <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                    <div
                      className="h-full bg-indigo-600 transition-all"
                      style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    {progress.completed} / {progress.total} rows completed
                  </p>
                </div>
              )}
              <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-indigo-500">
                  Current process
                </p>
                <p className="mt-1 text-sm leading-5 text-indigo-800">{currentStatus}</p>
              </div>
              {error && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  {error}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Results</h2>
              <p className="text-sm text-gray-500">
                {rows.length} raw rows · {failureRows.length} issues
              </p>
            </div>
            <button
              onClick={() => downloadCsv(rows)}
              disabled={rows.length === 0}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Export CSV
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 border-b border-gray-200 pb-3">
            {RESULT_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setResultTab(tab.id)}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${
                  resultTab === tab.id
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {resultTab === "overview" && (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Best Mean Judge Score</p>
                  <p className="mt-2 text-sm font-semibold text-gray-900">{configLabel(overviewStats.bestMeanJudgeScore)}</p>
                  <p className="mt-1 text-2xl font-bold text-indigo-700">{numeric(meanJudgeScore(overviewStats.bestMeanJudgeScore))}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Best Score Match</p>
                  <p className="mt-2 text-sm font-semibold text-gray-900">{configLabel(overviewStats.bestMatch)}</p>
                  <p className="mt-1 text-2xl font-bold text-indigo-700">{percent(overviewStats.bestMatch?.scoreMatchRate ?? null)}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Fastest</p>
                  <p className="mt-2 text-sm font-semibold text-gray-900">{configLabel(overviewStats.fastest)}</p>
                  <p className="mt-1 text-2xl font-bold text-indigo-700">
                    {overviewStats.fastest?.averageLatencyMs ? `${Math.round(overviewStats.fastest.averageLatencyMs)}ms` : "—"}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Lowest Token Cost</p>
                  <p className="mt-2 text-sm font-semibold text-gray-900">{configLabel(overviewStats.lowestTokens)}</p>
                  <p className="mt-1 text-2xl font-bold text-indigo-700">
                    {overviewStats.lowestTokens?.averageTokens ? Math.round(overviewStats.lowestTokens.averageTokens) : "—"}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Comparison Heatmap</h3>
                    <p className="text-xs text-gray-500">
                      Rows are model-temperature conditions. Color and main score use the average of all five judge dimensions.
                    </p>
                  </div>
                  <span className="text-xs text-gray-400">Mean Judge Score is scored 1-4</span>
                </div>
                {heatmap.length === 0 ? (
                  <p className="mt-4 rounded-lg border border-dashed border-gray-200 bg-white p-4 text-sm text-gray-400">
                    Heatmap will appear after at least one result is generated.
                  </p>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <div className="min-w-[860px] overflow-hidden rounded-xl border border-gray-200 bg-white">
                      <div className="grid grid-cols-[minmax(260px,1.1fr)_repeat(3,minmax(170px,1fr))] bg-white text-sm">
                        <div className="border-b border-gray-200 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                          Model condition
                        </div>
                        {METHODS.map((method) => (
                          <div
                            key={method.id}
                            className="border-b border-l border-gray-200 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500"
                          >
                            Method {method.id}
                          </div>
                        ))}
                        {heatmap.map((group) => (
                          <Fragment key={group.key}>
                            <div className="border-b border-gray-100 px-4 py-3">
                              <p className="font-semibold text-gray-800">{group.model}</p>
                              <p className="mt-1 text-xs text-gray-400">
                                {providerLabel(group.provider)} · temp {group.temperature}
                              </p>
                            </div>
                            {METHODS.map((method) => {
                              const cell = group.cells[method.id];
                              const score = meanJudgeScore(cell ?? null);
                              return (
                                <div key={method.id} className="border-b border-l border-gray-100 p-2">
                                  {cell ? (
                                    <div className={`rounded-lg border p-3 ${heatColor(score)}`}>
                                      <div className="flex items-center justify-between gap-3">
                                        <span className="text-xs font-semibold uppercase tracking-wider">Mean Judge Score</span>
                                        <span className="text-lg font-bold">{numeric(score)}</span>
                                      </div>
                                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                                        <span>Overall {numeric(cell.overallQualityMean)}</span>
                                        <span>Pass {percent(cell.passOverallRate)}</span>
                                        <span>Match {percent(cell.scoreMatchRate)}</span>
                                        <span>Rows {cell.successRows}/{cell.totalRows}</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3 text-center text-xs text-gray-400">
                                      No data
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Config</th>
                      <th className="px-3 py-2">Rows</th>
                      <th className="px-3 py-2">Score Match</th>
                      <th className="px-3 py-2">Mean Judge Score</th>
                      <th className="px-3 py-2">Overall</th>
                      <th className="px-3 py-2">Pass</th>
                      <th className="px-3 py-2">Latency</th>
                      <th className="px-3 py-2">Tokens</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {liveSummary.map((summary) => (
                      <tr key={summary.key}>
                        <td className="px-3 py-3">
                          <p className="font-medium">Method {summary.method} · {summary.model}</p>
                          <p className="text-xs text-gray-400">{summary.provider} · temp {summary.temperature}</p>
                        </td>
                        <td className="px-3 py-3">{summary.successRows}/{summary.totalRows}</td>
                        <td className="px-3 py-3">{percent(summary.scoreMatchRate)}</td>
                        <td className="px-3 py-3 font-semibold text-indigo-700">{numeric(meanJudgeScore(summary))}</td>
                        <td className="px-3 py-3">{numeric(summary.overallQualityMean)}</td>
                        <td className="px-3 py-3">{percent(summary.passOverallRate)}</td>
                        <td className="px-3 py-3">{summary.averageLatencyMs ? Math.round(summary.averageLatencyMs) : "—"} ms</td>
                        <td className="px-3 py-3">{summary.averageTokens ? Math.round(summary.averageTokens) : "—"}</td>
                      </tr>
                    ))}
                    {liveSummary.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-10 text-center text-gray-400">
                          No results yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {resultTab === "explorer" && (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-gray-600">Method</span>
                    <select value={explorerMethod} onChange={(event) => setExplorerMethod(event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
                      <option value="all">All</option>
                      {METHODS.map((method) => (
                        <option key={method.id} value={method.id}>Method {method.id}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-gray-600">Model</span>
                    <select value={explorerModel} onChange={(event) => setExplorerModel(event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
                      <option value="all">All</option>
                      {explorerOptions.models.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-gray-600">Temperature</span>
                    <select value={explorerTemperature} onChange={(event) => setExplorerTemperature(event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
                      <option value="all">All</option>
                      {explorerOptions.temperatures.map((temperature) => (
                        <option key={temperature} value={temperature}>temp {temperature}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-gray-600">Test Case</span>
                    <select value={explorerTestCase} onChange={(event) => setExplorerTestCase(event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
                      <option value="all">All</option>
                      {explorerOptions.testCases.map((testCase) => (
                        <option key={testCase} value={testCase}>{testCase}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-gray-600">Part</span>
                    <select value={explorerPart} onChange={(event) => setExplorerPart(event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
                      <option value="all">All</option>
                      {explorerOptions.parts.map((part) => (
                        <option key={part} value={part}>Part {part}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => {
                        setExplorerMethod("all");
                        setExplorerModel("all");
                        setExplorerTemperature("all");
                        setExplorerTestCase("all");
                        setExplorerPart("all");
                      }}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      Clear filters
                    </button>
                  </div>
                </div>
              </div>

              {running && liveRows.length > 0 && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-indigo-500">Live latest</p>
                  <p className="mt-1 text-sm text-indigo-800">
                    {liveRows[0].model} · Method {liveRows[0].method} · Part {liveRows[0].part}: {liveRows[0].feedback || "No feedback generated yet."}
                  </p>
                </div>
              )}

              <div className="max-h-[48rem] space-y-3 overflow-y-auto">
                {explorerRows.map((row, index) => (
                  <div
                    key={`${row.run_id}-${row.test_case_id}-${row.part}-${row.method}-${row.model}-${row.temperature}-${row.repeat_index}-${index}`}
                    className="rounded-xl border border-gray-200 bg-white p-4"
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded bg-indigo-50 px-2 py-1 font-semibold text-indigo-700">Method {row.method}</span>
                        <span className="rounded bg-gray-100 px-2 py-1 text-gray-600">{providerLabel(row.provider)} · {row.model}</span>
                        <span className="rounded bg-gray-100 px-2 py-1 text-gray-600">temp {row.temperature}</span>
                        <span className="rounded bg-gray-100 px-2 py-1 text-gray-600">repeat {row.repeat_index}</span>
                      </div>
                      <div className="text-xs text-gray-500">{row.test_case_id} · Part {row.part}</div>
                    </div>
                    <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                      <div className="rounded-lg bg-gray-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Student Response</p>
                        <p className="mt-1 text-sm leading-5 text-gray-600">{row.student_response}</p>
                        <p className="mt-2 text-xs text-gray-500">
                          AI score: {row.ai_score === "" ? "—" : row.ai_score} / Official: {row.official_score} · Match: {row.score_match === "" ? "—" : String(row.score_match)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Generated Feedback</p>
                        <p className="mt-1 text-sm leading-6 text-gray-700">{row.feedback || "No feedback generated."}</p>
                        {row.judge_rationale && (
                          <p className="mt-2 text-xs leading-5 text-gray-400">Judge rationale: {row.judge_rationale}</p>
                        )}
                        {row.error && <p className="mt-2 text-xs text-rose-600">{row.error}</p>}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                      <span>task {row.task_focus || "—"} ({String(passTaskFocus(row.task_focus))})</span>
                      <span>specificity {row.specificity || "—"} ({String(passSpecificity(row.specificity))})</span>
                      <span>manageability {row.manageability || "—"} ({String(passManageability(row.manageability))})</span>
                      <span>leakage {row.answer_leakage || "—"} ({String(passAnswerLeakage(row.answer_leakage))})</span>
                      <span>overall {row.overall_quality || "—"}</span>
                      <span>pass {String(passOverall(row))}</span>
                    </div>
                  </div>
                ))}
                {explorerRows.length === 0 && (
                  <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-400">
                    No feedback rows match the current filters.
                  </p>
                )}
              </div>
            </div>
          )}

          {resultTab === "failures" && (
            <div className="mt-4 space-y-3">
              {failureRows.map((row, index) => (
                <div key={`${row.run_id}-${row.test_case_id}-${row.part}-${row.method}-${index}`} className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                  <div className="flex flex-wrap gap-2 text-xs text-rose-700">
                    <span>Method {row.method}</span>
                    <span>{row.model}</span>
                    <span>temp {row.temperature}</span>
                    <span>{row.test_case_id}</span>
                    <span>Part {row.part}</span>
                    <span>repeat {row.repeat_index}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-rose-900">
                    {row.error || (row.feedback ? "Judge did not complete." : "No feedback returned.")}
                  </p>
                  {row.feedback && <p className="mt-2 text-sm text-rose-800">{row.feedback}</p>}
                </div>
              ))}
              {failureRows.length === 0 && (
                <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-400">
                  No failures or missing feedback rows.
                </p>
              )}
            </div>
          )}

          {resultTab === "raw" && (
            <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-[1400px] text-left text-xs">
                <thead className="bg-gray-50 uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Method</th>
                    <th className="px-3 py-2">Provider</th>
                    <th className="px-3 py-2">Model</th>
                    <th className="px-3 py-2">Temp</th>
                    <th className="px-3 py-2">Case</th>
                    <th className="px-3 py-2">Part</th>
                      <th className="px-3 py-2">Repeat</th>
                      <th className="px-3 py-2">AI/Official</th>
                      <th className="px-3 py-2">Task</th>
                      <th className="px-3 py-2">Specificity</th>
                      <th className="px-3 py-2">Manageability</th>
                      <th className="px-3 py-2">Leakage</th>
                      <th className="px-3 py-2">Overall</th>
                      <th className="px-3 py-2">Pass</th>
                    <th className="px-3 py-2">Latency</th>
                    <th className="px-3 py-2">Tokens</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {rows.map((row, index) => (
                    <tr key={`${row.run_id}-${index}`}>
                      <td className="px-3 py-2">{row.method}</td>
                      <td className="px-3 py-2">{row.provider}</td>
                      <td className="px-3 py-2">{row.model}</td>
                      <td className="px-3 py-2">{row.temperature}</td>
                      <td className="px-3 py-2">{row.test_case_id}</td>
                      <td className="px-3 py-2">{row.part}</td>
                      <td className="px-3 py-2">{row.repeat_index}</td>
                      <td className="px-3 py-2">{row.ai_score === "" ? "—" : row.ai_score}/{row.official_score}</td>
                      <td className="px-3 py-2">{row.task_focus || "—"}</td>
                      <td className="px-3 py-2">{row.specificity || "—"}</td>
                      <td className="px-3 py-2">{row.manageability || "—"}</td>
                      <td className="px-3 py-2">{row.answer_leakage || "—"}</td>
                      <td className="px-3 py-2">{row.overall_quality || "—"}</td>
                      <td className="px-3 py-2">{passText(passOverall(row))}</td>
                      <td className="px-3 py-2">{row.grading_latency_ms || "—"}</td>
                      <td className="px-3 py-2">{row.grading_token_count || "—"}</td>
                      <td className="px-3 py-2">{row.status}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={17} className="px-3 py-10 text-center text-gray-400">
                        No raw rows yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
