/**
 * POST /api/train
 *
 * Accepts { g0: G0Config } JSON where G0Config is a record of part labels
 * (A, B, C) to { keyConcepts, rubric, examples } objects.
 *
 * Runs the real GradeOpt training loop:
 *   Phase 1 — Parse KE (scored examples) from each part's G0.examples string
 *   Phase 2 — For each part, iterate up to MAX_ITERATIONS:
 *               GraderGPT scores all examples → collect errors
 *               If no errors or no improvement → early stop
 *               ReflectorGPT analyzes errors → proposed rules
 *               RefinerGPT merges proposals into adaptation rules
 *
 * Returns a text/plain streaming response — progress lines followed by
 * a DATA:<json> terminal line carrying GStarConfig (rules per part label).
 */

import { NextRequest } from "next/server";
import OpenAI from "openai";
import {
  DEFAULT_GRADING_MODEL,
  GradingModel,
  isGradingModel,
} from "@/lib/grading-models";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_ITERATIONS = 5;

// ── Local types ───────────────────────────────────────────────────────────────

interface G0PartConfig {
  keyConcepts: string;
  rubric: string;
  examples: string;
}

interface KnownExample {
  response: string;
  /** Normalized to 0 or 1 for binary grader comparison. */
  officialScore: 0 | 1;
}

interface GraderOutput {
  score: 0 | 1;
  reasoning: string;
  diagnosed_gap: string;
  confidence: "high" | "medium" | "low";
}

interface ReflectorOutput {
  analysis: string;
  proposed_rules: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Helper to parse retry-after time from OpenAI error message.
 * Looks for "try again in Xms" and returns the milliseconds.
 * Falls back to 5000ms if not found.
 */
function parseRetryAfter(errorMessage: string): number {
  const match = errorMessage.match(/try again in (\d+)ms/i);
  if (match && match[1]) {
    const ms = parseInt(match[1], 10);
    return ms + 1000; // Add 1000ms buffer
  }
  return 5000; // Default fallback
}

/**
 * Helper to execute an async function with retry logic for rate limits.
 * Retries up to 3 times on 429 errors with exponential backoff.
 */
async function withRateLimit<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      // Check if it's a 429 rate limit error
      if (err.status === 429 || err.error?.error?.type === "rate_limit_error") {
        const waitMs = parseRetryAfter(err.message || err.error?.error?.message || "");
        console.warn(
          `Rate limit hit on attempt ${attempt}/${maxRetries}. Waiting ${waitMs}ms before retry...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      } else {
        // Non-rate-limit error, don't retry
        throw err;
      }
    }
  }
  throw lastError;
}

/**
 * Parse a plain-text examples block (as stored in G0PartConfig.examples)
 * into an array of {response, officialScore} objects.
 *
 * Expected format (produced by /api/parse, may have been manually edited):
 *   Example 1 — Score: 1
 *   Response: "..."
 *   Annotation: ...
 *
 *   Example 2 — Score: 0
 *   Response: "..."
 *   Annotation: ...
 */
function parseExamples(examplesStr: string): KnownExample[] {
  const results: KnownExample[] = [];
  // Split on blank lines to isolate individual example blocks.
  const blocks = examplesStr.split(/\n\s*\n/);

  for (const block of blocks) {
    const scoreMatch = block.match(/score:\s*(\d)/i);
    // Prefer explicit "Response: ..." label; fall back to any long quoted string.
    const responseMatch =
      block.match(/response:\s*"([^"]+)"/i) ||
      block.match(/"([^"]{15,})"/);

    if (scoreMatch && responseMatch) {
      results.push({
        officialScore: (parseInt(scoreMatch[1], 10) > 0 ? 1 : 0) as 0 | 1,
        response: responseMatch[1].trim(),
      });
    }
  }

  return results;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let g0: Record<string, G0PartConfig> = {};
  let model: GradingModel = DEFAULT_GRADING_MODEL;
  try {
    const body = (await req.json()) as {
      g0?: Record<string, G0PartConfig>;
      model?: unknown;
    };
    g0 = body.g0 ?? {};
    if (body.model != null) {
      if (!isGradingModel(body.model)) {
        return new Response(
          `Error: Unsupported model: ${String(body.model)}\nDATA:${JSON.stringify({ error: "Unsupported model" })}`,
          {
            status: 400,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no",
            },
          }
        );
      }
      model = body.model;
    }
  } catch {
    // Non-critical; proceed with empty G0 (all parts skip training).
  }

  const encoder = new TextEncoder();
  // Only train on parts actually present in G0 (handles 2-part questions).
  const partLabels = Object.keys(g0).filter((k) => ["A", "B", "C"].includes(k));

  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: string) =>
        controller.enqueue(encoder.encode(line + "\n"));

      let dataSent = false;

      try {
        send(`Starting GradeOpt training with ${model}...`);

        const gStar: Record<string, string> = {};

        for (const label of partLabels) {
          const { keyConcepts, rubric, examples: examplesStr } = g0[label];
          const examples = parseExamples(examplesStr);

          if (examples.length === 0) {
            send(`Part ${label} — No parseable examples found. Skipping training.`);
            gStar[label] = "(No training data available for this part.)";
            continue;
          }

          let adaptationRules = "";
          let prevErrorCount = Infinity;

          for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
            // Add 1000ms delay between iterations to reduce rate limit hits
            if (iter > 1) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }

            // ── Grader ──────────────────────────────────────────────────────
            send(
              `Part ${label} — Iteration ${iter} — Grader scoring ${examples.length} response${examples.length !== 1 ? "s" : ""}...`
            );

            let graderResults;
            try {
              graderResults = await Promise.all(
                examples.map(async (ex) => {
                  const userContent = [
                    `KEY CONCEPT:\n${keyConcepts}`,
                    `RUBRIC:\n${rubric}`,
                    adaptationRules
                      ? `ADAPTATION RULES:\n${adaptationRules}`
                      : "ADAPTATION RULES:\nNone yet.",
                    `STUDENT RESPONSE:\n${ex.response}`,
                  ].join("\n\n");

                  const completion = await withRateLimit(() =>
                    client.chat.completions.create({
                      model: "gpt-4o",
                      temperature: 0,
                      response_format: { type: "json_object" },
                      messages: [
                        {
                          role: "system",
                          content:
                            "You are GraderGPT. Score this student response 0 or 1 based on the " +
                            "guideline provided. Output JSON with fields: " +
                            '"score" (0 or 1), "reasoning" (string), "diagnosed_gap" (string), ' +
                            '"confidence" ("high", "medium", or "low").',
                        },
                        { role: "user", content: userContent },
                      ],
                    })
                  );

                  const rawContent = completion.choices[0].message.content ?? "";
                  let parsed: Partial<GraderOutput>;
                  try {
                    parsed = JSON.parse(rawContent) as Partial<GraderOutput>;
                  } catch (parseErr) {
                    console.error(`Grader JSON parse failed. Raw response: ${rawContent}`);
                    send(
                      `Warning: GraderGPT returned invalid response, skipping this sample`
                    );
                    // Return null to indicate failure; we'll filter these out
                    return null;
                  }

                  const graderScore: 0 | 1 = parsed.score === 1 ? 1 : 0;
                  return {
                    graderScore,
                    output: {
                      score: graderScore,
                      reasoning: parsed.reasoning ?? "",
                      diagnosed_gap: parsed.diagnosed_gap ?? "",
                      confidence: parsed.confidence ?? "medium",
                    } satisfies GraderOutput,
                    example: ex,
                  };
                })
              );
              // Filter out null results from parse failures
              graderResults = graderResults.filter((r): r is Exclude<typeof r, null> => r !== null);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              send(`Part ${label} — Iteration ${iter} — Error in grader: ${msg}. Skipping iteration.`);
              continue;
            }

            // Collect mismatches.
            const errors = graderResults.filter(
              ({ graderScore, example }) => graderScore !== example.officialScore
            );

            if (errors.length === 0) {
              send(
                `Part ${label} — Iteration ${iter} — Errors: 0/${examples.length} — Early stopping.`
              );
              break;
            }

            send(
              `Part ${label} — Iteration ${iter} — Errors: ${errors.length}/${examples.length}`
            );

            if (errors.length >= prevErrorCount) {
              send(
                `Part ${label} — Iteration ${iter} — No improvement. Early stopping.`
              );
              break;
            }

            prevErrorCount = errors.length;

            // ── Reflector ────────────────────────────────────────────────────
            send(`Part ${label} — Iteration ${iter} — Reflector analyzing errors...`);

            const errorsText = errors
              .map(
                (e, i) =>
                  `Error ${i + 1}:\n` +
                  `Response: "${e.example.response}"\n` +
                  `Official Score: ${e.example.officialScore}\n` +
                  `Grader Score: ${e.graderScore}\n` +
                  `Reasoning: "${e.output.reasoning}"\n` +
                  `Diagnosed Gap: "${e.output.diagnosed_gap}"`
              )
              .join("\n\n");

            let proposals: string;
            try {
              const reflectorCompletion = await withRateLimit(() =>
                client.chat.completions.create({
                  model: "gpt-4o",
                  temperature: 0,
                  response_format: { type: "json_object" },
                  messages: [
                    {
                      role: "system",
                      content:
                        "You are ReflectorGPT. Analyze these grading errors and identify the shared " +
                        "failure pattern. Propose 1-3 specific adaptation rules to fix them. " +
                        'Output JSON with fields: "analysis" (string), "proposed_rules" (string).',
                    },
                    {
                      role: "user",
                      content: [
                        `RUBRIC:\n${rubric}`,
                        adaptationRules
                          ? `CURRENT ADAPTATION RULES:\n${adaptationRules}`
                          : "CURRENT ADAPTATION RULES:\nNone.",
                        `GRADING ERRORS:\n${errorsText}`,
                      ].join("\n\n"),
                    },
                  ],
                })
              );

              const rawContent = reflectorCompletion.choices[0].message.content ?? "";
              let reflectorData: Partial<ReflectorOutput>;
              try {
                reflectorData = JSON.parse(rawContent) as Partial<ReflectorOutput>;
              } catch (parseErr) {
                console.error(`Reflector JSON parse failed. Raw response: ${rawContent}`);
                send(
                  `Warning: ReflectorGPT returned invalid response, skipping this iteration`
                );
                continue;
              }
              proposals = reflectorData.proposed_rules ?? "";
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              send(
                `Part ${label} — Iteration ${iter} — Error in reflector: ${msg}. Skipping iteration.`
              );
              continue;
            }

            // ── Refiner ──────────────────────────────────────────────────────
            send(`Part ${label} — Iteration ${iter} — Refiner updating rules...`);

            try {
              const refinerCompletion = await withRateLimit(() =>
                client.chat.completions.create({
                  model: "gpt-4o",
                  temperature: 0,
                  // No response_format — REFINER outputs plain text, not JSON.
                  messages: [
                    {
                      role: "system",
                      content:
                        "You are RefinerGPT. Update the adaptation rules based on the reflector's " +
                        "proposals. Output only the updated adaptation rules as plain text. " +
                        "Do not modify the rubric.",
                    },
                    {
                      role: "user",
                      content: [
                        adaptationRules
                          ? `CURRENT ADAPTATION RULES:\n${adaptationRules}`
                          : "CURRENT ADAPTATION RULES:\nNone.",
                        `REFLECTOR PROPOSALS:\n${proposals}`,
                      ].join("\n\n"),
                    },
                  ],
                })
              );

              // Keep existing rules if the refiner returns nothing.
              const refinerResponse = refinerCompletion.choices[0].message.content?.trim();
              if (!refinerResponse) {
                send(
                  `Warning: RefinerGPT returned empty response, keeping current rules`
                );
              } else {
                adaptationRules = refinerResponse;
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              send(
                `Part ${label} — Iteration ${iter} — Error in refiner: ${msg}. Skipping iteration.`
              );
              continue;
            }
          }

          gStar[label] =
            adaptationRules ||
            "(No adaptation rules were generated for this part.)";
        }

        send("Training complete.");
        send(`DATA:${JSON.stringify(gStar)}`);
        dataSent = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send(`Error: ${msg}`);
        // Send fallback error response if we haven't sent the normal DATA response
        if (!dataSent) {
          send(`DATA:${JSON.stringify({ error: "Training incomplete — please try again" })}`);
          dataSent = true;
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
