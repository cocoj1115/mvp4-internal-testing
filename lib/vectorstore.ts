/**
 * lib/vectorstore.ts
 *
 * In-memory vector store for GradeRAG retrieval.
 * Mirrors ChromaDB's collection architecture (collections, documents, embeddings)
 * without requiring a running server. Backed by OpenAI text-embedding-3-small
 * and cosine-similarity search.
 *
 * Three named collections:
 *   kd1_standards — one entry per STEELS standard line
 *   kd2_rubrics   — one entry per part rubric (A, B, C)
 *   ke_examples   — one entry per scored student example
 *
 * Module-level singleton: state persists across API route calls within
 * the same Next.js Node.js process (survives requests, resets on cold start).
 */

import OpenAI from "openai";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface G0PartConfig {
  keyConcepts: string;
  rubric: string;
  examples: string;
}

/** Matches the ParseResult produced by /api/parse and consumed by /api/train. */
export interface ParseResult {
  kd1Chunks: number;
  kd2Chunks: number;
  keExamples: number;
  g0: Record<string, G0PartConfig>;
}

// ── Internal types ────────────────────────────────────────────────────────────

interface VectorEntry {
  id: string;
  text: string;
  embedding: number[];
}

interface ParsedExample {
  response: string;
  officialScore: number;
}

// ── Module-level singleton ────────────────────────────────────────────────────
//
// State is stored at module scope so it survives across HTTP requests within
// the same long-running Node.js process (Next.js dev server, or a traditional
// Node.js server deployment).
//
// ⚠ Vercel / serverless cold-start limitation:
//   Each serverless function invocation may run in a fresh process, resetting
//   module-level state to its initial values.  The vectorstore would need to be
//   rebuilt on every cold start.  For a persistent RAG layer in production,
//   replace this with a durable store (e.g. Supabase pgvector, Pinecone, or a
//   Redis-backed embedding cache).

const collections: Record<string, VectorEntry[]> = {
  kd1_standards: [],
  kd2_rubrics: [],
  ke_examples: [],
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Helpers ───────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

async function embed(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 8_000), // stay within token limit
  });
  return response.data[0].embedding;
}

/**
 * Parse the plain-text examples block used in G0PartConfig.examples
 * into individual {response, officialScore} records.
 * Mirrors the parser in /api/train.
 */
function parseExamplesFromStr(examplesStr: string): ParsedExample[] {
  const results: ParsedExample[] = [];
  const blocks = examplesStr.split(/\n\s*\n/);
  for (const block of blocks) {
    const scoreMatch = block.match(/score:\s*(\d)/i);
    const responseMatch =
      block.match(/response:\s*"([^"]+)"/i) || block.match(/"([^"]{15,})"/);
    if (scoreMatch && responseMatch) {
      results.push({
        officialScore: parseInt(scoreMatch[1], 10),
        response: responseMatch[1].trim(),
      });
    }
  }
  return results;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build (or rebuild) all three collections from a ParseResult.
 * Clears existing data, embeds every document, and marks the store ready.
 */
export async function buildVectorStore(parseResult: ParseResult): Promise<void> {
  // Reset all collections
  for (const key of Object.keys(collections)) {
    collections[key] = [];
  }

  const { g0 } = parseResult;

  // ── KD1: one entry per standards line ───────────────────────────────────────
  // All parts share the same keyConcepts block; take the first non-placeholder.
  const standardsText =
    Object.values(g0)
      .map((p) => p.keyConcepts)
      .find(
        (t) => t.trim().length > 0 && !t.toLowerCase().startsWith("key concepts for")
      ) ?? "";

  const standardLines = standardsText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 5 && l.includes(":")); // "code: expectation" format

  for (let i = 0; i < standardLines.length; i++) {
    const embedding = await embed(standardLines[i]);
    collections.kd1_standards.push({
      id: `kd1_${i}`,
      text: standardLines[i],
      embedding,
    });
  }

  // ── KD2: one entry per part rubric ──────────────────────────────────────────
  for (const [label, part] of Object.entries(g0)) {
    if (!["A", "B", "C"].includes(label)) continue;
    const text = `Part ${label} Rubric:\n${part.rubric}`;
    const embedding = await embed(text);
    collections.kd2_rubrics.push({
      id: `kd2_${label}`,
      text,
      embedding,
    });
  }

  // ── KE: one entry per scored example across all parts ───────────────────────
  let idx = 0;
  for (const [label, part] of Object.entries(g0)) {
    if (!["A", "B", "C"].includes(label)) continue;
    for (const ex of parseExamplesFromStr(part.examples)) {
      const text =
        `Part ${label} scored example (Score ${ex.officialScore}): ${ex.response}`;
      const embedding = await embed(text);
      collections.ke_examples.push({
        id: `ke_${ex.officialScore}_${idx++}`,
        text,
        embedding,
      });
    }
  }

}

/**
 * Retrieve the top-n most semantically similar documents from a collection.
 * Returns document text strings ranked by cosine similarity to the query.
 */
export async function retrieve(
  query: string,
  collection: string,
  n: number
): Promise<string[]> {
  const entries = collections[collection] ?? [];
  if (entries.length === 0) return [];

  const queryEmbedding = await embed(query);

  return entries
    .map((entry) => ({
      text: entry.text,
      score: cosineSimilarity(queryEmbedding, entry.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((e) => e.text);
}

/**
 * Returns true if the vector store has been built and has indexed documents.
 * Checks actual collection contents rather than a flag so it stays correct
 * even if the module is hot-reloaded during development or partially rebuilt.
 */
export function isReady(): boolean {
  return (
    collections.kd2_rubrics.length > 0 &&   // rubrics are the minimum needed
    collections.ke_examples.length > 0        // examples required for retrieval
  );
}

/**
 * Returns document counts per collection. Useful for the build API response.
 */
export function getCounts(): { kd1: number; kd2: number; ke: number } {
  return {
    kd1: collections.kd1_standards.length,
    kd2: collections.kd2_rubrics.length,
    ke: collections.ke_examples.length,
  };
}
