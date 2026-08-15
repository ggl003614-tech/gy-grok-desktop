import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";

const project = process.argv[2] || "D:\\projects\\grok-desk-smoke";
mkdirSync(project, { recursive: true });
writeFileSync(
  join(project, "README.md"),
  "# grok-desk-smoke\n\nTiny project used to verify Grok Desk after login.\n",
);

const grok = process.env.GROK_BIN || join(process.env.USERPROFILE || "", ".grok", "bin", "grok.exe");
const child = spawn(grok, ["agent", "stdio"], {
  cwd: project,
  env: { ...process.env, HOME: process.env.HOME || process.env.USERPROFILE },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

const pending = new Map();
const textChunks = [];
const stderr = [];
let nextId = 1;
const lines = readline.createInterface({ input: child.stdout });

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method === "session/request_permission" && message.id != null) {
    const option = (message.params?.options ?? []).find((entry) =>
      String(entry.optionId ?? entry.kind ?? "").toLowerCase().includes("allow"),
    );
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: option
        ? { outcome: "selected", optionId: option.optionId }
        : { outcome: "cancelled" },
    });
    return;
  }
  if (message.method === "session/update") {
    const update = message.params?.update ?? {};
    if (update.sessionUpdate === "agent_message_chunk" && typeof update.content?.text === "string") {
      textChunks.push(update.content.text);
    }
    return;
  }
  if (message.id != null && pending.has(message.id)) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
    else entry.resolve(message.result ?? {});
  }
});
child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
child.on("exit", (code) => {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error(`Grok exited ${code}: ${stderr.join("").trim()}`));
    pending.delete(id);
  }
});

function request(method, params, timeoutMs = 45_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

try {
  const initialize = await request("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
  });
  const methodId = (initialize.authMethods ?? []).some((item) => item.id === "cached_token")
    ? "cached_token"
    : null;
  if (!methodId) {
    throw new Error("No cached_token — GUI login did not leave a usable session");
  }
  const auth = await request(
    "authenticate",
    { methodId, _meta: { headless: true } },
    60_000,
  );
  const session = await request("session/new", { cwd: project, mcpServers: [] }, 60_000);
  await request(
    "session/prompt",
    {
      sessionId: session.sessionId,
      prompt: [
        {
          type: "text",
          text: "Create a file named hello-from-grok-desk.txt in the project root. Write exactly GROK_DESK_GUI_OK and nothing else. Do not modify other files.",
        },
      ],
    },
    180_000,
  );

  const created = join(project, "hello-from-grok-desk.txt");
  const report = {
    project,
    authenticated: true,
    email: auth._meta?.email ?? null,
    subscriptionTier: auth._meta?.subscription_tier ?? null,
    authMode: auth._meta?.auth_mode ?? null,
    sessionId: session.sessionId,
    assistantText: textChunks.join("").slice(0, 500),
    fileExists: existsSync(created),
    fileContent: existsSync(created) ? readFileSync(created, "utf8").trim() : null,
  };
  if (!report.fileExists || report.fileContent !== "GROK_DESK_GUI_OK") {
    console.error(JSON.stringify({ ...report, stderr: stderr.join("").slice(-2000) }, null, 2));
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
} finally {
  try {
    child.kill();
  } catch {
    // ignore
  }
  lines.close();
}
