import fs from "fs";
import OpenAI from "openai";

// NOTE: Vercel has a read-only filesystem except for /tmp.
// The knowledge base is stored in /tmp/knowledge_base.json at runtime.
const KB_PATH = "/tmp/knowledge_base.json";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface KBChunk {
  id: string;
  text: string;
  embedding: number[];
}

interface KnowledgeBase {
  chunks: KBChunk[];
  metadata: {
    created_at: string;
    chunk_count: number;
    embedding_model: string;
  };
}

export function loadKnowledgeBase(): KBChunk[] | null {
  try {
    if (!fs.existsSync(KB_PATH)) return null;
    const raw = fs.readFileSync(KB_PATH, "utf-8");
    const kb = JSON.parse(raw) as KnowledgeBase;
    return kb.chunks ?? null;
  } catch {
    return null;
  }
}

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

export function retrieve(
  queryEmbedding: number[],
  chunks: KBChunk[],
  topK: number
): KBChunk[] {
  return chunks
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((r) => r.chunk);
}

/**
 * Embed a query and retrieve the top-K most relevant chunks from the KB.
 * Returns null silently if the KB does not exist yet.
 */
export async function retrieveContext(
  query: string,
  topK: number
): Promise<string | null> {
  const chunks = loadKnowledgeBase();
  if (!chunks || chunks.length === 0) return null;

  try {
    const embeddingResponse = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: query,
    });
    const queryEmbedding = embeddingResponse.data[0].embedding;
    const topChunks = retrieve(queryEmbedding, chunks, topK);
    if (topChunks.length === 0) return null;
    return topChunks.map((c) => c.text).join("\n\n---\n\n");
  } catch {
    // RAG failure is non-fatal — grading continues without context
    return null;
  }
}
