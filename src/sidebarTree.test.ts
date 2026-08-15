import { describe, expect, it } from "vitest";
import {
  OTHER_FOLDER_NAME,
  filterFolderTree,
  folderDisplayName,
  groupSessionsByFolder,
  isJunkSession,
  sessionTitle,
} from "./sidebarTree";

describe("sidebar tree", () => {
  it("puts known workspaces in their folder and dumps the rest into 其他", () => {
    const folders = groupSessionsByFolder(
      [
        { sessionId: "a", cwd: "D:\\GY工作室", title: "阅读项目", numChatMessages: 4, updatedAt: "2026-08-13T10:00:00Z" },
        { sessionId: "a", cwd: "\\\\?\\D:\\GY工作室", title: "阅读项目", numChatMessages: 4, updatedAt: "2026-08-13T10:00:00Z" },
        { sessionId: "b", cwd: "D:/GY工作室", title: "管线", numChatMessages: 2, updatedAt: "2026-08-13T12:00:00Z" },
        { sessionId: "empty", cwd: "D:\\GY工作室", title: "New task", numChatMessages: 0, hasUserQuery: false },
        { sessionId: "ghost", cwd: "D:\\GY工作室", title: "", numChatMessages: 2, hasUserQuery: false },
        { sessionId: "loose", cwd: "G:\\", title: "随便聊", numChatMessages: 3, updatedAt: "2026-08-12T10:00:00Z" },
        { sessionId: "temp", cwd: "C:\\Users\\Administrator\\AppData\\Local\\Temp", title: "探测", numChatMessages: 1 },
      ],
      ["E:\\projects\\empty"],
      "D:\\GY工作室",
    );

    expect(folders.map((folder) => folder.name)).toEqual(["empty", "GY工作室", OTHER_FOLDER_NAME]);
    expect(folders[1].sessions.map((session) => session.sessionId)).toEqual(["b", "a"]);
    expect(folders[2].sessions.map((session) => session.sessionId)).toEqual(["temp", "loose"]);
  });

  it("hides empty placeholder threads", () => {
    expect(isJunkSession({ sessionId: "1", title: "New task", numChatMessages: 0 })).toBe(true);
    expect(isJunkSession({ sessionId: "2", title: "阅读项目", numChatMessages: 0 })).toBe(false);
    expect(isJunkSession({ sessionId: "3", title: "", numChatMessages: 2, hasUserQuery: false })).toBe(true);
    expect(isJunkSession({ sessionId: "4", title: "", numChatMessages: 4, hasUserQuery: true })).toBe(false);
  });

  it("does not pin a folder or thread when a different one is selected", () => {
    const sessions = [
      { sessionId: "a1", cwd: "D:\\alpha", title: "Alpha 旧", numChatMessages: 4, updatedAt: "2026-08-10T10:00:00Z" },
      { sessionId: "a2", cwd: "D:\\alpha", title: "Alpha 新", numChatMessages: 4, updatedAt: "2026-08-13T10:00:00Z" },
      { sessionId: "b1", cwd: "E:\\beta", title: "Beta 旧", numChatMessages: 4, updatedAt: "2026-08-11T10:00:00Z" },
      { sessionId: "b2", cwd: "E:\\beta", title: "Beta 新", numChatMessages: 4, updatedAt: "2026-08-12T10:00:00Z" },
    ];
    const known = ["D:\\alpha", "E:\\beta"];
    const first = groupSessionsByFolder(sessions, known, "D:\\alpha");
    const second = groupSessionsByFolder(sessions, known, "E:\\beta");
    expect(first.map((folder) => folder.key)).toEqual(second.map((folder) => folder.key));
    expect(first.map((folder) => folder.sessions.map((session) => session.sessionId)))
      .toEqual(second.map((folder) => folder.sessions.map((session) => session.sessionId)));
    expect(first[0].name).not.toBeUndefined();
  });

  it("keeps every project folder even when recents only list one of them", () => {
    const sessions = [
      { sessionId: "a1", cwd: "D:\\alpha", title: "Alpha", numChatMessages: 4 },
      { sessionId: "b1", cwd: "E:\\beta", title: "Beta", numChatMessages: 4 },
      { sessionId: "c1", cwd: "F:\\gamma", title: "Gamma", numChatMessages: 4 },
    ];
    const folders = groupSessionsByFolder(sessions, ["D:\\alpha"], "D:\\alpha");
    expect(folders.map((folder) => folder.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(folders.flatMap((folder) => folder.sessions.map((session) => session.sessionId))).toEqual([
      "a1",
      "b1",
      "c1",
    ]);
  });

  it("does not reshuffle folders or threads after rememberProject promotes a cwd", () => {
    const sessions = [
      { sessionId: "a1", cwd: "D:\\alpha", title: "Alpha", numChatMessages: 4, updatedAt: "2026-08-10T10:00:00Z" },
      { sessionId: "b1", cwd: "E:\\beta", title: "Beta", numChatMessages: 4, updatedAt: "2026-08-11T10:00:00Z" },
      { sessionId: "c1", cwd: "F:\\gamma", title: "Gamma", numChatMessages: 4, updatedAt: "2026-08-12T10:00:00Z" },
    ];
    const before = groupSessionsByFolder(sessions, ["D:\\alpha"], "D:\\alpha");
    const afterClick = groupSessionsByFolder(
      sessions.map((session) =>
        session.sessionId === "c1"
          ? { ...session, updatedAt: "2026-08-14T12:00:00Z" }
          : session,
      ),
      ["F:\\gamma", "D:\\alpha"],
      "F:\\gamma",
    );
    expect(afterClick.map((folder) => folder.name)).toEqual(before.map((folder) => folder.name));
    expect(afterClick.map((folder) => folder.sessions.map((session) => session.sessionId)))
      .toEqual(before.map((folder) => folder.sessions.map((session) => session.sessionId)));
  });

  it("filters folders and threads like a file tree search", () => {
    const folders = groupSessionsByFolder([
      { sessionId: "a", cwd: "D:\\GY工作室", title: "阅读项目", numChatMessages: 1 },
      { sessionId: "b", cwd: "D:\\GY工作室", title: "管线动画", numChatMessages: 1 },
      { sessionId: "c", cwd: "E:\\other", title: "别的事", numChatMessages: 1 },
    ], ["D:\\GY工作室"]);
    const hits = filterFolderTree(folders, "管线");
    expect(hits).toHaveLength(1);
    expect(hits[0].sessions.map((session) => session.sessionId)).toEqual(["b"]);
    expect(sessionTitle({ sessionId: "abcd1234" })).toBe("未命名对话");
    expect(folderDisplayName("D:\\GY工作室")).toBe("GY工作室");
  });
});
