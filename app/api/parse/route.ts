/**
 * POST /api/parse
 *
 * Accepts a multipart/form-data upload with two fields:
 *   "module1" — Module 1 PDF
 *   "module2" — Module 2 PDF
 * At least one must be provided.
 *
 * Parses the PDF, chunks the text, embeds each chunk with
 * text-embedding-3-small, and writes the result to /tmp/knowledge_base.json.
 *
 * NOTE: Vercel's filesystem is read-only except for /tmp.
 * The knowledge base is stored in /tmp/knowledge_base.json and will not
 * persist across serverless function cold starts on Vercel. For production,
 * replace /tmp storage with a persistent store (e.g. Vercel KV, S3, Supabase).
 *
 * Returns: { success: true, chunkCount: number }
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import OpenAI from "openai";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require("pdf-parse");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const KB_PATH = "/tmp/knowledge_base.json";

// ~2000 chars per chunk (1 token ≈ 4 chars → ~500 tokens), 200 char overlap
const CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 200;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end).trim());
    if (end === text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks.filter((c) => c.length > 50); // drop near-empty chunks
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  // OpenAI allows up to 2048 inputs per request; batch in groups of 100
  const BATCH = 100;
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const res = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: slice,
    });
    // API returns embeddings in the same order as input
    res.data.sort((a, b) => a.index - b.index);
    all.push(...res.data.map((d) => d.embedding));
  }
  return all;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    // ── Extract PDFs ─────────────────────────────────────────────────────
    const texts: string[] = [];
    for (const field of ["module1", "module2"] as const) {
      const file = formData.get(field);
      if (!file || typeof file === "string") continue;
      const buffer = Buffer.from(await (file as File).arrayBuffer());
      const parsed = await pdfParse(buffer);
      if (parsed.text) texts.push(parsed.text);
    }

    if (texts.length === 0) {
      return NextResponse.json(
        { error: "No valid PDF files provided in module1 or module2 fields." },
        { status: 400 }
      );
    }

    // ── Chunk ─────────────────────────────────────────────────────────────
    const combined = texts.join("\n\n");
    const rawChunks = chunkText(combined);

    // ── Embed ─────────────────────────────────────────────────────────────
    const embeddings = await embedBatch(rawChunks);

    const chunks = rawChunks.map((text, i) => ({
      id: `chunk_${i}`,
      text,
      embedding: embeddings[i],
    }));

    // ── Save to /tmp ──────────────────────────────────────────────────────
    const kb = {
      chunks,
      metadata: {
        created_at: new Date().toISOString(),
        chunk_count: chunks.length,
        embedding_model: "text-embedding-3-small",
      },
    };

    fs.writeFileSync(KB_PATH, JSON.stringify(kb));

    return NextResponse.json({ success: true, chunkCount: chunks.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/parse] Error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
