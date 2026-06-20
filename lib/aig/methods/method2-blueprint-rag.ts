import type { AIGRunOptions, ContextPack, Blueprint } from "../types";
import { getABCPriors, getRubrics, getWholeItems } from "../data";
import { forcedStimulusInstruction } from "./common";

function vocabOverlap(text: string, vocab: string[]): number {
  const lower = text.toLowerCase();
  return vocab.filter((v) => lower.includes(v.toLowerCase())).length;
}

export function buildBlueprintPrompt(
  ctx: ContextPack,
  options?: AIGRunOptions
): {
  system: string;
  user: string;
} {
  const system = [
    "You are an expert assessment designer for Pennsylvania Keystone Biology.",
    "Your task is to produce a blueprint for a constructed-response item that explores ONE core",
    "Knowledge Component (KC) in depth — exactly as real Keystone sample items do.",
    "",
    "INSTRUCTIONS:",
    "1. Review ALL KCs listed under the target standard.",
    "2. SELECT ONE core KC to explore in depth across all parts (core_kc).",
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
    "11. EVERY top-level schema key is mandatory. Never omit any field shown in the JSON schema.",
    "12. evidence_pattern is required on every response. It should briefly name the planned stimulus/evidence form,",
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
      evidence_pattern: "<type of stimulus or evidence the item will use>",
      expected_response_elements: ["<specific element students must include>"],
      common_incomplete_responses: ["<typical student error or omission>"],
    }),
  ].join("\n");

  const kcListSection = ctx.standardKCs
    .map((kc) => `  ${kc.code}: ${kc.statement}\n    Vocab: ${kc.vocab.join(", ")}`)
    .join("\n");

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

  const combinedVocab = ctx.standardKCs.flatMap((kc) => kc.vocab);
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
    "2. Choose ONE stimulus asset type that best fits the evidence_pattern from the blueprint:",
    "   For every stimulus type except 'none', provide stimulus_asset.title as a short Keystone-style figure title.",
    "   The title should be a concise noun phrase such as 'Investigation Setup', 'Seed Production', or 'Heart Rate of a Black Bear'.",
    "   All stimuli must use a black-and-white worksheet style: black, white, and gray only, no color, no decorative gradients, no shadows.",
    "   - 'table': numerical or comparative data -> provide table_markdown (GFM format)",
    "   - 'line_graph': trend over time/continuous variable -> provide chart_data",
    "   - 'bar_chart': comparing discrete categories -> provide chart_data",
    "   - 'scenario': a text-only stimulus with named organisms, conditions, and concrete observations -> provide scenario_text",
    "   - 'diagram': simple flowchart, cycle, or molecular/pathway schematic that can be drawn",
    "     with basic shapes and arrows -> provide diagram_spec as a complete SVG string.",
    "     Use ONLY when the structure is simple enough to represent clearly with boxes/circles/arrows.",
    "     Start with <svg width='540' height='320' xmlns='http://www.w3.org/2000/svg'>.",
    "     The SVG must be self-contained and valid with no prose before or after it.",
    "     Do NOT include the title text inside the SVG; the app renders the title above the figure.",
    "     Use black, white, and gray only. No colored fills or colored strokes.",
    "     Use <rect>, <circle>, <path>, <line>, <polygon>, <text>, and <marker> for arrows.",
    "     Do NOT include <script> or event handlers.",
    "     LAYOUT RULES — strictly follow to avoid overlapping elements:",
    "       • Keep all elements within x in [10,530] and y in [10,310]. Never place anything outside this.",
    "       • Space nodes at least 80px apart center-to-center. For a 3-node horizontal flow,",
    "         use x=90, x=270, x=450; for vertical, y=60, y=160, y=260.",
    "       • Place each text label at the CENTER of its shape: for <rect x='60' y='40' width='80' height='36'>,",
    "         put <text x='100' y='62' text-anchor='middle' dominant-baseline='middle'>.",
    "       • Keep each node label to one short phrase. If it exceeds 12 characters, split it into two <tspan> lines.",
    "       • Use rectangles or ellipses for multi-word labels. Avoid circles for long labels.",
    "       • Arrow lines must start and end OUTSIDE the shape border, not at the center.",
    "         End the line 6px before the shape edge so the arrowhead is visible.",
    "       • Do not stack text on top of shapes of a different element. If a label is long,",
    "         break it into two <tspan> lines with dy='1.2em' for the second.",
    "       • Do not place explanatory annotations inside a node unless they are part of the node label.",
    "         Put side notes outside the node, or omit them if they cause crowding.",
    "     Example arrow marker: <defs><marker id='a' markerWidth='8' markerHeight='6' refX='8' refY='3' orient='auto'><polygon points='0 0,8 3,0 6' fill='#374151'/></marker></defs>",
    "     then use marker-end='url(#a)' on <line> or <path> elements.",
    "   - 'illustration': use for ANY complex biological image — cell structures, organelles,",
    "     organisms, tissues, habitats, realistic molecular models, anything that requires",
    "     visual detail beyond simple shapes -> provide illustration_prompt. The app will automatically",
    "     send this prompt to the image generation model.",
    "     The illustration prompt must explicitly request a black-and-white exam figure on a plain white background.",
    "     Do NOT include a title inside the image; the app renders the title above the figure.",
    "   - 'none': purely textual item, no visual asset needed",
    "   Only populate the field matching the type; leave others absent.",
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
    "6. Do NOT reveal expected answers in the stem, stimulus asset, or part questions.",
    "7. Ground all scientific content in the study-guide chunks and key concepts provided.",
    "   Do NOT invent biology outside those sources.",
    `8. Stimulus constraint: ${forcedStimulusInstruction(options)}`,
    options?.revisionInstructions
      ? `9. Revision instructions from style check: ${options.revisionInstructions}`
      : "",
    "",
    "OUTPUT: strict JSON only, no markdown wrapper, matching exactly:",
    JSON.stringify({
      stem: "<biological context sentence(s)>",
      stimulus_asset: {
        type: "<table|line_graph|bar_chart|diagram|scenario|illustration|none>",
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
    "=== STIMULUS CONSTRAINT ===",
    forcedStimulusInstruction(options),
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
