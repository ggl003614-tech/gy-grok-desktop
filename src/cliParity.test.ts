import { describe, expect, it } from "vitest";
import { sessionOpenMethod } from "./acpClient";
import { buildAdvancedCliArgs } from "./cliArgs";
import { PERMISSION_MODES, normalizePermissionMode } from "./permissionModes";
import { applyThreadNames, saveThreadName } from "./threadNames";
import {
  OTHER_FOLDER_NAME,
  groupSessionsByFolder,
  isJunkSession,
  sessionTitle,
} from "./sidebarTree";

describe("CLI parity on shipped builders", () => {
  it("puts --permission-mode on the real CLI argument builder", () => {
    const args = buildAdvancedCliArgs({
      permissionMode: "auto",
      model: "grok-4.6",
    });
    const index = args.indexOf("--permission-mode");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(args[index + 1]).toBe("auto");
    expect(PERMISSION_MODES.map((mode) => mode.id)).toEqual([
      "default",
      "acceptEdits",
      "auto",
      "plan",
      "dontAsk",
      "bypassPermissions",
    ]);
    expect(normalizePermissionMode("auto")).toBe("auto");
    expect(normalizePermissionMode("nope")).toBe("default");
  });

  it("groups real threads under the folder and hides ghost sessions", () => {
    const folders = groupSessionsByFolder(
      [
        {
          sessionId: "real",
          cwd: "D:\\GY工作室",
          title: "阅读项目",
          numChatMessages: 8,
          hasUserQuery: true,
        },
        {
          sessionId: "ghost",
          cwd: "D:\\GY工作室",
          title: "",
          numChatMessages: 2,
          hasUserQuery: false,
        },
        {
          sessionId: "loose",
          cwd: "G:\\",
          title: "零散",
          numChatMessages: 3,
          hasUserQuery: true,
        },
      ],
      [],
      "D:\\GY工作室",
    );
    expect(isJunkSession({ sessionId: "ghost", title: "", numChatMessages: 2, hasUserQuery: false })).toBe(true);
    expect(folders.map((folder) => folder.name)).toEqual(["GY工作室", OTHER_FOLDER_NAME]);
    expect(folders[0].sessions.map((session) => session.sessionId)).toEqual(["real"]);
    expect(folders[1].sessions.map((session) => session.sessionId)).toEqual(["loose"]);
  });

  it("applies a user rename instead of showing a session code", () => {
    const memory = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => {
          memory.set(key, value);
        },
      },
    });
    saveThreadName("019ffa2c-xxxx", "工作室管线");
    const named = applyThreadNames([{ sessionId: "019ffa2c-xxxx", title: "线程 019ffa2c" }]);
    expect(named[0].title).toBe("工作室管线");
    expect(sessionTitle({ sessionId: "019ffa2c-xxxx" })).toBe("未命名对话");
  });

  it("loads an existing session instead of opening session/new", () => {
    expect(
      sessionOpenMethod("saved-session", { loadSession: true, resumeSession: true }),
    ).toBe("session/load");
    expect(
      sessionOpenMethod(undefined, { loadSession: true, resumeSession: true }),
    ).toBe("session/new");
  });
});
