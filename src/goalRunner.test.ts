import { describe, expect, it } from "vitest";
import {
  GOAL_MAX_AUTO_ROUNDS,
  decideGoalContinue,
  isGoalDoneReply,
  parseGoalCommand,
} from "./goalRunner";

describe("/goal 命令识别", () => {
  it("带目标的是 start", () => {
    expect(parseGoalCommand("/goal 把测试全修绿")).toBe("start");
    expect(parseGoalCommand("  /goal 迁移 auth 模块 --budget 500000 ")).toBe("start");
  });

  it("pause/clear 停掉自动续跑，resume 恢复", () => {
    expect(parseGoalCommand("/goal clear")).toBe("stop");
    expect(parseGoalCommand("/goal pause")).toBe("stop");
    expect(parseGoalCommand("/goal resume")).toBe("resume");
  });

  it("status 和裸 /goal 是只读，不碰状态", () => {
    expect(parseGoalCommand("/goal status")).toBe("passive");
    expect(parseGoalCommand("/goal")).toBe("passive");
  });

  it("别的输入跟 goal 无关", () => {
    expect(parseGoalCommand("帮我改个按钮")).toBeNull();
    expect(parseGoalCommand("/compact")).toBeNull();
    // 前缀相似但不是 /goal 命令
    expect(parseGoalCommand("/goals 这种不算")).toBeNull();
  });
});

describe("哨兵协议", () => {
  it("短回复里的 GOAL_DONE 算结束", () => {
    expect(isGoalDoneReply("GOAL_DONE")).toBe(true);
    expect(isGoalDoneReply("  GOAL_DONE。")).toBe(true);
  });

  it("长正文里顺嘴提到不算 —— 它还在干活", () => {
    expect(
      isGoalDoneReply(
        "这一轮我改了三个文件，等验证过了我会按约定回复 GOAL_DONE，" +
          "但现在还有两个测试没过，我先去修那两个测试，修完再跑一遍完整的套件确认。",
      ),
    ).toBe(false);
  });

  it("空回复不算", () => {
    expect(isGoalDoneReply("")).toBe(false);
  });
});

describe("续跑决策", () => {
  const base = {
    goalActive: true,
    cancelled: false,
    autoRounds: 3,
    lifeLocked: false,
    sameSession: true,
    lastAssistantText: "这一轮写完了第 2 行。",
  };

  it("正常情况继续踢", () => {
    expect(decideGoalContinue(base)).toEqual({ continue: true, reason: "" });
  });

  it("goal 报告结束就停", () => {
    expect(decideGoalContinue({ ...base, lastAssistantText: "GOAL_DONE" }).reason).toBe("done");
  });

  it("用户手动打断就停 —— 人说停就是停", () => {
    expect(decideGoalContinue({ ...base, cancelled: true }).reason).toBe("cancelled");
  });

  it("生活模式锁了不许续 —— 刹车优先于油门", () => {
    expect(decideGoalContinue({ ...base, lifeLocked: true }).reason).toBe("locked");
  });

  it("保险丝烧断就停", () => {
    expect(decideGoalContinue({ ...base, autoRounds: GOAL_MAX_AUTO_ROUNDS }).reason).toBe("cap");
  });

  it("切走了先不踢，避免在别的线程眼皮底下烧额度", () => {
    expect(decideGoalContinue({ ...base, sameSession: false }).reason).toBe("switched");
  });
});

describe("goal 续跑接线（回归防线）", () => {
  it("App 里接了识别、续跑、停止三处", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "App.tsx"), "utf8");
    expect(app).toMatch(/parseGoalCommand\(prompt\)/);
    expect(app).toMatch(/maybeContinueGoal\(turnSessionId\)/);
    expect(app).toMatch(/void sendPrompt\(GOAL_NUDGE\)/);
    // 用户按停之后不许自己爬起来
    const cancel = app.slice(app.indexOf("const cancelPrompt"), app.indexOf("const cancelThread"));
    expect(cancel).toMatch(/goalActiveRef\.current = false/);
  });
});
