# AIG — Automatic Item Generation

AIG generates constructed-response items for the Pennsylvania Keystone Biology standardized exam.

## Pipeline Overview

```
Select Standard → Assemble Context → LLM Call 1: Blueprint → LLM Call 2: Item → Display Results
```

### Step 1: Assemble Context (`assembleContext`)

Collects all data relevant to the target standard from local files and packages it into a `ContextPack`:

| Field | Source | Purpose |
|-------|--------|---------|
| `standardKCs` | `data/aig/kc_table.csv` | All Knowledge Components under the standard |
| `studyGuideChunks` | `data/aig/study_guide_chunks.json` | Top 4 most relevant passages via cosine similarity (threshold 0.25) |
| `relatedCards` | `data/aig/taxonomy_and_cards.json` | Top 12 item cards scored by vocabulary overlap |
| `taxonomyRows` | same | 12 task types with definitions, difficulty levels, and scaffolding |
| `relevantRubrics` | `data/aig/rubrics.json` | Scoring rubric examples matched to the standard |
| `grounding` | all of the above | Tracks which data sources were actually hit (shown in UI) |

**Retrieval logic**: The study-guide search uses the combined `vocab` terms from all KCs under the standard as the query. This produces a tighter embedding signal than concatenating full KC statement sentences, which dilutes relevance when a standard has many KCs.

---

### Step 2: Generate Blueprint (`generateBlueprint`)

LLM Call 1. The blueprint is the item's design specification — it defines structure without writing the actual question.

**Key Blueprint fields:**

```json
{
  "target_standard": "3.1.9-12.A",
  "core_kc": "3.1.9-12.A1",           // single KC explored in depth across all parts
  "supporting_kcs": ["3.1.9-12.A2"],  // 0–2 background KCs (context only, no dedicated part)
  "cognitive_demand": "Moderate",
  "key_concepts": ["codon", "anticodon", "tRNA"],
  "task_sequence": {
    "Part A": { "kc_code": "...", "task_type": "Recall / Identify / Classify", "function": "identify the molecule that carries the anticodon" },
    "Part B": { "kc_code": "...", "task_type": "Explain Mechanism", "function": "explain how the anticodon ensures the correct amino acid is added" },
    "Part C": { "kc_code": "...", "task_type": "Predict / Infer", "function": "predict the effect of an anticodon mutation" }
  },
  "evidence_pattern": "...",
  "expected_response_elements": [...],
  "common_incomplete_responses": [...]
}
```

**Design rules enforced by the prompt:**
- **Single-focus rule**: Each part asks for exactly one thing. The `function` field must not chain two questions with "and", "also", or a comma introducing a second ask.
- **Difficulty must not decrease**: Part A must be difficulty 1–2 (low entry point); difficulty(A) ≤ difficulty(B) ≤ difficulty(C); at most one part may reach difficulty 4–5.
- **One core concept**: All parts probe different facets of the same `core_kc` — they do not pivot to a new topic.
- **Exact task_type names**: Must match a TYPE name from the taxonomy exactly (no difficulty number appended).

---

### Step 3: Generate Item (`generateItem`)

LLM Call 2. Writes the actual student-facing content from the blueprint.

**Item structure:**

```json
{
  "stem": "sentence(s) setting the biological context",
  "stimulus_asset": {
    "type": "diagram",
    "caption": "...",
    "diagram_spec": "<svg ...>...</svg>"
  },
  "parts": {
    "Part A": { "task_type": "Recall / Identify / Classify", "question": "student-facing question" },
    "Part B": { "task_type": "Explain Mechanism", "question": "..." },
    "Part C": { "task_type": "Predict / Infer", "question": "..." }
  },
  "scoring_rubric": {
    "points_possible": 3,
    "3": "Thorough — by ALL of: [bullet A] AND [bullet B] AND [bullet C]",
    "2": "Partial — fulfilling TWO of the bullets",
    "1": "Minimal — fulfilling ONE of the bullets",
    "0": "Insufficient evidence"
  }
}
```

**Stimulus asset types:**

| type | When to use | Required field |
|------|-------------|----------------|
| `table` | Numerical or comparative data | `table_markdown` (GFM format) |
| `line_graph` | Trend over time or a continuous variable | `chart_data` |
| `bar_chart` | Comparing discrete categories | `chart_data` |
| `diagram` | Simple flowchart, cycle, or molecular/pathway schematic that can be drawn with basic shapes and arrows | `diagram_spec` (complete SVG string) |
| `illustration` | Any complex biological image — cell structures, organelles, organisms, tissues, realistic molecular models | `illustration_prompt` |
| `none` | Purely textual item, no visual asset needed | — |

**Scoring rubric**: One holistic 0–3 rubric for the whole item. The 3-point level requires all parts to be answered correctly.

---

### Retry Logic

Both LLM calls use `callWithRetry` with one automatic retry:
1. On first failure, the error message is appended to the user message and the call is made again.
2. If both attempts fail, an error is thrown.

**Blueprint validation checks**: `core_kc` must be a real KC code under the standard; `task_type` must match a taxonomy type; Part A and Part B must be present.

**Item validation checks**: `stimulus_asset.type` must be a valid enum value; table/chart/diagram types must include their corresponding fields; `scoring_rubric` must have keys 0, 1, 2, and 3.

---

## TELeR Level

Controls whether `expected_response_elements` from the blueprint is provided to the model in the item prompt:

- **L3 (default)**: Expected response elements are withheld. The model derives scoring criteria from the KC and blueprint alone.
- **L4**: Expected response elements are provided. Produces more targeted rubrics at the cost of some model creativity.

---

## Methods Registry

`AIG_METHODS` is defined in [lib/aig/pipeline.ts](lib/aig/pipeline.ts). Each method implements `run(standard, model, temperature)` and returns `{ blueprint, item, grounding }`.

| Method ID | Label | Status |
|-----------|-------|--------|
| `method_blueprint_l3` | Blueprint + TELeR L3 | ✅ Implemented |
| `method_2` | (placeholder) | ❌ Not implemented |
| `method_3` | (placeholder) | ❌ Not implemented |

To add a new method: add an entry to `AIG_METHODS` — the UI reads the method list from `/api/aig/kcs` and will pick it up automatically.

---

## File Structure

```
lib/aig/
  types.ts       — TypeScript type definitions for all AIG data structures
  data.ts        — Reads local JSON/CSV data files
  pipeline.ts    — assembleContext / generateBlueprint / generateItem / AIG_METHODS
  prompts.ts     — buildBlueprintPrompt / buildItemPrompt

app/aig/
  page.tsx           — Frontend UI (standard selector, method/model/temperature config, progress display, result rendering)
  StimulusAsset.tsx  — Renders table / chart / diagram / illustration assets

app/api/aig/
  generate/route.ts      — POST /api/aig/generate
  standards/route.ts     — GET /api/aig/standards
  kcs/route.ts           — GET /api/aig/kcs
  illustration/route.ts  — POST /api/aig/illustration

data/aig/
  kc_table.csv               — KC list (code, standard, statement, vocab, module, unit)
  taxonomy_and_cards.json    — 12 task type definitions + historical item cards
  study_guide_chunks.json    — Vectorized study guide passages
  standards.json             — Standard metadata
  rubrics.json               — Scoring rubric examples
```

---

## UI Walkthrough (`/aig` page)

1. Select a **Standard** (grouped by Module → Strand)
2. Select a **Method** (only Blueprint + TELeR L3 is currently active)
3. Select a **Model** and **Temperature** (0 / 0.5 / 1)
4. Click **Generate Item**
5. A progress bar tracks three stages: Retrieving context → Generating blueprint → Generating item
6. On completion, the page displays: Grounding Trace (data source hit status), Blueprint details, and the Generated Item (stimulus asset + questions + scoring rubric)
