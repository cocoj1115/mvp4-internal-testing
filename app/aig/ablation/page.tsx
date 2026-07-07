"use client";

import { useMemo, useRef, useState } from "react";
import type React from "react";
import { COMPARE_JUDGE_MODELS, COMPARE_MODEL_CONFIGS } from "@/lib/compare/models";
import type { CompareJudgeConfig } from "@/lib/compare/types";
import type { AIGStimulusType, Blueprint, GeneratedItem, StyleCheckResult } from "@/lib/aig/types";
import { StimulusAsset } from "../StimulusAsset";

type ConfigId = "C0" | "C1" | "C2" | "C3" | "C4" | "M1" | "M1R";
type Decision = "Ready for SME review / pilot" | "Minor revision" | "Major revision" | "Reject or regenerate";

interface ConfigDef {
  id: ConfigId;
  label: string;
  family: "method2" | "method1";
  hypothesis?: string;
  dimensions?: number[];
}

const CONFIGS: ConfigDef[] = [
  { id: "C0", label: "Method2 Full", family: "method2" },
  { id: "C1", label: "Method2 -Blueprint", family: "method2", hypothesis: "H1", dimensions: [1, 3, 8, 10] },
  { id: "C2", label: "Method2 -RAG", family: "method2", hypothesis: "H2", dimensions: [2, 4, 6] },
  { id: "C3", label: "Method2 TELeR L2", family: "method2", hypothesis: "H3", dimensions: [1, 9, 10] },
  { id: "C4", label: "Method2 TELeR L4", family: "method2", hypothesis: "H4", dimensions: [3, 7, 10] },
  { id: "M1", label: "Method1 Raw", family: "method1" },
  { id: "M1R", label: "Method1 + Retry", family: "method1" },
];

const STANDARD_DETAILS = [
  {
    code: "3.1.9-12.A",
    module: "A",
    label: "DNA structure determines protein structure",
  },
  {
    code: "3.1.9-12.B",
    module: "A",
    label: "Hierarchical organization of multicellular systems",
  },
  {
    code: "3.1.9-12.D",
    module: "B",
    label: "Cellular division and differentiation",
  },
  {
    code: "3.1.9-12.N",
    module: "B",
    label: "Reducing human impact on environment and biodiversity",
  },
] as const;

const STANDARDS = STANDARD_DETAILS.map((standard) => standard.code);

const RESULT_COLUMN_HELP = [
  { term: "N", text: "Judged items in this config." },
  { term: "Mean Score", text: "Weighted 0-100 score from the 12 rubric dimensions." },
  { term: "Hard Gate Pass", text: "Pass rate across the four required gates." },
  { term: "Decision Columns", text: "Counts by final bank-readiness decision." },
];

const DIMENSIONS = [
  { id: 1, key: "kc_standard_alignment", label: "KC / Standard Alignment", weight: 15 },
  { id: 2, key: "scientific_accuracy", label: "Scientific Accuracy", weight: 15 },
  { id: 3, key: "cognitive_demand_task_type_fit", label: "Cognitive Demand & Task-Type Fit", weight: 10 },
  { id: 4, key: "relevance_context_grounding", label: "Relevance / Context Grounding", weight: 8 },
  { id: 5, key: "appropriateness_accessibility", label: "Appropriateness & Accessibility", weight: 7 },
  { id: 6, key: "stimulus_data_quality", label: "Stimulus / Data Quality", weight: 10 },
  { id: 7, key: "answerability_evidence_sufficiency", label: "Answerability & Evidence Sufficiency", weight: 10 },
  { id: 8, key: "multi_part_coherence", label: "Multi-Part Coherence", weight: 5 },
  { id: 9, key: "clarity_grammaticality", label: "Clarity & Grammaticality", weight: 5 },
  { id: 10, key: "rubric_alignment_scorability", label: "Rubric Alignment & Scorability", weight: 10 },
  { id: 11, key: "annotated_response_quality", label: "Annotated Response Quality", weight: 3 },
  { id: 12, key: "novelty_non_duplication", label: "Novelty / Non-Duplication", weight: 2 },
] as const;

type DimensionKey = (typeof DIMENSIONS)[number]["key"];

interface GateResult {
  pass: boolean;
  rationale: string;
}

interface DimensionScore {
  score: number;
  rationale: string;
}

interface JudgeResult {
  hard_gates: Record<string, GateResult>;
  dimension_scores: Record<DimensionKey, DimensionScore>;
  weighted_score: number;
  hard_gates_pass: boolean;
  decision: Decision;
  rationale: string;
  latencyMs: number;
}

interface GenerationResult {
  blueprint?: Blueprint;
  item: GeneratedItem;
  grounding: {
    study_guide: { empty: boolean; chunk_ids: string[] };
    rubric: { empty: boolean; items: string[] };
    cards: { empty: boolean; card_ids: string[] };
  };
  style_check?: StyleCheckResult;
  metadata?: {
    style_check_enabled: boolean;
    retry_enabled: boolean;
    max_attempts: number;
    attempts: number;
    final_status: "not_checked" | "passed" | "failed" | "max_attempts_reached";
  };
}

interface ResultRow {
  run_id: string;
  timestamp: string;
  config: {
    id: ConfigId;
    label: string;
    methodFamily: "method2" | "method1";
    retryEnabled: boolean;
  };
  standard_code: string;
  replicate_index: number;
  fixed_core_kc: string;
  stimulus_type: Exclude<AIGStimulusType, "auto" | "none">;
  model: string;
  temperature: number;
  judge: CompareJudgeConfig;
  generation: GenerationResult;
  judge_result: JudgeResult;
  latency_ms: number;
  status: "success";
}

interface FailedRow {
  run_id: string;
  timestamp: string;
  config: ConfigDef;
  standard_code: string;
  replicate_index: number;
  model: string;
  temperature: number;
  error: string;
  status: "failed";
}

type AnyRow = ResultRow | FailedRow;

interface PlannedRow {
  configId: ConfigId;
  standardCode: string;
  replicateIndex: number;
}

type RunStatus = "idle" | "running" | "stopped" | "complete";

const UNIQUE_MODELS = Array.from(new Map(COMPARE_MODEL_CONFIGS.map((c) => [c.modelId, c])).values());

function isSuccess(row: AnyRow): row is ResultRow {
  return row.status === "success";
}

function plannedKey(row: PlannedRow) {
  return `${row.configId}:${row.standardCode}:${row.replicateIndex}`;
}

function completedKey(row: AnyRow) {
  return `${row.config.id}:${row.standard_code}:${row.replicate_index}`;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatNumber(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function percent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function makeRunId() {
  return `aig-ablation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function csvValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
  return `"${String(value).replace(/"/g, '""')}"`;
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function buildCsv(rows: AnyRow[]) {
  const columns = [
    "run_id",
    "timestamp",
    "status",
    "config_id",
    "config_label",
    "method_family",
    "retry_enabled",
    "standard_code",
    "replicate_index",
    "fixed_core_kc",
    "stimulus_type",
    "model",
    "temperature",
    "judge_provider",
    "judge_model",
    "weighted_score",
    "hard_gates_pass",
    "decision",
    "judge_rationale",
    "item_stem",
    "part_a",
    "part_b",
    "part_c",
    "rubric_3",
    "rubric_2",
    "rubric_1",
    "rubric_0",
    "part_rubrics_json",
    "annotated_responses_json",
    "generation_latency_ms",
    "judge_latency_ms",
    "error",
    ...DIMENSIONS.map((dimension) => `d${dimension.id}_${dimension.key}`),
  ];
  const body = rows.map((row) => {
    if (!isSuccess(row)) {
      const config = row.config;
      return columns.map((column) => {
        const map: Record<string, unknown> = {
          run_id: row.run_id,
          timestamp: row.timestamp,
          status: row.status,
          config_id: config.id,
          config_label: config.label,
          method_family: config.family,
          standard_code: row.standard_code,
          replicate_index: row.replicate_index,
          model: row.model,
          temperature: row.temperature,
          error: row.error,
        };
        return csvValue(map[column]);
      }).join(",");
    }
    const map: Record<string, unknown> = {
      run_id: row.run_id,
      timestamp: row.timestamp,
      status: row.status,
      config_id: row.config.id,
      config_label: row.config.label,
      method_family: row.config.methodFamily,
      retry_enabled: row.generation.metadata?.retry_enabled ?? false,
      standard_code: row.standard_code,
      replicate_index: row.replicate_index,
      fixed_core_kc: row.fixed_core_kc,
      stimulus_type: row.stimulus_type,
      model: row.model,
      temperature: row.temperature,
      judge_provider: row.judge.provider,
      judge_model: row.judge.modelId,
      weighted_score: row.judge_result.weighted_score,
      hard_gates_pass: row.judge_result.hard_gates_pass,
      decision: row.judge_result.decision,
      judge_rationale: row.judge_result.rationale,
      item_stem: row.generation.item.stem,
      part_a: row.generation.item.parts["Part A"]?.question ?? "",
      part_b: row.generation.item.parts["Part B"]?.question ?? "",
      part_c: row.generation.item.parts["Part C"]?.question ?? "",
      rubric_3: row.generation.item.scoring_rubric["3"],
      rubric_2: row.generation.item.scoring_rubric["2"],
      rubric_1: row.generation.item.scoring_rubric["1"],
      rubric_0: row.generation.item.scoring_rubric["0"],
      part_rubrics_json: JSON.stringify(row.generation.item.part_rubrics ?? {}),
      annotated_responses_json: JSON.stringify(row.generation.item.annotated_responses ?? []),
      generation_latency_ms: row.latency_ms,
      judge_latency_ms: row.judge_result.latencyMs,
      error: "",
    };
    for (const dimension of DIMENSIONS) {
      map[`d${dimension.id}_${dimension.key}`] = row.judge_result.dimension_scores[dimension.key]?.score;
    }
    return columns.map((column) => csvValue(map[column])).join(",");
  });
  return `\uFEFF${[columns.join(","), ...body].join("\r\n")}\r\n`;
}

function aggregateByConfig(rows: ResultRow[]) {
  return CONFIGS.map((config) => {
    const group = rows.filter((row) => row.config.id === config.id);
    const decisionCounts = group.reduce<Record<string, number>>((counts, row) => {
      counts[row.judge_result.decision] = (counts[row.judge_result.decision] ?? 0) + 1;
      return counts;
    }, {});
    const dimensionMeans = Object.fromEntries(
      DIMENSIONS.map((dimension) => [
        dimension.id,
        mean(group.map((row) => row.judge_result.dimension_scores[dimension.key]?.score).filter((value): value is number => typeof value === "number")),
      ])
    ) as Record<number, number | null>;
    return {
      config,
      count: group.length,
      weightedMean: mean(group.map((row) => row.judge_result.weighted_score)),
      hardGatePassRate: group.length === 0 ? null : group.filter((row) => row.judge_result.hard_gates_pass).length / group.length,
      dimensionMeans,
      decisionCounts,
    };
  });
}

function scoreColor(score: number) {
  if (score >= 5) return { background: "#dcfce7", color: "#166534", borderColor: "#86efac" };
  if (score >= 4) return { background: "#ecfdf5", color: "#047857", borderColor: "#a7f3d0" };
  if (score >= 3) return { background: "#fffbeb", color: "#92400e", borderColor: "#fde68a" };
  if (score >= 2) return { background: "#fff7ed", color: "#c2410c", borderColor: "#fed7aa" };
  return { background: "#fef2f2", color: "#b91c1c", borderColor: "#fecaca" };
}

function DimensionScores({ row }: { row: ResultRow }) {
  return (
      <div style={{ marginTop: 16 }}>
      <div style={sectionSubheadStyle}>Rubric Dimension Scores</div>
      <p style={helpTextStyle}>
        Per-dimension judge scores. The weighted score is computed from these values.
      </p>
      <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 10 }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th>#</th>
              <th>Dimension</th>
              <th>Score</th>
              <th>Weight</th>
              <th>Rationale</th>
            </tr>
          </thead>
          <tbody>
            {DIMENSIONS.map((dimension) => {
              const score = row.judge_result.dimension_scores[dimension.key];
              const color = scoreColor(score.score);
              return (
                <tr key={dimension.id}>
                  <td>{dimension.id}</td>
                  <td>{dimension.label}</td>
                  <td>
                    <span style={{ ...scorePillStyle, ...color }}>
                      {score.score}/5
                    </span>
                  </td>
                  <td>{dimension.weight}</td>
                  <td>{score.rationale}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GeneratedItemsExplorer({
  rows,
  selectedKey,
  onSelect,
}: {
  rows: ResultRow[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p style={emptyStateStyle}>
        Run the study to see every generated item here.
      </p>
    );
  }

  const selectedRow = rows.find((row) => rowKey(row) === selectedKey) ?? rows[rows.length - 1];

  return (
    <div style={itemExplorerStyle}>
      <div style={itemTableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th>Config</th>
              <th>Standard</th>
              <th>Rep</th>
              <th>Score</th>
              <th>Decision</th>
              <th>Stem</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = rowKey(row);
              const active = key === rowKey(selectedRow);
              return (
                <tr
                  key={key}
                  onClick={() => onSelect(key)}
                  style={{
                    background: active ? "#eef2ff" : undefined,
                    cursor: "pointer",
                  }}
                >
                  <td>
                    <span style={configPillStyle}>{row.config.id}</span>
                  </td>
                  <td>{row.standard_code}</td>
                  <td>{row.replicate_index + 1}</td>
                  <td>
                    <span style={{ ...scorePillStyle, ...scoreColor(Math.round(row.judge_result.weighted_score / 20)) }}>
                      {row.judge_result.weighted_score.toFixed(1)}
                    </span>
                  </td>
                  <td>{row.judge_result.decision}</td>
                  <td>
                    <span style={tableStemPreviewStyle}>{row.generation.item.stem}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <aside style={itemSideStyle}>
        <DetailPanel row={selectedRow} />
      </aside>
    </div>
  );
}

function DetailPanel({ row }: { row: ResultRow }) {
  const item = row.generation.item;
  return (
    <div style={panelStyle}>
      <div style={sectionTitleStyle}>Generated Item Detail</div>
      <div style={metaGridStyle}>
        <Field label="Config" value={`${row.config.id} ${row.config.label}`} />
        <Field label="Standard" value={row.standard_code} />
        <Field label="Core KC" value={row.fixed_core_kc} />
        <Field label="Stimulus" value={row.stimulus_type} />
        <Field label="Weighted Score" value={row.judge_result.weighted_score.toFixed(1)} />
        <Field label="Decision" value={row.judge_result.decision} />
      </div>
      <Field label="Judge Summary" value={row.judge_result.rationale} />
      <DimensionScores row={row} />
      <div style={{ marginTop: 14 }}>
        <span style={labelStyle}>Hard Gates</span>
        <div style={gateGridStyle}>
          {Object.entries(row.judge_result.hard_gates).map(([key, gate]) => (
            <div key={key} style={{ ...gateStyle, borderColor: gate.pass ? "#86efac" : "#fecaca", background: gate.pass ? "#f0fdf4" : "#fef2f2" }}>
              <strong>{key.replaceAll("_", " ")}</strong>
              <span style={{ color: gate.pass ? "#15803d" : "#b91c1c", fontWeight: 700 }}>{gate.pass ? "PASS" : "FAIL"}</span>
              <p>{gate.rationale}</p>
            </div>
          ))}
        </div>
      </div>
      {row.generation.blueprint && (
        <BlueprintSummary blueprint={row.generation.blueprint} />
      )}
      <div style={{ marginTop: 16 }}>
        <span style={labelStyle}>Stem</span>
        <p style={{ margin: "4px 0 12px", lineHeight: 1.6 }}>{item.stem}</p>
        {item.stimulus_asset.type !== "none" && <StimulusAsset asset={item.stimulus_asset} />}
        {(["Part A", "Part B", "Part C"] as const).filter((part) => item.parts[part]).map((part) => (
          <div key={part} style={partStyle}>
            <strong>{part}</strong>
            <span style={taskTypeStyle}>{item.parts[part]!.task_type}</span>
            <p>{item.parts[part]!.question}</p>
          </div>
        ))}
        <span style={labelStyle}>Rubric</span>
        <div style={rubricStyle}>
          {(["3", "2", "1", "0"] as const).map((score) => (
            <div key={score} style={rubricRowStyle}>
              <strong style={rubricScoreStyle}>{score}</strong>
              <span>{item.scoring_rubric[score]}</span>
            </div>
          ))}
        </div>
        {item.part_rubrics && <PartRubrics rubrics={item.part_rubrics} />}
        {item.annotated_responses && <AnnotatedResponses responses={item.annotated_responses} />}
      </div>
    </div>
  );
}

function BlueprintSummary({ blueprint }: { blueprint: Blueprint }) {
  const taskParts = (["Part A", "Part B", "Part C"] as const).filter((part) => blueprint.task_sequence[part]);
  return (
    <div style={{ marginTop: 14 }}>
      <div style={sectionSubheadStyle}>Blueprint</div>
      <div style={metaGridStyle}>
        <Field label="Anchor KC" value={blueprint.anchor_kc} />
        <Field label="Core KC" value={blueprint.core_kc} />
        <Field label="Stimulus Type" value={blueprint.stimulus_type} />
        <Field label="Cognitive Demand" value={blueprint.cognitive_demand} />
      </div>
      {blueprint.stem_affordance && <Field label="Stem Affordance" value={blueprint.stem_affordance} />}
      {blueprint.evidence_pattern && <Field label="Evidence Pattern" value={blueprint.evidence_pattern} />}
      <div style={{ marginTop: 10, overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 10 }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th>Part</th>
              <th>KC</th>
              <th>Task Type</th>
              <th>Function</th>
            </tr>
          </thead>
          <tbody>
            {taskParts.map((partName) => {
              const part = blueprint.task_sequence[partName]!;
              return (
                <tr key={partName}>
                  <td>{partName}</td>
                  <td>{part.kc_code}</td>
                  <td>{part.task_type}</td>
                  <td>{part.function}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ListField label="Key Concepts" values={blueprint.key_concepts} />
      <ListField label="Expected Response Elements" values={blueprint.expected_response_elements} />
      <ListField label="Common Incomplete Responses" values={blueprint.common_incomplete_responses} />
      <details style={{ marginTop: 12 }}>
        <summary style={summaryStyle}>Raw blueprint JSON</summary>
        <pre style={preStyle}>{JSON.stringify(blueprint, null, 2)}</pre>
      </details>
    </div>
  );
}

function PartRubrics({ rubrics }: { rubrics: NonNullable<GeneratedItem["part_rubrics"]> }) {
  return (
    <div style={{ marginTop: 14 }}>
      <span style={labelStyle}>Part Rubrics</span>
      <div style={partRubricGridStyle}>
        {(["Part A", "Part B", "Part C"] as const).filter((part) => rubrics[part]).map((part) => {
          const rubric = rubrics[part]!;
          return (
            <div key={part} style={partStyle}>
              <strong>{part}</strong>
              <span style={taskTypeStyle}>{rubric.points_possible} pt</span>
              <div style={{ marginTop: 8 }}>
                {Object.entries(rubric.criteria)
                  .sort(([a], [b]) => Number(b) - Number(a))
                  .map(([score, criterion]) => (
                    <div key={score} style={rubricRowStyle}>
                      <strong style={rubricScoreStyle}>{score}</strong>
                      <span>{criterion}</span>
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AnnotatedResponses({ responses }: { responses: NonNullable<GeneratedItem["annotated_responses"]> }) {
  return (
    <div style={{ marginTop: 14 }}>
      <span style={labelStyle}>Annotated Responses</span>
      <div style={rubricStyle}>
        {[...responses]
          .sort((a, b) => b.score - a.score)
          .map((response) => (
            <div key={response.score} style={annotatedResponseStyle}>
              <strong style={rubricScoreStyle}>{response.score}</strong>
              <div>
                <p style={{ margin: "0 0 6px", lineHeight: 1.5 }}>{response.response}</p>
                <p style={{ margin: 0, color: "#6b7280", lineHeight: 1.5 }}>{response.annotation}</p>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

function ListField({ label, values }: { label: string; values?: string[] }) {
  if (!values || values.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <span style={labelStyle}>{label}</span>
      <ul style={listStyle}>
        {values.map((value, index) => (
          <li key={`${label}-${index}`}>{value}</li>
        ))}
      </ul>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <span style={labelStyle}>{label}</span>
      <span style={{ fontSize: 14, color: "#111827" }}>{value}</span>
    </div>
  );
}

export default function AblationPage() {
  const [modelId, setModelId] = useState(UNIQUE_MODELS[0]?.modelId ?? "");
  const [temperature, setTemperature] = useState(0);
  const [judgeId, setJudgeId] = useState(COMPARE_JUDGE_MODELS[0]?.modelId ?? "");
  const [itemsPerCell, setItemsPerCell] = useState(3);
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [running, setRunning] = useState(false);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [runId, setRunId] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [currentTask, setCurrentTask] = useState<PlannedRow | null>(null);
  const [currentMessage, setCurrentMessage] = useState("Ready.");
  const stopRequestedRef = useRef(false);

  const selectedModel = UNIQUE_MODELS.find((model) => model.modelId === modelId) ?? UNIQUE_MODELS[0];
  const selectedJudge = COMPARE_JUDGE_MODELS.find((judge) => judge.modelId === judgeId) ?? COMPARE_JUDGE_MODELS[0];
  const successRows = rows.filter(isSuccess);
  const aggregates = useMemo(() => aggregateByConfig(successRows), [successRows]);
  const plannedRows = useMemo<PlannedRow[]>(() => {
    const planned: PlannedRow[] = [];
    for (const standardCode of STANDARDS) {
      for (let replicateIndex = 0; replicateIndex < itemsPerCell; replicateIndex++) {
        for (const config of CONFIGS) {
          planned.push({ standardCode, replicateIndex, configId: config.id });
        }
      }
    }
    return planned;
  }, [itemsPerCell]);
  const completedCount = rows.length;
  const progressCount = running ? Math.max(currentIndex, completedCount) : completedCount;
  const progressPercent = plannedRows.length === 0 ? 0 : Math.round((progressCount / plannedRows.length) * 100);
  const canResume = !running && runStatus === "stopped";
  const controlsLocked = running || runStatus === "stopped";

  async function runStudy(mode: "new" | "resume" = "new") {
    if (!selectedModel || !selectedJudge) return;
    const nextRunId = mode === "resume" && runId ? runId : makeRunId();
    const existingKeys = mode === "resume" ? new Set(rows.map(completedKey)) : new Set<string>();
    let completedRows: AnyRow[] = mode === "resume" ? [...rows] : [];
    const rowsToRun = plannedRows.filter((row) => !existingKeys.has(plannedKey(row)));

    if (rowsToRun.length === 0) {
      setRunStatus("complete");
      setCurrentMessage("Run complete.");
      setCurrentTask(null);
      return;
    }

    stopRequestedRef.current = false;
    setRunId(nextRunId);
    if (mode === "new") {
      setRows([]);
      setSelectedKey("");
      setCurrentIndex(0);
    } else {
      setCurrentIndex(existingKeys.size);
    }
    setRunStatus("running");
    setRunning(true);
    for (let i = 0; i < rowsToRun.length; i++) {
      if (stopRequestedRef.current) {
        setRunStatus("stopped");
        setCurrentMessage("Stopped. Resume to continue remaining items.");
        break;
      }

      const planned = rowsToRun[i];
      const completedBeforeThisRun = mode === "resume" ? existingKeys.size + i : i;
      setCurrentIndex(completedBeforeThisRun + 1);
      setCurrentTask(planned);
      const config = CONFIGS.find((entry) => entry.id === planned.configId)!;
      const baselineBlueprint = planned.configId === "C3" || planned.configId === "C4"
        ? completedRows.find(
            (row): row is ResultRow =>
              isSuccess(row) &&
              row.config.id === "C0" &&
              row.standard_code === planned.standardCode &&
              row.replicate_index === planned.replicateIndex &&
              Boolean(row.generation.blueprint)
          )?.generation.blueprint
        : undefined;
      setCurrentMessage(`Generating and judging ${config.id} · ${planned.standardCode} · rep ${planned.replicateIndex + 1}`);
      try {
        const response = await fetch("/api/aig/ablation/run-one", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: nextRunId,
            configId: planned.configId,
            standardCode: planned.standardCode,
            replicateIndex: planned.replicateIndex,
            model: selectedModel.modelId,
            temperature,
            judge: {
              provider: selectedJudge.provider,
              modelId: selectedJudge.modelId,
            },
            baselineBlueprint,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "Unknown error");
        }
        const row = data as ResultRow;
        completedRows = [...completedRows, row];
        setRows((prev) => [...prev, row]);
        setSelectedKey(rowKey(row));
        setCurrentMessage(`Completed ${config.id} · ${planned.standardCode} · rep ${planned.replicateIndex + 1}`);
      } catch (err) {
        const failed: FailedRow = {
          run_id: nextRunId,
          timestamp: new Date().toISOString(),
          config,
          standard_code: planned.standardCode,
          replicate_index: planned.replicateIndex,
          model: selectedModel.modelId,
          temperature,
          error: err instanceof Error ? err.message : String(err),
          status: "failed",
        };
        completedRows = [...completedRows, failed];
        setRows((prev) => [...prev, failed]);
      }
      if (stopRequestedRef.current) {
        setRunStatus("stopped");
        setCurrentMessage("Stopped. Resume to continue remaining items.");
        break;
      }
    }
    setRunning(false);
    setCurrentTask(null);
    const finishedCount = completedRows.length;
    if (stopRequestedRef.current) {
      setRunStatus("stopped");
      setCurrentMessage("Stopped. Resume to continue remaining items.");
    } else if (finishedCount >= plannedRows.length) {
      setRunStatus("complete");
      setCurrentIndex(plannedRows.length);
      setCurrentMessage("Run complete.");
    }
  }

  function stopRun() {
    if (!running) return;
    stopRequestedRef.current = true;
    setCurrentMessage("Stop requested. Finishing the current item first.");
  }

  function exportJson() {
    download(`${runId || "aig-ablation"}-results.json`, JSON.stringify(rows, null, 2), "application/json;charset=utf-8");
  }

  function exportCsv() {
    download(`${runId || "aig-ablation"}-results.csv`, buildCsv(rows), "text/csv;charset=utf-8");
  }

  const c0 = aggregates.find((aggregate) => aggregate.config.id === "C0");
  const m1 = aggregates.find((aggregate) => aggregate.config.id === "M1");

  return (
    <main className="ablation-page" style={pageStyle}>
      <style jsx global>{`
        .ablation-page table th {
          background: #f9fafb;
          color: #6b7280;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          padding: 10px 12px;
          text-align: left;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .ablation-page table td {
          border-top: 1px solid #f3f4f6;
          color: #374151;
          padding: 11px 12px;
          vertical-align: top;
        }
        .ablation-page table tbody tr:hover {
          background: #f9fafb;
        }
        .ablation-page button:disabled {
          cursor: not-allowed !important;
          opacity: 0.45;
        }
        .ablation-page input:focus,
        .ablation-page select:focus {
          border-color: #818cf8;
          box-shadow: 0 0 0 2px rgba(129, 140, 248, 0.35);
          outline: none;
        }
        @keyframes ablation-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 24px" }}>
        <div style={panelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 26, color: "#111827", letterSpacing: "-0.01em" }}>AIG Ablation Study</h1>
              <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 14 }}>
                Method2 component ablation plus Method1 raw/retry comparison.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={secondaryButtonStyle} disabled={rows.length === 0} onClick={exportCsv}>Export CSV</button>
              <button type="button" style={secondaryButtonStyle} disabled={rows.length === 0} onClick={exportJson}>Export JSON</button>
            </div>
          </div>

          <div style={infoBoxStyle}>
            <div>
              <strong>Standards in this study</strong>
              <div style={standardGridStyle}>
                {STANDARD_DETAILS.map((standard) => (
                  <div key={standard.code} style={standardChipStyle}>
                    <span style={{ fontWeight: 800, color: "#4f46e5" }}>{standard.code}</span>
                    <span style={{ color: "#6b7280" }}>Module {standard.module}</span>
                    <span>{standard.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <p style={{ ...helpTextStyle, marginTop: 12 }}>
              CSV exports scored rows. JSON exports full generated items and judge output.
            </p>
          </div>

          <div style={controlGridStyle}>
            <div>
              <label style={labelStyle}>Generation Model</label>
              <select value={modelId} onChange={(event) => setModelId(event.target.value)} style={selectStyle} disabled={controlsLocked}>
                {UNIQUE_MODELS.map((model) => (
                  <option key={model.modelId} value={model.modelId}>{model.label.replace(/ · .*/, "")}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Temperature</label>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(event) => setTemperature(Number(event.target.value))}
                style={selectStyle}
                disabled={controlsLocked}
              />
            </div>
            <div>
              <label style={labelStyle}>Judge Model</label>
              <select value={judgeId} onChange={(event) => setJudgeId(event.target.value)} style={selectStyle} disabled={controlsLocked}>
                {COMPARE_JUDGE_MODELS.map((judge) => (
                  <option key={`${judge.provider}:${judge.modelId}`} value={judge.modelId}>{judge.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Replicates per standard/config</label>
              <input
                type="number"
                min={1}
                max={5}
                value={itemsPerCell}
                onChange={(event) => setItemsPerCell(Math.max(1, Math.min(5, Number(event.target.value))))}
                style={selectStyle}
                disabled={controlsLocked}
              />
              <p style={fieldHelpStyle}>
                Items generated for each standard/config pair. Default 3 produces 84 items.
              </p>
            </div>
          </div>

          <div style={actionRowStyle}>
            <button
              type="button"
              onClick={() => runStudy("new")}
              disabled={running || !selectedModel || !selectedJudge}
              style={primaryButtonStyle}
            >
              {running ? "Running" : rows.length > 0 ? `Start Over (${plannedRows.length})` : `Run ${plannedRows.length} Items`}
            </button>
            <button type="button" onClick={stopRun} disabled={!running} style={secondaryButtonStyle}>
              Stop
            </button>
            <button type="button" onClick={() => runStudy("resume")} disabled={!canResume} style={secondaryButtonStyle}>
              Resume
            </button>
          </div>

          {(running || runStatus !== "idle" || rows.length > 0) && (
            <div style={runStatusPanelStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {running && <span style={spinnerStyle} aria-label="Loading" />}
                <span style={runStatusPillStyle}>{runStatus}</span>
                <strong>{progressCount}/{plannedRows.length}</strong>
                <span style={{ color: "#6b7280" }}>{currentMessage}</span>
              </div>
              {currentTask && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  <span style={mutedPillStyle}>Config {currentTask.configId}</span>
                  <span style={mutedPillStyle}>{currentTask.standardCode}</span>
                  <span style={mutedPillStyle}>rep {currentTask.replicateIndex + 1}</span>
                </div>
              )}
              <div style={progressTrackStyle}>
                <div style={{ ...progressFillStyle, width: `${progressPercent}%` }} />
              </div>
            </div>
          )}
        </div>

        <section style={panelStyle}>
          <div style={sectionTitleStyle}>Main Results</div>
          <p style={helpTextStyle}>
            Config-level averages from the LLM judge.
          </p>
          <div style={definitionGridStyle}>
            {RESULT_COLUMN_HELP.map((item) => (
              <div key={item.term} style={definitionItemStyle}>
                <strong>{item.term}</strong>
                <span>{item.text}</span>
              </div>
            ))}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th>Config</th>
                  <th>Family</th>
                  <th>N</th>
                  <th>Mean Score</th>
                  <th>Hard Gate Pass</th>
                  <th>Ready</th>
                  <th>Minor</th>
                  <th>Major</th>
                  <th>Reject</th>
                </tr>
              </thead>
              <tbody>
                {aggregates.map((aggregate) => (
                  <tr key={aggregate.config.id}>
                    <td><strong>{aggregate.config.id}</strong> {aggregate.config.label}</td>
                    <td>{aggregate.config.family}</td>
                    <td>{aggregate.count}</td>
                    <td>{formatNumber(aggregate.weightedMean)}</td>
                    <td>{percent(aggregate.hardGatePassRate)}</td>
                    <td>{aggregate.decisionCounts["Ready for SME review / pilot"] ?? 0}</td>
                    <td>{aggregate.decisionCounts["Minor revision"] ?? 0}</td>
                    <td>{aggregate.decisionCounts["Major revision"] ?? 0}</td>
                    <td>{aggregate.decisionCounts["Reject or regenerate"] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section style={panelStyle}>
          <div style={sectionTitleStyle}>Rubric Dimension Summary</div>
          <p style={helpTextStyle}>
            Mean 1-5 scores for each rubric dimension.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th>Dimension</th>
                  {CONFIGS.map((config) => (
                    <th key={config.id}>{config.id}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DIMENSIONS.map((dimension) => (
                  <tr key={dimension.id}>
                    <td>
                      <strong>{dimension.id}. {dimension.label}</strong>
                      <div style={{ color: "#9ca3af", fontSize: 12 }}>Weight {dimension.weight}</div>
                    </td>
                    {aggregates.map((aggregate) => {
                      const value = aggregate.dimensionMeans[dimension.id];
                      return (
                        <td key={`${dimension.id}-${aggregate.config.id}`}>
                          {value === null ? "—" : (
                            <span style={{ ...scorePillStyle, ...scoreColor(Math.round(value)) }}>
                              {value.toFixed(2)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div style={twoColumnStyle}>
          <section style={panelStyle}>
            <div style={sectionTitleStyle}>Method2 Ablation Deltas</div>
            <table style={tableStyle}>
              <thead>
                <tr><th>Config</th><th>Hypothesis</th><th>Overall Δ</th><th>Hyp. Dim Δ</th></tr>
              </thead>
              <tbody>
                {aggregates.filter((aggregate) => ["C1", "C2", "C3", "C4"].includes(aggregate.config.id)).map((aggregate) => {
                  const dims = aggregate.config.dimensions ?? [];
                  const dimDeltas = dims
                    .map((dimensionId) => {
                      const base = c0?.dimensionMeans[dimensionId] ?? null;
                      const value = aggregate.dimensionMeans[dimensionId] ?? null;
                      return base === null || value === null ? null : value - base;
                    })
                    .filter((value): value is number => value !== null);
                  const overallDelta = c0?.weightedMean === null || aggregate.weightedMean === null || c0?.weightedMean === undefined
                    ? null
                    : aggregate.weightedMean - c0.weightedMean;
                  return (
                    <tr key={aggregate.config.id}>
                      <td>{aggregate.config.id}</td>
                      <td>{aggregate.config.hypothesis ?? "—"}</td>
                      <td>{formatSigned(overallDelta)}</td>
                      <td>{formatSigned(mean(dimDeltas), 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section style={panelStyle}>
            <div style={sectionTitleStyle}>Method1 Comparison</div>
            <table style={tableStyle}>
              <tbody>
                <ComparisonRow label="M1 vs C0" left={aggregates.find((a) => a.config.id === "M1")} right={c0} />
                <ComparisonRow label="M1R vs M1" left={aggregates.find((a) => a.config.id === "M1R")} right={m1} />
                <ComparisonRow label="M1R vs C0" left={aggregates.find((a) => a.config.id === "M1R")} right={c0} />
              </tbody>
            </table>
          </section>
        </div>

        <section style={panelStyle}>
          <div style={sectionTitleStyle}>Generated Items</div>
          <p style={helpTextStyle}>
            Click a row to inspect the full item and scores.
          </p>
          <GeneratedItemsExplorer rows={successRows} selectedKey={selectedKey} onSelect={setSelectedKey} />
        </section>

        <section style={panelStyle}>
          <div style={sectionTitleStyle}>Raw Result Rows</div>
          <p style={helpTextStyle}>
            Audit table, including failed rows.
          </p>
          <div style={{ overflowX: "auto", maxHeight: 360 }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Status</th>
                  <th>Config</th>
                  <th>Standard</th>
                  <th>Rep</th>
                  <th>Score</th>
                  <th>Decision</th>
                  <th>Core KC</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const key = isSuccess(row) ? rowKey(row) : `${row.config.id}:${row.standard_code}:${row.replicate_index}:failed:${index}`;
                  return (
                    <tr
                      key={key}
                      onClick={() => isSuccess(row) && setSelectedKey(rowKey(row))}
                      style={{ cursor: isSuccess(row) ? "pointer" : "default", background: isSuccess(row) && rowKey(row) === selectedKey ? "#eff6ff" : undefined }}
                    >
                      <td>{index + 1}</td>
                      <td>{row.status}</td>
                      <td>{isSuccess(row) ? row.config.id : row.config.id}</td>
                      <td>{row.standard_code}</td>
                      <td>{row.replicate_index + 1}</td>
                      <td>{isSuccess(row) ? row.judge_result.weighted_score.toFixed(1) : "—"}</td>
                      <td>{isSuccess(row) ? row.judge_result.decision : row.error}</td>
                      <td>{isSuccess(row) ? row.fixed_core_kc : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function rowKey(row: ResultRow) {
  return `${row.config.id}:${row.standard_code}:${row.replicate_index}:${row.timestamp}`;
}

function formatSigned(value: number | null, digits = 1) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function ComparisonRow({
  label,
  left,
  right,
}: {
  label: string;
  left?: ReturnType<typeof aggregateByConfig>[number];
  right?: ReturnType<typeof aggregateByConfig>[number];
}) {
  const delta = left?.weightedMean === null || right?.weightedMean === null || left?.weightedMean === undefined || right?.weightedMean === undefined
    ? null
    : left.weightedMean - right.weightedMean;
  return (
    <tr>
      <td>{label}</td>
      <td>{formatSigned(delta)}</td>
      <td>{formatNumber(left?.weightedMean ?? null)} vs {formatNumber(right?.weightedMean ?? null)}</td>
    </tr>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f9fafb",
  color: "#111827",
  colorScheme: "light",
  fontFamily: "Arial, Helvetica, sans-serif",
};

const panelStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
  padding: 20,
  marginBottom: 20,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  marginBottom: 14,
  color: "#111827",
};

const sectionSubheadStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  marginBottom: 4,
  color: "#111827",
};

const controlGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 14,
  marginTop: 18,
  marginBottom: 16,
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  background: "#fff",
  color: "#111827",
  fontSize: 14,
  transition: "border-color 0.15s, box-shadow 0.15s",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#6b7280",
  marginBottom: 5,
};

const primaryButtonStyle: React.CSSProperties = {
  border: "none",
  borderRadius: 12,
  background: "#4f46e5",
  color: "#fff",
  fontWeight: 700,
  padding: "12px 16px",
  cursor: "pointer",
  transition: "background 0.15s, transform 0.15s",
};

const actionRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const secondaryButtonStyle: React.CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 8,
  background: "#fff",
  color: "#4b5563",
  fontWeight: 600,
  padding: "8px 12px",
  cursor: "pointer",
};

const progressTrackStyle: React.CSSProperties = {
  height: 8,
  background: "#e5e7eb",
  borderRadius: 999,
  marginTop: 12,
  overflow: "hidden",
};

const progressFillStyle: React.CSSProperties = {
  height: "100%",
  background: "#4f46e5",
  transition: "width 0.2s ease",
};

const runStatusPanelStyle: React.CSSProperties = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  marginTop: 12,
  padding: 12,
  fontSize: 13,
};

const runStatusPillStyle: React.CSSProperties = {
  background: "#eef2ff",
  borderRadius: 999,
  color: "#4338ca",
  display: "inline-flex",
  fontSize: 12,
  fontWeight: 800,
  padding: "3px 8px",
  textTransform: "uppercase",
};

const spinnerStyle: React.CSSProperties = {
  animation: "ablation-spin 0.8s linear infinite",
  border: "2px solid #c7d2fe",
  borderRadius: "50%",
  borderTopColor: "#4f46e5",
  display: "inline-block",
  height: 16,
  width: 16,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
  overflow: "hidden",
};

const twoColumnStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 18,
};

const metaGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 10,
};

const gateGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 10,
};

const gateStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 10,
  fontSize: 12,
};

const partStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 12,
  marginTop: 10,
  background: "#fff",
};

const taskTypeStyle: React.CSSProperties = {
  marginLeft: 8,
  fontSize: 11,
  color: "#6d28d9",
  background: "#ede9fe",
  borderRadius: 6,
  padding: "2px 6px",
};

const rubricStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  overflow: "hidden",
  fontSize: 13,
};

const rubricRowStyle: React.CSSProperties = {
  alignItems: "flex-start",
  borderBottom: "1px solid #f3f4f6",
  display: "grid",
  gap: 12,
  gridTemplateColumns: "32px 1fr",
  padding: "10px 12px",
};

const rubricScoreStyle: React.CSSProperties = {
  color: "#4f46e5",
  fontSize: 15,
};

const partRubricGridStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
};

const annotatedResponseStyle: React.CSSProperties = {
  alignItems: "flex-start",
  borderBottom: "1px solid #f3f4f6",
  display: "grid",
  gap: 12,
  gridTemplateColumns: "32px 1fr",
  padding: "10px 12px",
};

const listStyle: React.CSSProperties = {
  color: "#374151",
  lineHeight: 1.55,
  margin: "4px 0 0",
  paddingLeft: 18,
};

const summaryStyle: React.CSSProperties = {
  cursor: "pointer",
  color: "#4f46e5",
  fontWeight: 700,
};

const preStyle: React.CSSProperties = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 12,
  overflowX: "auto",
  fontSize: 12,
};

const helpTextStyle: React.CSSProperties = {
  color: "#6b7280",
  fontSize: 13,
  lineHeight: 1.6,
  margin: "0 0 14px",
};

const fieldHelpStyle: React.CSSProperties = {
  color: "#9ca3af",
  fontSize: 12,
  lineHeight: 1.45,
  margin: "6px 0 0",
};

const infoBoxStyle: React.CSSProperties = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  marginTop: 18,
  padding: 14,
};

const standardGridStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  marginTop: 10,
};

const standardChipStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  display: "grid",
  gap: 3,
  padding: 10,
  fontSize: 12,
};

const definitionGridStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
  marginBottom: 14,
};

const definitionItemStyle: React.CSSProperties = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  display: "grid",
  gap: 4,
  padding: 10,
  color: "#4b5563",
  fontSize: 12,
  lineHeight: 1.45,
};

const scorePillStyle: React.CSSProperties = {
  border: "1px solid",
  borderRadius: 999,
  display: "inline-flex",
  fontSize: 12,
  fontWeight: 800,
  justifyContent: "center",
  minWidth: 44,
  padding: "3px 8px",
};

const itemExplorerStyle: React.CSSProperties = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "minmax(0, 1.05fr) minmax(360px, 0.95fr)",
  alignItems: "start",
};

const itemTableWrapStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  maxHeight: 640,
  overflow: "auto",
};

const itemSideStyle: React.CSSProperties = {
  position: "sticky",
  top: 16,
  maxHeight: "calc(100vh - 32px)",
  overflow: "auto",
};

const configPillStyle: React.CSSProperties = {
  background: "#eef2ff",
  borderRadius: 999,
  color: "#4338ca",
  display: "inline-flex",
  fontSize: 11,
  fontWeight: 800,
  padding: "3px 7px",
};

const mutedPillStyle: React.CSSProperties = {
  background: "#f3f4f6",
  borderRadius: 999,
  color: "#6b7280",
  display: "inline-flex",
  fontSize: 11,
  fontWeight: 700,
  padding: "3px 7px",
};

const tableStemPreviewStyle: React.CSSProperties = {
  color: "#374151",
  display: "-webkit-box",
  fontSize: 13,
  lineHeight: 1.5,
  margin: "10px 0 0",
  overflow: "hidden",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
};

const emptyStateStyle: React.CSSProperties = {
  background: "#f9fafb",
  border: "1px dashed #d1d5db",
  borderRadius: 10,
  color: "#9ca3af",
  fontSize: 14,
  margin: 0,
  padding: 18,
  textAlign: "center",
};
