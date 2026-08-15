export interface EffortOption {
  value: string;
  label: string;
}

const RANK: Array<[RegExp, number]> = [
  [/none|off|minimal/, 0],
  [/^low$/, 10],
  [/medium|mid/, 20],
  [/^high$/, 30],
  [/xhigh|extra|max/, 90],
];

export function effortRank(value: string) {
  const text = value.trim().toLowerCase();
  for (const [pattern, rank] of RANK) {
    if (pattern.test(text)) return rank;
  }
  return 40;
}

export function sortEfforts<T extends EffortOption>(efforts: T[]): T[] {
  return [...efforts].sort((left, right) => effortRank(left.value) - effortRank(right.value));
}

export type EffortStage = "low" | "medium" | "high" | "xhigh";

export function effortStage(effort?: EffortOption): EffortStage {
  const text = `${effort?.value ?? ""} ${effort?.label ?? ""}`.toLowerCase();
  if (/xhigh|extra\s*high|extra-high|\bmax\b/.test(text)) return "xhigh";
  if (/(^|\s)high(\s|$)/.test(text) && !/xhigh|extra/.test(text)) return "high";
  if (/medium|mid/.test(text)) return "medium";
  return "low";
}

export function isExtraHighEffort(effort?: EffortOption) {
  return effortStage(effort) === "xhigh";
}

export function displayEffortLabel(effort?: EffortOption) {
  return effort?.label?.trim() || effort?.value || "";
}

export function effortWorldKey(stage: EffortStage) {
  return `world.${stage}`;
}
