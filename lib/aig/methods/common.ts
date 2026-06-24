import fs from "fs";
import path from "path";
import type { AIGRunOptions, AIGStimulusType } from "../types";

export function stimulusLabel(stimulusType: AIGStimulusType): string {
  const labels: Record<AIGStimulusType, string> = {
    auto: "auto",
    table: "table",
    line_graph: "line graph",
    bar_chart: "bar graph",
    diagram: "diagram",
    scenario: "scenario description",
    illustration: "illustration",
    none: "none",
  };
  return labels[stimulusType];
}

export function notebookStimulusLabel(stimulusType: AIGStimulusType): string {
  const labels: Record<AIGStimulusType, string> = {
    auto: "AUTO",
    table: "DATA_TABLE",
    line_graph: "LINE_GRAPH",
    bar_chart: "BAR_GRAPH",
    diagram: "DIAGRAM",
    scenario: "SCENARIO",
    illustration: "ILLUSTRATION",
    none: "NONE",
  };
  return labels[stimulusType];
}

export function forcedStimulusInstruction(options?: AIGRunOptions): string {
  if (!options || options.stimulusType === "auto") {
    return "Use the stimulus type preselected by the app. Do not use 'none'.";
  }
  return `You MUST use stimulus type "${stimulusLabel(options.stimulusType)}". Do not choose a different stimulus type.`;
}

export function aigDataPath(filename: string): string {
  return path.join(process.cwd(), "data", "aig", filename);
}

export function readAigTextFile(filename: string): string {
  return fs.readFileSync(aigDataPath(filename), "utf-8");
}

export function readAigJsonFile<T>(filename: string): T {
  return JSON.parse(readAigTextFile(filename)) as T;
}
