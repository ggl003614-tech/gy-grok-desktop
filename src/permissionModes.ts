export const PERMISSION_MODES = [
  { id: "default", label: "手动", detail: "每次高风险操作都询问，对应 CLI default" },
  { id: "acceptEdits", label: "接受编辑", detail: "自动接受文件编辑，其他仍询问" },
  { id: "auto", label: "自动", detail: "对应 CLI --permission-mode auto" },
  { id: "plan", label: "计划", detail: "先规划，不直接改文件" },
  { id: "dontAsk", label: "不问", detail: "尽量不弹审批" },
  { id: "bypassPermissions", label: "全部允许", detail: "绕过审批，对应 CLI bypassPermissions" },
] as const;

export type PermissionModeId = (typeof PERMISSION_MODES)[number]["id"];

export function normalizePermissionMode(value: unknown): PermissionModeId {
  const raw = String(value ?? "").trim();
  return PERMISSION_MODES.some((mode) => mode.id === raw)
    ? (raw as PermissionModeId)
    : "default";
}

export function permissionModeLabel(id: string) {
  return PERMISSION_MODES.find((mode) => mode.id === id)?.label ?? "手动";
}

export function isDangerousPermissionMode(id: string) {
  return id === "bypassPermissions" || id === "dontAsk";
}
