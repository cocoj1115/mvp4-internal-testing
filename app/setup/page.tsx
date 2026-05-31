"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  QUESTIONS,
  PartLabel,
} from "@/app/lib/questions";
import {
  DeviceTestingSetup,
  GStarConfig,
  Method,
  TESTING_SETUP_STORAGE_KEY,
  parseDeviceTestingSetup,
} from "@/app/lib/testingSetup";

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

interface AssignmentDraft {
  method: Method | null;
  gStar?: GStarConfig;
}

function buildInitialDrafts(): Record<string, AssignmentDraft> {
  return Object.fromEntries(
    QUESTIONS.map((q) => [q.id, { method: null } satisfies AssignmentDraft])
  );
}

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

  if (buf.trim()) {
    if (buf.startsWith("DATA:")) dataPayload = buf.slice(5);
    else onLine(buf);
  }

  return dataPayload;
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
        <h2 className="font-semibold text-gray-800 text-sm tracking-wide uppercase">
          {title}
        </h2>
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

function WizardProgress({ step }: { step: WizardStep }) {
  const steps: { n: WizardStep; label: string }[] = [
    { n: 1, label: "Upload Materials" },
    { n: 2, label: "Review G0" },
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
              <span
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold border-2 transition-colors ${
                  done
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : active
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-gray-300 bg-white text-gray-400"
                }`}
              >
                {done ? "✓" : s.n}
              </span>
              <span
                className={`text-xs font-medium whitespace-nowrap ${
                  active ? "text-indigo-700" : done ? "text-emerald-600" : "text-gray-400"
                }`}
              >
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
      <span className="text-sm font-medium text-emerald-700">{label}</span>
      <button
        onClick={onNext}
        className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition"
      >
        Next →
      </button>
    </div>
  );
}

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
      const fd = new FormData();
      fd.append("file", file);
      const dataJson = await streamLines(
        "/api/parse",
        { method: "POST", body: fd },
        (line) => setLines((prev) => [...prev, line])
      );
      const parsed = JSON.parse(dataJson) as ParseResult;

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
            `Vector index ready - ${kd1} standards, ${kd2} rubrics, ${ke} examples indexed.`,
          ]);
        } else {
          setLines((prev) => [
            ...prev,
            "Vector index build failed - grading will use G* only.",
          ]);
        }
      } catch {
        setLines((prev) => [
          ...prev,
          "Vector index unavailable - grading will use G* only.",
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
          Upload Keystone scoring materials
        </p>
        <p className="text-xs text-gray-500 mb-3">
          KD1 + KD2 + KE can be combined in one PDF file.
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
            <p className="text-sm text-gray-600">
              {file ? (
                <span className="font-medium text-indigo-700">{file.name}</span>
              ) : (
                <>
                  Drop PDF here or <span className="text-indigo-600 font-medium">browse</span>
                </>
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
          Confirm and Run Training →
        </button>
      </div>
    </div>
  );
}

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
            body: JSON.stringify({ g0 }),
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
  }, [g0]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">Running GradeOpt training loop...</p>
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
          Save Method 1 Setup
        </button>
      </div>
    </div>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const [stationLabel, setStationLabel] = useState("");
  const [drafts, setDrafts] = useState<Record<string, AssignmentDraft>>(buildInitialDrafts);
  const [editingQuestionId, setEditingQuestionId] = useState<string>(QUESTIONS[0]?.id ?? "");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [g0Config, setG0Config] = useState<G0Config>({});
  const [gStarDraft, setGStarDraft] = useState<GStarConfig>({});

  const editingQuestion = QUESTIONS.find((q) => q.id === editingQuestionId) ?? null;
  const editingDraft = editingQuestion ? drafts[editingQuestion.id] : null;
  const partLabels = (editingQuestion?.parts.map((p) => p.label) ?? []) as PartLabel[];

  useEffect(() => {
    const raw = localStorage.getItem(TESTING_SETUP_STORAGE_KEY);
    if (!raw) return;

    try {
      const parsed = parseDeviceTestingSetup(JSON.parse(raw));
      if (!parsed) return;

      if (parsed.stationLabel) {
        setStationLabel(parsed.stationLabel);
      }

      setDrafts((prev) => {
        const next = { ...prev };
        for (const assignment of parsed.assignments) {
          if (!(assignment.questionId in next)) continue;
          next[assignment.questionId] = {
            method: assignment.method,
            gStar: assignment.gStar,
          };
        }
        return next;
      });
    } catch {
      // Ignore malformed stored data
    }
  }, []);

  function resetWizard() {
    setWizardStep(1);
    setG0Config({});
    setGStarDraft({});
  }

  function setMethod(method: Method) {
    if (!editingQuestion) return;
    setDrafts((prev) => {
      const current = prev[editingQuestion.id];
      return {
        ...prev,
        [editingQuestion.id]: {
          method,
          gStar: method === 1 ? current.gStar : undefined,
        },
      };
    });
    setSaveMessage(null);
    resetWizard();
  }

  function handleParseDone(result: ParseResult) {
    const filtered: G0Config = {};
    for (const label of partLabels) {
      filtered[label] = result.g0[label] ?? result.g0.A;
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
    if (!editingQuestion) return;
    setDrafts((prev) => ({
      ...prev,
      [editingQuestion.id]: {
        method: 1,
        gStar: approved,
      },
    }));
    setSaveMessage(null);
  }

  const missingMethods = QUESTIONS.filter((q) => drafts[q.id].method == null);
  const missingMethod1Setup = QUESTIONS.filter(
    (q) => drafts[q.id].method === 1 && !drafts[q.id].gStar
  );
  const canSave = missingMethods.length === 0 && missingMethod1Setup.length === 0;

  function saveSetup() {
    if (!canSave) return;

    const assignments: DeviceTestingSetup["assignments"] = QUESTIONS.map((q) => {
      const d = drafts[q.id];
      return {
        questionId: q.id,
        method: d.method as Method,
        gStar: d.gStar,
      };
    });

    const payload: DeviceTestingSetup = {
      version: 1,
      createdAt: new Date().toISOString(),
      stationLabel: stationLabel.trim() || undefined,
      assignments,
    };

    localStorage.setItem(TESTING_SETUP_STORAGE_KEY, JSON.stringify(payload));
    setSaveMessage("Setup saved for this computer. Students can start from the testing page now.");
  }

  function clearSetup() {
    localStorage.removeItem(TESTING_SETUP_STORAGE_KEY);
    setDrafts(buildInitialDrafts());
    setStationLabel("");
    setSaveMessage("Saved setup cleared for this computer.");
    resetWizard();
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Testing Setup</h1>
            <p className="text-sm text-gray-500 mt-1">
              Configure this computer before students begin. Question sequence is fixed; methods can differ per question.
            </p>
          </div>
        </div>

        <SectionCard title="Station">
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              Station label (optional)
            </label>
            <input
              value={stationLabel}
              onChange={(e) => setStationLabel(e.target.value)}
              placeholder="e.g., Computer A / Group 1"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </SectionCard>

        <SectionCard title="Question Methods and Sequence Summary">
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Select one question below, assign its method, and complete setup if Method 1 is used.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Editing question</label>
              <select
                value={editingQuestionId}
                onChange={(e) => {
                  setEditingQuestionId(e.target.value);
                  resetWizard();
                }}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {QUESTIONS.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.dropdownLabel}
                  </option>
                ))}
              </select>
            </div>

            {editingQuestion && editingDraft && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-widest text-gray-500">Current method</p>
                  <p className="text-sm font-semibold text-gray-800 mt-0.5">
                    {editingDraft.method ? `Method ${editingDraft.method}` : "Not selected"}
                  </p>
                </div>

                <div className="flex gap-3 flex-wrap">
                  {([1, 2, 3] as Method[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMethod(m)}
                      className={`inline-flex items-center px-4 py-2.5 rounded-lg text-sm border transition ${
                        editingDraft.method === m
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:text-indigo-600"
                      }`}
                    >
                      Method {m}
                    </button>
                  ))}
                </div>

                {editingDraft.method === 1 && !editingDraft.gStar && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    Method 1 requires setup before this question is ready.
                  </div>
                )}

                {editingDraft.method === 1 && editingDraft.gStar && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    Method 1 setup complete for this question.
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-gray-200 pt-4 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Sequence Summary
              </h3>

              {QUESTIONS.map((q, index) => {
                const draft = drafts[q.id];
                const setupReady = draft.method !== 1 || !!draft.gStar;
                return (
                  <div
                    key={q.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white px-4 py-3"
                  >
                    <div>
                      <p className="text-xs text-gray-400">Question {index + 1}</p>
                      <p className="text-sm font-medium text-gray-800">{q.dropdownLabel}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-700">
                        {draft.method ? `Method ${draft.method}` : "Method not assigned"}
                      </p>
                      {draft.method === 1 && (
                        <p className={`text-xs ${setupReady ? "text-emerald-600" : "text-amber-600"}`}>
                          {setupReady ? "Setup ready" : "Setup required"}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}

              {missingMethods.length > 0 && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  Assign a method for every question before saving.
                </p>
              )}

              {missingMethod1Setup.length > 0 && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  Complete Method 1 setup for all questions using Method 1 before saving.
                </p>
              )}

              {saveMessage && (
                <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                  {saveMessage}
                </p>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => router.push("/testing")}
                  disabled={!canSave}
                  className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Go to Testing Page
                </button>
                <button
                  onClick={clearSetup}
                  className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:border-gray-400"
                >
                  Clear Saved Setup
                </button>
                <button
                  onClick={saveSetup}
                  disabled={!canSave}
                  className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save Setup to This Computer
                </button>
              </div>
            </div>
          </div>
        </SectionCard>

        {editingDraft?.method === 1 && !editingDraft.gStar && editingQuestion && (
          <SectionCard title={`Method 1 Setup - ${editingQuestion.id}`}>
            <WizardProgress step={wizardStep} />

            {wizardStep === 1 && <Step1Upload onComplete={handleParseDone} />}
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

      </div>
    </div>
  );
}
