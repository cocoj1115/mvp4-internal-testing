import type { AIGRunOptions, ContextPack, Blueprint } from "../types";
import { getABCPriors, getRubrics, getWholeItems } from "../data";
import { forcedStimulusInstruction } from "./common";

function vocabOverlap(text: string, vocab: string[]): number {
  const lower = text.toLowerCase();
  return vocab.filter((v) => lower.includes(v.toLowerCase())).length;
}

const STIMULUS_SELECTION_CRITERIA = [
  "Stimulus selection criteria:",
  "  - table: use when exact condition/value data are central to the reasoning.",
  "  - line_graph: use when a trend over time, dose, temperature, or another continuous variable is central.",
  "  - bar_chart: use when comparing discrete groups, categories, treatments, or conditions is central.",
  "  - scenario: use only when graph, table, diagram, and illustration would be unnatural or unnecessary.",
  "  - diagram: use only when labeled structure, spatial relationship, process flow, or arrows are essential.",
  "  - illustration: use when complex biological visual detail is needed beyond simple SVG shapes.",
  "Do not default to scenario or diagram. Prefer table/graph when quantitative evidence would naturally support the task.",
];

function stimulusGenerationRules(type: Blueprint["stimulus_type"]): string[] {
  const common = [
    "For every stimulus type except 'none', provide stimulus_asset.title as a short Keystone-style figure title.",
    "The title should be a concise noun phrase such as 'Investigation Setup', 'Seed Production', or 'Heart Rate of a Black Bear'.",
    "All stimuli must use a black-and-white worksheet style: black, white, and gray only, no color, no decorative gradients, no shadows.",
    `Use exactly stimulus_asset.type="${type}". Do not choose a different stimulus type.`,
  ];

  if (type === "table") {
    return [
      ...common,
      "Provide table_markdown as a GFM table with concise column headers and specific values.",
      "Use table when condition/value data or categorical measurements are the evidence students should cite.",
      "Only populate table_markdown; omit chart_data, diagram_spec, scenario_text, and illustration_prompt.",
    ];
  }

  if (type === "line_graph") {
    return [
      ...common,
      "Provide chart_data for a line graph with clear x_label, y_label, and at least 3 labeled points.",
      "Use line_graph for trends over time, dose, temperature, concentration, or another continuous variable.",
      "Only populate chart_data; omit table_markdown, diagram_spec, scenario_text, and illustration_prompt.",
    ];
  }

  if (type === "bar_chart") {
    return [
      ...common,
      "Provide chart_data for a bar chart comparing discrete categories, groups, treatments, or conditions.",
      "Use concise category labels and realistic numeric values.",
      "Only populate chart_data; omit table_markdown, diagram_spec, scenario_text, and illustration_prompt.",
    ];
  }

  if (type === "scenario") {
    return [
      ...common,
      "Provide scenario_text with 3-5 sentences, named organisms or context, and at least one concrete observation or measurement.",
      "Use scenario when qualitative evidence is enough and a chart/diagram would be artificial.",
      "Only populate scenario_text; omit table_markdown, chart_data, diagram_spec, and illustration_prompt.",
    ];
  }

  if (type === "diagram") {
    return [
      ...common,
      "Provide diagram_spec as a complete SVG string for a simple flowchart, cycle, structure, or pathway schematic.",
      "Use ONLY when the structure is simple enough to represent clearly with boxes/circles/arrows.",
      "Start with <svg width='540' height='320' xmlns='http://www.w3.org/2000/svg'>.",
      "The SVG must be self-contained and valid with no prose before or after it.",
      "Do NOT include the title text inside the SVG; the app renders the title above the figure.",
      "Use black, white, and gray only. No colored fills or colored strokes.",
      "Use <rect>, <circle>, <path>, <line>, <polygon>, <text>, and <marker> for arrows.",
      "Do NOT include <script> or event handlers.",
      "LAYOUT RULES - strictly follow to avoid overlapping elements:",
      "  - Keep all elements within x in [10,530] and y in [10,310]. Never place anything outside this.",
      "  - Space nodes at least 80px apart center-to-center.",
      "  - Place each text label at the CENTER of its shape using text-anchor='middle' and dominant-baseline='middle'.",
      "  - If a label exceeds 12 characters, split it into two <tspan> lines.",
      "  - Use rectangles or ellipses for multi-word labels. Avoid circles for long labels.",
      "  - Arrow lines must start and end OUTSIDE the shape border, not at the center.",
      "Only populate diagram_spec; omit table_markdown, chart_data, scenario_text, and illustration_prompt.",
    ];
  }

  if (type === "illustration") {
    return [
      ...common,
      "Provide illustration_prompt for a black-and-white Keystone exam figure on a plain white background.",
      "Use illustration for complex biological visuals such as cells, organelles, organisms, tissues, habitats, or realistic molecular models.",
      "Do NOT include a title inside the generated image; the app renders the title above the figure.",
      "Only populate illustration_prompt; omit table_markdown, chart_data, diagram_spec, and scenario_text.",
    ];
  }

  return [
    ...common,
    "Use no visual stimulus. Set stimulus_asset.type to none and provide no stimulus-specific fields.",
  ];
}

export function buildBlueprintPrompt(
  ctx: ContextPack,
  options?: AIGRunOptions
): {
  system: string;
  user: string;
} {
  const fixedStimulusType = options?.stimulusType && options.stimulusType !== "auto"
    ? options.stimulusType
    : undefined;
  const stimulusSelectionInstruction = fixedStimulusType
    ? [
        `11. Use the requested stimulus_type exactly: ${fixedStimulusType}. Do not choose a different stimulus_type.`,
      ]
    : [
        "11. Choose exactly one stimulus_type for the blueprint using the criteria below.",
        ...STIMULUS_SELECTION_CRITERIA.map((line) => `   ${line}`),
      ];

  const system = [
    "You are an expert assessment designer for Pennsylvania Keystone Biology.",
    "Your task is to produce a blueprint for a constructed-response item that explores ONE core",
    "Knowledge Component (KC) in depth — exactly as real Keystone sample items do.",
    "",
    "INSTRUCTIONS:",
    "1. Review ALL KCs listed under the target standard.",
    ctx.selectedCoreKC
      ? `2. Use the PRESELECTED core KC exactly as core_kc: ${ctx.selectedCoreKC.code}. Do not choose a different core_kc.`
      : "2. SELECT ONE core KC to explore in depth across all parts (core_kc).",
    "   Parts A/B/C probe different facets or levels of that SAME core concept — not different topics.",
    "   You may list 0–2 other KCs from the same standard as supporting_kcs if they provide genuine",
    "   background context, but do NOT devote a whole part to a separate concept.",
    "3. Decide part count: default to 3 parts (A, B, C). Use only 2 parts (A, B) only when",
    "   the core KC does not naturally support a third coherent, non-redundant part.",
    "4. Assign each part a kc_code. Default all parts to core_kc. A part may use a supporting_kc",
    "   only if it genuinely deepens the same core concept rather than pivoting to a new topic.",
    "5. DIFFICULTY RULES (use the Difficulty numbers shown per taxonomy type):",
    "   - task_type must be the exact TYPE name (e.g. 'Recall / Identify / Classify') — do NOT",
    "     append the difficulty number or any other text to the task_type value.",
    "   - Part A MUST be difficulty 1–2 (low entry point, single convergent answer).",
    "   - Difficulty must not decrease: difficulty(A) <= difficulty(B) <= difficulty(C).",
    "   - At most ONE part may be difficulty 4–5.",
    "6. SINGLE-FOCUS RULE (critical — applies to every part's function field):",
    "   - Each part's function must describe EXACTLY ONE thing the student is asked to do.",
    "   - Part A's function must name a single convergent target: one term, one substance, one structure,",
    "     one relationship (e.g. 'identify the molecule that carries the anticodon during translation').",
    "   - Do NOT write a function that chains asks with 'and', 'also', 'as well as', or a comma",
    "     that introduces a second question.",
    "   BAD: 'identify what a codon and anticodon are, and name the matching mechanism'",
    "   GOOD: 'identify the molecule that determines amino-acid order'",
    "   - Part B / Part C may describe or explain, but still about ONE mechanism or concept in depth.",
    "   BAD Part B: 'explain how transcription works and how translation differs from it'",
    "   GOOD Part B: 'explain how the anticodon ensures the correct amino acid is added'",
    "7. cognitive_demand: Low / Low-Mod / Moderate / High — from the core KC statement.",
    "8. key_concepts from core_kc vocab + study-guide grounding. Do NOT invent biology.",
    "9. expected_response_elements and common_incomplete_responses grounded in core_kc and study guide.",
    `10. Stimulus constraint: ${forcedStimulusInstruction(options)}`,
    ...stimulusSelectionInstruction,
    "12. EVERY top-level schema key is mandatory. Never omit any field shown in the JSON schema.",
    "13. evidence_pattern is required on every response. It should briefly name the planned stimulus/evidence form,",
    "    such as 'monochrome line graph of rate over time', 'black-and-white comparison table', or 'scenario with concrete observations'.",
    "",
    "OUTPUT: strict JSON only, no markdown, matching exactly:",
    JSON.stringify({
      target_standard: "<standard code e.g. 3.1.9-12.A>",
      core_kc: "<one KC code — the single concept explored in depth>",
      supporting_kcs: ["<optional: other KC codes from same standard used only as background>"],
      cognitive_demand: "<Low | Low-Mod | Moderate | High>",
      key_concepts: ["<concept from core_kc vocab/study guide>"],
      task_sequence: {
        "Part A": { kc_code: "<core_kc or supporting_kc>", task_type: "<exact TYPE name, difficulty 1-2, no annotation>", function: "<ONE single-focus target — one term/substance/structure>" },
        "Part B": { kc_code: "<core_kc or supporting_kc>", task_type: "<exact TYPE name, difficulty >= Part A, no annotation>", function: "<ONE mechanism or relationship — no 'and' chaining>" },
        "Part C": { kc_code: "<core_kc or supporting_kc>", task_type: "<exact TYPE name, difficulty >= Part B, no annotation>", function: "<ONE evaluation, prediction, or synthesis point>" },
      },
      stimulus_type: fixedStimulusType ?? "<table|line_graph|bar_chart|scenario|diagram|illustration>",
      evidence_pattern: "<type of stimulus or evidence the item will use>",
      expected_response_elements: ["<specific element students must include>"],
      common_incomplete_responses: ["<typical student error or omission>"],
    }),
  ].join("\n");

  const kcListSection = ctx.standardKCs
    .map((kc) => `  ${kc.code}: ${kc.statement}\n    Vocab: ${kc.vocab.join(", ")}`)
    .join("\n");

  const selectedCoreSection = ctx.selectedCoreKC
    ? [
        `Selected core KC: ${ctx.selectedCoreKC.code}`,
        `Statement: ${ctx.selectedCoreKC.statement}`,
        `Vocab: ${ctx.selectedCoreKC.vocab.join(", ") || "(none)"}`,
        "The blueprint JSON core_kc value must exactly match this selected core KC.",
      ].join("\n")
    : "(No preselected core KC; choose one from the list above.)";

  const taxonomySection = Object.entries(ctx.taxonomyRows)
    .sort(([, a], [, b]) => a.difficulty - b.difficulty)
    .map(([name, entry]) =>
      `TYPE: ${name}\nDifficulty: ${entry.difficulty}\nDefinition: ${entry.definition}\nScaffolding: ${entry.scaffolding}`
    )
    .join("\n\n");

  const priors = getABCPriors();
  const priorSeqSection = priors
    .map((p) => {
      const diffLabels = p.sequence.map((t) => {
        const d = ctx.taxonomyRows[t]?.difficulty ?? "?";
        return `${t} [d${d}]`;
      });
      return `${p.item}: A=${diffLabels[0] ?? "?"} -> B=${diffLabels[1] ?? "?"} -> C=${diffLabels[2] ?? "—"}`;
    })
    .join("\n");

  const combinedVocab = ctx.selectedCoreKC?.vocab.length
    ? ctx.selectedCoreKC.vocab
    : ctx.standardKCs.flatMap((kc) => kc.vocab);
  const wholeItemSection = getWholeItems()
    .map((item) => ({
      item,
      score: item.parts.reduce((s, p) => s + vocabOverlap(p.prompt, combinedVocab), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ item }) =>
      [
        `ITEM ${item.item_id} (${item.source}):`,
        ...item.parts.map(
          (p) => `  Part ${p.part} [${p.primary_type} d${p.difficulty}]: ${p.prompt}`
        ),
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
    "=== PRESELECTED CORE KC ===",
    selectedCoreSection,
    "",
    "=== 12 TAXONOMY TYPES (choose task_types only from these) ===",
    taxonomySection,
    "",
    "=== OBSERVED A/B/C SEQUENCES (use as prior, not fixed) ===",
    priorSeqSection || "(none)",
    "",
    "=== WHOLE-ITEM EXEMPLARS (observe how each real item stays on one concept and escalates difficulty) ===",
    wholeItemSection || "(none)",
    "",
    "=== STUDY-GUIDE GROUNDING (use to ground key_concepts and expected elements) ===",
    studyGuideSection,
    "",
    "=== STIMULUS CONSTRAINT ===",
    forcedStimulusInstruction(options),
    fixedStimulusType
      ? `\n=== FIXED STIMULUS TYPE ===\n${fixedStimulusType}`
      : `\n=== STIMULUS SELECTION CRITERIA ===\n${STIMULUS_SELECTION_CRITERIA.join("\n")}`,
    "",
    "Produce the blueprint JSON now.",
  ].join("\n");

  return { system, user };
}

export function buildItemPrompt(
  bp: Blueprint,
  ctx: ContextPack,
  telerLevel: number = 3,
  options?: AIGRunOptions
): { system: string; user: string } {
  const partCount = (["Part A", "Part B", "Part C"] as const).filter(
    (p) => bp.task_sequence[p]
  ).length;

  const partSchema: Record<string, { task_type: string; question: string }> = {
    "Part A": { task_type: "<from blueprint>", question: "<student-facing question>" },
    "Part B": { task_type: "<from blueprint>", question: "<student-facing question>" },
  };
  if (bp.task_sequence["Part C"]) {
    partSchema["Part C"] = { task_type: "<from blueprint>", question: "<student-facing question>" };
  }

  const rubricTemplate =
    partCount === 2
      ? {
          points_possible: 3,
          "3": "Thorough — BOTH: [bullet A] AND [bullet B]",
          "2": "Partial — fulfilling ONE of the two bullets",
          "1": "Minimal — partially addressing one bullet",
          "0": "Insufficient evidence",
        }
      : {
          points_possible: 3,
          "3": "Thorough — by ALL of: [bullet A] AND [bullet B] AND [bullet C]",
          "2": "Partial — fulfilling TWO of the bullets",
          "1": "Minimal — fulfilling ONE of the bullets",
          "0": "Insufficient evidence",
        };

  const system = [
    "You are an expert item writer for Pennsylvania Keystone Biology Keystone exams.",
    `Generate a ${partCount}-part constructed-response item from the provided blueprint.`,
    "",
    "ITEM WRITING RULES:",
    "1. Stem must set the biological context without giving away the answers.",
    `2. Use the blueprint stimulus_type exactly: ${bp.stimulus_type}.`,
    ...stimulusGenerationRules(bp.stimulus_type).map((line) => `   ${line}`),
    "3. SINGLE-FOCUS RULE (critical — strictly enforced):",
    "   Each part asks for EXACTLY ONE thing. The student's answer converges on a single concept,",
    "   term, mechanism, or relationship. Do NOT chain sub-questions with 'and', 'also',",
    "   'as well as', or commas that introduce a second question.",
    "   - Part A must have a single convergent answer (one term / one substance / one structure).",
    "   - Part B / Part C may use 'describe', 'explain', or 'give an example', but still about",
    "     ONE core point. Describing one mechanism in depth is fine; asking about two different",
    "     mechanisms in one part is not.",
    "   Each part probes a different facet of the SAME core concept — do not pivot topics.",
    "4. Each part question must match its task_type and target the KC assigned in the blueprint (kc_code).",
    `5. Write ONE holistic 0-3 rubric for the whole item. The 3-point level lists ${partCount} bullets`,
    `   (one per part) joined by AND; 2 = ${partCount === 2 ? "ONE bullet (partial)" : "two bullets"}; 1 = ${partCount === 2 ? "partially addresses one bullet" : "one bullet"}; 0 = insufficient.`,
    "   Match the exact style of the anchors.",
    "   IMPORTANT: the rubricTemplate shown in the schema is only a shape guide.",
    "   You must replace every placeholder with concrete biology-specific credit criteria for THIS item.",
    "   Do NOT output [bullet A], [bullet B], [bullet C], [Part A concept], or any other unresolved template text.",
    "6. Do NOT reveal expected answers in the stem, stimulus asset, or part questions.",
    "7. Ground all scientific content in the study-guide chunks and key concepts provided.",
    "   Do NOT invent biology outside those sources.",
    `8. Stimulus type is fixed by the blueprint: ${bp.stimulus_type}.`,
    options?.revisionInstructions
      ? `9. Revision instructions from style check: ${options.revisionInstructions}`
      : "",
    "",
    "OUTPUT: strict JSON only, no markdown wrapper, matching exactly:",
    JSON.stringify({
      stem: "<biological context sentence(s)>",
      stimulus_asset: {
        type: bp.stimulus_type,
        title: "<short Keystone-style figure title, 2-8 words>",
        table_markdown: "<GFM table string — only when type=table, else omit>",
        chart_data: {
          x_label: "<axis label>",
          y_label: "<axis label>",
          series: [{ name: "<series name>", points: [["<x>", "<y>"]] }],
        },
        diagram_spec: "<complete SVG string — only when type=diagram, else omit>",
        scenario_text: "<scenario stimulus text — only when type=scenario, else omit>",
        illustration_prompt: "<image-generation prompt string — only when type=illustration, else omit>",
      },
      parts: partSchema,
      scoring_rubric: rubricTemplate,
    }),
  ].join("\n");

  const studyGuideSection =
    ctx.studyGuideChunks.length > 0
      ? ctx.studyGuideChunks.map((c) => `[${c.chunk_id}]\n${c.text}`).join("\n---\n")
      : "(No study-guide chunks above threshold — use KC statements and key concepts only.)";

  const rubricAnchors = [
    `GENERAL RUBRIC FRAMEWORK:\n${getRubrics().general}`,
    ...ctx.relevantRubrics.map(
      (r) => `STYLE ANCHOR — ${r.item} (${r.alignment}, DOK ${r.dok}):\n${r.scoring_guideline}`
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
    "=== TASK SEQUENCE (kc_code -> task_type — function) ===",
    partLines,
    "",
    "=== EVIDENCE PATTERN ===",
    bp.evidence_pattern,
    "",
    "=== FIXED STIMULUS TYPE ===",
    bp.stimulus_type,
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
    options?.revisionInstructions
      ? `=== REVISION INSTRUCTIONS ===\n${options.revisionInstructions}\n`
      : "",
    "Generate the item JSON now.",
  ]
    .filter((line) => line !== undefined)
    .filter((line) => line !== "")
    .join("\n");

  return { system, user };
}
