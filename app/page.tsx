"use client";

import { useState, useRef, useEffect } from "react";
import { QUESTIONS, Question, QuestionPart, QuestionTable, PartLabel } from "@/app/lib/questions";
import type { GradeResponse } from "@/app/api/grade/route";

// ─── Types ──────────────────────────────────────────────────────────────────

type Method = 1 | 2 | 3;

interface PartResult extends GradeResponse {
  timeSeconds: number;
  answer: string;
  maxScore: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function elapsed(startMs: number) {
  return Math.round((Date.now() - startMs) / 1000);
}

// ─── Layout primitives ──────────────────────────────────────────────────────

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

// ─── Score chip ──────────────────────────────────────────────────────────────

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
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      ) : isZero ? (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        // Partial credit — dash icon
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
            clipRule="evenodd"
          />
        </svg>
      )}
      {score} / {maxScore}
    </span>
  );
}

// ─── Static image with graceful fallback ─────────────────────────────────────

function QuestionImage({ src }: { src: string }) {
  const [missing, setMissing] = useState(false);

  if (missing) {
    return (
      <div className="flex items-center gap-3 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-5 py-5">
        <svg
          className="w-8 h-8 text-gray-300 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 20.25h18M12 3v9m0 0l-3-3m3 3l3-3"
          />
        </svg>
        <div>
          <p className="text-sm font-medium text-gray-500">Question diagram</p>
          <p className="mt-0.5 font-mono text-xs text-gray-400">{src}</p>
          <p className="mt-0.5 text-xs text-gray-400">
            Place the image in <code className="bg-gray-100 px-1 rounded">public{src}</code> to display it here.
          </p>
        </div>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Question diagram"
      onError={() => setMissing(true)}
      className="w-full rounded-lg border border-gray-200 object-contain"
    />
  );
}

// ─── Data table (M2Q15) ──────────────────────────────────────────────────────

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
              <th
                key={col}
                className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-600"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map(([system, description], idx) => (
            <tr
              key={idx}
              className={`border-b border-gray-100 last:border-0 ${
                idx % 2 === 1 ? "bg-gray-50/60" : "bg-white"
              }`}
            >
              <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap align-top">
                {system}
              </td>
              <td className="px-4 py-3 text-gray-600 align-top leading-relaxed">
                {description}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Question context block (stem + image/table) ─────────────────────────────

function QuestionContext({ question }: { question: Question }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-slate-50 p-4 space-y-3">
      {/* Metadata chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-widest">
          {question.id}
        </span>
        <span className="text-[11px] text-gray-300">·</span>
        <span className="text-[11px] font-mono text-gray-500">
          Standard {question.standard}
        </span>
        <span className="text-[11px] text-gray-300">·</span>
        <span className="text-[11px] text-gray-500">{question.topic}</span>
        <span className="text-[11px] text-gray-300">·</span>
        <span className="text-[11px] text-gray-500">
          {question.parts.reduce((s, p) => s + p.maxScore, 0)} pts
        </span>
      </div>

      {/* Stem */}
      <p className="text-sm text-gray-700 leading-relaxed">{question.stem}</p>

      {/* Image (M1Q14, M1Q15) */}
      {question.imageUrl && <QuestionImage src={question.imageUrl} />}

      {/* Table (M2Q15) */}
      {question.table && <QuestionTableBlock table={question.table} />}
    </div>
  );
}

// ─── Part panel ──────────────────────────────────────────────────────────────

interface PartPanelProps {
  part: QuestionPart;
  onSubmit: (answer: string) => Promise<void>;
  isLoading: boolean;
  completedResult?: PartResult;
}

function PartPanel({ part, onSubmit, isLoading, completedResult }: PartPanelProps) {
  const [answer, setAnswer] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!completedResult) textareaRef.current?.focus();
  }, [completedResult]);

  // Locked / read-only after submission
  if (completedResult) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            Part {part.label}
            {part.maxScore > 1 && (
              <span className="ml-1.5 font-normal text-gray-400">
                ({part.maxScore} pts)
              </span>
            )}
          </span>
          <ScorePip score={completedResult.score} maxScore={completedResult.maxScore} />
        </div>
        <p className="text-sm text-gray-500 italic">{part.prompt}</p>
        <p className="text-sm text-gray-700 bg-white border border-gray-200 rounded p-3 whitespace-pre-wrap">
          {completedResult.answer}
        </p>
      </div>
    );
  }

  // Active input
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
          {answer.trim().length === 0
            ? "Response required"
            : `${answer.trim().length} chars`}
        </span>
        <button
          onClick={() => onSubmit(answer)}
          disabled={isLoading || answer.trim().length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
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

// ─── Results panel ───────────────────────────────────────────────────────────

function ResultsPanel({
  question,
  results,
}: {
  question: Question;
  results: Record<string, PartResult>;
}) {
  const totalEarned = question.parts.reduce(
    (sum, p) => sum + (results[p.label]?.score ?? 0),
    0
  );
  const totalPossible = question.parts.reduce((sum, p) => sum + p.maxScore, 0);
  const totalTime = question.parts.reduce(
    (sum, p) => sum + (results[p.label]?.timeSeconds ?? 0),
    0
  );

  const scoreColor =
    totalEarned === totalPossible
      ? "text-emerald-600"
      : totalEarned === 0
      ? "text-rose-600"
      : "text-amber-500";

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-50 border-b border-gray-200">
        <h3 className="font-semibold text-gray-800">Results</h3>
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span>
            Total:{" "}
            <span className={`font-bold ${scoreColor}`}>
              {totalEarned} / {totalPossible}
            </span>
          </span>
          <span>⏱ {totalTime}s total</span>
        </div>
      </div>

      {/* Per-part breakdown */}
      <div className="divide-y divide-gray-100">
        {question.parts.map((p) => {
          const r = results[p.label];
          if (!r) return null;

          const feedbackBg =
            r.score === r.maxScore
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : r.score === 0
              ? "bg-rose-50 text-rose-800 border-rose-200"
              : "bg-amber-50 text-amber-800 border-amber-200";

          return (
            <div key={p.label} className="px-6 py-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-gray-700">
                  Part {p.label}
                  {p.maxScore > 1 && (
                    <span className="ml-1.5 text-xs font-normal text-gray-400">
                      ({p.maxScore} pts)
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-3 text-sm text-gray-400">
                  <span>⏱ {r.timeSeconds}s</span>
                  <ScorePip score={r.score} maxScore={r.maxScore} />
                </div>
              </div>
              <p className="text-xs text-gray-400 italic line-clamp-2">{r.answer}</p>
              <div className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${feedbackBg}`}>
                {r.feedback}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function Home() {
  const [selectedId, setSelectedId] = useState<string>("");
  const [method, setMethod] = useState<Method>(1);

  // Index into question.parts of the active part.
  // When activePart >= question.parts.length → all done.
  const [activePart, setActivePart] = useState<number>(0);

  const [partStartTimes, setPartStartTimes] = useState<Record<string, number>>({});
  const [results, setResults] = useState<Record<string, PartResult>>({});
  const [loadingPart, setLoadingPart] = useState<PartLabel | null>(null);

  const question = QUESTIONS.find((q) => q.id === selectedId);
  const allDone = !!question && activePart >= question.parts.length;

  function handleQuestionChange(id: string) {
    const q = QUESTIONS.find((q) => q.id === id);
    const firstLabel = q?.parts[0]?.label ?? "A";
    setSelectedId(id);
    setActivePart(0);
    setPartStartTimes({ [firstLabel]: Date.now() });
    setResults({});
    setLoadingPart(null);
  }

  // Start timing whenever a new part becomes active
  useEffect(() => {
    if (!question || activePart >= question.parts.length) return;
    const label = question.parts[activePart].label;
    setPartStartTimes((prev) =>
      prev[label] ? prev : { ...prev, [label]: Date.now() }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePart, selectedId]);

  async function handleSubmit(partLabel: PartLabel, answer: string) {
    if (!question) return;
    const startMs = partStartTimes[partLabel] ?? Date.now();
    const partDef = question.parts.find((p) => p.label === partLabel)!;
    setLoadingPart(partLabel);

    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, partLabel, studentResponse: answer }),
      });

      const data: GradeResponse = await res.json();

      setResults((prev) => ({
        ...prev,
        [partLabel]: {
          ...data,
          timeSeconds: elapsed(startMs),
          answer,
          maxScore: partDef.maxScore,
        },
      }));

      const nextIndex =
        question.parts.findIndex((p) => p.label === partLabel) + 1;
      setActivePart(nextIndex);

      if (nextIndex < question.parts.length) {
        const nextLabel = question.parts[nextIndex].label;
        setPartStartTimes((prev) => ({ ...prev, [nextLabel]: Date.now() }));
      }
    } catch (err) {
      console.error(err);
      alert("Something went wrong while grading. Please try again.");
    } finally {
      setLoadingPart(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Page header */}
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">
            BioBridge MVP4 — Internal Testing
          </h1>
          <p className="text-sm text-gray-500">
            Keystone Biology CR Question Evaluator
          </p>
        </div>

        {/* ── Section 1: Question Selector ─────────────────────────────── */}
        <SectionCard step={1} title="Question Selector">
          <div className="space-y-4">
            <div>
              <label
                htmlFor="question-select"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
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
                  <option key={q.id} value={q.id}>
                    {q.dropdownLabel}
                  </option>
                ))}
              </select>
            </div>

            {question && <QuestionContext question={question} />}
          </div>
        </SectionCard>

        {/* ── Section 2: Feedback Method ───────────────────────────────── */}
        <SectionCard step={2} title="Feedback Method">
          <div className="flex gap-2 flex-wrap">
            {([1, 2, 3] as Method[]).map((m) => (
              <button
                key={m}
                onClick={() => m === 1 && setMethod(m)}
                className={`inline-flex items-center px-5 py-2 rounded-lg text-sm font-medium border transition ${
                  method === m
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                    : m === 1
                    ? "bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:text-indigo-600"
                    : "bg-white text-gray-400 border-gray-200 cursor-not-allowed"
                }`}
              >
                Method {m}
                {m !== 1 && <Badge label="Placeholder" />}
              </button>
            ))}
          </div>
          {method === 1 && (
            <p className="mt-3 text-xs text-gray-400">
              Method 1: GPT-4o scoring with per-part rubric guidance.
            </p>
          )}
        </SectionCard>

        {/* ── Section 3: Answer Panel ──────────────────────────────────── */}
        {question && (
          <SectionCard step={3} title="Answer Panel">
            {!allDone ? (
              <div className="space-y-4">
                {question.parts.map((part, idx) => {
                  if (idx > activePart) return null; // not yet unlocked
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
                {/* Compact summary row per part */}
                <div className="space-y-2">
                  {question.parts.map((part) => {
                    const r = results[part.label] as PartResult;
                    return (
                      <div
                        key={part.label}
                        className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 flex items-center justify-between gap-4"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="text-xs font-bold text-gray-400 uppercase mr-2">
                            Part {part.label}
                          </span>
                          <span className="text-xs text-gray-500">
                            {part.prompt.length > 80
                              ? `${part.prompt.slice(0, 80)}…`
                              : part.prompt}
                          </span>
                        </div>
                        <ScorePip score={r.score} maxScore={r.maxScore} />
                      </div>
                    );
                  })}
                </div>

                {/* Full results */}
                <ResultsPanel question={question} results={results} />

                {/* Retry */}
                <div className="text-center pt-2">
                  <button
                    onClick={() => {
                      const firstLabel = question.parts[0].label;
                      setActivePart(0);
                      setResults({});
                      setPartStartTimes({ [firstLabel]: Date.now() });
                    }}
                    className="text-sm text-indigo-600 hover:text-indigo-800 font-medium underline underline-offset-2 transition"
                  >
                    Retry this question
                  </button>
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {/* Empty state */}
        {!question && (
          <div className="text-center py-16 text-gray-400 text-sm">
            Select a question above to begin.
          </div>
        )}
      </div>
    </div>
  );
}
