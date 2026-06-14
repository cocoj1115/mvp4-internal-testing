import type { ContextPack, Blueprint } from "./types";
import { getABCPriors, getRubrics } from "./data";

// ── Blueprint prompt ──────────────────────────────────────────────────────────

export function buildBlueprintPrompt(ctx: ContextPack): {
  system: string;
  user: string;
} {
  const system = [
    "You are an expert assessment designer for Pennsylvania Keystone Biology.",
    "Your task is to produce a structured blueprint for a three-part constructed-response item",
    "that integrates multiple Knowledge Components (KCs) under one STEELS standard.",
    "",
    "INSTRUCTIONS:",
    "1. Review ALL KCs listed under the target standard.",
    "2. SELECT 2 or 3 KCs that combine naturally into ONE coherent item.",
    "   Not all KCs need to be used. Choose KCs with complementary cognitive roles",
    "   that build a logical progression.",
    "3. Assign each Part (A required, B required, C optional) to exactly ONE selected KC (kc_code).",
    "   Each Part's task_type must come ONLY from the 12 taxonomy types provided.",
    "4. Ensure the parts form ONE coherent scenario with escalating cognitive demand,",
    "   each part targeting its assigned KC.",
    "5. Determine cognitive_demand from the combined KC statements (Low / Low-Mod / Moderate / High).",
    "6. key_concepts must come from the KCs' vocab and study-guide grounding — do NOT invent content.",
    "7. expected_response_elements and common_incomplete_responses must be grounded in the selected KCs",
    "   and study-guide chunks. Do NOT fabricate biology.",
    "",
    "OUTPUT: strict JSON only, no markdown, matching exactly:",
    JSON.stringify({
      target_standard: "<standard code e.g. 3.1.9-12.A>",
      integrated_kcs: ["<KC code>", "<KC code>"],
      cognitive_demand: "<Low | Low-Mod | Moderate | High>",
      key_concepts: ["<concept from selected KCs' vocab/study guide>"],
      task_sequence: {
        "Part A": { kc_code: "<one of integrated_kcs>", task_type: "<one of the 12 taxonomy types>", function: "<what this part tests>" },
        "Part B": { kc_code: "<one of integrated_kcs>", task_type: "<one of the 12 taxonomy types>", function: "<what this part tests>" },
        "Part C": { kc_code: "<one of integrated_kcs>", task_type: "<one of the 12 taxonomy types>", function: "<what this part tests>" },
      },
      evidence_pattern: "<type of stimulus or evidence the item will use>",
      expected_response_elements: ["<specific element students must include>"],
      common_incomplete_responses: ["<typical student error or omission>"],
    }),
  ].join("\n");

  const kcListSection = ctx.standardKCs
    .map(
      (kc) =>
        `  ${kc.code}: ${kc.statement}\n    Vocab: ${kc.vocab.join(", ")}`
    )
    .join("\n");

  const taxonomySection = Object.entries(ctx.taxonomyRows)
    .map(([name, entry]) =>
      `TYPE: ${name}\nDefinition: ${entry.definition}\nScaffolding: ${entry.scaffolding}`
    )
    .join("\n\n");

  const priors = getABCPriors();
  const priorSeqSection = priors
    .map(
      (p) =>
        `${p.item}: ${p.sequence.map((t, i) => `${["A", "B", "C"][i]}=${t}`).join(" → ")}`
    )
    .join("\n");

  const priorSection = ctx.relatedCards
    .map((c) =>
      [
        `Card ${c.card_id} | Part ${c.part} | item: ${c.item_id}`,
        `primary_type: ${c.primary_type} | secondary_type: ${c.secondary_type}`,
        `evidence_demand: ${c.evidence_demand} | cognitive_demand: ${c.cognitive_demand || "—"}`,
        `Prompt: ${c.prompt}`,
      ].join("\n")
    )
    .join("\n---\n");

  const studyGuideSection =
    ctx.studyGuideChunks.length > 0
      ? ctx.studyGuideChunks
          .map((c) => `[${c.chunk_id} | score=${c.score.toFixed(2)}]\n${c.text}`)
          .join("\n---\n")
      : "(No study-guide chunks retrieved above threshold — use KC statements and vocabulary only.)";

  const user = [
    "=== TARGET STANDARD ===",
    `Standard: ${ctx.standard}`,
    `KCs under this standard (${ctx.standardKCs.length} total):`,
    kcListSection,
    "",
    "=== 12 TAXONOMY TYPES (choose task_types only from these) ===",
    taxonomySection,
    "",
    "=== OBSERVED A/B/C SEQUENCES (use as prior, not fixed) ===",
    priorSeqSection || "(none)",
    "",
    "=== SIMILAR ITEM CARDS (reference for task type and evidence demand) ===",
    priorSection || "(none)",
    "",
    "=== STUDY-GUIDE GROUNDING (use to ground key_concepts and expected elements) ===",
    studyGuideSection,
    "",
    "Produce the blueprint JSON now.",
  ].join("\n");

  return { system, user };
}

// ── Item prompt ───────────────────────────────────────────────────────────────

export function buildItemPrompt(
  bp: Blueprint,
  ctx: ContextPack,
  telerLevel: number = 3
): { system: string; user: string } {
  const system = [
    "You are an expert item writer for Pennsylvania Keystone Biology Keystone exams.",
    "Generate a complete three-part constructed-response item from the provided blueprint.",
    "",
    "ITEM WRITING RULES:",
    "1. Stem must set the biological context without giving away the answers.",
    "2. Choose ONE stimulus asset type that best fits the evidence_pattern from the blueprint:",
    "   - 'table': numerical or comparative data → provide table_markdown (GFM format)",
    "   - 'line_graph': trend over time/continuous variable → provide chart_data",
    "   - 'bar_chart': comparing discrete categories → provide chart_data",
    "   - 'diagram': structure, cycle, or process that must be described textually → provide diagram_spec",
    "   - 'illustration': requires a realistic image (organism, habitat, cell) → provide illustration_prompt",
    "   - 'none': purely textual item, no visual asset needed",
    "   Always set caption (1-2 sentences describing the asset, even for 'none').",
    "   Only populate the field matching the type; leave others absent.",
    "3. Each part question must match its task_type and target the KC assigned in the blueprint (kc_code).",
    "4. Write ONE holistic 0-3 rubric for the whole item. The 3-point level lists three bullets (one per",
    "   part) joined by AND; 2 = two bullets; 1 = one bullet; 0 = insufficient. Match the exact style of the anchors.",
    "5. Do NOT reveal expected answers in the stem, stimulus asset, or part questions.",
    "6. Ground all scientific content in the study-guide chunks and key concepts provided.",
    "   Do NOT invent biology outside those sources.",
    "",
    "OUTPUT: strict JSON only, no markdown wrapper, matching exactly:",
    JSON.stringify({
      stem: "<biological context sentence(s)>",
      stimulus_asset: {
        type: "<table|line_graph|bar_chart|diagram|illustration|none>",
        caption: "<1-2 sentence description of the asset>",
        table_markdown: "<GFM table string — only when type=table, else omit>",
        chart_data: {
          x_label: "<axis label>",
          y_label: "<axis label>",
          series: [{ name: "<series name>", points: [["<x>", "<y>"]] }],
        },
        diagram_spec: "<textual description of diagram — only when type=diagram, else omit>",
        illustration_prompt: "<DALL-E prompt string — only when type=illustration, else omit>",
      },
      parts: {
        "Part A": { task_type: "<from blueprint>", question: "<student-facing question>" },
        "Part B": { task_type: "<from blueprint>", question: "<student-facing question>" },
        "Part C": { task_type: "<from blueprint>", question: "<student-facing question>" },
      },
      scoring_rubric: {
        points_possible: 3,
        "3": "Thorough — by ALL of: [bullet A] AND [bullet B] AND [bullet C]",
        "2": "Partial — fulfilling TWO of the bullets",
        "1": "Minimal — fulfilling ONE of the bullets",
        "0": "Insufficient evidence",
      },
    }),
  ].join("\n");

  const studyGuideSection =
    ctx.studyGuideChunks.length > 0
      ? ctx.studyGuideChunks
          .map((c) => `[${c.chunk_id}]\n${c.text}`)
          .join("\n---\n")
      : "(No study-guide chunks above threshold — use KC statements and key concepts only.)";

  const rubricAnchors = [
    `GENERAL RUBRIC FRAMEWORK:\n${getRubrics().general}`,
    ...ctx.relevantRubrics.map(
      (r) =>
        `STYLE ANCHOR — ${r.item} (${r.alignment}, DOK ${r.dok}):\n${r.scoring_guideline}`
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

  const partLines = (["Part A", "Part B", "Part C"] as const)
    .filter((p) => bp.task_sequence[p])
    .map((p) => {
      const part = bp.task_sequence[p]!;
      return `${p}: [${part.kc_code}] ${part.task_type} — ${part.function}`;
    })
    .join("\n");

  const user = [
    "=== BLUEPRINT ===",
    JSON.stringify(bp, null, 2),
    "",
    "=== KEY CONCEPTS (ground item content here) ===",
    bp.key_concepts.join(", "),
    "",
    "=== TASK SEQUENCE (kc_code → task_type — function) ===",
    partLines,
    "",
    "=== EVIDENCE PATTERN ===",
    bp.evidence_pattern,
    "",
    telerLevel >= 4
      ? `=== EXPECTED RESPONSE ELEMENTS (TELeR L${telerLevel}) ===\n${bp.expected_response_elements.join("\n")}`
      : `(TELeR L${telerLevel}: expected_response_elements NOT provided — derive scoring criteria from KC and blueprint only.)`,
    "",
    "=== RUBRIC ANCHORS (align format and bullet style) ===",
    rubricAnchors,
    "",
    "=== STUDY-GUIDE GROUNDING ===",
    studyGuideSection,
    "",
    "Generate the item JSON now.",
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  return { system, user };
}
