"use client";

import { useEffect, useRef, useState } from "react";
import { COMPARE_MODEL_CONFIGS } from "@/lib/compare/models";
import type {
  AIGStimulusType,
  Blueprint,
  GeneratedItem,
  StyleCheckResult,
} from "@/lib/aig/types";
import { StimulusAsset } from "./StimulusAsset";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StandardOption {
  standard: string;
  kcCount: number;
  module: string;
  strand: string;
  statement: string;
}

interface MethodOption {
  id: string;
  label: string;
}

interface ProgressStep {
  id: string;
  label: string;
  detail: string;
}

interface GenerateResult {
  blueprint?: Blueprint;
  item: GeneratedItem;
  grounding: {
    study_guide: { empty: boolean; chunk_ids: string[] };
    rubric: { empty: boolean; items: string[] };
    cards: { empty: boolean; card_ids: string[] };
  };
  style_check?: StyleCheckResult;
  attempts?: Array<{
    attempt: number;
    item: GeneratedItem;
    blueprint?: Blueprint;
    style_check?: StyleCheckResult;
    revision_instructions?: string;
  }>;
  metadata?: {
    style_check_enabled: boolean;
    retry_enabled: boolean;
    max_attempts: number;
    attempts: number;
    final_status: "not_checked" | "passed" | "failed" | "max_attempts_reached";
  };
}

interface ResultContext {
  methodId: string;
  methodLabel: string;
  stimulusType: AIGStimulusType;
}

// ── Static method list (labels mirrored from registry) ────────────────────────

const METHODS: MethodOption[] = [
  { id: "method_simple_direct", label: "Method 1: Simple Direct" },
  { id: "method_blueprint_l3", label: "Method 2: Blueprint + TELeR L3" },
  { id: "method_3", label: "(placeholder — teammate)" },
  { id: "method_4", label: "(placeholder — teammate)" },
];

// ── Unique base models for dropdown ──────────────────────────────────────────

const UNIQUE_MODELS = Array.from(
  new Map(COMPARE_MODEL_CONFIGS.map((c) => [c.modelId, c])).values()
);

const TEMPERATURES = [0, 0.5, 1] as const;

function getAllowedTemperatures(modelId: string): ReadonlyArray<(typeof TEMPERATURES)[number]> {
  const temps = Array.from(
    new Set(
      COMPARE_MODEL_CONFIGS.filter((config) => config.modelId === modelId).map(
        (config) => config.temperature as (typeof TEMPERATURES)[number]
      )
    )
  ).sort((a, b) => a - b);

  return temps.length > 0 ? temps : TEMPERATURES;
}

const STIMULUS_TYPES: Array<{ id: AIGStimulusType; label: string }> = [
  { id: "auto", label: "Auto" },
  { id: "table", label: "Data Table" },
  { id: "line_graph", label: "Line Graph" },
  { id: "bar_chart", label: "Bar Graph" },
  { id: "scenario", label: "Scenario" },
  { id: "diagram", label: "Diagram (SVG)" },
  { id: "illustration", label: "Illustration" },
  { id: "none", label: "None" },
];

function getStimulusTypeLabel(type: AIGStimulusType | GeneratedItem["stimulus_asset"]["type"]): string {
  const match = STIMULUS_TYPES.find((entry) => entry.id === type);
  return match?.label ?? type;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({
  title,
  children,
  accent = false,
}: {
  title: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        border: `1px solid ${accent ? "#6366f1" : "#e2e8f0"}`,
        borderRadius: 8,
        marginBottom: 20,
        overflow: "hidden",
        background: "#fff",
        color: "#111827",
        colorScheme: "light",
      }}
    >
      <div
        style={{
          background: accent ? "#6366f1" : "#f8fafc",
          padding: "10px 16px",
          fontWeight: 600,
          fontSize: 14,
          color: accent ? "#fff" : "#374151",
          borderBottom: `1px solid ${accent ? "#4f46e5" : "#e2e8f0"}`,
        }}
      >
        {title}
      </div>
      <div style={{ padding: 16, background: "#fff", color: "#111827", colorScheme: "light" }}>{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "#6b7280",
          display: "block",
          marginBottom: 2,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 14, color: "#111827" }}>{value}</span>
    </div>
  );
}

function GroundingBadge({
  grounding,
}: {
  grounding: GenerateResult["grounding"];
}) {
  const items = [
    {
      label: "Study Guide",
      empty: grounding.study_guide.empty,
      detail: grounding.study_guide.chunk_ids.join(", ") || "—",
    },
    {
      label: "Rubric",
      empty: grounding.rubric.empty,
      detail: grounding.rubric.items.join(", ") || "—",
    },
    {
      label: "Cards",
      empty: grounding.cards.empty,
      detail: grounding.cards.card_ids.join(", ") || "—",
    },
  ];
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {items.map((it) => (
        <div
          key={it.label}
          style={{
            fontSize: 12,
            background: it.empty ? "#fef2f2" : "#f0fdf4",
            border: `1px solid ${it.empty ? "#fca5a5" : "#86efac"}`,
            borderRadius: 6,
            padding: "4px 10px",
            color: it.empty ? "#b91c1c" : "#15803d",
          }}
          title={it.detail}
        >
          {it.label}: {it.empty ? "EMPTY" : `${it.detail.split(",").length} matched`}
        </div>
      ))}
    </div>
  );
}

function StyleCheckPanel({ result }: { result: GenerateResult }) {
  const check = result.style_check;
  const metadata = result.metadata;
  if (!metadata || !metadata.style_check_enabled || !check) {
    return (
      <div style={{ fontSize: 13, color: "#6b7280" }}>
        Style check was not run.
      </div>
    );
  }

  const rows = Object.entries(check.criteria_results);
  const passesAllCriteria = rows.every(([, details]) => details.pass);
  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={pillStyle(passesAllCriteria ? "pass" : "fail")}>
          {passesAllCriteria ? "Passed" : "Failed"}
        </span>
        <span style={pillStyle("neutral")}>
          Attempts: {metadata.attempts}/{metadata.max_attempts}
        </span>
        <span style={pillStyle("neutral")}>
          Retry: {metadata.retry_enabled ? "On" : "Off"}
        </span>
        <span style={pillStyle("neutral")}>
          Status: {metadata.final_status}
        </span>
      </div>
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
        {rows.map(([name, details]) => (
          <div
            key={name}
            style={{
              display: "grid",
              gridTemplateColumns: "170px 72px 1fr",
              gap: 10,
              padding: "9px 12px",
              borderBottom: name === rows[rows.length - 1][0] ? "none" : "1px solid #e2e8f0",
              background: details.pass ? "#fff" : "#fef2f2",
              fontSize: 12,
            }}
          >
            <strong style={{ color: "#374151" }}>{name.replaceAll("_", " ")}</strong>
            <span style={{ color: details.pass ? "#15803d" : "#b91c1c", fontWeight: 700 }}>
              {details.pass ? "PASS" : "FAIL"}
            </span>
            <span style={{ color: details.flag ? "#7f1d1d" : "#6b7280" }}>
              {details.flag ?? "—"}
            </span>
          </div>
        ))}
      </div>
      {check.revision_instructions && (
        <Field label="Revision Instructions" value={check.revision_instructions} />
      )}
    </div>
  );
}

// ── Progress steps ────────────────────────────────────────────────────────────

function getProgressSteps(
  methodId: string,
  styleCheckEnabled: boolean,
  retryEnabled: boolean,
  stimulusType: AIGStimulusType
): ProgressStep[] {
  const steps: ProgressStep[] = methodId === "method_simple_direct"
    ? [
        {
          id: "prompt",
          label: "Preparing prompt",
          detail: "Loading Keystone generation rules, KC information, vocabulary, and exemplars",
        },
        {
          id: "item",
          label: "Generating item",
          detail: "LLM call — writes the stimulus, Part A/B/C, and scoring rubric directly",
        },
      ]
    : [
        {
          id: "context",
          label: "Retrieving context",
          detail: "Embedding the selected standard/KCs and retrieving matching study guide, rubric, and card evidence",
        },
        {
          id: "blueprint",
          label: "Generating blueprint",
          detail: "LLM call 1 — plans task types, cognitive demand, evidence pattern, and response targets",
        },
        {
          id: "item",
          label: "Generating item",
          detail: "LLM call 2 — writes stem, stimulus, Part A/B/C, rubric, and annotated examples from the blueprint",
        },
      ];

  if (stimulusType === "illustration") {
    steps.push({
      id: "illustration",
      label: "Generating image",
      detail: "Image API call — creates the illustration from the LLM-generated illustration prompt",
    });
  }

  if (styleCheckEnabled) {
    steps.push({
      id: "style-check",
      label: retryEnabled ? "Checking/retrying" : "Style checking",
      detail: retryEnabled
        ? "Reviewer checks item quality and may request a revised generation attempt"
        : "Reviewer checks stimulus quality, DOK progression, Keystone style, and standard alignment",
    });
  }

  steps.push({ id: "done", label: "Done", detail: "" });
  return steps;
}

function getStepDurations(steps: ProgressStep[]) {
  return steps.slice(0, -1).map((s) => {
    if (s.id === "prompt") return 2500;
    if (s.id === "context") return 4000;
    if (s.id === "blueprint") return 9000;
    if (s.id === "illustration") return 15000;
    if (s.id === "style-check") return 9000;
    return 14000;
  });
}

function hasGroundingMatches(grounding: GenerateResult["grounding"]) {
  return !grounding.study_guide.empty || !grounding.rubric.empty || !grounding.cards.empty;
}

function ProgressBar({ step, steps }: { step: number; steps: ProgressStep[] }) {
  const pct = Math.min(100, Math.round((step / (steps.length - 1)) * 100));
  const doneIndex = steps.length - 1;
  return (
    <div style={{ marginBottom: 20 }}>
      <style jsx>{`
        @keyframes aig-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
      {/* Step labels */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        {steps.map((s, i) => (
          <div
            key={s.id}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: 11,
              fontWeight: i <= step ? 700 : 400,
              color: i < step ? "#15803d" : i === step ? "#4f46e5" : "#9ca3af",
              transition: "color 0.3s",
            }}
          >
            <div style={{ height: 16, marginBottom: 3, display: "flex", justifyContent: "center" }}>
              {i < step || (i === doneIndex && step === doneIndex) ? (
                <span style={{ color: "#15803d", fontWeight: 800, lineHeight: "16px" }}>✓</span>
              ) : i === step ? (
                <span
                  aria-label="Loading"
                  style={{
                    width: 13,
                    height: 13,
                    border: "2px solid #c7d2fe",
                    borderTopColor: "#4f46e5",
                    borderRadius: "50%",
                    animation: "aig-spin 0.8s linear infinite",
                    display: "inline-block",
                  }}
                />
              ) : (
                <span
                  style={{
                    width: 9,
                    height: 9,
                    border: "1.5px solid #cbd5e1",
                    borderRadius: "50%",
                    marginTop: 3,
                    display: "inline-block",
                  }}
                />
              )}
            </div>
            {s.label}
          </div>
        ))}
      </div>
      {/* Bar */}
      <div style={{ height: 6, background: "#e2e8f0", borderRadius: 3, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: step === doneIndex ? "#15803d" : "#4f46e5",
            borderRadius: 3,
            transition: "width 0.6s ease",
          }}
        />
      </div>
      {/* Current step detail */}
      {step < doneIndex && (
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6, textAlign: "center" }}>
          {steps[step].detail}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AIGPage() {
  const [standards, setStandards] = useState<StandardOption[]>([]);
  const [standardCode, setStandardCode] = useState("");
  const [methodId, setMethodId] = useState(METHODS[0].id);
  const [modelId, setModelId] = useState(UNIQUE_MODELS[0]?.modelId ?? "");
  const [temperature, setTemperature] = useState<0 | 0.5 | 1>(0);
  const [stimulusType, setStimulusType] = useState<AIGStimulusType>("auto");
  const [styleCheckEnabled, setStyleCheckEnabled] = useState(false);
  const [retryEnabled, setRetryEnabled] = useState(false);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(-1);
  const [runProgressSteps, setRunProgressSteps] = useState<ProgressStep[]>(
    getProgressSteps(METHODS[0].id, false, false, "auto")
  );
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [resultContext, setResultContext] = useState<ResultContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stepTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const activeProgressSteps = useRef<ProgressStep[]>(runProgressSteps);
  const allowedTemperatures = getAllowedTemperatures(modelId);

  useEffect(() => {
    fetch("/api/aig/standards")
      .then((r) => r.json())
      .then((d: { standards: StandardOption[] }) => {
        setStandards(d.standards);
        if (d.standards.length > 0) setStandardCode(d.standards[0].standard);
      })
      .catch(() => setError("Failed to load standards list."));
  }, []);

  useEffect(() => {
    if (!allowedTemperatures.includes(temperature)) {
      setTemperature(allowedTemperatures[0] ?? 1);
    }
  }, [allowedTemperatures, temperature]);

  function startStepAnimation() {
    stepTimers.current.forEach(clearTimeout);
    stepTimers.current = [];
    const steps = getProgressSteps(methodId, styleCheckEnabled, retryEnabled, stimulusType);
    activeProgressSteps.current = steps;
    setRunProgressSteps(steps);
    setStep(0);
    let elapsed = 0;
    getStepDurations(steps).slice(0, -1).forEach((dur, i) => {
      elapsed += dur;
      const t = setTimeout(() => setStep(i + 1), elapsed);
      stepTimers.current.push(t);
    });
  }

  function stopStepAnimation(success: boolean) {
    stepTimers.current.forEach(clearTimeout);
    stepTimers.current = [];
    setStep(success ? activeProgressSteps.current.length - 1 : -1);
  }

  async function handleGenerate() {
    if (!standardCode) return;
    setLoading(true);
    setResult(null);
    setResultContext(null);
    setError(null);
    startStepAnimation();
    try {
      const res = await fetch("/api/aig/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          standardCode,
          methodId,
          model: modelId,
          temperature,
          stimulusType,
          styleCheckEnabled,
          retryEnabled,
          maxAttempts,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        stopStepAnimation(false);
        setError(data.error ?? "Unknown error");
      } else {
        stopStepAnimation(true);
        setResult(data as GenerateResult);
        setResultContext({
          methodId,
          methodLabel: selectedMethod?.label ?? methodId,
          stimulusType,
        });
      }
    } catch {
      stopStepAnimation(false);
      setError("Network error — check server logs.");
    } finally {
      setLoading(false);
    }
  }

  const selectedStandard = standards.find((s) => s.standard === standardCode);
  const selectedMethod = METHODS.find((m) => m.id === methodId);
  const resultHasGrounding = result ? hasGroundingMatches(result.grounding) : false;
  const resultMethodUsesRetrieval = (resultContext?.methodId ?? methodId) !== "method_simple_direct";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f1f5f9",
        color: "#111827",
        colorScheme: "light",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
        {/* Controls */}
        <div
          style={{
            background: "#fff",
            borderRadius: 10,
            border: "1px solid #e2e8f0",
            padding: 20,
            marginBottom: 24,
            color: "#111827",
            colorScheme: "light",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              marginBottom: 16,
            }}
          >
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                Standard
              </label>
              <select
                value={standardCode}
                onChange={(e) => setStandardCode(e.target.value)}
                style={selectStyle}
              >
                {(() => {
                  // group by module → strand
                  const groups = new Map<string, Map<string, StandardOption[]>>();
                  for (const s of standards) {
                    const modKey = `Module ${s.module}`;
                    if (!groups.has(modKey)) groups.set(modKey, new Map());
                    const strands = groups.get(modKey)!;
                    if (!strands.has(s.strand)) strands.set(s.strand, []);
                    strands.get(s.strand)!.push(s);
                  }
                  const els: React.ReactNode[] = [];
                  for (const [mod, strands] of Array.from(groups.entries())) {
                    for (const [strand, items] of Array.from(strands.entries())) {
                      els.push(
                        <optgroup key={`${mod}__${strand}`} label={`${mod} · ${strand}`}>
                          {items.map((s) => {
                            const label = s.statement.length > 70
                              ? s.statement.slice(0, 70).trimEnd() + "…"
                              : s.statement;
                            return (
                              <option key={s.standard} value={s.standard}>
                                {s.standard} — {label}
                              </option>
                            );
                          })}
                        </optgroup>
                      );
                    }
                  }
                  return els;
                })()}
              </select>
              {selectedStandard && (
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6, lineHeight: 1.5 }}>
                  <span style={{ fontWeight: 600 }}>{selectedStandard.strand}</span>
                  {" · "}
                  {selectedStandard.kcCount} KCs
                  <div style={{ marginTop: 3, color: "#374151" }}>{selectedStandard.statement}</div>
                </div>
              )}
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                Method
              </label>
              <select
                value={methodId}
                onChange={(e) => setMethodId(e.target.value)}
                style={selectStyle}
              >
                {METHODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                Model
              </label>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                style={selectStyle}
              >
                {UNIQUE_MODELS.map((m) => (
                  <option key={m.modelId} value={m.modelId}>
                    {m.label.replace(/ · .*/, "")}
                  </option>
                ))}
              </select>
            </div>

            <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                  Temperature
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  {allowedTemperatures.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTemperature(t)}
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      borderRadius: 6,
                      border: `1px solid ${temperature === t ? "#6366f1" : "#d1d5db"}`,
                      background: temperature === t ? "#6366f1" : "#fff",
                      color: temperature === t ? "#fff" : "#374151",
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                Stimulus Type
              </label>
              <select
                value={stimulusType}
                onChange={(e) => setStimulusType(e.target.value as AIGStimulusType)}
                style={selectStyle}
              >
                {STIMULUS_TYPES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>
                Auto lets each method choose the most appropriate stimulus.
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                Style Check
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <label style={{ ...checkboxLabelStyle, marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={styleCheckEnabled}
                    onChange={(e) => {
                      setStyleCheckEnabled(e.target.checked);
                      if (!e.target.checked) setRetryEnabled(false);
                    }}
                  />
                  Run style check
                </label>
                <label style={{ ...checkboxLabelStyle, opacity: styleCheckEnabled ? 1 : 0.5, marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={retryEnabled}
                    disabled={!styleCheckEnabled}
                    onChange={(e) => setRetryEnabled(e.target.checked)}
                  />
                  Retry on failure
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: styleCheckEnabled && retryEnabled ? 1 : 0.6 }}>
                  <span style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>Max attempts</span>
                  <select
                    value={maxAttempts}
                    disabled={!styleCheckEnabled || !retryEnabled}
                    onChange={(e) => setMaxAttempts(Number(e.target.value))}
                    style={{ ...selectStyle, width: 76, padding: "5px 8px" }}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !standardCode}
            style={{
              width: "100%",
              padding: "12px 0",
              background: loading ? "#a5b4fc" : "#4f46e5",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 15,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {loading ? "Generating…" : "Generate Item"}
          </button>
        </div>

        {/* Progress */}
        {step >= 0 && (
          <div
            style={{
              background: "#fff",
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              padding: "16px 20px",
              marginBottom: 20,
              color: "#111827",
              colorScheme: "light",
            }}
          >
            <ProgressBar step={step} steps={runProgressSteps} />
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fca5a5",
              borderRadius: 8,
              padding: "12px 16px",
              color: "#b91c1c",
              marginBottom: 20,
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <div>
            <Section title="Method Summary">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                <Field label="Method" value={resultContext?.methodLabel ?? selectedMethod?.label ?? methodId} />
                <Field
                  label="Requested Stimulus Type"
                  value={getStimulusTypeLabel(resultContext?.stimulusType ?? stimulusType)}
                />
                <Field
                  label="Generated Stimulus Type"
                  value={getStimulusTypeLabel(result.item.stimulus_asset.type)}
                />
                <Field
                  label="Retrieval"
                  value={
                    resultMethodUsesRetrieval && resultHasGrounding
                      ? "Used"
                      : resultMethodUsesRetrieval
                        ? "Used, but no matches returned"
                        : "Not used by this method"
                  }
                />
                <Field
                  label="LLM Planning"
                  value={result.blueprint ? "Blueprint generated before item writing" : "No separate blueprint step"}
                />
              </div>
            </Section>

            {resultMethodUsesRetrieval && (
              <Section title="Grounding Trace">
                <GroundingBadge grounding={result.grounding} />
              </Section>
            )}

            {!result.blueprint && (result.item.anchor_kc || result.item.core_kc) && (
              <Section title="KC Selection" accent>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 0,
                  }}
                >
                  <Field
                    label="Target Standard"
                    value={result.item.target_standard ?? selectedStandard?.standard ?? standardCode}
                  />
                  <Field label="Anchor KC" value={result.item.anchor_kc ?? result.item.core_kc} />
                </div>
                {result.item.selected_kcs && result.item.selected_kcs.length > 0 && (
                  <Field
                    label="Selected KCs"
                    value={result.item.selected_kcs.join(" · ")}
                  />
                )}
                {result.item.supporting_kcs && result.item.supporting_kcs.length > 0 && (
                  <Field
                    label="Non-anchor KCs"
                    value={result.item.supporting_kcs.join(" · ")}
                  />
                )}
              </Section>
            )}

            {/* Blueprint */}
            {result.blueprint && (
              <Section title="Blueprint" accent>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 0,
                  }}
                >
                  <Field label="Target Standard" value={result.blueprint.target_standard} />
                  <Field label="Cognitive Demand" value={result.blueprint.cognitive_demand} />
                  <Field
                    label="Blueprint Stimulus Type"
                    value={getStimulusTypeLabel(result.blueprint.stimulus_type)}
                  />
                </div>
                <Field label="Anchor KC" value={result.blueprint.anchor_kc ?? result.blueprint.core_kc} />
                {result.blueprint.selected_kcs && result.blueprint.selected_kcs.length > 0 && (
                  <Field
                    label="Selected KCs"
                    value={result.blueprint.selected_kcs.join(" · ")}
                  />
                )}
                {result.blueprint.supporting_kcs && result.blueprint.supporting_kcs.length > 0 && (
                  <Field
                    label="Non-anchor KCs"
                    value={result.blueprint.supporting_kcs.join(" · ")}
                  />
                )}
                {result.blueprint.stem_affordance && (
                  <Field
                    label="Stem Affordance"
                    value={result.blueprint.stem_affordance}
                  />
                )}
                {result.blueprint.compatibility_rationale && (
                  <Field
                    label="KC Compatibility"
                    value={result.blueprint.compatibility_rationale}
                  />
                )}
                <Field
                  label="Key Concepts"
                  value={result.blueprint.key_concepts.join(" · ")}
                />
                <Field
                  label="Evidence Pattern"
                  value={result.blueprint.evidence_pattern}
                />
                <div style={{ marginBottom: 10 }}>
                  <span style={labelStyle}>Task Sequence</span>
                  {(["Part A", "Part B", "Part C"] as const)
                    .filter((p) => result.blueprint?.task_sequence[p])
                    .map((p) => {
                      const part = result.blueprint!.task_sequence[p]!;
                      return (
                        <div key={p} style={{ fontSize: 13, marginTop: 4, color: "#374151" }}>
                          <strong style={{ color: "#111827" }}>{p}</strong>{" "}
                          <span style={{ fontSize: 11, color: "#9ca3af" }}>
                            [{part.kc_code}]
                          </span>{" "}
                          —{" "}
                          <span style={{ color: "#6366f1" }}>{part.task_type}</span>
                          {" "}· {part.function}
                        </div>
                      );
                    })}
                </div>
                <Field
                  label="Expected Response Elements"
                  value={
                    <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
                      {result.blueprint.expected_response_elements.map((e, i) => (
                        <li key={i} style={{ fontSize: 13 }}>{e}</li>
                      ))}
                    </ul>
                  }
                />
                <Field
                  label="Common Incomplete Responses"
                  value={
                    <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
                      {result.blueprint.common_incomplete_responses.map((e, i) => (
                        <li key={i} style={{ fontSize: 13 }}>{e}</li>
                      ))}
                    </ul>
                  }
                />
              </Section>
            )}

            <Section title="Style Check">
              <StyleCheckPanel result={result} />
            </Section>

            {/* Generated Item */}
            <Section title="Generated Item">
              <Field label="Stem" value={result.item.stem} />
              {result.item.stimulus_asset && result.item.stimulus_asset.type !== "none" && (
                <div style={{ marginBottom: 10 }}>
                  <span style={labelStyle}>Stimulus</span>
                  <StimulusAsset asset={result.item.stimulus_asset} />
                </div>
              )}

              {/* Parts */}
              {(["Part A", "Part B", "Part C"] as const).filter((p) => result.item.parts[p]).map((p) => (
                <div
                  key={p}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: 14,
                    marginBottom: 12,
                    background: "#fff",
                    color: "#111827",
                    colorScheme: "light",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <strong style={{ fontSize: 14, color: "#111827" }}>{p}</strong>
                    <span
                      style={{
                        fontSize: 11,
                        background: "#ede9fe",
                        color: "#6d28d9",
                        borderRadius: 4,
                        padding: "2px 8px",
                        fontWeight: 600,
                      }}
                    >
                      {result.item.parts[p]!.task_type}
                    </span>
                    {(result.blueprint?.task_sequence[p]?.kc_code || result.item.part_kcs?.[p]) && (
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>
                        {result.blueprint?.task_sequence[p]?.kc_code ?? result.item.part_kcs?.[p]}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, color: "#111827", lineHeight: 1.6 }}>
                    {result.item.parts[p]!.question}
                  </div>
                </div>
              ))}

              {/* Holistic rubric */}
              <div style={{ marginTop: 4 }}>
                <span style={labelStyle}>Scoring Rubric (holistic 0–3)</span>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden", marginTop: 4 }}>
                  {(["3", "2", "1", "0"] as const).map((score) => (
                    <div
                      key={score}
                      style={{
                        display: "flex",
                        gap: 12,
                        padding: "10px 14px",
                        borderBottom: score === "0" ? "none" : "1px solid #e2e8f0",
                        background: score === "3" ? "#f0fdf4" : score === "0" ? "#fef2f2" : "#fff",
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 15, minWidth: 16, color: score === "3" ? "#15803d" : score === "0" ? "#b91c1c" : "#374151" }}>
                        {score}
                      </span>
                      <span style={{ fontSize: 13, color: "#374151" }}>
                        {result.item.scoring_rubric[score]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 13,
  background: "#fff",
  color: "#111827",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  color: "#6b7280",
  display: "block" as const,
  marginBottom: 4,
};

const checkboxLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  color: "#374151",
  marginBottom: 6,
};

function pillStyle(kind: "pass" | "fail" | "neutral"): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 999,
    padding: "4px 10px",
    background: kind === "pass" ? "#dcfce7" : kind === "fail" ? "#fee2e2" : "#f1f5f9",
    color: kind === "pass" ? "#166534" : kind === "fail" ? "#991b1b" : "#475569",
    border: `1px solid ${kind === "pass" ? "#86efac" : kind === "fail" ? "#fecaca" : "#cbd5e1"}`,
  };
}
