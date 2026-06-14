import fs from "fs";
import path from "path";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface KBChunk {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
  embedding: number[];
}

interface KBFile {
  collection: string;
  embedding_model: string;
  chunk_count: number;
  chunks: KBChunk[];
}

// ── Load collections once per server instance ─────────────────────────────

function loadCollection(filename: string): KBChunk[] | null {
  try {
    const filePath = path.join(process.cwd(), "data", "gstar", "kb", filename);
    const raw = fs.readFileSync(filePath, "utf-8");
    const kb = JSON.parse(raw) as KBFile;
    return kb.chunks ?? null;
  } catch {
    return null;
  }
}

let kd1Chunks: KBChunk[] | null | undefined;
let kd2Chunks: KBChunk[] | null | undefined;
let keChunks: KBChunk[] | null | undefined;

function getCollections(): { kd1: KBChunk[] | null; kd2: KBChunk[] | null; ke: KBChunk[] | null } {
  if (kd1Chunks === undefined) kd1Chunks = loadCollection("kd1_embeddings.json");
  if (kd2Chunks === undefined) kd2Chunks = loadCollection("kd2_embeddings.json");
  if (keChunks === undefined)  keChunks  = loadCollection("ke_embeddings.json");
  return { kd1: kd1Chunks, kd2: kd2Chunks, ke: keChunks };
}

// ── Cosine similarity ─────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function topK(queryEmbedding: number[], chunks: KBChunk[], k: number): KBChunk[] {
  return chunks
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((r) => r.chunk);
}

function wordOverlap(query: string, text: string): number {
  const normalize = (s: string) =>
    s.toLowerCase()
     .replace(/[^a-z0-9\s]/g, "")
     .split(/\s+/)
     .filter((w) => w.length > 3);
  const queryWords = new Set(normalize(query));
  const textWords = normalize(text);
  if (queryWords.size === 0) return 0;
  const matches = textWords.filter((w) => queryWords.has(w)).length;
  return Math.min(matches / queryWords.size, 1);
}

function topKWithRerank(queryEmbedding: number[], query: string, chunks: KBChunk[], k: number): KBChunk[] {
  const candidates = chunks
    .map((chunk) => ({ chunk, cosine: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.cosine - a.cosine)
    .slice(0, 5);

  return candidates
    .map(({ chunk, cosine }) => ({
      chunk,
      finalScore: 0.6 * cosine + 0.4 * wordOverlap(query, chunk.text),
    }))
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, k)
    .map((r) => r.chunk);
}

// ── Embedding helper ──────────────────────────────────────────────────────

export async function embedText(input: string): Promise<number[]> {
  const res = await client.embeddings.create({ model: "text-embedding-3-small", input });
  return res.data[0].embedding;
}

// ── Main export ───────────────────────────────────────────────────────────

export async function retrieveFromKB(
  partPrompt: string,
  studentResponse: string,
  topKCount: number = 2
): Promise<{ kd1: string; kd2: string; ke: string } | null> {
  const { kd1, kd2, ke } = getCollections();
  if (!kd1 || !kd2 || !ke) return null;

  try {
    // One call for KD1 + KD2 (query = part prompt), one for KE (query = student response)
    const [promptEmbedding, responseEmbedding] = await Promise.all([
      embedText(partPrompt),
      embedText(studentResponse),
    ]);

    const kd1Chunks = topK(promptEmbedding,   kd1, topKCount);
    const kd2Chunks = topK(promptEmbedding,   kd2, topKCount);
    const keChunks  = topKWithRerank(responseEmbedding, studentResponse, ke, topKCount);

    return {
      kd1: kd1Chunks.map((c) => c.text).join("\n---\n"),
      kd2: kd2Chunks.map((c) => c.text).join("\n---\n"),
      ke:  keChunks.map((c) => c.text).join("\n---\n"),
    };
  } catch {
    return null;
  }
}
