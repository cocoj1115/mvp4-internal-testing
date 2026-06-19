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
    .map((kc) => `  - ${kc.kcId}: ${kc.statement}\n    Vocabulary: ${kc.vocab.join(", ")}`)
    .join("\n");
  const vocab = Array.from(new Set(ctx.standardKCs.flatMap((kc) => kc.vocab))).join(", ");

  const schema = {
    stem: "<brief setup sentence(s) that introduce the task without giving away answers>",
    stimulus_asset: {
      type: "<table|line_graph|bar_chart|diagram|scenario|illustration|none>",
      caption: "<1-2 sentence description of the stimulus>",
      table_markdown: "<only when type=table>",
      chart_data: {
        x_label: "<axis label>",
        y_label: "<axis label>",
        series: [{ name: "<series name>", points: [["<x>", 0]] }],
      },
      diagram_spec: "<only when type=diagram>",
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
      "3": "Thorough — by ALL of: [Part A concept] AND [Part B concept] AND [Part C concept]",
      "2": "Partial — fulfilling TWO of the bullets",
      "1": "Minimal — fulfilling ONE of the bullets",
      "0": "Insufficient evidence",
    },
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
    "Knowledge Components in scope:",
    kcLines,
    "",
    `Key Vocabulary: ${vocab}`,
    "",
    `Required Stimulus: ${options.stimulusType === "auto" ? "AUTO" : notebookStimulusLabel(options.stimulusType)}`,
    `Stimulus constraint: ${forcedStimulusInstruction(options)}`,
    "If type='diagram', write a text-only diagram specification in diagram_spec. It will be displayed as a diagram spec, not converted into an image.",
    "If type='illustration', write a precise image generation prompt in illustration_prompt. The app will automatically send that prompt to the image generation model.",
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
