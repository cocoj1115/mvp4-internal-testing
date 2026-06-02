import gstarA from "@/data/G_star_3.1.9-12.A.json";
import gstarC from "@/data/G_star_3.1.9-12.C.json";
import gstarP from "@/data/G_star_3.1.9-12.P.json";
import gstarN from "@/data/G_star_3.1.9-12.N.json";

export interface GStarPart {
  key_concept: string;
  scoring_rubric: string;
  adaptation_rules: string;
}

export interface GStarFile {
  standard: string;
  item: string;
  question_stem: string;
  part_a: GStarPart | null;
  part_b: GStarPart | null;
  part_c: GStarPart | null;
  metadata: Record<string, unknown>;
}

const GSTAR_MAP: Record<string, GStarFile> = {
  "3.1.9-12.A": gstarA as GStarFile,
  "3.1.9-12.C": gstarC as GStarFile,
  "3.1.9-12.P": gstarP as GStarFile,
  "3.1.9-12.N": gstarN as GStarFile,
};

export function getGStar(standard: string): GStarFile | null {
  return GSTAR_MAP[standard] ?? null;
}

export function getAdaptationRules(
  standard: string,
  partLabel: "A" | "B" | "C"
): string | null {
  const gstar = getGStar(standard);
  if (!gstar) return null;
  const partKey = `part_${partLabel.toLowerCase()}` as "part_a" | "part_b" | "part_c";
  const part = gstar[partKey];
  if (!part) return null;
  const rules = part.adaptation_rules;
  if (!rules || rules === "null" || rules === "N/A" || rules.trim() === "") return null;
  return rules;
}
