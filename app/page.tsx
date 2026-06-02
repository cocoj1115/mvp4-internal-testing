"use client";

import { useState, useRef, useEffect } from "react";
import {
  QUESTIONS,
  Question,
  QuestionPart,
  QuestionTable,
  PartLabel,
} from "@/app/lib/questions";
import type { GradeResponse } from "@/app/api/grade/route";
import {
  DEFAULT_GRADING_MODEL,
  GRADING_MODELS,
  GradingModel,
} from "@/lib/grading-models";

// ─── Types ────────────────────────────────────────────────────────────────────

type Method = 1 | 2 | 3;
type WizardStep = 1 | 2 | 3 | 4;

interface G0PartConfig {
  keyConcepts: string;
  rubric: string;
  examples: string;
}

type G0Config = Record<string, G0PartConfig>;
type GStarConfig = Record<string, string>; // partLabel → adaptation rules

interface ParseResult {
  kd1Chunks: number;
  kd2Chunks: number;
  keExamples: number;
  g0: G0Config;
}

interface PartResult extends GradeResponse {
  timeSeconds: number;
  answer: string;
  maxScore: number;
}

interface PartAttemptData {
  attempt1?: PartResult;
  attempt2?: PartResult;
  modelAnswerShown?: boolean;
}

interface SessionData {
  questionId: string;
  method: Method;
  timestamp: string;
  parts: Record<string, {
    attempt1?: { response: string; score: number; feedback: string };
    attempt2?: { response: string; score: number; feedback: string; model_answer_shown?: boolean };
  }>;
}

function isGradeResponse(value: unknown): value is GradeResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.score === "number" &&
    Number.isFinite(candidate.score) &&
    typeof candidate.feedback === "string"
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function elapsed(startMs: number) {
  return Math.round((Date.now() - startMs) / 1000);
}

/**
 * Fetch a streaming endpoint and call `onLine` for each progress line.
 * Lines starting with "DATA:" are withheld from `onLine` and returned
 * as the function result (the JSON payload string after "DATA:").
 */
async function streamLines(
  url: string,
  init: RequestInit,
  onLine: (line: string) => void
): Promise<string> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Request failed: HTTP ${res.status}`);
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let dataPayload = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.trim()) continue;
      if (part.startsWith("DATA:")) {
        dataPayload = part.slice(5);
      } else {
        onLine(part);
      }
    }
  }
  // Flush remaining buffer
  if (buf.trim()) {
    if (buf.startsWith("DATA:")) dataPayload = buf.slice(5);
    else onLine(buf);
  }
  return dataPayload;
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────

function SectionCard({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-bold shrink-0">
          {step}
        </span>
        <h2 className="font-semibold text-gray-800 text-sm tracking-wide uppercase">
          {title}
        </h2>
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

function ScorePip({ score, maxScore }: { score: number; maxScore: number }) {
  const isFull = score === maxScore;
  const isZero = score === 0;
  const colorClass = isFull
    ? "text-emerald-600"
    : isZero
    ? "text-rose-600"
    : "text-amber-500";
  return (
    <span className={`inline-flex items-center gap-1 font-semibold text-sm ${colorClass}`}>
      {isFull ? (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      ) : isZero ? (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
        </svg>
      )}
      {score} / {maxScore}
    </span>
  );
}

// ─── Question display ─────────────────────────────────────────────────────────

function QuestionImage({ src }: { src: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) {
    return (
      <div className="flex items-center gap-3 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-5 py-5">
        <svg className="w-8 h-8 text-gray-300 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 20.25h18M12 3v9m0 0l-3-3m3 3l3-3" />
        </svg>
        <div>
          <p className="text-sm font-medium text-gray-500">Question diagram</p>
          <p className="mt-0.5 font-mono text-xs text-gray-400">{src}</p>
          <p className="mt-0.5 text-xs text-gray-400">
            Place the image in <code className="bg-gray-100 px-1 rounded">public{src}</code>
          </p>
        </div>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="Question diagram" onError={() => setMissing(true)} className="w-full rounded-lg border border-gray-200 object-contain" />
  );
}

function QuestionTableBlock({ table }: { table: QuestionTable }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm border-collapse">
        <caption className="py-2 text-xs font-semibold uppercase tracking-wider text-gray-600 bg-gray-50 border-b border-gray-200">
          {table.title}
        </caption>
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {table.columns.map((col) => (
              <th key={col} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map(([system, description], idx) => (
            <tr key={idx} className={`border-b border-gray-100 last:border-0 ${idx % 2 === 1 ? "bg-gray-50/60" : "bg-white"}`}>
              <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap align-top">{system}</td>
              <td className="px-4 py-3 text-gray-600 align-top leading-relaxed">{description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuestionContext({ question }: { question: Question }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-slate-50 p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-widest">{question.id}</span>
        <span className="text-[11px] text-gray-300">·</span>
        <span className="text-[11px] font-mono text-gray-500">Standard {question.standard}</span>
        <span className="text-[11px] text-gray-300">·</span>
        <span className="text-[11px] text-gray-500">{question.topic}</span>
        <span className="text-[11px] text-gray-300">·</span>
        <span className="text-[11px] text-gray-500">{question.parts.reduce((s, p) => s + p.maxScore, 0)} pts</span>
      </div>
      <p className="text-sm text-gray-700 leading-relaxed">{question.stem}</p>
      {question.imageUrl && <QuestionImage src={question.imageUrl} />}
      {question.table && <QuestionTableBlock table={question.table} />}
    </div>
  );
}

// ─── Wizard: shared ───────────────────────────────────────────────────────────

function WizardProgress({ step }: { step: WizardStep }) {
  const steps: { n: WizardStep; label: string }[] = [
    { n: 1, label: "Upload Materials" },
    { n: 2, label: "Review G₀" },
    { n: 3, label: "Training" },
    { n: 4, label: "Review G*" },
  ];
  return (
    <div className="flex items-center mb-7">
      {steps.map((s, idx) => {
        const done = s.n < step;
        const active = s.n === step;
        return (
          <div key={s.n} className={`flex items-center ${idx < steps.length - 1 ? "flex-1" : ""}`}>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold border-2 transition-colors ${
                done ? "border-emerald-500 bg-emerald-500 text-white"
                : active ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-gray-300 bg-white text-gray-400"
              }`}>
                {done ? (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : s.n}
              </span>
              <span className={`text-xs font-medium whitespace-nowrap ${
                active ? "text-indigo-700" : done ? "text-emerald-600" : "text-gray-400"
              }`}>
                {s.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className={`flex-1 mx-3 h-px ${done ? "bg-emerald-400" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StreamLog({ lines, active }: { lines: string[]; active: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div className="rounded-lg bg-gray-950 border border-gray-800 p-4 font-mono text-xs max-h-60 overflow-y-auto">
      <div className="space-y-0.5">
        {lines.map((line, i) => {
          const isSuccess = /done|complete|correct|stopping/i.test(line);
          const isError = /error/i.test(line);
          return (
            <div key={i} className="flex gap-2">
              <span className="text-gray-600 select-none shrink-0">›</span>
              <span className={isSuccess ? "text-emerald-400" : isError ? "text-rose-400" : "text-gray-300"}>
                {line}
              </span>
            </div>
          );
        })}
        {active && (
          <div className="flex gap-2">
            <span className="text-gray-600 select-none shrink-0">›</span>
            <span className="text-gray-500 animate-pulse">▊</span>
          </div>
        )}
      </div>
      <div ref={endRef} />
    </div>
  );
}

function CheckBanner({ label, onNext }: { label: string; onNext: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
      <div className="flex items-center gap-2">
        <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        <span className="text-sm font-medium text-emerald-700">{label}</span>
      </div>
      <button
        onClick={onNext}
        className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition"
      >
        Next →
      </button>
    </div>
  );
}

// ─── Wizard: Step 1 — Upload Materials ───────────────────────────────────────

function Step1Upload({
  model,
  onComplete,
}: {
  model: GradingModel;
  onComplete: (result: ParseResult) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
    if (!file) return;
    setStreaming(true);
    setLines([]);
    setError(null);
    try {
      // ── Phase 1: parse PDF ───────────────────────────────────────────────
      const fd = new FormData();
      fd.append("file", file);
      fd.append("model", model);
      const dataJson = await streamLines(
        "/api/parse",
        { method: "POST", body: fd },
        (line) => setLines((prev) => [...prev, line])
      );
      const parsed = JSON.parse(dataJson) as ParseResult;

      // ── Phase 2: build vector index ──────────────────────────────────────
      setLines((prev) => [...prev, "Building vector index..."]);
      try {
        const vsRes = await fetch("/api/vectorstore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parseResult: parsed }),
        });
        const vsData = (await vsRes.json()) as {
          success?: boolean;
          counts?: { kd1: number; kd2: number; ke: number };
        };
        if (vsData.success && vsData.counts) {
          const { kd1, kd2, ke } = vsData.counts;
          setLines((prev) => [
            ...prev,
            `Vector index ready — ${kd1} standards, ${kd2} rubrics, ${ke} examples indexed.`,
          ]);
        } else {
          setLines((prev) => [
            ...prev,
            "Vector index build failed — grading will use G* only.",
          ]);
        }
      } catch {
        // Non-fatal: grading falls back to G*-only when isReady() is false.
        setLines((prev) => [
          ...prev,
          "Vector index unavailable — grading will use G* only.",
        ]);
      }

      setResult(parsed);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-gray-700 mb-1">
          Upload your Keystone scoring materials
        </p>
        <p className="text-xs text-gray-500 mb-3">
          KD1 + KD2 + KE can be combined in a single PDF file.
        </p>

        {!done && (
          <div
            onClick={() => !streaming && fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f?.type === "application/pdf") setFile(f);
            }}
            className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 transition ${
              streaming
                ? "border-gray-200 bg-gray-50 pointer-events-none opacity-60"
                : file
                ? "border-indigo-400 bg-indigo-50/30 cursor-pointer"
                : "border-gray-300 bg-gray-50 hover:border-indigo-400 hover:bg-indigo-50/20 cursor-pointer"
            }`}
          >
            <svg className={`w-8 h-8 ${file ? "text-indigo-400" : "text-gray-300"}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-sm text-gray-600">
              {file ? (
                <span className="font-medium text-indigo-700">{file.name}</span>
              ) : (
                <>Drop PDF here or <span className="text-indigo-600 font-medium">browse</span></>
              )}
            </p>
            {!file && <p className="text-xs text-gray-400">PDF files only</p>}
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        )}
      </div>

      {lines.length > 0 && <StreamLog lines={lines} active={streaming} />}

      {error && (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      {done && result && (
        <CheckBanner label="Parsing complete" onNext={() => onComplete(result)} />
      )}

      {!done && file && !streaming && (
        <div className="flex justify-end">
          <button
            onClick={handleUpload}
            className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition"
          >
            Parse PDF
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Wizard: Step 2 — Review G₀ ──────────────────────────────────────────────

function Step2ReviewG0({
  g0,
  partLabels,
  onConfirm,
}: {
  g0: G0Config;
  partLabels: PartLabel[];
  onConfirm: (g0: G0Config) => void;
}) {
  const [config, setConfig] = useState<G0Config>(g0);

  function update(part: string, field: keyof G0PartConfig, value: string) {
    setConfig((prev) => ({ ...prev, [part]: { ...prev[part], [field]: value } }));
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
        Review and edit the extracted content before training. All fields are editable.
      </div>

      {partLabels.map((label) => {
        const part = config[label];
        if (!part) return null;
        return (
          <div key={label} className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-indigo-600">
              Part {label}
            </h3>
            {(
              [
                { field: "keyConcepts" as const, label: "Key Concepts (KD1)", rows: 4 },
                { field: "rubric" as const, label: "Scoring Rubric (KD2)", rows: 6 },
                { field: "examples" as const, label: "Scored Examples (KE)", rows: 6 },
              ] as const
            ).map(({ field, label: fieldLabel, rows }) => (
              <div key={field}>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  {fieldLabel}
                </label>
                <textarea
                  value={part[field]}
                  onChange={(e) => update(label, field, e.target.value)}
                  rows={rows}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-800 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                />
              </div>
            ))}
          </div>
        );
      })}

      <div className="flex justify-end">
        <button
          onClick={() => onConfirm(config)}
          className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition"
        >
          Confirm &amp; Run Training →
        </button>
      </div>
    </div>
  );
}

// ─── Wizard: Step 3 — GradeOpt Training ──────────────────────────────────────

function Step3Training({
  g0,
  model,
  onComplete,
}: {
  g0: G0Config;
  model: GradingModel;
  onComplete: (gStar: GStarConfig) => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GStarConfig | null>(null);
  const startedRef = useRef(false);
  const g0Ref = useRef(g0);
  const modelRef = useRef(model);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const dataJson = await streamLines(
          "/api/train",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ g0: g0Ref.current, model: modelRef.current }),
          },
          (line) => setLines((prev) => [...prev, line])
        );
        const gStar = JSON.parse(dataJson) as GStarConfig;
        setDraft(gStar);
        setDone(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Training failed");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">Running GradeOpt training loop…</p>
      <StreamLog lines={lines} active={!done && !error} />
      {error && (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3">
          {error}
        </p>
      )}
      {done && draft && (
        <CheckBanner label="Training complete" onNext={() => onComplete(draft)} />
      )}
    </div>
  );
}

// ─── Wizard: Step 4 — Review G* ──────────────────────────────────────────────

function Step4ReviewGStar({
  gStarDraft,
  partLabels,
  onApprove,
}: {
  gStarDraft: GStarConfig;
  partLabels: PartLabel[];
  onApprove: (gStar: GStarConfig) => void;
}) {
  const [config, setConfig] = useState<GStarConfig>(gStarDraft);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <svg className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
        <p className="text-sm text-amber-700">
          These rules were auto-generated by the GradeOpt training loop. Please review carefully before approving.
        </p>
      </div>

      {partLabels.map((label) => (
        <div key={label} className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-indigo-600">
            Part {label} Adaptation Rules
          </h3>
          <textarea
            value={config[label] ?? ""}
            onChange={(e) => setConfig((prev) => ({ ...prev, [label]: e.target.value }))}
            rows={9}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-800 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
          />
        </div>
      ))}

      <div className="flex justify-end">
        <button
          onClick={() => onApprove(config)}
          className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition"
        >
          Approve &amp; Start →
        </button>
      </div>
    </div>
  );
}

// ─── Answer panel: Part input ─────────────────────────────────────────────────

function PartPanel({
  part,
  onSubmit,
  isLoading,
  completedResult,
  lockedAnswer,
}: {
  part: QuestionPart;
  onSubmit: (answer: string) => Promise<void>;
  isLoading: boolean;
  completedResult?: PartResult;
  lockedAnswer?: string;
}) {
  const [answer, setAnswer] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!completedResult && !lockedAnswer) textareaRef.current?.focus();
  }, [completedResult, lockedAnswer]);

  if (lockedAnswer !== undefined && !completedResult) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-4 space-y-2 opacity-80">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Part {part.label}</span>
          <span className="text-xs text-amber-500 font-medium flex items-center gap-1.5">
            <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Grading all parts…
          </span>
        </div>
        <p className="text-sm text-gray-600 bg-white border border-gray-200 rounded p-3 whitespace-pre-wrap leading-relaxed">
          {lockedAnswer}
        </p>
      </div>
    );
  }

  if (completedResult) {
    const bg =
      completedResult.score === completedResult.maxScore
        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
        : completedResult.score === 0
        ? "bg-rose-50 text-rose-800 border-rose-200"
        : "bg-amber-50 text-amber-800 border-amber-200";

    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            Part {part.label}
            {part.maxScore > 1 && (
              <span className="ml-1.5 font-normal text-gray-400">({part.maxScore} pts)</span>
            )}
          </span>
          <ScorePip score={completedResult.score} maxScore={completedResult.maxScore} />
        </div>
        <p className="text-sm text-gray-500 italic">{part.prompt}</p>
        <p className="text-sm text-gray-700 bg-white border border-gray-200 rounded p-3 whitespace-pre-wrap">
          {completedResult.answer}
        </p>
        <div className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${bg}`}>
          {completedResult.feedback}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/30 p-5 space-y-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold shrink-0">
          {part.label}
        </span>
        <div className="flex-1 space-y-1">
          <p className="text-sm text-gray-700 leading-relaxed">{part.prompt}</p>
          {part.maxScore > 1 && (
            <p className="text-xs font-medium text-indigo-500">
              Worth {part.maxScore} points — describe two separate methods.
            </p>
          )}
        </div>
      </div>
      <textarea
        ref={textareaRef}
        className="w-full min-h-[120px] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y transition"
        placeholder="Type your response here…"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        disabled={isLoading}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {answer.trim().length === 0 ? "Response required" : `${answer.trim().length} chars`}
        </span>
        <button
          onClick={() => onSubmit(answer)}
          disabled={isLoading || answer.trim().length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Grading…
            </>
          ) : (
            "Submit"
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Researcher setup page ────────────────────────────────────────────────────

const COMPUTER_PRESETS: Record<number, Record<string, number>> = {
  1: { M1Q14: 1, M1Q15: 2, M2Q14: 3, M2Q15: 1 },
  2: { M1Q14: 2, M1Q15: 3, M2Q14: 1, M2Q15: 2 },
  3: { M1Q14: 3, M1Q15: 1, M2Q14: 2, M2Q15: 3 },
  4: { M1Q14: 1, M1Q15: 2, M2Q14: 3, M2Q15: 1 },
};

type SetupPhase = "upload" | "training" | "assignment" | "complete";

function SetupPage({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<SetupPhase>("upload");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [trainingLogs, setTrainingLogs] = useState<string[]>([]);
  const [trainingDone, setTrainingDone] = useState(false);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [computer, setComputer] = useState<number>(1);
  const [assignment, setAssignment] = useState<Record<string, number>>(COMPUTER_PRESETS[1]);
  const trainingStarted = useRef(false);

  useEffect(() => {
    if (phase === "training" && parseResult && !trainingStarted.current) {
      trainingStarted.current = true;
      runAllTraining(parseResult);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, parseResult]);

  async function runAllTraining(result: ParseResult) {
    try {
      for (const question of QUESTIONS) {
        const filteredG0: G0Config = {};
        for (const p of question.parts) {
          filteredG0[p.label] = result.g0[p.label] ?? result.g0["A"] ?? {
            keyConcepts: "",
            rubric: "",
            examples: "",
          };
        }

        setTrainingLogs((prev) => [...prev, `Training ${question.dropdownLabel}…`]);

        const dataJson = await streamLines(
          "/api/train",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ g0: filteredG0 }),
          },
          (line) => setTrainingLogs((prev) => [...prev, `  ${line}`])
        );

        const gStar = JSON.parse(dataJson) as GStarConfig;
        localStorage.setItem(`biobridge_gstar_${question.id}`, JSON.stringify(gStar));
        setTrainingLogs((prev) => [...prev, `✓ G* saved for ${question.id}`]);
      }
      setTrainingDone(true);
    } catch (e) {
      setTrainingError(e instanceof Error ? e.message : "Training failed");
    }
  }

  function handleComputerChange(n: number) {
    setComputer(n);
    setAssignment({ ...COMPUTER_PRESETS[n] });
  }

  function handleSaveSetup() {
    localStorage.setItem("biobridge_method_assignment", JSON.stringify(assignment));
    localStorage.setItem("biobridge_setup_complete", "true");
    setPhase("complete");
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">BioBridge — Researcher Setup</h1>
          <p className="text-sm text-gray-500">Configure this computer before students begin.</p>
        </div>

        {/* Step 1: Upload PDF */}
        {phase === "upload" && (
          <SectionCard step={1} title="Upload Scoring Materials">
            <p className="text-xs text-gray-500 mb-4">
              Upload the Keystone Biology scoring guide PDF. GradeOpt will be trained for all four questions.
            </p>
            <Step1Upload
              model={DEFAULT_GRADING_MODEL}
              onComplete={(result) => {
                setParseResult(result);
                setPhase("training");
              }}
            />
          </SectionCard>
        )}

        {/* Step 2: Training */}
        {phase === "training" && (
          <SectionCard step={2} title="Training GradeOpt for All Questions">
            <p className="text-xs text-gray-500 mb-4">
              Running GradeOpt training for each question. This may take a few minutes.
            </p>
            <StreamLog lines={trainingLogs} active={!trainingDone && !trainingError} />
            {trainingError && (
              <p className="mt-3 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3">
                {trainingError}
              </p>
            )}
            {trainingDone && (
              <div className="mt-4">
                <CheckBanner
                  label="Training complete for all questions"
                  onNext={() => setPhase("assignment")}
                />
              </div>
            )}
          </SectionCard>
        )}

        {/* Step 3: Method assignment */}
        {phase === "assignment" && (
          <SectionCard step={3} title="Method Assignment">
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Computer</p>
                <div className="flex gap-2">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() => handleComputerChange(n)}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold border transition ${
                        computer === n
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-700 border-gray-300 hover:border-indigo-400"
                      }`}
                    >
                      Computer {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                {QUESTIONS.map((q) => (
                  <div key={q.id} className="flex items-center justify-between px-4 py-3 bg-white">
                    <span className="text-sm font-medium text-gray-700">{q.dropdownLabel}</span>
                    <select
                      value={assignment[q.id] ?? 1}
                      onChange={(e) =>
                        setAssignment((prev) => ({
                          ...prev,
                          [q.id]: parseInt(e.target.value, 10),
                        }))
                      }
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value={1}>Method 1</option>
                      <option value={2}>Method 2</option>
                      <option value={3}>Method 3</option>
                    </select>
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSaveSetup}
                  className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition"
                >
                  Save Setup →
                </button>
              </div>
            </div>
          </SectionCard>
        )}

        {/* Step 4: Complete */}
        {phase === "complete" && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center space-y-3">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 mb-2">
              <svg className="w-6 h-6 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-emerald-800">Setup complete.</h2>
            <p className="text-sm text-emerald-700">Student can now use this computer.</p>
            <button
              onClick={onComplete}
              className="mt-2 px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition"
            >
              Start Student Mode →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Home() {
  // ── Setup state ─────────────────────────────────────────────────────────
  // null = still reading localStorage (avoid flash)
  const [isSetupComplete, setIsSetupComplete] = useState<boolean | null>(null);
  const [methodAssignment, setMethodAssignment] = useState<Record<string, number>>({});

  useEffect(() => {
    const complete = localStorage.getItem("biobridge_setup_complete") === "true";
    setIsSetupComplete(complete);
    if (complete) {
      const ma = localStorage.getItem("biobridge_method_assignment");
      if (ma) setMethodAssignment(JSON.parse(ma));
    }
  }, []);

  // ── Question & method ────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState("");
  const [selectedMethod, setSelectedMethod] = useState<Method | null>(null);
  const [selectedModel, setSelectedModel] =
    useState<GradingModel>(DEFAULT_GRADING_MODEL);

  // ── Wizard state (Method 1) ──────────────────────────────────────────────
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [g0Config, setG0Config] = useState<G0Config>({});
  const [gStarDraft, setGStarDraft] = useState<GStarConfig>({});
  // gStar === null  → wizard not yet complete
  // gStar !== null  → approved, answer panel active
  const [gStar, setGStar] = useState<GStarConfig | null>(null);

  // ── Answer panel state (Method 1 & 3) ───────────────────────────────────
  // Per-part attempt tracking: each part has its own attempt1/attempt2 results
  const [partAttempts, setPartAttempts] = useState<Record<PartLabel, PartAttemptData>>({} as Record<PartLabel, PartAttemptData>);
  const [unlockedParts, setUnlockedParts] = useState<Record<PartLabel, boolean>>({} as Record<PartLabel, boolean>);
  const [retryingParts, setRetryingParts] = useState<Record<PartLabel, boolean>>({} as Record<PartLabel, boolean>);
  const [showingModelAnswer, setShowingModelAnswer] = useState<Record<PartLabel, boolean>>({} as Record<PartLabel, boolean>);
  const [activePart, setActivePart] = useState(0);
  const [method2Grading, setMethod2Grading] = useState(false);
  const [method2Answers, setMethod2Answers] = useState<Record<PartLabel, string>>({} as Record<PartLabel, string>);
  const [cerNote, setCerNote] = useState<string | null>(null);
  const [loadingPart, setLoadingPart] = useState<PartLabel | null>(null);

  // ── Derived state ────────────────────────────────────────────────────────
  const question = QUESTIONS.find((q) => q.id === selectedId);
  const partLabels = (question?.parts.map((p) => p.label) ?? []) as PartLabel[];
  const showAnswerPanel = !!selectedMethod && (selectedMethod !== 1 || !!gStar);
  const allPartsComplete = !!question && question.parts.every((p) => {
    const att = partAttempts[p.label as PartLabel];
    return att?.attempt1 && (att.attempt1.score === att.attempt1.maxScore || att.attempt2);
  });

  // ── Reset helpers ────────────────────────────────────────────────────────
  function resetAnswerPanel() {
    setPartAttempts({} as Record<PartLabel, PartAttemptData>);
    setUnlockedParts({} as Record<PartLabel, boolean>);
    setRetryingParts({} as Record<PartLabel, boolean>);
    setShowingModelAnswer({} as Record<PartLabel, boolean>);
    setActivePart(0);
    setMethod2Grading(false);
    setMethod2Answers({} as Record<PartLabel, string>);
    setCerNote(null);
    setLoadingPart(null);
  }

  function saveSessionData(question: Question, method: Method, attempts: Record<PartLabel, PartAttemptData>) {
    const sessionKey = `biobridge_session_${question.id}`;
    const sessionData: SessionData = {
      questionId: question.id,
      method,
      timestamp: new Date().toISOString(),
      parts: {},
    };

    question.parts.forEach((p) => {
      const attempt = attempts[p.label as PartLabel];
      sessionData.parts[p.label] = {};
      if (attempt?.attempt1) {
        sessionData.parts[p.label].attempt1 = {
          response: attempt.attempt1.answer,
          score: attempt.attempt1.score,
          feedback: attempt.attempt1.feedback,
        };
      }
      if (attempt?.attempt2) {
        sessionData.parts[p.label].attempt2 = {
          response: attempt.attempt2.answer,
          score: attempt.attempt2.score,
          feedback: attempt.attempt2.feedback,
          model_answer_shown: attempt.modelAnswerShown ?? false,
        };
      }
    });

    localStorage.setItem(sessionKey, JSON.stringify(sessionData));
  }

  function deriveUnlockedPartsFromSession(question: Question, attempts: Record<PartLabel, PartAttemptData>) {
    const unlocked: Record<PartLabel, boolean> = {} as Record<PartLabel, boolean>;
    if (question.parts.length === 0) return unlocked;

    unlocked[question.parts[0].label as PartLabel] = true;

    for (let i = 1; i < question.parts.length; i += 1) {
      const prevLabel = question.parts[i - 1].label as PartLabel;
      const prevAttempt = attempts[prevLabel];
      if (!prevAttempt) continue;

      const prevPassed = prevAttempt.attempt1?.score === prevAttempt.attempt1?.maxScore;
      const prevAttempt2 = prevAttempt.attempt2;
      const prevAdvance = prevAttempt2?.score === prevAttempt2?.maxScore || prevAttempt.modelAnswerShown;
      if (prevPassed || prevAdvance) {
        unlocked[question.parts[i].label as PartLabel] = true;
      }
    }

    return unlocked;
  }

  function initializeFirstPart() {
    // Method 1: unlock first part for attempt 1
    if (selectedMethod === 1 && question) {
      const firstPartLabel = question.parts[0].label as PartLabel;
      setUnlockedParts({ [firstPartLabel]: true } as Record<PartLabel, boolean>);
      setActivePart(0);
    }
  }

  function resetWizard() {
    setWizardStep(1);
    setG0Config({});
    setGStarDraft({});
    setGStar(null);
  }

  // ── Handlers ────────────────────────────────────────────────────────────
  function handleQuestionChange(id: string) {
    setSelectedId(id);

    const questionForId = QUESTIONS.find((q) => q.id === id);

    if (isSetupComplete) {
      // Student mode: auto-load method and G* from localStorage
      if (id) {
        const method = ((methodAssignment[id] ?? 1) as Method);
        setSelectedMethod(method);
        if (method === 1) {
          const stored = localStorage.getItem(`biobridge_gstar_${id}`);
          setGStar(stored ? JSON.parse(stored) : null);
          resetAnswerPanel();

          if (questionForId) {
            const sessionRaw = localStorage.getItem(`biobridge_session_${id}`);
            if (sessionRaw) {
              try {
                const session = JSON.parse(sessionRaw) as SessionData;
                const restoredAttempts: Record<PartLabel, PartAttemptData> = {} as Record<PartLabel, PartAttemptData>;
                for (const part of questionForId.parts) {
                  const saved = session.parts[part.label] as SessionData["parts"][string] | undefined;
                  if (!saved) continue;
                  restoredAttempts[part.label as PartLabel] = {} as PartAttemptData;
                  if (saved.attempt1) {
                    restoredAttempts[part.label as PartLabel]!.attempt1 = {
                      answer: saved.attempt1.response,
                      score: saved.attempt1.score,
                      feedback: saved.attempt1.feedback,
                      confidence: "medium",
                      diagnosedGap: "",
                      reasoning: "",
                      timeSeconds: 0,
                      maxScore: part.maxScore,
                    } as PartResult;
                  }
                  if (saved.attempt2) {
                    restoredAttempts[part.label as PartLabel]!.attempt2 = {
                      answer: saved.attempt2.response,
                      score: saved.attempt2.score,
                      feedback: saved.attempt2.feedback,
                      confidence: "medium",
                      diagnosedGap: "",
                      reasoning: "",
                      timeSeconds: 0,
                      maxScore: part.maxScore,
                    } as PartResult;
                  }
                  if (saved.attempt2?.model_answer_shown) {
                    restoredAttempts[part.label as PartLabel]!.modelAnswerShown = true;
                  }
                }
                setPartAttempts(restoredAttempts);
                setUnlockedParts(deriveUnlockedPartsFromSession(questionForId, restoredAttempts));
              } catch {
                resetAnswerPanel();
                initializeFirstPart();
              }
            } else {
              resetAnswerPanel();
              initializeFirstPart();
            }
          } else {
            resetAnswerPanel();
          }
        } else {
          setGStar(null);
          resetAnswerPanel();
        }
      } else {
        setSelectedMethod(null);
        setGStar(null);
      }
    } else {
      // Legacy flow (no setup yet)
      setSelectedMethod(null);
      resetWizard();
      if (id) resetAnswerPanel();
    }
  }

  function handleMethodSelect(m: Method) {
    setSelectedMethod(m);
    resetWizard();
    if (question) resetAnswerPanel();
  }

  function handleSetupComplete() {
    const ma = localStorage.getItem("biobridge_method_assignment");
    if (ma) setMethodAssignment(JSON.parse(ma));
    setIsSetupComplete(true);
  }

  function handleResetSetup() {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("biobridge_")) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    window.location.reload();
  }

  // Wizard step callbacks
  function handleParseDone(result: ParseResult) {
    // Filter G0 to only the parts this question has
    const filtered: G0Config = {};
    for (const label of partLabels) {
      filtered[label] = result.g0[label] ?? result.g0["A"];
    }
    setG0Config(filtered);
    setWizardStep(2);
  }

  function handleG0Confirmed(edited: G0Config) {
    setG0Config(edited);
    setWizardStep(3);
  }

  function handleTrainingDone(draft: GStarConfig) {
    setGStarDraft(draft);
    setWizardStep(4);
  }

  function handleGStarApproved(approved: GStarConfig) {
    setGStar(approved);
    if (question) {
      resetAnswerPanel();
      initializeFirstPart();
    }
  }

  async function handleSubmit(partLabel: PartLabel, answer: string) {
    if (!question || selectedMethod !== 1) return;
    const partDef = question.parts.find((p) => p.label === partLabel)!;
    setLoadingPart(partLabel);

    try {
      const fetchStart = Date.now();

      // ── Determine attempt number ──────────────────────────────────────
      const hasAttempt1 = !!partAttempts[partLabel]?.attempt1;
      const attemptNum = hasAttempt1 ? 2 : 1;

      // ── Build request payload ──────────────────────────────────────────
      const requestBody: any = {
        questionId: question.id,
        partLabel,
        studentResponse: answer,
        method: "1",
        gStar: gStar?.[partLabel],
        attemptNumber: attemptNum,
      };

      // For attempt 2, pass prior attempt 1 feedback
      if (attemptNum === 2 && partAttempts[partLabel]?.attempt1) {
        const attempt1Result = partAttempts[partLabel].attempt1!;
        requestBody.priorFeedback = attempt1Result.feedback;
        requestBody.priorDiagnosedGap = attempt1Result.diagnosedGap || "none";

        // Resolve gap if there was a diagnosed gap in attempt 1
        if (attempt1Result.diagnosedGap && attempt1Result.diagnosedGap !== "none") {
          try {
            const resolveRes = await fetch("/api/resolve-gap", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                diagnosedGap: attempt1Result.diagnosedGap,
                attempt2Response: answer,
              }),
            });
            const resolveData = await resolveRes.json();
            if (resolveData.gapResolution) {
              requestBody.gapResolution = resolveData.gapResolution;
            }
          } catch (resolveErr) {
            console.error("Gap resolution failed (non-fatal):", resolveErr);
          }
        }
      }

      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const payload = (await res.json()) as unknown;
      if (!res.ok) {
        const message =
          payload &&
          typeof payload === "object" &&
          typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : "Something went wrong while grading. Please try again.";
        throw new Error(message);
      }
      if (!isGradeResponse(payload)) {
        throw new Error("Invalid grading response received.");
      }
      const data = payload;
      const timeSeconds = elapsed(fetchStart);

      const newResult: PartResult = {
        ...data,
        timeSeconds,
        answer,
        maxScore: partDef.maxScore,
      };

      const currentAttempt = partAttempts[partLabel] ?? {};
      const updatedAttempt: PartAttemptData = {
        ...currentAttempt,
        [attemptNum === 1 ? "attempt1" : "attempt2"]: newResult,
      };

      if (attemptNum === 2) {
        setRetryingParts((prev) => ({ ...prev, [partLabel]: false }));
      }

      setPartAttempts((prev) => ({
        ...prev,
        [partLabel]: updatedAttempt,
      }));

      if (newResult.score === newResult.maxScore) {
        const partIndex = question.parts.findIndex((p) => p.label === partLabel);
        if (partIndex < question.parts.length - 1) {
          const nextPartLabel = question.parts[partIndex + 1].label as PartLabel;
          setUnlockedParts((prev) => ({ ...prev, [nextPartLabel]: true }));
          setActivePart(partIndex + 1);
        }
      }

      saveSessionData(question, selectedMethod, {
        ...partAttempts,
        [partLabel]: updatedAttempt,
      });
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Something went wrong while grading. Please try again.");
    } finally {
      setLoadingPart(null);
    }
  }

  async function handleMethod2Submit(partLabel: PartLabel, answer: string) {
    if (!question) return;
    const partDef = question.parts.find((p) => p.label === partLabel)!;
    setLoadingPart(partLabel);
    setMethod2Grading(true);
    try {
      const fetchStart = Date.now();
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: question.id,
          partLabel,
          studentResponse: answer,
          method: "2",
          model: selectedModel,
        }),
      });

      const payload = (await res.json()) as unknown;
      if (!res.ok) {
        const message =
          payload &&
          typeof payload === "object" &&
          typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : "Something went wrong while grading. Please try again.";
        throw new Error(message);
      }
      if (!isGradeResponse(payload)) {
        throw new Error("Invalid grading response received.");
      }
      const data = payload;
      const timeSeconds = elapsed(fetchStart);

      setPartAttempts((prev) => {
        const updated = { ...prev } as Record<PartLabel, PartAttemptData>;
        const result: PartResult = {
          ...data,
          timeSeconds,
          answer,
          maxScore: partDef.maxScore,
        };
        updated[partLabel] = {
          ...updated[partLabel],
          attempt1: result,
        };
        return updated;
      });
      setMethod2Answers((prev) => ({ ...prev, [partLabel]: answer }));
      setCerNote((data as any).cerNote ?? null);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Something went wrong while grading. Please try again.");
    } finally {
      setLoadingPart(null);
      setMethod2Grading(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  // Still reading localStorage — render nothing to avoid flash
  if (isSetupComplete === null) return null;

  // Researcher setup page
  if (!isSetupComplete) {
    return <SetupPage onComplete={handleSetupComplete} />;
  }

  // ── Student mode ─────────────────────────────────────────────────────────
  const methodLabels: Record<Method, string> = {
    1: "GradeOpt + RAG",
    2: "Two-Stage Scoring",
    3: "Placeholder",
  };

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Page header */}
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">BioBridge MVP4</h1>
          <p className="text-sm text-gray-500">Keystone Biology CR Question Evaluator</p>
        </div>

        {/* ── Section 1: Question Selector ─────────────────────────────── */}
        <SectionCard step={1} title="Question">
          <div className="space-y-4">
            <select
              id="question-select"
              value={selectedId}
              onChange={(e) => handleQuestionChange(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            >
              <option value="">— Choose a question —</option>
              {QUESTIONS.map((q) => (
                <option key={q.id} value={q.id}>{q.dropdownLabel}</option>
              ))}
            </select>

            {question && (
              <>
                <QuestionContext question={question} />
                {selectedMethod && (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-sm text-gray-500">Feedback Method:</span>
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">
                      Method {selectedMethod} — {methodLabels[selectedMethod]}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </SectionCard>

        {/* ── Section 2: Answer Panel ──────────────────────────────────── */}
        {showAnswerPanel && (
          <SectionCard step={2} title="Answer Panel">
            {selectedMethod === 1 ? (
              // ─── METHOD 1: Per-part attempt flow ──────────────────────────
              <div className="space-y-6">
                {question!.parts.map((part, partIndex) => {
                  const partLabel = part.label as PartLabel;
                  const attempts = partAttempts[partLabel];
                  const isUnlocked = unlockedParts[partLabel];
                  const isFirstPart = partIndex === 0;

                  // Part is locked if not first and prior part hasn't scored full on any attempt
                  const isLocked = !isFirstPart && !isUnlocked && !attempts;

                  if (isLocked) {
                    return (
                      <div key={partLabel} className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-4 text-center">
                        <p className="text-sm text-gray-500">Complete Part {question!.parts[partIndex - 1].label} first to unlock this part.</p>
                      </div>
                    );
                  }

                  // Part is active (can submit or showing results)
                  const hasAttempt1 = !!attempts?.attempt1;
                  const hasAttempt2 = !!attempts?.attempt2;
                  const attempt1Result = attempts?.attempt1;
                  const attempt1Passed = attempt1Result?.score === attempt1Result?.maxScore;
                  const modelAnswerShown = attempts?.modelAnswerShown;
                  const isRetrying = retryingParts[partLabel];

                  if (!hasAttempt1 || (hasAttempt1 && !hasAttempt2 && !attempt1Passed && isRetrying)) {
                    // ─ ATTEMPT 1 or ATTEMPT 2 RETRY: Input panel
                    return (
                      <PartPanel
                        key={partLabel}
                        part={part}
                        onSubmit={(answer) => handleSubmit(partLabel, answer)}
                        isLoading={loadingPart === partLabel}
                        completedResult={undefined}
                      />
                    );
                  }

                  if (!hasAttempt2 && !attempt1Passed && hasAttempt1) {
                    // ─ ATTEMPT 1 FAILED: Show feedback + Try Again button
                    return (
                      <div key={partLabel} className="space-y-3">
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sm text-gray-700">
                              Part {partLabel}
                              {part.maxScore > 1 && <span className="ml-1.5 text-xs font-normal text-gray-400">({part.maxScore} pts)</span>}
                            </span>
                            <ScorePip score={attempt1Result!.score} maxScore={attempt1Result!.maxScore} />
                          </div>
                          <p className="text-xs text-gray-400 italic">{attempt1Result!.answer}</p>
                        </div>
                        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 leading-relaxed">
                          {attempt1Result!.feedback}
                        </div>
                        <button
                          onClick={() => {
                            setRetryingParts((prev) => ({ ...prev, [partLabel]: true }));
                          }}
                          className="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition"
                        >
                          Try Again
                        </button>
                      </div>
                    );
                  }

                  if (!hasAttempt2 && attempt1Passed) {
                    // ─ ATTEMPT 1 PASSED: Show feedback (next part unlocked in handleSubmit)
                    return (
                      <div key={partLabel} className="space-y-3">
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sm text-gray-700">
                              Part {partLabel}
                              {part.maxScore > 1 && <span className="ml-1.5 text-xs font-normal text-gray-400">({part.maxScore} pts)</span>}
                            </span>
                            <ScorePip score={attempt1Result!.score} maxScore={attempt1Result!.maxScore} />
                          </div>
                          <p className="text-xs text-gray-400 italic">{attempt1Result!.answer}</p>
                        </div>
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 leading-relaxed">
                          {attempt1Result!.feedback}
                        </div>
                      </div>
                    );
                  }

                  if (hasAttempt2) {
                    // ─ ATTEMPT 2: Show results
                    const attempt2Result = attempts!.attempt2!;
                    const attempt2Passed = attempt2Result.score === attempt2Result.maxScore;

                    if (!attempt2Passed) {
                      // Attempt 2 failed: show feedback + model answer option
                      return (
                        <div key={partLabel} className="space-y-3">
                          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-sm text-gray-700">
                                Part {partLabel} — Attempt 2
                                {part.maxScore > 1 && <span className="ml-1.5 text-xs font-normal text-gray-400">({part.maxScore} pts)</span>}
                              </span>
                              <ScorePip score={attempt2Result.score} maxScore={attempt2Result.maxScore} />
                            </div>
                            <p className="text-xs text-gray-400 italic">{attempt2Result.answer}</p>
                          </div>
                          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 leading-relaxed">
                            {attempt2Result.feedback}
                          </div>
                          {!modelAnswerShown && (
                            <button
                              onClick={() => {
                                setShowingModelAnswer((prev) => ({ ...prev, [partLabel]: true }));
                              }}
                              className="w-full px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition"
                            >
                              See Model Answer
                            </button>
                          )}
                          {showingModelAnswer[partLabel] && (
                            <div className="rounded-lg border border-gray-300 bg-gray-100 p-4 space-y-3">
                              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Model Answer:</p>
                              <p className="text-sm text-gray-800 leading-relaxed">{part.modelAnswer}</p>
                              <button
                                onClick={() => {
                                  const updatedAttempts = {
                                    ...partAttempts,
                                    [partLabel]: {
                                      ...partAttempts[partLabel],
                                      modelAnswerShown: true,
                                    },
                                  } as Record<PartLabel, PartAttemptData>;
                                  setPartAttempts(updatedAttempts);
                                  saveSessionData(question!, selectedMethod!, updatedAttempts);
                                  const nextIndex = partIndex + 1;
                                  if (nextIndex < question!.parts.length) {
                                    const nextLabel = question!.parts[nextIndex].label as PartLabel;
                                    setUnlockedParts((prev) => ({ ...prev, [nextLabel]: true }));
                                  }
                                }}
                                className="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition"
                              >
                                Continue →
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    } else {
                      // Attempt 2 passed: show feedback (next part unlocked in handleSubmit)
                      return (
                        <div key={partLabel} className="space-y-3">
                          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm text-gray-700">
                                  Part {partLabel} — Attempt 2
                                  {part.maxScore > 1 && <span className="ml-1.5 text-xs font-normal text-gray-400">({part.maxScore} pts)</span>}
                                </span>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
                                  ✓ Improved
                                </span>
                              </div>
                              <ScorePip score={attempt2Result.score} maxScore={attempt2Result.maxScore} />
                            </div>
                            <p className="text-xs text-gray-400 italic">{attempt2Result.answer}</p>
                          </div>
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 leading-relaxed">
                            {attempt2Result.feedback}
                          </div>
                        </div>
                      );
                    }
                  }
                })}

                {allPartsComplete && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-6 py-6 text-center space-y-2">
                    <p className="text-lg font-semibold text-emerald-800">
                      You have completed all parts of this question.
                    </p>
                    <button
                      onClick={() => {
                        setSelectedId("");
                        resetAnswerPanel();
                      }}
                      className="mt-3 px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition"
                    >
                      Choose Another Question
                    </button>
                  </div>
                )}
              </div>
            ) : selectedMethod === 2 ? (
              // ─── METHOD 2: All parts visible, batch grading ────────────────
              <div className="space-y-4">
                {question!.parts.map((part) => (
                  <PartPanel
                    key={part.label}
                    part={part}
                    onSubmit={(answer) => handleMethod2Submit(part.label, answer)}
                    isLoading={method2Grading}
                    completedResult={partAttempts[part.label as PartLabel]?.attempt1 as PartResult | undefined}
                    lockedAnswer={method2Answers[part.label]}
                  />
                ))}
                {Object.keys(partAttempts).length > 0 && (
                  <div className="space-y-3">
                    {question!.parts.map((part) => {
                      const result = partAttempts[part.label as PartLabel]?.attempt1;
                      if (!result) return null;
                      const bg =
                        result.score === result.maxScore ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : result.score === 0 ? "bg-rose-50 text-rose-800 border-rose-200"
                        : "bg-amber-50 text-amber-800 border-amber-200";
                      return (
                        <div key={part.label} className="rounded-lg border px-4 py-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sm text-gray-700">
                              Part {part.label}
                              {part.maxScore > 1 && <span className="ml-1.5 text-xs font-normal text-gray-400">({part.maxScore} pts)</span>}
                            </span>
                            <ScorePip score={result.score} maxScore={result.maxScore} />
                          </div>
                          <p className="text-xs text-gray-400 italic line-clamp-2">{result.answer}</p>
                          <div className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${bg}`}>
                            {result.feedback}
                          </div>
                        </div>
                      );
                    })}
                    {cerNote && (
                      <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 space-y-1">
                        <p className="text-xs font-bold uppercase tracking-wider text-sky-600">
                          CER Writing Tip
                        </p>
                        <p className="text-sm text-sky-800 leading-relaxed">{cerNote}</p>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setSelectedId("");
                        resetAnswerPanel();
                      }}
                      className="w-full px-4 py-2 rounded-lg text-indigo-600 text-sm font-medium hover:text-indigo-800"
                    >
                      Choose Another Question
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </SectionCard>
        )}

        {/* Empty state */}
        {!selectedId && (
          <div className="text-center py-16 text-gray-400 text-sm">
            Select a question above to begin.
          </div>
        )}

        {/* Reset setup — hidden link for researcher */}
        <div className="text-center pb-4">
          <button
            onClick={handleResetSetup}
            className="text-xs text-gray-300 hover:text-gray-500 transition"
          >
            Reset setup
          </button>
        </div>
      </div>
    </div>
  );
}
