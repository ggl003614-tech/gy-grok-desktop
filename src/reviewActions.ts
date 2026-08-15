export type CheckActionId = "local" | "project" | "quality";

export interface CheckAction {
  id: CheckActionId;
  label: string;
  detail: string;
  slash?: string;
  prompt: string;
  fallback: string;
}

export const CHECK_ACTIONS: CheckAction[] = [
  {
    id: "local",
    label: "审查本地改动",
    detail: "官方 /review，只看不改",
    slash: "review",
    prompt: "/review --local",
    fallback:
      "请审查当前工作区的未提交改动（staged、unstaged、untracked）。先读 git status 和 diff，再读相关源文件。按 bug / suggestion / nit 分级汇报，引用 file:line。不要修改任何代码。",
  },
  {
    id: "project",
    label: "检查整个项目",
    detail: "找出优先修复的错误或风险",
    prompt: "检查这个项目，找出最值得优先修复的错误或风险。先汇报发现，不要直接修改。",
    fallback: "检查这个项目，找出最值得优先修复的错误或风险。先汇报发现，不要直接修改。",
  },
  {
    id: "quality",
    label: "严格代码质量",
    detail: "官方 /code-review，关注结构",
    slash: "code-review",
    prompt: "/code-review",
    fallback:
      "对当前分支的改动做一次严格的代码质量审查。关注结构简化、巨型文件、spaghetti 分支增长。先汇报，不要改代码。",
  },
];

function commandNameMatches(name: string, slash: string) {
  const normalized = name.replace(/^\//, "").toLowerCase();
  return normalized === slash || normalized.endsWith(`:${slash}`);
}

export function checkPromptFor(
  id: CheckActionId,
  commands: Array<{ name: string }> = [],
): string {
  const action = CHECK_ACTIONS.find((item) => item.id === id);
  if (!action) return "";
  if (!action.slash) return action.prompt;
  if (
    commands.length > 0 &&
    !commands.some((command) => commandNameMatches(command.name, action.slash!))
  ) {
    return action.fallback;
  }
  return action.prompt;
}
