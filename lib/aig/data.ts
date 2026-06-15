import fs from "fs";
import path from "path";
import { embedText, cosineSimilarity } from "@/lib/retrieval";
import type { KC, TaxonomyEntry, Card, Chunk, ABCPrior, ItemRubric } from "./types";

// ── CSV parser (handles quoted fields, BOM) ───────────────────────────────────

function parseCSV(raw: string): string[][] {
  const text = raw.startsWith("﻿") ? raw.slice(1) : raw;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field.trim());
        field = "";
      } else if (ch === "\n") {
        row.push(field.trim());
        rows.push(row);
        row = [];
        field = "";
      } else if (ch !== "\r") {
        field += ch;
      }
    }
  }
  if (field || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

// ── File paths ────────────────────────────────────────────────────────────────

function aigPath(filename: string) {
  return path.join(process.cwd(), "data", "aig", filename);
}

// ── Module-level caches ───────────────────────────────────────────────────────

interface StandardInfo {
  module: string;
  strand: string;
  statement: string;
}

let _kcs: KC[] | null = null;
let _taxonomy: Record<string, TaxonomyEntry> | null = null;
let _cards: Card[] | null = null;
let _chunks: Chunk[] | null = null;
let _rubrics: { general: string; item_specific: ItemRubric[] } | null = null;
let _standardsInfo: Record<string, StandardInfo> | null = null;
let _chunkEmbeddings: Array<{ chunk: Chunk; vec: number[] }> | null = null;
let _chunkEmbedInitPromise: Promise<void> | null = null;

// ── Loaders ───────────────────────────────────────────────────────────────────

export function getKCs(): KC[] {
  if (_kcs) return _kcs;

  const raw = fs.readFileSync(aigPath("kc_table.csv"), "utf-8");
  const rows = parseCSV(raw);
  if (rows.length < 2) return (_kcs = []);

  // skip header row
  let lastModule = "";
  let lastUnit = "";
  const result: KC[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 5) continue;

    const [col0, col1, col2, col3, col4, col5] = row;

    if (col0) lastModule = col0.trim();
    if (col1) lastUnit = col1.trim();

    const standard = col2.trim();
    const kcId = col3.trim();
    const statement = col4.trim();
    const vocabRaw = col5 ?? "";

    if (!standard || !kcId || !statement) continue;

    const numeric = kcId.replace(/[^0-9]/g, "");
    const code = standard + numeric;

    const vocab = vocabRaw
      .split(/[;,]/)
      .map((v) => v.trim())
      .filter(Boolean);

    result.push({
      code,
      standard,
      kcId,
      statement,
      vocab,
      module: lastModule,
      unit: lastUnit,
    });
  }

  return (_kcs = result);
}

export function getTaxonomy(): Record<string, TaxonomyEntry> {
  if (_taxonomy) return _taxonomy;
  const raw = fs.readFileSync(aigPath("taxonomy_and_cards.json"), "utf-8");
  const data = JSON.parse(raw) as {
    taxonomy: Record<string, TaxonomyEntry>;
    cards: Card[];
  };
  _cards = data.cards;
  return (_taxonomy = data.taxonomy);
}

export function getCards(): Card[] {
  if (_cards) return _cards;
  getTaxonomy(); // populates _cards as a side effect
  return _cards!;
}

export function getChunks(): Chunk[] {
  if (_chunks) return _chunks;
  const raw = fs.readFileSync(aigPath("study_guide_chunks.json"), "utf-8");
  const data = JSON.parse(raw) as { chunks: Chunk[] };
  return (_chunks = data.chunks);
}

export function getRubrics(): { general: string; item_specific: ItemRubric[] } {
  if (_rubrics) return _rubrics;
  const raw = fs.readFileSync(aigPath("rubrics.json"), "utf-8");
  return (_rubrics = JSON.parse(raw) as { general: string; item_specific: ItemRubric[] });
}

// ── A/B/C priors ─────────────────────────────────────────────────────────────

export function getABCPriors(): ABCPrior[] {
  const cards = getCards();
  const byItem = new Map<string, Card[]>();
  for (const card of cards) {
    const list = byItem.get(card.item_id) ?? [];
    list.push(card);
    byItem.set(card.item_id, list);
  }

  const result: ABCPrior[] = [];
  for (const [item, itemCards] of Array.from(byItem.entries())) {
    const sorted = itemCards
      .filter((c) => ["A", "B", "C"].includes(c.part))
      .sort((a, b) => a.part.localeCompare(b.part));
    if (sorted.length < 2) continue;
    result.push({ item, sequence: sorted.map((c) => c.primary_type) });
  }
  return result;
}

// ── Whole-item exemplars ──────────────────────────────────────────────────────

export interface WholeItemPart {
  part: "A" | "B" | "C";
  prompt: string;
  primary_type: string;
  difficulty: number;
}

export interface WholeItem {
  item_id: string;
  source: string;
  parts: WholeItemPart[];
}

export function getWholeItems(): WholeItem[] {
  const taxonomy = getTaxonomy();
  const cards = getCards();
  const byItem = new Map<string, Card[]>();
  for (const card of cards) {
    if (!["A", "B", "C"].includes(card.part)) continue;
    const list = byItem.get(card.item_id) ?? [];
    list.push(card);
    byItem.set(card.item_id, list);
  }
  const result: WholeItem[] = [];
  for (const [item_id, itemCards] of Array.from(byItem.entries())) {
    const sorted = itemCards.sort((a, b) => a.part.localeCompare(b.part));
    if (sorted.length < 2) continue;
    result.push({
      item_id,
      source: sorted[0].source,
      parts: sorted.map((c) => ({
        part: c.part as "A" | "B" | "C",
        prompt: c.prompt,
        primary_type: c.primary_type,
        difficulty: taxonomy[c.primary_type]?.difficulty ?? 0,
      })),
    });
  }
  return result;
}

// ── Standards helpers ─────────────────────────────────────────────────────────

function getStandardsInfo(): Record<string, StandardInfo> {
  if (_standardsInfo) return _standardsInfo;
  const raw = fs.readFileSync(aigPath("standards.json"), "utf-8");
  return (_standardsInfo = JSON.parse(raw) as Record<string, StandardInfo>);
}

export function getStandardInfo(code: string): StandardInfo | null {
  return getStandardsInfo()[code] ?? null;
}

export function getStandards(): { standard: string; kcs: KC[]; module: string; strand: string; statement: string }[] {
  const info = getStandardsInfo();
  const byStandard = new Map<string, KC[]>();
  for (const kc of getKCs()) {
    const list = byStandard.get(kc.standard) ?? [];
    list.push(kc);
    byStandard.set(kc.standard, list);
  }
  return Array.from(byStandard.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([standard, kcs]) => ({
      standard,
      kcs,
      module: info[standard]?.module ?? "",
      strand: info[standard]?.strand ?? "",
      statement: info[standard]?.statement ?? "",
    }));
}

export function getKCsByStandard(standard: string): KC[] {
  return getKCs().filter((kc) => kc.standard === standard);
}

// ── Chunk embeddings (cold-start, once per server instance) ───────────────────

async function initChunkEmbeddings(): Promise<void> {
  if (_chunkEmbeddings) return;
  const chunks = getChunks();
  // batch in groups of 20 to avoid rate-limit spikes
  const batchSize = 20;
  const all: Array<{ chunk: Chunk; vec: number[] }> = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vecs = await Promise.all(batch.map((c) => embedText(c.text)));
    for (let j = 0; j < batch.length; j++) {
      all.push({ chunk: batch[j], vec: vecs[j] });
    }
  }
  _chunkEmbeddings = all;
}

export async function retrieveStudyGuide(
  query: string,
  k: number = 4,
  minScore: number = 0.25
): Promise<Array<{ chunk_id: string; text: string; score: number }>> {
  if (!_chunkEmbedInitPromise) {
    _chunkEmbedInitPromise = initChunkEmbeddings();
  }
  await _chunkEmbedInitPromise;

  const qVec = await embedText(query);
  const scored = _chunkEmbeddings!
    .map(({ chunk, vec }) => ({
      chunk_id: chunk.chunk_id,
      text: chunk.text,
      score: cosineSimilarity(qVec, vec),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return scored;
}
