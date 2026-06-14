"use client";

import { useEffect, useRef, useState } from "react";
import { COMPARE_MODEL_CONFIGS } from "@/lib/compare/models";
import type { Blueprint, GeneratedItem } from "@/lib/aig/types";
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

interface GenerateResult {
  blueprint: Blueprint;
  item: GeneratedItem;
  grounding: {
    study_guide: { empty: boolean; chunk_ids: string[] };
    rubric: { empty: boolean; items: string[] };
    cards: { empty: boolean; card_ids: string[] };
  };
}

// ── Static method list (labels mirrored from registry) ────────────────────────

const METHODS: MethodOption[] = [
  { id: "method_blueprint_l3", label: "Blueprint + TELeR L3" },
  { id: "method_2", label: "(placeholder — teammate)" },
  { id: "method_3", label: "(placeholder — teammate)" },
  { id: "method_4", label: "(placeholder — teammate)" },
];

// ── Unique base models for dropdown ──────────────────────────────────────────

const UNIQUE_MODELS = Array.from(
  new Map(COMPARE_MODEL_CONFIGS.map((c) => [c.modelId, c])).values()
);

const TEMPERATURES = [0, 0.5, 1] as const;

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
      <div style={{ padding: 16 }}>{children}</div>
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

// ── Progress steps ────────────────────────────────────────────────────────────

const STEPS = [
  { id: "context", label: "Retrieving context", detail: "Embedding KC statement · cosine search over 129 study-guide chunks · matching cards" },
  { id: "blueprint", label: "Generating blueprint", detail: "LLM call 1 — picks task types, cognitive demand, evidence pattern from taxonomy" },
  { id: "item", label: "Generating item", detail: "LLM call 2 (TELeR L3) — writes stem, parts A/B/C, rubric, annotated examples" },
  { id: "done", label: "Done", detail: "" },
];

// Rough expected durations per step (ms) — used only for animation pacing
const STEP_DURATIONS = [4000, 12000, 18000];

function ProgressBar({ step }: { step: number }) {
  const pct = Math.min(100, Math.round((step / (STEPS.length - 1)) * 100));
  return (
    <div style={{ marginBottom: 20 }}>
      {/* Step labels */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        {STEPS.map((s, i) => (
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
            <div style={{ marginBottom: 3 }}>
              {i < step ? "✓" : i === step ? "⟳" : "○"}
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
            background: step === STEPS.length - 1 ? "#15803d" : "#4f46e5",
            borderRadius: 3,
            transition: "width 0.6s ease",
          }}
        />
      </div>
      {/* Current step detail */}
      {step < STEPS.length - 1 && (
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6, textAlign: "center" }}>
          {STEPS[step].detail}
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
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stepTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    fetch("/api/aig/standards")
      .then((r) => r.json())
      .then((d: { standards: StandardOption[] }) => {
        setStandards(d.standards);
        if (d.standards.length > 0) setStandardCode(d.standards[0].standard);
      })
      .catch(() => setError("Failed to load standards list."));
  }, []);

  function startStepAnimation() {
    stepTimers.current.forEach(clearTimeout);
    stepTimers.current = [];
    setStep(0);
    let elapsed = 0;
    STEP_DURATIONS.forEach((dur, i) => {
      elapsed += dur;
      const t = setTimeout(() => setStep(i + 1), elapsed);
      stepTimers.current.push(t);
    });
  }

  function stopStepAnimation(success: boolean) {
    stepTimers.current.forEach(clearTimeout);
    stepTimers.current = [];
    setStep(success ? STEPS.length - 1 : -1);
  }

  async function handleGenerate() {
    if (!standardCode) return;
    setLoading(true);
    setResult(null);
    setError(null);
    startStepAnimation();
    try {
      const res = await fetch("/api/aig/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ standardCode, methodId, model: modelId, temperature }),
      });
      const data = await res.json();
      if (!res.ok) {
        stopStepAnimation(false);
        setError(data.error ?? "Unknown error");
      } else {
        stopStepAnimation(true);
        setResult(data as GenerateResult);
      }
    } catch {
      stopStepAnimation(false);
      setError("Network error — check server logs.");
    } finally {
      setLoading(false);
    }
  }

  const selectedStandard = standards.find((s) => s.standard === standardCode);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f1f5f9",
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
                {TEMPERATURES.map((t) => (
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
            }}
          >
            <ProgressBar step={step} />
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
            {/* Grounding trace */}
            <Section title="Grounding Trace">
              <GroundingBadge grounding={result.grounding} />
            </Section>

            {/* Blueprint */}
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
              </div>
              <Field
                label="Integrated KCs"
                value={result.blueprint.integrated_kcs.join(" · ")}
              />
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
                  .filter((p) => result.blueprint.task_sequence[p])
                  .map((p) => {
                    const part = result.blueprint.task_sequence[p]!;
                    return (
                      <div key={p} style={{ fontSize: 13, marginTop: 4 }}>
                        <strong>{p}</strong>{" "}
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
              {(["Part A", "Part B", "Part C"] as const).map((p) => (
                <div
                  key={p}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: 14,
                    marginBottom: 12,
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
                    <strong style={{ fontSize: 14 }}>{p}</strong>
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
                      {result.item.parts[p].task_type}
                    </span>
                    {result.blueprint.task_sequence[p]?.kc_code && (
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>
                        {result.blueprint.task_sequence[p]!.kc_code}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 14 }}>
                    {result.item.parts[p].question}
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
