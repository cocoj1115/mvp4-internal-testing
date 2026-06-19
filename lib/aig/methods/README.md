# AIG Method Organization

This directory groups prompt construction and method-specific assets for AIG question generation.

## Method 1: Simple Direct

UI label: `Simple Direct`

Code:
- `method1-simple-direct.ts`

Data:
- `data/aig/generation_rules.txt`
- `data/aig/exemplars.json`

Flow:
1. Read Keystone SAQ generation rules.
2. Select up to 2 relevant official sampler exemplars by exact standard first, then same module.
3. Pass selected standard, KCs, vocabulary, stimulus constraint, rules, and exemplars to the LLM.
4. Generate the final item directly, without study-guide retrieval and without a blueprint.

Purpose:
- Baseline method for testing how far a rules-driven direct prompt can go.

## Method 2: Blueprint + TELeR L3

UI label: `Blueprint + TELeR L3`

Code:
- `method2-blueprint-rag.ts`

Data:
- `data/aig/kc_table.csv`
- `data/aig/standards.json`
- `data/aig/study_guide_chunks.json`
- `data/aig/rubrics.json`
- `data/aig/taxonomy_and_cards.json`

Flow:
1. Retrieve context for the selected standard.
2. Ask the LLM to create a blueprint.
3. Ask the LLM to generate the final item from the blueprint.

Purpose:
- Current grounded planning method.

## Shared Runtime

Runtime orchestration, validation, method registry, style check, and retry loop currently live in:
- `lib/aig/pipeline.ts`

Thin compatibility exports live in:
- `lib/aig/prompts.ts`

Shared helpers for stimulus labels and AIG data-file loading live in:
- `common.ts`

## Style Check / Retry

Style check and retry are not tied to one generation method. They are common runtime options that can be applied to any method from the `/aig` UI.

This keeps ablation comparisons possible:
- method without style check
- method with style check only
- method with style check and retry
