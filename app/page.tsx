"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  QUESTIONS,
  Question,
  QuestionPart,
  QuestionTable,
} from "@/app/lib/questions";
import type { GradeResponse } from "@/app/api/grade/route";

// ─── Types ────────────────────────────────────────────────────────────────────

type Method = 1 | 2 | 3;
type PartStatus = "locked" | "active" | "done";

interface AttemptRecord {
  attemptNumber: 1 | 2;
  response: string;
  score: number;
  feedback: string;
  diagnosedGap: string;
  submittedAt: string;
  resolution?: string;
  modelAnswerShown?: boolean;
}

interface PartState {
  status: PartStatus;
  attempts: AttemptRecord[];
}

interface SessionState {
  questionId: string;
  method: Method;
  startedAt: string;
  parts: Record<string, PartState>;
}

function initSession(question: Question, method: Method): SessionState {
  const parts: Record<string, PartState> = {};
  question.parts.forEach((p, idx) => {
    parts[p.label] = { status: idx === 0 ? "active" : "locked", attempts: [] };
  });
  return { questionId: question.id, method, startedAt: new Date().toISOString(), parts };
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function QuestionImage({ src }: { src: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) return (
    <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-5 py-4 text-xs text-gray-400">
      Place image at <code className="bg-gray-100 px-1 rounded">public{src}</code>
    </div>
  );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="Question diagram" onError={() => setMissing(true)}
      className="w-full rounded-lg border border-gray-200 object-contain" />
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
              <th key={col} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map(([sys, desc], idx) => (
            <tr key={idx} className={`border-b border-gray-100 last:border-0 ${idx % 2 === 1 ? "bg-gray-50/60" : "bg-white"}`}>
              <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap align-top">{sys}</td>
              <td className="px-4 py-3 text-gray-600 align-top leading-relaxed">{desc}</td>
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
      </div>
      <p className="text-sm text-gray-700 leading-relaxed">{question.stem}</p>
      {question.imageUrl && <QuestionImage src={question.imageUrl} />}
      {question.table && <QuestionTableBlock table={question.table} />}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

// ─── Setup: Step 1 — Knowledge Base Upload ────────────────────────────────────

function Step1KBUpload({ onSuccess }: { onSuccess: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    const pdfs = Array.from(incoming).filter((f) => f.type === "application/pdf");
    setFiles((prev) => {
      const combined = [...prev, ...pdfs];
      // dedupe by name, keep latest, max 2
      const seen = new Map<string, File>();
      for (const f of combined) seen.set(f.name, f);
      return Array.from(seen.values()).slice(0, 2);
    });
  }

  async function handleProcess() {
    if (files.length === 0) { setError("Upload at least one PDF."); return; }
    setProcessing(true);
    setError(null);
    try {
      const fd = new FormData();
      if (files[0]) fd.append("module1", files[0]);
      if (files[1]) fd.append("module2", files[1]);
      const res = await fetch("/api/parse", { method: "POST", body: fd });
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        const text = await res.text();
        throw new Error(`Server error (${res.status}): ${text.slice(0, 200)}`);
      }
      const data = await res.json() as { success?: boolean; chunkCount?: number; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? "Processing failed.");
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "An error occurred.");
    } finally {
      setProcessing(false);
    }
  }

  const hasFiles = files.length > 0;

  return (
    <div className="space-y-4">
      {/* Single dropzone */}
      <div
        onClick={() => !processing && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 cursor-pointer transition ${
          processing ? "opacity-60 pointer-events-none border-gray-200 bg-gray-50"
          : hasFiles ? "border-indigo-400 bg-indigo-50/20"
          : "border-gray-300 bg-gray-50 hover:border-indigo-400 hover:bg-indigo-50/20"
        }`}
      >
        <svg className={`w-8 h-8 shrink-0 ${hasFiles ? "text-indigo-400" : "text-gray-300"}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        {hasFiles ? (
          <div className="space-y-1 text-center">
            {files.map((f) => (
              <p key={f.name} className="text-sm font-medium text-indigo-700">{f.name}</p>
            ))}
            {files.length < 2 && (
              <p className="text-xs text-gray-400">Click or drop to add a second PDF</p>
            )}
          </div>
        ) : (
          <div className="text-center">
            <p className="text-sm text-gray-600">
              <span className="text-indigo-600 font-medium">Browse</span> or drop PDF files here
            </p>
            <p className="text-xs text-gray-400 mt-1">Up to 2 PDF files</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {/* Clear selection */}
      {hasFiles && !processing && (
        <button onClick={() => setFiles([])} className="text-xs text-gray-400 hover:text-gray-600 transition">
          Clear selection
        </button>
      )}

      {error && (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3">{error}</p>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleProcess}
          disabled={processing || files.length === 0}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {processing ? <><Spinner />Processing…</> : "Process & Embed"}
        </button>
      </div>
      {processing && (
        <p className="text-xs text-gray-400 text-center">
          Parsing PDFs and building vector index — this may take a minute…
        </p>
      )}
    </div>
  );
}

// ─── Setup: Step 2 — Method Assignment ───────────────────────────────────────

function Step2MethodAssignment({ onSave }: { onSave: (assignment: Record<string, Method>) => void }) {
  const [assignment, setAssignment] = useState<Record<string, Method>>({
    M1Q14: 1, M1Q15: 1, M2Q14: 1, M2Q15: 1,
  });

  const methodLabels: Record<Method, string> = {
    1: "Method 1 — GradeOpt + RAG",
    2: "Method 2 — Two-Stage Error-Aware",
    3: "Method 3 — Feedback-First",
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600">
        Assign a grading method to each question. Students will not see this.
      </p>
      <div className="rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
        {QUESTIONS.map((q) => (
          <div key={q.id} className="flex items-center justify-between px-5 py-3.5 bg-white">
            <div>
              <span className="text-sm font-semibold text-gray-800">{q.id}</span>
              <span className="ml-2 text-xs text-gray-400 font-mono">Standard {q.standard}</span>
            </div>
            <select
              value={assignment[q.id]}
              onChange={(e) => setAssignment((prev) => ({ ...prev, [q.id]: parseInt(e.target.value) as Method }))}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {([1, 2, 3] as Method[]).map((m) => (
                <option key={m} value={m}>{methodLabels[m]}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <button
          onClick={() => onSave(assignment)}
          className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition"
        >
          Save &amp; Start →
        </button>
      </div>
    </div>
  );
}

// ─── Setup mode ───────────────────────────────────────────────────────────────

function SetupMode({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);

  function handleSave(assignment: Record<string, Method>) {
    localStorage.setItem("biobridge_method_assignment", JSON.stringify(assignment));
    localStorage.setItem("biobridge_setup_complete", "true");
    onComplete();
  }

  function handleReset() {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("biobridge_")) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    window.location.reload();
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">BioBridge — Setup</h1>
          <p className="text-sm text-gray-500 mt-1">Step {step} of 2</p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-3">
          {[
            { n: 1, label: "Knowledge Base" },
            { n: 2, label: "Method Assignment" },
          ].map((s, idx) => (
            <div key={s.n} className={`flex items-center ${idx < 1 ? "flex-1" : ""}`}>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold border-2 transition-colors ${
                  s.n < step ? "border-emerald-500 bg-emerald-500 text-white"
                  : s.n === step ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-gray-300 bg-white text-gray-400"
                }`}>
                  {s.n < step ? (
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : s.n}
                </span>
                <span className={`text-xs font-medium ${s.n === step ? "text-indigo-700" : s.n < step ? "text-emerald-600" : "text-gray-400"}`}>
                  {s.label}
                </span>
              </div>
              {idx < 1 && <div className={`flex-1 mx-3 h-px ${s.n < step ? "bg-emerald-400" : "bg-gray-200"}`} />}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          {step === 1
            ? <Step1KBUpload onSuccess={() => setStep(2)} />
            : <Step2MethodAssignment onSave={handleSave} />
          }
        </div>

        <div className="text-center">
          <button onClick={handleReset} className="text-xs text-gray-400 hover:text-gray-600 transition">
            Reset setup
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Student: Part player ─────────────────────────────────────────────────────

function PartPlayer({
  part,
  partState,
  isLoading,
  input,
  onInputChange,
  onSubmit,
  onNext,
  onShowModelAnswer,
  onContinue,
}: {
  part: QuestionPart;
  partState: PartState;
  isLoading: boolean;
  input: string;
  onInputChange: (v: string) => void;
  onSubmit: () => void;
  onNext: () => void;
  onShowModelAnswer: () => void;
  onContinue: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { status, attempts = [] } = partState;

  // Focus textarea when part becomes active with no attempts or when retry starts
  useEffect(() => {
    if ((status === "active" && attempts.length === 0) || retrying) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [status, attempts.length, retrying]);
  const attempt1 = attempts[0] as AttemptRecord | undefined;
  const attempt2 = attempts[1] as AttemptRecord | undefined;

  const partHeader = (
    <div className="flex items-center gap-2 mb-3">
      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold shrink-0 ${
        status === "done" ? "bg-emerald-500 text-white"
        : status === "locked" ? "bg-gray-200 text-gray-400"
        : "bg-indigo-600 text-white"
      }`}>
        {status === "done"
          ? <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
          : part.label}
      </span>
      <span className="text-sm font-semibold text-gray-700">Part {part.label}</span>
      {part.maxScore > 1 && status !== "locked" && (
        <span className="text-xs text-gray-400">({part.maxScore} pts)</span>
      )}
    </div>
  );

  // ── Locked ────────────────────────────────────────────────────────────────
  if (status === "locked") {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 opacity-60">
        {partHeader}
        <p className="text-sm text-gray-400 italic">{part.prompt}</p>
      </div>
    );
  }

  // ── Done (compact) ────────────────────────────────────────────────────────
  if (status === "done") {
    const lastAttempt = attempts.at(-1)!;
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5">
        {partHeader}
        <p className="text-xs text-gray-400 italic mb-2">{part.prompt}</p>
        <p className="text-sm text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-2 line-clamp-2">
          {lastAttempt.response}
        </p>
      </div>
    );
  }

  // ── Active — no attempts yet (Attempt 1 input) ───────────────────────────
  if (!attempt1) {
    return (
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/20 p-5 space-y-3">
        {partHeader}
        <p className="text-sm text-gray-700 leading-relaxed">{part.prompt}</p>
        {part.maxScore > 1 && (
          <p className="text-xs font-medium text-indigo-500">Worth {part.maxScore} points — describe two separate methods.</p>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          disabled={isLoading}
          placeholder="Type your response here…"
          rows={4}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y transition"
        />
        <div className="flex justify-between items-center">
          <span className="text-xs text-gray-400">{input.trim().length === 0 ? "Response required" : `${input.trim().length} chars`}</span>
          <button
            onClick={onSubmit}
            disabled={isLoading || input.trim().length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isLoading ? <><Spinner />Grading…</> : "Submit"}
          </button>
        </div>
      </div>
    );
  }

  const attempt1Passed = attempt1.score >= part.maxScore;

  // ── Active — Attempt 1 passed ─────────────────────────────────────────────
  if (attempt1Passed && !attempt2) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        {partHeader}
        <p className="text-xs text-gray-400 italic">{part.prompt}</p>
        <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{attempt1.response}</p>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 leading-relaxed">
          {attempt1.feedback}
        </div>
        <div className="flex justify-end">
          <button onClick={onNext} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition">
            Next →
          </button>
        </div>
      </div>
    );
  }

  // ── Active — Attempt 1 failed, not yet retrying ───────────────────────────
  if (!attempt1Passed && !attempt2 && !retrying) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        {partHeader}
        <p className="text-xs text-gray-400 italic">{part.prompt}</p>
        <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{attempt1.response}</p>
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 leading-relaxed">
          {attempt1.feedback}
        </div>
        <div className="flex justify-end">
          <button
            onClick={() => { setRetrying(true); onInputChange(attempt1.response); }}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // ── Active — Attempt 1 failed, retrying (Attempt 2 input) ────────────────
  if (!attempt1Passed && !attempt2 && retrying) {
    return (
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/20 p-5 space-y-3">
        {partHeader}
        <p className="text-sm text-gray-700 leading-relaxed">{part.prompt}</p>
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 leading-relaxed">
          {attempt1.feedback}
        </div>
        <p className="text-xs font-medium text-indigo-500">Attempt 2 of 2</p>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          disabled={isLoading}
          rows={4}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y transition"
        />
        <div className="flex justify-between items-center">
          <span className="text-xs text-gray-400">{input.trim().length === 0 ? "Response required" : `${input.trim().length} chars`}</span>
          <button
            onClick={onSubmit}
            disabled={isLoading || input.trim().length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isLoading ? <><Spinner />Grading…</> : "Submit"}
          </button>
        </div>
      </div>
    );
  }

  // ── Active — Attempt 2 present ────────────────────────────────────────────
  if (attempt2) {
    const attempt2Passed = attempt2.score >= part.maxScore;
    const modelShown = attempt2.modelAnswerShown ?? false;

    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        {partHeader}
        <p className="text-xs text-gray-400 italic">{part.prompt}</p>
        <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{attempt2.response}</p>
        <div className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${
          attempt2Passed
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-amber-200 bg-amber-50 text-amber-800"
        }`}>
          {attempt2.feedback}
        </div>

        {attempt2Passed && (
          <div className="flex justify-end">
            <button onClick={onNext} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition">
              Next →
            </button>
          </div>
        )}

        {!attempt2Passed && !modelShown && (
          <div className="flex justify-end">
            <button
              onClick={onShowModelAnswer}
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-600 text-sm font-medium hover:bg-gray-50 transition"
            >
              See Model Answer
            </button>
          </div>
        )}

        {!attempt2Passed && modelShown && (
          <div className="space-y-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 space-y-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Model Answer</p>
              <p className="text-sm text-gray-700 leading-relaxed">{part.modelAnswer}</p>
            </div>
            <div className="flex justify-end">
              <button onClick={onContinue} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition">
                Continue →
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ─── Student: Question player ─────────────────────────────────────────────────

function QuestionPlayer({
  question,
  method,
  questionIndex,
  totalQuestions,
  onNextQuestion,
}: {
  question: Question;
  method: Method;
  questionIndex: number;
  totalQuestions: number;
  onNextQuestion: () => void;
}) {
  const [session, setSession] = useState<SessionState>(() => {
    try {
      const stored = localStorage.getItem(`biobridge_session_${question.id}`);
      if (stored) return JSON.parse(stored) as SessionState;
    } catch { /* ignore */ }
    return initSession(question, method);
  });
  const [loading, setLoading] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const saveSession = useCallback((s: SessionState) => {
    setSession(s);
    localStorage.setItem(`biobridge_session_${question.id}`, JSON.stringify(s));
  }, [question.id]);

  const allDone = question.parts.every((p) => session.parts[p.label]?.status === "done");

  async function handleSubmit(partLabel: string) {
    const partState = session.parts[partLabel];
    if (!partState) return;
    const attempts = partState.attempts ?? [];
    const attemptNumber = (attempts.length + 1) as 1 | 2;
    const response = (inputs[partLabel] ?? "").trim();
    if (!response) return;

    setLoading(partLabel);
    try {
      const attempt1 = attempts[0] as AttemptRecord | undefined;
      const body: Record<string, unknown> = {
        questionId: question.id,
        partLabel,
        studentResponse: response,
        method: session.method.toString(),
        attemptNumber,
      };
      if (attemptNumber === 2 && attempt1) {
        body.attempt1Feedback = attempt1.feedback;
        body.attempt1Gap = attempt1.diagnosedGap;
      }

      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as GradeResponse;

      const record: AttemptRecord = {
        attemptNumber,
        response,
        score: data.score,
        feedback: data.feedback,
        diagnosedGap: data.diagnosedGap ?? "none",
        submittedAt: new Date().toISOString(),
        resolution: data.resolution,
        modelAnswerShown: false,
      };

      const newSession = structuredClone(session);
      newSession.parts[partLabel].attempts.push(record);
      saveSession(newSession);
      setInputs((prev) => ({ ...prev, [partLabel]: "" }));
    } catch (err) {
      console.error(err);
      alert("Something went wrong while grading. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  function handleNext(partLabel: string) {
    const newSession = structuredClone(session);
    newSession.parts[partLabel].status = "done";
    const partIndex = question.parts.findIndex((p) => p.label === partLabel);
    if (partIndex < question.parts.length - 1) {
      const nextLabel = question.parts[partIndex + 1].label;
      newSession.parts[nextLabel].status = "active";
    }
    saveSession(newSession);
  }

  function handleShowModelAnswer(partLabel: string) {
    const newSession = structuredClone(session);
    const last = newSession.parts[partLabel].attempts.at(-1);
    if (last) last.modelAnswerShown = true;
    saveSession(newSession);
  }

  function handleContinue(partLabel: string) {
    handleNext(partLabel);
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gray-50">
      {/* Left column — sticky question context */}
      <div className="w-full md:w-2/5 md:shrink-0 md:sticky md:top-0 md:h-screen md:overflow-y-auto bg-gray-100 border-b border-gray-200 md:border-b-0 md:border-r md:border-gray-200 p-6">
        <div className="space-y-3">
          <div>
            <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest">{question.id}</p>
            <h2 className="text-base font-bold text-gray-900 leading-snug mt-0.5">{question.topic}</h2>
          </div>
          <QuestionContext question={question} />
        </div>
      </div>

      {/* Right column — scrollable parts */}
      <div className="flex-1 min-w-0 p-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Read-only progress indicator */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Question {questionIndex} of {totalQuestions}
          </p>

          {/* Parts */}
          <div className="space-y-3">
            {question.parts.map((part) => (
              <PartPlayer
                key={part.label}
                part={part}
                partState={session.parts[part.label] ?? { status: "locked", attempts: [] }}
                isLoading={loading === part.label}
                input={inputs[part.label] ?? ""}
                onInputChange={(v) => setInputs((prev) => ({ ...prev, [part.label]: v }))}
                onSubmit={() => handleSubmit(part.label)}
                onNext={() => handleNext(part.label)}
                onShowModelAnswer={() => handleShowModelAnswer(part.label)}
                onContinue={() => handleContinue(part.label)}
              />
            ))}
          </div>

          {/* Next question button — appears when all parts are done */}
          {allDone && (
            <div className="flex justify-end pt-2">
              <button
                onClick={onNextQuestion}
                className="px-5 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition"
              >
                Next Question →
              </button>
            </div>
          )}

          {/* Reset */}
          <div className="text-center pb-8 pt-6">
            <button
              onClick={() => {
                const toRemove: string[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                  const k = localStorage.key(i);
                  if (k && k.startsWith("biobridge_")) toRemove.push(k);
                }
                toRemove.forEach((k) => localStorage.removeItem(k));
                window.location.reload();
              }}
              className="text-xs text-gray-300 hover:text-gray-500 transition"
            >
              Reset setup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Student mode ─────────────────────────────────────────────────────────────

const QUESTION_SEQUENCE = ["M1Q14", "M1Q15", "M2Q14", "M2Q15"] as const;

function StudentMode() {
  const [currentIndex, setCurrentIndex] = useState(() => {
    try {
      const stored = localStorage.getItem("biobridge_current_question");
      if (stored !== null) {
        const idx = parseInt(stored, 10);
        if (!isNaN(idx) && idx >= 0) return idx;
      }
    } catch { /* ignore */ }
    return 0;
  });

  const methodAssignment = (() => {
    try {
      return JSON.parse(localStorage.getItem("biobridge_method_assignment") ?? "{}") as Record<string, Method>;
    } catch { return {} as Record<string, Method>; }
  })();

  function handleNextQuestion() {
    const nextIndex = currentIndex + 1;
    setCurrentIndex(nextIndex);
    localStorage.setItem("biobridge_current_question", String(nextIndex));
  }

  if (currentIndex >= QUESTION_SEQUENCE.length) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <p className="text-lg font-semibold text-gray-800 text-center">
          You&apos;ve completed all questions. Thank you!
        </p>
      </div>
    );
  }

  const questionId = QUESTION_SEQUENCE[currentIndex]!;
  const question = QUESTIONS.find((q) => q.id === questionId)!;
  const method: Method = (methodAssignment[questionId] ?? 1) as Method;

  return (
    <QuestionPlayer
      key={question.id}
      question={question}
      method={method}
      questionIndex={currentIndex + 1}
      totalQuestions={QUESTION_SEQUENCE.length}
      onNextQuestion={handleNextQuestion}
    />
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);

  useEffect(() => {
    setSetupComplete(localStorage.getItem("biobridge_setup_complete") === "true");
  }, []);

  if (setupComplete === null) return null;

  return setupComplete
    ? <StudentMode />
    : <SetupMode onComplete={() => setSetupComplete(true)} />;
}
