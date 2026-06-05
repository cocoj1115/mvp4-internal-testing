import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { QUESTION_MAP, PartLabel } from "@/app/lib/questions";
import { judgeFeedback } from "@/lib/compare/judge";
import { runComparisonMethod } from "@/lib/compare/method-runners";
import { normalizeJudgeConfig, normalizeModelConfig } from "@/lib/compare/models";
import { aggregateRows } from "@/lib/compare/results";
import {
  CompareInput,
  CompareMethod,
  CompareRequest,
  M1Q14TestCase,
  RawComparisonRow,
} from "@/lib/compare/types";

export const maxDuration = 300;

const VALID_METHODS = new Set<CompareMethod>(["1", "2", "3"]);
const VALID_PARTS = new Set<PartLabel>(["A", "B", "C"]);

function jsonLine(value: unknown) {
  return `${JSON.stringify(value)}\n`;
}

async function loadTestCases(): Promise<M1Q14TestCase[]> {
  const filePath = path.join(process.cwd(), "data", "eval", "test-cases-M1Q14.json");
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? (parsed as M1Q14TestCase[]) : [];
}

export async function GET() {
  try {
    return NextResponse.json({ testCases: await loadTestCases() });
  } catch (err) {
    console.error("[/api/compare-feedback] Failed to load test cases:", err);
    return NextResponse.json({ testCases: [] });
  }
}

function normalizeInput(value: unknown): CompareInput | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.questionId !== "M1Q14") return null;
  if (!VALID_PARTS.has(record.part as PartLabel)) return null;
  if (typeof record.testCaseId !== "string" || record.testCaseId.trim() === "") return null;
  if (typeof record.studentResponse !== "string" || record.studentResponse.trim() === "") return null;
  if (typeof record.officialScore !== "number" || !Number.isFinite(record.officialScore)) return null;
  const part = QUESTION_MAP.M1Q14.parts.find((candidate) => candidate.label === record.part);
  if (!part) return null;
  if (record.officialScore < 0 || record.officialScore > part.maxScore) return null;

  return {
    questionId: "M1Q14",
    part: record.part as PartLabel,
    testCaseId: record.testCaseId,
    studentResponse: record.studentResponse.trim(),
    officialScore: record.officialScore,
  };
}

function normalizeRequest(body: unknown): CompareRequest {
  if (!body || typeof body !== "object") throw new Error("Invalid request body.");
  const record = body as Record<string, unknown>;
  if (record.questionId !== "M1Q14") throw new Error("Only M1Q14 is supported.");

  const inputs = Array.isArray(record.inputs)
    ? record.inputs.map(normalizeInput).filter((input): input is CompareInput => Boolean(input))
    : [];
  if (inputs.length === 0) throw new Error("At least one valid input is required.");

  const methods = Array.isArray(record.methods)
    ? record.methods.filter((method): method is CompareMethod => VALID_METHODS.has(method as CompareMethod))
    : [];
  if (methods.length === 0) throw new Error("At least one method is required.");

  const candidates = Array.isArray(record.candidates)
    ? record.candidates.map(normalizeModelConfig).filter((config): config is NonNullable<typeof config> => Boolean(config))
    : [];
  if (candidates.length === 0) throw new Error("At least one model-temperature candidate is required.");

  const repeats =
    typeof record.repeats === "number" && Number.isFinite(record.repeats)
      ? Math.max(1, Math.min(10, Math.round(record.repeats)))
      : 5;
  const judge = normalizeJudgeConfig(record.judge);
  if (!judge) throw new Error("A valid judge model is required.");

  return {
    questionId: "M1Q14",
    inputs,
    methods,
    candidates,
    repeats,
    judge,
  };
}

function emptyJudgeFields() {
  return {
    judge_run: false,
    judge_track: "" as const,
    confirmation_clarity: "" as const,
    scope_control: "" as const,
    task_focus: "" as const,
    specificity: "" as const,
    manageability: "" as const,
    answer_leakage: "" as const,
    overall_quality: "" as const,
    judge_rationale: "",
    judge_latency_ms: "" as const,
  };
}

function failedRow(args: {
  runId: string;
  input: CompareInput;
  method: CompareMethod;
  candidate: CompareRequest["candidates"][number];
  repeatIndex: number;
  error: unknown;
}): RawComparisonRow {
  return {
    run_id: args.runId,
    timestamp: new Date().toISOString(),
    question_id: "M1Q14",
    part: args.input.part,
    test_case_id: args.input.testCaseId,
    student_response: args.input.studentResponse,
    official_score: args.input.officialScore,
    model: args.candidate.modelId,
    provider: args.candidate.provider,
    temperature: args.candidate.temperature,
    method: Number(args.method),
    repeat_index: args.repeatIndex,
    ai_score: "",
    score_match: "",
    feedback: "",
    grading_latency_ms: "",
    grading_token_count: "",
    ...emptyJudgeFields(),
    status: "failed",
    error: args.error instanceof Error ? args.error.message : String(args.error),
  };
}

export async function POST(req: NextRequest) {
  let compareRequest: CompareRequest;
  try {
    compareRequest = normalizeRequest(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid request." },
      { status: 400 }
    );
  }

  const question = QUESTION_MAP.M1Q14;
  const encoder = new TextEncoder();
  const runId = crypto.randomUUID();

  const abortSignal = req.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const rows: RawComparisonRow[] = [];
      const total =
        compareRequest.inputs.length *
        compareRequest.methods.length *
        compareRequest.candidates.length *
        compareRequest.repeats;
      let completed = 0;
      let stopped = false;

      controller.enqueue(encoder.encode(jsonLine({ type: "start", runId, total })));

      // Flatten all tasks upfront so we can process them with concurrency
      interface TaskSpec {
        input: CompareInput;
        method: CompareMethod;
        candidate: CompareRequest["candidates"][number];
        repeatIndex: number;
        part: ReturnType<typeof question.parts.find>;
      }
      const tasks: TaskSpec[] = [];
      for (const input of compareRequest.inputs) {
        const part = question.parts.find((p) => p.label === input.part);
        if (!part) continue;
        for (const method of compareRequest.methods) {
          for (const candidate of compareRequest.candidates) {
            for (let r = 1; r <= compareRequest.repeats; r++) {
              tasks.push({ input, method, candidate, repeatIndex: r, part });
            }
          }
        }
      }

      async function runTask(spec: TaskSpec) {
        if (stopped || abortSignal.aborted) { stopped = true; return; }
        const { input, method, candidate, repeatIndex, part } = spec;
        const context = {
          testCaseId: input.testCaseId,
          part: input.part,
          method: Number(method),
          provider: candidate.provider,
          model: candidate.modelId,
          temperature: candidate.temperature,
          repeatIndex,
          repeats: compareRequest.repeats,
        };

        let row: RawComparisonRow;
        try {
          controller.enqueue(
            encoder.encode(jsonLine({
              type: "status", stage: "generating",
              message: `Generating feedback for ${input.testCaseId}, Part ${input.part}, Method ${method}, ${candidate.modelId} temp ${candidate.temperature}, repeat ${repeatIndex}/${compareRequest.repeats}.`,
              context,
            }))
          );

          const result = await runComparisonMethod({
            questionId: "M1Q14",
            part: input.part,
            studentResponse: input.studentResponse,
            method,
            candidate,
          });

          const base = {
            run_id: runId,
            timestamp: new Date().toISOString(),
            question_id: "M1Q14" as const,
            part: input.part,
            test_case_id: input.testCaseId,
            student_response: input.studentResponse,
            official_score: input.officialScore,
            model: candidate.modelId,
            provider: candidate.provider,
            temperature: candidate.temperature,
            method: Number(method),
            repeat_index: repeatIndex,
            ai_score: result.aiScore,
            score_match: result.aiScore === input.officialScore,
            feedback: result.feedback,
            grading_latency_ms: result.latencyMs,
            grading_token_count: result.totalTokens,
          };

          try {
            controller.enqueue(
              encoder.encode(jsonLine({
                type: "status", stage: "judging",
                message: `Judging feedback for ${input.testCaseId}, Part ${input.part}, Method ${method}, ${candidate.modelId} temp ${candidate.temperature}, repeat ${repeatIndex}/${compareRequest.repeats}.`,
                context,
              }))
            );

            const judge = await judgeFeedback({
              questionId: "M1Q14",
              part: input.part,
              taskType: part!.taskType,
              studentResponse: input.studentResponse,
              feedback: result.feedback,
              aiScore: result.aiScore,
              maxScore: part!.maxScore,
              judge: compareRequest.judge,
            });
            row = {
              ...base,
              judge_run: true,
              judge_track: judge.track,
              confirmation_clarity: judge.confirmation_clarity ?? "",
              scope_control: judge.scope_control ?? "",
              task_focus: judge.task_focus ?? "",
              specificity: judge.specificity ?? "",
              manageability: judge.manageability ?? "",
              answer_leakage: judge.answer_leakage ?? "",
              overall_quality: judge.overall_quality ?? "",
              judge_rationale: judge.rationale,
              judge_latency_ms: judge.latencyMs,
              status: "success",
              error: "",
            };
          } catch (judgeErr) {
            console.error("[/api/compare-feedback] judge failed:", judgeErr);
            row = {
              ...base,
              ...emptyJudgeFields(),
              status: "success",
              error: judgeErr instanceof Error ? `Judge failed: ${judgeErr.message}` : "Judge failed.",
            };
          }
        } catch (err) {
          console.error("[/api/compare-feedback] generation failed:", err);
          row = failedRow({ runId, input, method, candidate, repeatIndex, error: err });
        }

        rows.push(row);
        completed += 1;
        controller.enqueue(encoder.encode(jsonLine({ type: "result", row })));
        controller.enqueue(encoder.encode(jsonLine({ type: "progress", completed, total })));
      }

      // Run with concurrency limit of 3 to stay within rate limits and timeouts
      const CONCURRENCY = 3;
      for (let i = 0; i < tasks.length && !stopped; i += CONCURRENCY) {
        if (abortSignal.aborted) { stopped = true; break; }
        await Promise.all(tasks.slice(i, i + CONCURRENCY).map(runTask));
      }

      controller.enqueue(encoder.encode(jsonLine({ type: "aggregate", rows: aggregateRows(rows) })));
      controller.enqueue(encoder.encode(jsonLine({ type: stopped ? "stopped" : "done", runId, total })));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
