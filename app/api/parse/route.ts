/**
 * POST /api/parse
 *
 * Accepts a multipart/form-data upload containing a single PDF file
 * (KD1 + KD2 + KE scoring materials).
 *
 * Extracts all text via pdf-parse, then makes three sequential model calls
 * to classify the content into KD1 (STEELS standards), KD2 (rubric criteria),
 * and KE (scored examples). Assembles a G0 config from the results.
 *
 * Returns a text/plain streaming response — progress lines followed by
 * a DATA:<json> terminal line carrying the ParseResult payload.
 */

import { NextRequest } from "next/server";
import OpenAI from "openai";
import pdfParse from "pdf-parse";
import {
  DEFAULT_GRADING_MODEL,
  isGradingModel,
} from "@/lib/grading-models";

// Force Node.js runtime so pdf-parse (which uses fs) is available.
export const runtime = "nodejs";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Local types ───────────────────────────────────────────────────────────────

interface Standard {
  code: string;
  expectation: string;
}

interface PartRubric {
  keyConcept: string;
  rubric: string;
}

interface KExample {
  score: number;
  partA?: string | null;
  partB?: string | null;
  partC?: string | null;
  annotation?: string;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: string) =>
        controller.enqueue(encoder.encode(line + "\n"));

      try {
        // ── Extract PDF text ─────────────────────────────────────────────────
        send("Parsing PDF...");

        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        if (!file) throw new Error("No file uploaded.");
        const modelValue = formData.get("model");
        if (modelValue != null && !isGradingModel(modelValue)) {
          throw new Error(`Unsupported model: ${String(modelValue)}`);
        }
        const model = isGradingModel(modelValue)
          ? modelValue
          : DEFAULT_GRADING_MODEL;

        const buffer = Buffer.from(await file.arrayBuffer());
        const pdfData = await pdfParse(buffer);
        const text = pdfData.text.trim();

        send(`Extracted ${text.length.toLocaleString()} characters of text.`);

        // ── KD1: STEELS standards ────────────────────────────────────────────
        send(`Calling ${model} to identify STEELS standards (KD1)...`);

        const kd1Completion = await client.chat.completions.create({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are extracting STEELS standards from a biology assessment document. " +
                "Return only the standard codes and their performance expectations as a JSON " +
                'object with a "standards" array of objects with fields "code" and "expectation".',
            },
            { role: "user", content: text },
          ],
        });

        const kd1Data = JSON.parse(
          kd1Completion.choices[0].message.content ?? "{}"
        ) as { standards?: Standard[] };
        const standards: Standard[] = kd1Data.standards ?? [];
        send(`Found ${standards.length} standard${standards.length !== 1 ? "s" : ""}.`);

        // ── KD2: Rubric criteria ─────────────────────────────────────────────
        send(`Calling ${model} to extract rubric criteria (KD2)...`);

        const kd2Completion = await client.chat.completions.create({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are extracting item-specific scoring rubric criteria from a Keystone Biology " +
                "scoring guide. For each sub-part (A, B, C), extract the key concept and scoring " +
                'criteria. Return JSON with a "parts" object where keys are "A", "B", "C" each ' +
                'containing "keyConcept" and "rubric" fields.',
            },
            { role: "user", content: text },
          ],
        });

        const kd2Data = JSON.parse(
          kd2Completion.choices[0].message.content ?? "{}"
        ) as { parts?: Record<string, PartRubric> };
        const rubricParts: Record<string, PartRubric> = kd2Data.parts ?? {};
        const foundParts = Object.keys(rubricParts).filter((k) =>
          ["A", "B", "C"].includes(k)
        );
        send(
          foundParts.length > 0
            ? `Extracted rubric for parts ${foundParts.join(", ")}.`
            : "Extracted rubric criteria (no part labels identified)."
        );

        // ── KE: Scored examples ──────────────────────────────────────────────
        send(`Calling ${model} to extract scored examples (KE)...`);

        const keCompletion = await client.chat.completions.create({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are extracting scored student response examples from a Keystone Biology " +
                'scoring guide. Return a JSON object with an "examples" array of objects with ' +
                'fields "score" (number), "partA" (string or null), "partB" (string or null), ' +
                '"partC" (string or null), "annotation" (string).',
            },
            { role: "user", content: text },
          ],
        });

        const keData = JSON.parse(
          keCompletion.choices[0].message.content ?? "{}"
        ) as { examples?: KExample[] };
        const keExamples: KExample[] = keData.examples ?? [];
        send(
          `Found ${keExamples.length} scored example${keExamples.length !== 1 ? "s" : ""}.`
        );

        // ── Build G0 ─────────────────────────────────────────────────────────
        send("Building G0 from extracted content...");

        const standardsText = standards
          .map((s) => `${s.code}: ${s.expectation}`)
          .join("\n");

        // Always produce A, B, C entries so handleParseDone can filter freely.
        const g0: Record<
          string,
          { keyConcepts: string; rubric: string; examples: string }
        > = {};

        for (const label of ["A", "B", "C"]) {
          const partRubric = rubricParts[label];
          const responseKey = `part${label}` as "partA" | "partB" | "partC";

          const partExamples = keExamples.filter(
            (e) => e[responseKey] != null && String(e[responseKey]).trim() !== ""
          );

          const examplesText =
            partExamples.length > 0
              ? partExamples
                  .map(
                    (e, i) =>
                      `Example ${i + 1} — Score: ${e.score}\n` +
                      `Response: "${String(e[responseKey] ?? "")}"\n` +
                      `Annotation: ${e.annotation ?? ""}`
                  )
                  .join("\n\n")
              : `(No scored examples found for Part ${label})`;

          g0[label] = {
            keyConcepts: standardsText || `Key concepts for Part ${label}`,
            rubric: partRubric
              ? `Key Concept: ${partRubric.keyConcept}\n\nScoring Criteria:\n${partRubric.rubric}`
              : `(No rubric extracted for Part ${label})`,
            examples: examplesText,
          };
        }

        send("Done.");

        const payload = {
          kd1Chunks: standards.length,
          kd2Chunks: foundParts.length,
          keExamples: keExamples.length,
          g0,
        };

        send(`DATA:${JSON.stringify(payload)}`);
      } catch (err) {
        // Log the real error server-side only — never stream it to the client,
        // as OpenAI error messages can include the API key or other credentials.
        console.error("[/api/parse] Fatal error:", err);
        send("Error calling GPT-4o. Please check your API key and try again.");
        send(`DATA:${JSON.stringify({ error: "Parse failed. Please try again." })}`);
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
