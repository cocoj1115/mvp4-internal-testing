export type Method = 1 | 2 | 3;

export type GStarConfig = Record<string, string>;

export interface TestingAssignment {
  questionId: string;
  method: Method;
  gStar?: GStarConfig;
}

export interface DeviceTestingSetup {
  version: 1;
  createdAt: string;
  stationLabel?: string;
  assignments: TestingAssignment[];
}

export const TESTING_SETUP_STORAGE_KEY = "biobridge-device-setup-v1";

export function isMethod(value: unknown): value is Method {
  return value === 1 || value === 2 || value === 3;
}

export function isGStarConfig(value: unknown): value is GStarConfig {
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every(
    (entry) => typeof entry === "string"
  );
}

export function parseDeviceTestingSetup(value: unknown): DeviceTestingSetup | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;

  if (candidate.version !== 1) return null;
  if (typeof candidate.createdAt !== "string") return null;
  if (!Array.isArray(candidate.assignments)) return null;

  const assignments: TestingAssignment[] = [];
  for (const entry of candidate.assignments) {
    if (!entry || typeof entry !== "object") return null;
    const item = entry as Record<string, unknown>;
    if (typeof item.questionId !== "string") return null;
    if (!isMethod(item.method)) return null;

    const assignment: TestingAssignment = {
      questionId: item.questionId,
      method: item.method,
    };

    if (item.gStar != null) {
      if (!isGStarConfig(item.gStar)) return null;
      assignment.gStar = item.gStar;
    }

    assignments.push(assignment);
  }

  return {
    version: 1,
    createdAt: candidate.createdAt,
    stationLabel:
      typeof candidate.stationLabel === "string" ? candidate.stationLabel : undefined,
    assignments,
  };
}
