import { describe, expect, it } from "vitest";
import {
  asTimelineItems,
  lookupForConnect,
  sameProjectPath,
  serializeTimeline,
  titleFromTranscript,
  transcriptLookup,
} from "./sessionMemory";

describe("session memory", () => {
  it("treats the same Windows path as the same project", () => {
    expect(sameProjectPath("E:\\projects\\app\\", "e:/projects/app")).toBe(true);
    expect(sameProjectPath("\\\\?\\D:\\GY工作室\\", "D:/GY工作室")).toBe(true);
    expect(sameProjectPath("E:\\projects\\app", "E:\\projects\\other")).toBe(false);
  });

  it("drops raw payloads and keeps a readable title", () => {
    const items = serializeTimeline([
      {
        id: "1",
        kind: "user",
        text: "帮我看一下这个登录闪退",
        raw: { secret: "nope" },
      },
    ]);
    expect(items[0]).not.toHaveProperty("raw");
    expect(titleFromTranscript(items)).toBe("帮我看一下这个登录闪退");
  });

  it("resumes the requested thread instead of the latest local alias", () => {
    const previous = [
      { id: "local-a", remoteSessionId: "remote-a" },
      { id: "local-b", remoteSessionId: "remote-b" },
    ];
    expect(transcriptLookup(previous, "remote-b")).toEqual({
      localId: "local-b",
      remoteId: "remote-b",
      requireResume: true,
    });
    expect(transcriptLookup(previous, undefined, true)).toEqual({ requireResume: false });
    expect(transcriptLookup([], undefined)).toEqual({ requireResume: false });
    expect(lookupForConnect(previous)).toEqual({ requireResume: false });
    expect(lookupForConnect(previous, "remote-b")).toEqual({
      localId: "local-b",
      remoteId: "remote-b",
      requireResume: true,
    });
  });

  it("ignores malformed stored rows when restoring", () => {
    expect(asTimelineItems([{ kind: "user" }, { kind: "assistant", text: "好" }])).toEqual([
      expect.objectContaining({ kind: "assistant", text: "好" }),
    ]);
  });
});
