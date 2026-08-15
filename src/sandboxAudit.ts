export type AuditFinding = {
  id: string;
  severity: "ok" | "info" | "warn";
  title: string;
  detail: string;
};

const LOCAL_ONLY_IN_SHIPPED = [
  /C:\\Users\\Administrator/i,
  /D:\\GY工作室/,
  /E:\\projects\\grok-desktop/,
];

export function withoutRustTests(source: string) {
  const index = source.search(/#\[cfg\(test\)\]/);
  return index >= 0 ? source.slice(0, index) : source;
}

/** Lines that look like a shipped binary depending on this developer's machine. */
export function shippedLocalOnlyHits(source: string) {
  const hits: string[] = [];
  for (const line of withoutRustTests(source).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("///")) continue;
    if (trimmed.includes("assert") || trimmed.includes("expect(")) continue;
    for (const pattern of LOCAL_ONLY_IN_SHIPPED) {
      if (pattern.test(trimmed)) hits.push(trimmed.slice(0, 200));
    }
  }
  return hits;
}

export function classifyLocalService(bind: string, startedByApp: boolean): AuditFinding {
  if (bind.startsWith("127.0.0.1:") && startedByApp) {
    return {
      id: "computer-mcp",
      severity: "ok",
      title: "电脑控制是软件自己起的本机端口",
      detail: `${bind} 在 GY Grok 进程里监听。新用户不必先开别的后端；本机已有一份 GY Grok 时，第二份会抢不到这个端口。`,
    };
  }
  return {
    id: "external-localhost",
    severity: "warn",
    title: "发现未由本软件拉起的本机服务",
    detail: bind,
  };
}

export function grokLookupOrder() {
  return [
    "GROK_BIN if set and the file exists",
    "%USERPROFILE%\\.grok\\bin\\grok.exe",
    "grok.exe on PATH",
  ];
}

export function officialCliArtifact(version: string, platform: string) {
  const suffix = platform.startsWith("windows") ? ".exe" : "";
  return `https://x.ai/cli/grok-${version}-${platform}${suffix}`;
}

export function linuxSandboxCanTest() {
  return [
    "official Grok CLI download on a blank HOME",
    "grok version on linux-x86_64 / linux-aarch64",
    "ACP initialize without a cached login",
    "no extra localhost backend required for the CLI itself",
  ];
}

export function linuxSandboxCannotTest() {
  return [
    "GY Grok window / WebView2 / Tauri",
    "Windows ConPTY terminal",
    "built-in desk-computer on 127.0.0.1:18765",
    "official browser login from the GUI",
  ];
}

export function firstRunNeeds() {
  return [
    "Windows 10/11 x64",
    "WebView2 Runtime（新版 Windows 通常已自带）",
    "能访问 https://x.ai/cli 以便自动安装官方 Grok Build",
    "官方登录（新用户不会带着本机已有的 ~/.grok/auth.json）",
  ];
}

export function summarizeAudit(findings: AuditFinding[]) {
  return {
    ok: findings.filter((item) => item.severity === "ok").length,
    info: findings.filter((item) => item.severity === "info").length,
    warn: findings.filter((item) => item.severity === "warn").length,
    findings,
  };
}
