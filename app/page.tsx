"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  QUESTIONS,
  Question,
  QuestionPart,
  QuestionTable,
} from "@/app/lib/questions";
import type { GradeResponse } from "@/app/api/grade/route";
import {
  DEFAULT_GRADING_MODEL_IDS,
  STUDENT_GRADING_MODEL_OPTIONS,
  defaultGradingModelForMethod,
  findGradingModelConfig,
  type GradingModelConfig,
  type StudentMethod,
} from "@/lib/grading-models";

// ─── Types ────────────────────────────────────────────────────────────────────

type Method = 1 | 2 | 3;
type ModelAssignment = Record<string, string>;
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

// ─── Setup: Method Assignment ────────────────────────────────────────────────

function methodKey(method: Method): StudentMethod {
  return String(method) as StudentMethod;
}

function modelOptionLabel(model: GradingModelConfig): string {
  return model.label;
}

// ─── Setup mode ───────────────────────────────────────────────────────────────

const METHOD_LABELS: Record<Method, string> = {
  1: "Method 1 — GradeOpt + RAG",
  2: "Method 2 — Two-Stage Error-Aware",
  3: "Method 3 — Feedback-First",
};

const STUDENT_METHOD_PRESETS: Array<{
  id: string;
  label: string;
  methods: Record<string, Method>;
}> = [
  { id: "student-1", label: "Student 1", methods: { M1Q14: 1, M1Q15: 2, M2Q14: 3, M2Q15: 1 } },
  { id: "student-2", label: "Student 2", methods: { M1Q14: 2, M1Q15: 3, M2Q14: 1, M2Q15: 2 } },
  { id: "student-3", label: "Student 3", methods: { M1Q14: 3, M1Q15: 1, M2Q14: 2, M2Q15: 3 } },
  { id: "student-4", label: "Student 4", methods: { M1Q14: 1, M1Q15: 2, M2Q14: 3, M2Q15: 1 } },
];

function SetupMode({ onComplete }: { onComplete: () => void }) {
  const defaultMethods = Object.fromEntries(QUESTIONS.map((q) => [q.id, 1 as Method]));
  const defaultModelAssignment = Object.fromEntries(
    QUESTIONS.map((q) => [q.id, DEFAULT_GRADING_MODEL_IDS["1"]])
  );
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  const [methods, setMethods] = useState<Record<string, Method>>(() => {
    try {
      const stored = localStorage.getItem("biobridge_method_assignment");
      if (stored) return JSON.parse(stored) as Record<string, Method>;
    } catch { /* ignore */ }
    return defaultMethods;
  });

  const [modelAssignment, setModelAssignment] = useState<ModelAssignment>(() => {
    try {
      const stored = localStorage.getItem("biobridge_model_assignment");
      if (stored) return JSON.parse(stored) as ModelAssignment;
    } catch { /* ignore */ }
    return defaultModelAssignment;
  });

  function handleMethodChange(questionId: string, method: Method) {
    setSelectedPreset(null);
    setMethods((prev) => ({ ...prev, [questionId]: method }));
    setModelAssignment((prev) => ({
      ...prev,
      [questionId]: DEFAULT_GRADING_MODEL_IDS[methodKey(method)],
    }));
  }

  function modelAssignmentForMethods(assignment: Record<string, Method>): ModelAssignment {
    return Object.fromEntries(
      QUESTIONS.map((q) => [
        q.id,
        DEFAULT_GRADING_MODEL_IDS[methodKey(assignment[q.id] ?? 1)],
      ])
    );
  }

  function handlePresetSelect(preset: (typeof STUDENT_METHOD_PRESETS)[number]) {
    const nextMethods = { ...defaultMethods, ...preset.methods };
    setSelectedPreset(preset.id);
    setMethods(nextMethods);
    setModelAssignment(modelAssignmentForMethods(nextMethods));
  }

  function handleSave() {
    localStorage.setItem("biobridge_method_assignment", JSON.stringify(methods));
    localStorage.setItem("biobridge_model_assignment", JSON.stringify(modelAssignment));
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
    localStorage.removeItem("biobridge_grading_configs");
    window.location.reload();
  }

  const selectClass = "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center py-12 px-4">
      <div className="w-full max-w-[44rem] space-y-5">

        {/* Header */}
        <div className="text-center space-y-1">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
            <span className="text-xs font-semibold text-indigo-600 uppercase tracking-widest">Internal Testing</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">BioBridge Setup</h1>
          <p className="text-sm text-gray-400">Assign a method and model to each question. Students will not see this.</p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Student</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STUDENT_METHOD_PRESETS.map((preset) => {
              const active = selectedPreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handlePresetSelect(preset)}
                  className={`h-10 rounded-lg border px-3 text-sm font-medium transition ${
                    active
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-gray-200 bg-white text-gray-700 hover:border-indigo-200 hover:bg-indigo-50"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Question cards */}
        <div className="space-y-3">
          {QUESTIONS.map((q) => (
            <div key={q.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
              {/* Question info */}
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-base font-bold text-gray-900">{q.id}</span>
                  <span className="ml-2 text-xs text-indigo-500 font-mono bg-indigo-50 px-1.5 py-0.5 rounded">{q.standard}</span>
                  <p className="text-xs text-gray-400 mt-0.5">{q.topic}</p>
                </div>
              </div>

              {/* Selectors */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(260px,1fr)_minmax(340px,1.2fr)]">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Method</label>
                  <select
                    value={methods[q.id] ?? 1}
                    onChange={(e) => handleMethodChange(q.id, parseInt(e.target.value) as Method)}
                    className={selectClass}
                  >
                    {([1, 2, 3] as Method[]).map((m) => (
                      <option key={m} value={m}>{METHOD_LABELS[m]}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Model &amp; Temp</label>
                  <select
                    value={modelAssignment[q.id] ?? DEFAULT_GRADING_MODEL_IDS[methodKey(methods[q.id] ?? 1)]}
                    onChange={(e) => {
                      setSelectedPreset(null);
                      setModelAssignment((prev) => ({ ...prev, [q.id]: e.target.value }));
                    }}
                    className={selectClass}
                  >
                    {STUDENT_GRADING_MODEL_OPTIONS[methodKey(methods[q.id] ?? 1)].map((model, index) => (
                      <option key={model.id} value={model.id}>
                        {index === 0 ? "Default: " : index === 1 ? "Backup: " : ""}
                        {modelOptionLabel(model)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          className="w-full py-3 rounded-2xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 active:scale-[0.98] transition shadow-sm"
        >
          Save &amp; Start →
        </button>

        {/* Reset */}
        <div className="text-center">
          <button onClick={handleReset} className="text-xs text-gray-300 hover:text-gray-500 transition">
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
  const [modelAnswerOpen, setModelAnswerOpen] = useState(false);
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
        {lastAttempt.feedback && (
          <p className={`mt-2 text-xs leading-relaxed ${
            lastAttempt.score >= part.maxScore ? "text-emerald-600" : "text-rose-600"
          }`}>{lastAttempt.feedback}</p>
        )}
        {attempts.length >= 2 && (
          <div className="mt-2">
            <button
              onClick={() => setModelAnswerOpen((v) => !v)}
              className="text-xs text-gray-400 hover:text-gray-500 transition"
            >
              {modelAnswerOpen ? "Hide model answer" : "See model answer"}
            </button>
            {modelAnswerOpen && (
              <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">{part.modelAnswer}</p>
            )}
          </div>
        )}
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
        <p className="text-xs font-semibold text-gray-700">Score: {attempt1.score} / {part.maxScore}</p>
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
        <p className="text-xs font-semibold text-gray-700">Score: {attempt1.score} / {part.maxScore}</p>
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
        <p className="text-xs font-semibold text-gray-700">Score: {attempt2.score} / {part.maxScore}</p>
        <div className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${
          attempt2Passed
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-rose-200 bg-rose-50 text-rose-800"
        }`}>
          {attempt2.feedback}
        </div>

        <div>
          <button
            onClick={() => setModelAnswerOpen((v) => !v)}
            className="text-xs text-gray-400 hover:text-gray-500 transition"
          >
            {modelAnswerOpen ? "Hide model answer" : "See model answer"}
          </button>
          {modelAnswerOpen && (
            <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">{part.modelAnswer}</p>
          )}
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
  modelConfig,
  questionIndex,
  totalQuestions,
  onNextQuestion,
}: {
  question: Question;
  method: Method;
  modelConfig: GradingModelConfig;
  questionIndex: number;
  totalQuestions: number;
  onNextQuestion: () => void;
}) {
  const [session, setSession] = useState<SessionState>(() => {
    try {
      const stored = localStorage.getItem(`biobridge_session_${question.id}`);
      if (stored) {
        const parsed = JSON.parse(stored) as SessionState;
        parsed.method = method;
        return parsed;
      }
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

      const priorGaps: Record<string, string> = {};
      question.parts.forEach((p) => {
        if (p.label === partLabel) return;
        const partAttempts = session.parts[p.label]?.attempts ?? [];
        const lastAttempt = partAttempts.at(-1);
        if (lastAttempt && lastAttempt.diagnosedGap && lastAttempt.diagnosedGap !== "none") {
          priorGaps[p.label] = lastAttempt.diagnosedGap;
        }
      });

      const body: Record<string, unknown> = {
        questionId: question.id,
        partLabel,
        studentResponse: response,
        method: session.method.toString(),
        modelConfig,
        attemptNumber,
      };
      if (attemptNumber === 2 && attempt1) {
        body.attempt1Feedback = attempt1.feedback;
        body.attempt1Gap = attempt1.diagnosedGap;
      }
      body.priorGaps = Object.keys(priorGaps).length > 0 ? priorGaps : undefined;
      const currentPart = question.parts.find((p) => p.label === partLabel);
      body.taskType = currentPart?.taskType;

      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as GradeResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);

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

  const modelAssignment = (() => {
    try {
      return JSON.parse(localStorage.getItem("biobridge_model_assignment") ?? "{}") as ModelAssignment;
    } catch { return {} as ModelAssignment; }
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
  const modelConfig =
    findGradingModelConfig(modelAssignment[questionId] ?? "") ??
    defaultGradingModelForMethod(methodKey(method));

  return (
    <QuestionPlayer
      key={question.id}
      question={question}
      method={method}
      modelConfig={modelConfig}
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
