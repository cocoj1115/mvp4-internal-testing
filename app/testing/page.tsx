"use client";

import Link from "next/link";
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
  TESTING_SETUP_STORAGE_KEY,
  parseDeviceTestingSetup,
} from "@/app/lib/testingSetup";
import type {
  DeviceTestingSetup,
  GStarConfig,
  Method,
} from "@/app/lib/testingSetup";

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4;

interface G0PartConfig {
  keyConcepts: string;
  rubric: string;
  examples: string;
}

type G0Config = Record<string, G0PartConfig>;

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

function Badge({ label }: { label: string }) {
  return (
    <span className="ml-2 inline-block rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold px-2 py-0.5 tracking-wide uppercase">
      {label}
    </span>
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

function Step1Upload({ onComplete }: { onComplete: (result: ParseResult) => void }) {
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
  onComplete,
}: {
  g0: G0Config;
  onComplete: (gStar: GStarConfig) => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GStarConfig | null>(null);
  const startedRef = useRef(false);
  const g0Ref = useRef(g0);

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
            body: JSON.stringify({ g0: g0Ref.current }),
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
}: {
  part: QuestionPart;
  onSubmit: (answer: string) => Promise<void>;
  isLoading: boolean;
  completedResult?: PartResult;
}) {
  const [answer, setAnswer] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!completedResult) textareaRef.current?.focus();
  }, [completedResult]);

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

// ─── Answer panel: Results ────────────────────────────────────────────────────

function ResultsPanel({
  question,
  results,
}: {
  question: Question;
  results: Record<string, PartResult>;
}) {
  const totalEarned = question.parts.reduce((s, p) => s + (results[p.label]?.score ?? 0), 0);
  const totalPossible = question.parts.reduce((s, p) => s + p.maxScore, 0);
  const totalTime = question.parts.reduce((s, p) => s + (results[p.label]?.timeSeconds ?? 0), 0);
  const totalTokens = question.parts.reduce((s, p) => s + (results[p.label]?.tokenCount ?? 0), 0);
  const scoreColor =
    totalEarned === totalPossible ? "text-emerald-600" : totalEarned === 0 ? "text-rose-600" : "text-amber-500";

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 bg-gray-50 border-b border-gray-200">
        <h3 className="font-semibold text-gray-800">Results</h3>
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span>Total: <span className={`font-bold ${scoreColor}`}>{totalEarned} / {totalPossible}</span></span>
          <span>⏱ {totalTime}s</span>
          {totalTokens > 0 && <span>{totalTokens.toLocaleString()} tokens</span>}
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {question.parts.map((p) => {
          const r = results[p.label];
          if (!r) return null;
          const bg =
            r.score === r.maxScore ? "bg-emerald-50 text-emerald-800 border-emerald-200"
            : r.score === 0 ? "bg-rose-50 text-rose-800 border-rose-200"
            : "bg-amber-50 text-amber-800 border-amber-200";
          return (
            <div key={p.label} className="px-6 py-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-gray-700">
                  Part {p.label}
                  {p.maxScore > 1 && <span className="ml-1.5 text-xs font-normal text-gray-400">({p.maxScore} pts)</span>}
                </span>
                <div className="flex items-center gap-3 text-sm text-gray-400">
                  <span>⏱ {r.timeSeconds}s</span>
                  {r.tokenCount != null && <span>{r.tokenCount.toLocaleString()} tok</span>}
                  <ScorePip score={r.score} maxScore={r.maxScore} />
                </div>
              </div>
              <p className="text-xs text-gray-400 italic line-clamp-2">{r.answer}</p>
              <div className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${bg}`}>
                {r.feedback}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Home() {
  // ── Question & method ────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState("");
  const [selectedMethod, setSelectedMethod] = useState<Method | null>(null);
  const [deviceSetup, setDeviceSetup] = useState<DeviceTestingSetup | null>(null);
  const [assignmentIndex, setAssignmentIndex] = useState(0);
  const [setupLoaded, setSetupLoaded] = useState(false);

  // ── Wizard state (Method 1) ──────────────────────────────────────────────
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [g0Config, setG0Config] = useState<G0Config>({});
  const [gStarDraft, setGStarDraft] = useState<GStarConfig>({});
  // gStar === null  → wizard not yet complete
  // gStar !== null  → approved, answer panel active
  const [gStar, setGStar] = useState<GStarConfig | null>(null);

  // ── Answer panel state ───────────────────────────────────────────────────
  const [activePart, setActivePart] = useState<number>(0);
  const [results, setResults] = useState<Record<string, PartResult>>({});
  const [loadingPart, setLoadingPart] = useState<PartLabel | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(TESTING_SETUP_STORAGE_KEY);
    if (!raw) {
      setSetupLoaded(true);
      return;
    }

    try {
      const parsed = parseDeviceTestingSetup(JSON.parse(raw));
      if (parsed && parsed.assignments.length > 0) {
        setDeviceSetup(parsed);
      }
    } catch {
      // Ignore malformed local data and continue in manual mode.
    }

    setSetupLoaded(true);
  }, []);

  // ── Derived state ────────────────────────────────────────────────────────
  const assignment = deviceSetup?.assignments[assignmentIndex] ?? null;
  const effectiveQuestionId = assignment?.questionId ?? selectedId;
  const effectiveMethod = assignment?.method ?? selectedMethod;
  const effectiveGStar = assignment?.gStar ?? gStar;
  const question = QUESTIONS.find((q) => q.id === effectiveQuestionId);
  const partLabels = (question?.parts.map((p) => p.label) ?? []) as PartLabel[];
  const allDone = !!question && activePart >= question.parts.length;
  const isPresetMode = !!deviceSetup;
  const hasNextPresetQuestion =
    !!deviceSetup && assignmentIndex < deviceSetup.assignments.length - 1;
  const presetFinished =
    !!deviceSetup && !hasNextPresetQuestion && allDone;

  // Sections visible based on flow state
  const showMethodSelector = !isPresetMode && !!selectedId;
  const showWizard = !isPresetMode && !!selectedMethod && selectedMethod === 1 && !gStar;
  const showAnswerPanel =
    !!question && !!effectiveMethod && (effectiveMethod !== 1 || !!effectiveGStar);

  // ── Reset helpers ────────────────────────────────────────────────────────
  function resetAnswerPanel() {
    setActivePart(0);
    setResults({});
    setLoadingPart(null);
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
    setSelectedMethod(null);
    resetWizard();
    if (id) {
      const q = QUESTIONS.find((q) => q.id === id);
      if (q) resetAnswerPanel();
    }
  }

  function handleMethodSelect(m: Method) {
    setSelectedMethod(m);
    resetWizard();
    if (question) resetAnswerPanel();
  }

  function handleNextPresetQuestion() {
    if (!deviceSetup) return;
    if (assignmentIndex >= deviceSetup.assignments.length - 1) return;
    setAssignmentIndex((prev) => prev + 1);
    resetAnswerPanel();
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
    if (question) resetAnswerPanel();
  }

  async function handleSubmit(partLabel: PartLabel, answer: string) {
    if (!question || !effectiveMethod) return;
    const partDef = question.parts.find((p) => p.label === partLabel)!;
    setLoadingPart(partLabel);

    try {
      const fetchStart = Date.now();
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: question.id,
          partLabel,
          studentResponse: answer,
          method: effectiveMethod.toString(),
          gStar: effectiveGStar?.[partLabel],
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

      setResults((prev) => ({
        ...prev,
        [partLabel]: {
          ...data,
          timeSeconds,
          answer,
          maxScore: partDef.maxScore,
        },
      }));

      const nextIndex = question.parts.findIndex((p) => p.label === partLabel) + 1;
      setActivePart(nextIndex);
    } catch (err) {
      console.error(err);
      alert("Something went wrong while grading. Please try again.");
    } finally {
      setLoadingPart(null);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-gray-900">BioBridge MVP4 — Internal Testing</h1>
            <p className="text-sm text-gray-500">Keystone Biology CR Question Evaluator</p>
          </div>
          {!isPresetMode && (
            <Link
              href="/setup"
              className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-indigo-400 hover:text-indigo-600"
            >
              Setup Page
            </Link>
          )}
        </div>

        {!setupLoaded && (
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
            Loading local test setup...
          </div>
        )}

        {isPresetMode && setupLoaded && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">
              {deviceSetup.stationLabel || "Testing Station"}
            </p>
            <p className="mt-1 text-sm text-indigo-900">
              Question {assignmentIndex + 1} of {deviceSetup.assignments.length}
            </p>
          </div>
        )}

        {/* ── Section 1: Question Selector / Locked Question ───────────── */}
        {!isPresetMode && (
          <SectionCard step={1} title="Question Selector">
            <div className="space-y-4">
              <div>
                <label htmlFor="question-select" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Select a question
                </label>
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
              </div>
              {question && <QuestionContext question={question} />}
            </div>
          </SectionCard>
        )}

        {isPresetMode && question && (
          <SectionCard step={1} title={`Question ${assignmentIndex + 1}`}>
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
                Method {effectiveMethod}
              </p>
              <QuestionContext question={question} />
            </div>
          </SectionCard>
        )}

        {/* ── Section 2: Method Selector ───────────────────────────────── */}
        {showMethodSelector && (
          <SectionCard step={2} title="Method Selector">
            <div className="flex gap-3 flex-wrap">
              {([1, 2, 3] as Method[]).map((m) => {
                const labels: Record<Method, string> = {
                  1: "GradeOpt + RAG Pipeline",
                  2: "Two-Stage Scoring",
                  3: "Placeholder",
                };
                const isActive = selectedMethod === m;
                return (
                  <button
                    key={m}
                    onClick={() => handleMethodSelect(m)}
                    className={`inline-flex items-center px-4 py-2.5 rounded-lg text-sm border transition ${
                      isActive
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-sm font-semibold"
                        : "bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:text-indigo-600 font-medium"
                    }`}
                  >
                    <span className="font-bold mr-1">Method {m}</span>
                    <span className={isActive ? "text-indigo-200" : "text-gray-400"}>
                      {labels[m]}
                    </span>
                    {m === 3 && <Badge label="Placeholder" />}
                  </button>
                );
              })}
            </div>
            {selectedMethod === 1 && !gStar && (
              <p className="mt-3 text-xs text-gray-400">
                Complete the setup wizard below to configure GradeOpt before answering.
              </p>
            )}
            {selectedMethod === 1 && gStar && (
              <p className="mt-3 text-xs text-emerald-600 font-medium">
                ✓ G* loaded — GradeOpt + RAG grading active
              </p>
            )}
            {selectedMethod === 2 && (
              <p className="mt-3 text-xs text-sky-600 font-medium">
                Two GPT-4o calls per part — score first, then generate feedback for that part.
              </p>
            )}
            {selectedMethod === 3 && (
              <p className="mt-3 text-xs text-gray-400">
                Method 3 is a placeholder — proceeding directly to the answer panel.
              </p>
            )}
          </SectionCard>
        )}

        {/* ── Section 3: Pipeline Wizard (Method 1 only) ───────────────── */}
        {showWizard && (
          <SectionCard step={3} title="GradeOpt + RAG Pipeline Setup">
            <WizardProgress step={wizardStep} />

            {wizardStep === 1 && (
              <Step1Upload onComplete={handleParseDone} />
            )}
            {wizardStep === 2 && (
              <Step2ReviewG0
                g0={g0Config}
                partLabels={partLabels}
                onConfirm={handleG0Confirmed}
              />
            )}
            {wizardStep === 3 && (
              <Step3Training g0={g0Config} onComplete={handleTrainingDone} />
            )}
            {wizardStep === 4 && (
              <Step4ReviewGStar
                gStarDraft={gStarDraft}
                partLabels={partLabels}
                onApprove={handleGStarApproved}
              />
            )}
          </SectionCard>
        )}

        {/* ── Section 3: Answer Panel ──────────────────────────────────── */}
        {showAnswerPanel && (
          <SectionCard step={isPresetMode ? 2 : 3} title="Answer Panel">
            {!allDone ? (
              <div className="space-y-4">
                {question!.parts.map((part, idx) => {
                  if (idx > activePart) return null;
                  return (
                    <PartPanel
                      key={part.label}
                      part={part}
                      onSubmit={(answer) => handleSubmit(part.label, answer)}
                      isLoading={loadingPart === part.label}
                      completedResult={results[part.label] as PartResult | undefined}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="space-y-4">
                <ResultsPanel question={question!} results={results} />
                <div className="text-center pt-2">
                  {!isPresetMode && (
                    <button
                      onClick={() => {
                        if (question) resetAnswerPanel();
                      }}
                      className="text-sm text-indigo-600 hover:text-indigo-800 font-medium underline underline-offset-2 transition"
                    >
                      Retry this question
                    </button>
                  )}

                  {isPresetMode && hasNextPresetQuestion && (
                    <button
                      onClick={handleNextPresetQuestion}
                      className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition"
                    >
                      Next Question
                    </button>
                  )}

                  {isPresetMode && presetFinished && (
                    <p className="text-sm font-medium text-emerald-700">
                      All questions completed for this station.
                    </p>
                  )}
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {/* Empty state */}
        {!isPresetMode && !selectedId && setupLoaded && (
          <div className="text-center py-16 text-gray-400 text-sm">
            Select a question above to begin.
          </div>
        )}
      </div>
    </div>
  );
}
