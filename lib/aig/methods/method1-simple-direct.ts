import type { AIGRunOptions, AIGStimulusType, ContextPack } from "../types";
import {
  forcedStimulusInstruction,
  notebookStimulusLabel,
  readAigJsonFile,
  readAigTextFile,
} from "./common";

interface KeystoneExemplar {
  id: string;
  standard_code: string;
  module: string;
  stimulus_type: string;
  biological_context: string;
  source: string;
  question: string;
  parts: {
    a: string;
    b: string;
    c?: string;
  };
  notes?: string;
}

let _generationRules: string | null = null;
let _exemplars: KeystoneExemplar[] | null = null;

function getGenerationRules(): string {
  return (_generationRules ??= readAigTextFile("generation_rules.txt"));
}

function getExemplars(): KeystoneExemplar[] {
  return (_exemplars ??= readAigJsonFile<KeystoneExemplar[]>("exemplars.json"));
}

function normalizeModule(module: string | undefined): string {
  if (!module) return "";
  return module.replace(/^Module\s+/i, "").trim().slice(-1).toUpperCase();
}

function exemplarStimulusMatches(exemplarType: string, stimulusType: AIGStimulusType): boolean {
  if (stimulusType === "auto") return false;
  const expected = notebookStimulusLabel(stimulusType);
  if (stimulusType === "scenario") {
    return exemplarType === "SCENARIO" || exemplarType === "TEXT";
  }
  if (stimulusType === "line_graph" || stimulusType === "bar_chart") {
    return exemplarType === expected || exemplarType === "CHART";
  }
  return exemplarType === expected;
}

function getRelevantExemplars(
  standardCode: string,
  module: string,
  stimulusType: AIGStimulusType,
  maxExemplars = 2
): KeystoneExemplar[] {
  const exemplars = getExemplars();
  const normalizedModule = normalizeModule(module);
  const exact = exemplars.filter((e) => e.standard_code === standardCode);
  const sameModule = exemplars.filter(
    (e) => e.standard_code !== standardCode && normalizeModule(e.module) === normalizedModule
  );
  const candidates = [...exact, ...sameModule].slice(0, maxExemplars);
  return candidates.sort((a, b) => {
    const aMatch = exemplarStimulusMatches(a.stimulus_type, stimulusType) ? 1 : 0;
    const bMatch = exemplarStimulusMatches(b.stimulus_type, stimulusType) ? 1 : 0;
    return aMatch - bMatch;
  });
}

function formatExemplarsForPrompt(exemplars: KeystoneExemplar[]): string {
  if (exemplars.length === 0) return "";
  const lines = [
    "",
    "REFERENCE EXAMPLES FROM OFFICIAL KEYSTONE SAMPLERS",
    "Study the structure, tone, stimulus format, and DOK progression carefully.",
    "Your generated question should match this style without copying the scenario.",
    "",
  ];
  exemplars.forEach((ex, i) => {
    lines.push(`EXAMPLE ${i + 1} (${ex.standard_code} | ${ex.biological_context})`);
    lines.push(`Stimulus: ${ex.stimulus_type} | Source: ${ex.source}`);
    lines.push("");
    lines.push(ex.question);
    lines.push("");
    lines.push(`  Part A: ${ex.parts.a}`);
    lines.push(`  Part B: ${ex.parts.b}`);
    if (ex.parts.c) lines.push(`  Part C: ${ex.parts.c}`);
    if (ex.notes) lines.push(`  Note: ${ex.notes}`);
    lines.push("");
  });
  return lines.join("\n");
}

export function buildKeystoneDirectPrompt(
  ctx: Pick<ContextPack, "standard" | "standardKCs">,
  options: AIGRunOptions
): { system: string; user: string } {
  const moduleCode = normalizeModule(ctx.standardKCs[0]?.module);
  const exemplars = getRelevantExemplars(ctx.standard, moduleCode, options.stimulusType);
  const exemplarSection = formatExemplarsForPrompt(exemplars);
  const kcLines = ctx.standardKCs
    .map((kc) => `  - ${kc.code} (${kc.kcId}): ${kc.statement}\n    Vocabulary: ${kc.vocab.join(", ")}`)
    .join("\n");
  const fixedAnchorKC = options.fixedCoreKC
    ? ctx.standardKCs.find((kc) => kc.code === options.fixedCoreKC)
    : undefined;
  const fixedAnchorSection = fixedAnchorKC
    ? [
        `Preselected anchor KC: ${fixedAnchorKC.code}`,
        `Statement: ${fixedAnchorKC.statement}`,
        `Vocabulary: ${fixedAnchorKC.vocab.join(", ") || "(none)"}`,
        "The JSON anchor_kc value must exactly match this preselected anchor KC.",
      ].join("\n")
    : "No preselected anchor KC. Select one anchor_kc from the KC list below.";
  const vocab = Array.from(new Set(ctx.standardKCs.flatMap((kc) => kc.vocab))).join(", ");

  const schema = {
    target_standard: "<same PA STEELS standard code provided in the request>",
    anchor_kc: "<preselected anchor KC code; must be used in at least one part>",
    core_kc: "<same value as anchor_kc, included for backward compatibility>",
    selected_kcs: ["<all unique KC codes assigned to Part A/B/C; max 3 total>"],
    supporting_kcs: ["<optional non-anchor KC codes assigned to at least one part; max 2>"],
    part_kcs: {
      "Part A": "<one KC code from selected_kcs>",
      "Part B": "<one KC code from selected_kcs>",
      "Part C": "<one KC code from selected_kcs>",
    },
    stem_affordance: "<brief description of the shared context/stimulus that makes these part KCs cohere>",
    compatibility_rationale: "<brief reason the assigned KCs work naturally with one shared stem/stimulus>",
    stem: "<brief setup sentence(s) that introduce the task without giving away answers>",
    stimulus_asset: {
      type: "<table|line_graph|bar_chart|diagram|scenario|illustration|none>",
      title: "<short Keystone-style figure title, 2-8 words>",
      table_markdown: "<only when type=table>",
      chart_data: {
        x_label: "<axis label>",
        y_label: "<axis label>",
        series: [{ name: "<series name>", points: [["<x>", 0]] }],
      },
      diagram_spec: "<complete SVG string — only when type=diagram>",
      scenario_text: "<only when type=scenario>",
      illustration_prompt: "<only when type=illustration>",
    },
    parts: {
      "Part A": { task_type: "DOK 1-2 identify/describe", question: "<Part A question>" },
      "Part B": { task_type: "DOK 2 mechanism/evidence", question: "<Part B question>" },
      "Part C": { task_type: "DOK 3 prediction/justification", question: "<Part C question>" },
    },
    scoring_rubric: {
      points_possible: 3,
      "3": "Thorough — by ALL of: actual Part A biology criterion AND actual Part B biology criterion AND actual Part C biology criterion",
      "2": "Partial — fulfilling any two of those actual biology criteria",
      "1": "Minimal — fulfilling one actual biology criterion",
      "0": "Insufficient evidence",
    },
    part_rubrics: {
      "Part A": {
        points_possible: 1,
        criteria: {
          "1": "Concrete Part A credit criterion",
          "0": "No credit criterion",
        },
      },
      "Part B": {
        points_possible: 1,
        criteria: {
          "1": "Concrete Part B credit criterion",
          "0": "No credit criterion",
        },
      },
      "Part C": {
        points_possible: 1,
        criteria: {
          "1": "Concrete Part C credit criterion",
          "0": "No credit criterion",
        },
      },
    },
    annotated_responses: [
      { score: 3, response: "Full-credit sample student response", annotation: "Why it earns 3 points" },
      { score: 2, response: "Two-point sample student response", annotation: "Why it earns 2 points" },
      { score: 1, response: "One-point sample student response", annotation: "Why it earns 1 point" },
      { score: 0, response: "Zero-point sample student response", annotation: "Why it earns 0 points" },
    ],
  };

  const user = [
    getGenerationRules(),
    exemplarSection,
    "",
    "GENERATION REQUEST",
    "Generate ONE Pennsylvania Keystone Biology short-answer question aligned to:",
    `PA STEELS Standard: ${ctx.standard}`,
    `Module: ${moduleCode}`,
    "",
    "Before writing the item, assign a KC to each part explicitly:",
    "  - Use only the Knowledge Components listed below.",
    "  - Use the preselected anchor KC below in at least one of Part A, Part B, or Part C.",
    "  - Assign exactly one KC code to each part in part_kcs.",
    "  - It is acceptable for multiple parts to use the same KC.",
    "  - It is acceptable for all parts to use the same KC.",
    "  - If you assign non-anchor KCs, use at most two additional KCs.",
    "  - All selected KCs must work naturally with one shared stem/stimulus.",
    "  - Do not assign a KC to a part unless that part can be directly assessed from the same item context.",
    "  - When assigning KCs to parts, preserve the A/B/C progression: Part A should target an entry point that can be assessed with a focused, convergent response; Part B should target a mechanism, relationship, or explanation; Part C should target transfer, prediction, evidence, design, or evaluation when the selected KCs support it.",
    "  - Return the full KC code shown before the parentheses, not the short local ID in parentheses.",
    "  - Example: return '3.1.9-12.B4', not 'B4'.",
    "  - Set core_kc to the same value as anchor_kc for backward compatibility.",
    "  - Set selected_kcs to the unique KC codes used in part_kcs.",
    "  - Set supporting_kcs to the non-anchor KC codes used in part_kcs, if any.",
    "",
    "Preselected Anchor KC:",
    fixedAnchorSection,
    "",
    "Knowledge Components in scope:",
    kcLines,
    "",
    `Key Vocabulary: ${vocab}`,
    "",
    `Required Stimulus: ${options.stimulusType === "auto" ? "AUTO" : notebookStimulusLabel(options.stimulusType)}`,
    `Stimulus constraint: ${forcedStimulusInstruction(options)}`,
    "For every stimulus type except 'none', provide a short stimulus_asset.title in Keystone style.",
    "The title should be a concise noun phrase such as 'Heart Rate of a Black Bear', 'Seed Production', or 'Investigation Setup'.",
    "Visual style for all stimuli must match Pennsylvania Keystone exam figures:",
    "  - black, white, and gray only; no color",
    "  - clean textbook/worksheet look",
    "  - no decorative gradients, shadows, or artistic backgrounds",
    "  - simple labels and high contrast",
    "Scoring rubric requirement:",
    "  - Replace all rubric template text with concrete content specific to this item.",
    "  - Do NOT leave placeholders such as [Part A concept], [Part B concept], [Part C concept], [bullet A], or angle-bracket template text.",
    "  - The rubric must describe the actual biology ideas required for credit.",
    "  - The 3-point rubric must explicitly name the actual Part A, Part B, and Part C credit criteria.",
    "  - Also write part_rubrics for each generated part. The points_possible values must sum to 3.",
    "  - Provide annotated_responses for total scores 0, 1, 2, and 3. Each annotation must explain why the sample earns that score.",
    "  - The scoring_rubric strings in the schema below are format examples only; do not copy them verbatim.",
    "Use a specific, plausible biology context when possible; avoid generic textbook-only scenarios if a concrete investigation or organism/system context preserves alignment.",
    "If type='diagram', diagram_spec MUST be a complete inline SVG string, not prose.",
    "For diagram SVG output:",
    "  - Start with <svg width='540' height='320' xmlns='http://www.w3.org/2000/svg'>.",
    "  - Do NOT include the title text inside the SVG; the app renders the title above the figure.",
    "  - Use black, white, and gray only. No colored fills or colored strokes.",
    "  - Use only simple shapes: <rect>, <circle>, <ellipse>, <line>, <path>, <polygon>, <text>, <tspan>, <marker>.",
    "  - Add a clear viewBox-compatible layout within x in [10,530] and y in [10,310].",
    "  - Keep nodes at least 80px apart center-to-center.",
    "  - Center each text label inside its shape using text-anchor='middle' and dominant-baseline='middle'.",
    "  - For labels longer than 12 characters, split into two lines with <tspan> instead of letting text overflow.",
    "  - Use rectangles or ellipses for multi-word labels. Avoid circles for long labels.",
    "  - Arrow lines must begin and end outside the node border, with arrowheads visible.",
    "  - Do NOT include free-floating annotation text unless it is placed outside the main shape and does not overlap any label.",
    "  - Do NOT include markdown fences, explanations, or any text before/after the SVG markup.",
    "If type='illustration', write a precise image generation prompt in illustration_prompt. The app will automatically send that prompt to the image generation model.",
    "  - The illustration must look like a Keystone exam figure: black-and-white textbook diagram, plain white background, minimal shading, no color.",
    "  - Do NOT include a title inside the generated image; the app renders the title above the figure.",
    "If type='line_graph' or type='bar_chart', the data should support a monochrome graph with a single clear title and simple axis labels.",
    "If type='table', choose short column headers and values that fit a plain black-and-white worksheet table.",
    options.revisionInstructions
      ? `\nREVISION REQUIRED - PREVIOUS ATTEMPT FAILED STYLE CHECK\n${options.revisionInstructions}`
      : "",
    "",
    "Return strict JSON matching this schema. Do not include markdown fences.",
    JSON.stringify(schema, null, 2),
  ]
    .filter((line) => line !== "")
    .join("\n");

  return {
    system: "You are a Keystone Biology assessment writer. Always respond with valid JSON only.",
    user,
  };
}
