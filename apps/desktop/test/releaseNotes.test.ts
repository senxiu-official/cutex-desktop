// lib/releaseNotes: 新功能 / the upgrade dialog read the bundled changelog without internal build names.
import { describe, expect, it } from "vitest";
import bundled from "../src/renderer/src/modules/about/changelog.bundled.json";
import type { ChangelogDoc } from "../src/shared/changelog";
import { releaseItems, userFacingBlock, userFacingRelease, userFacingText } from "../src/renderer/src/lib/releaseNotes";

const INTERNAL = /\br\d{2,3}\b|claude-r\d+|\b\d+\.\d+\.\d+-r\d+\b/i;

describe("userFacingText", () => {
  it("says newer host where a phrase names a host build", () => {
    expect(userFacingText("搭配 r266 主机，可以复核委托审批。旧主机继续显示它支持的入口。")).toBe("搭配新版主机，可以复核委托审批。旧主机继续显示它支持的入口。");
    expect(userFacingText("修复向 cutex r259 发送图片失败的问题：先上传附件，再提交消息。")).toBe("修复向新版主机发送图片失败的问题：先上传附件，再提交消息。");
    expect(userFacingText("On r267 hosts with the matching capabilities, use routing approvals.")).toBe("On newer hosts with the matching capabilities, use routing approvals.");
    expect(userFacingText("Automatic-retry waiting status requires cutex r268 and stays hidden on older hosts.")).toBe("Automatic-retry waiting status requires a newer host and stays hidden on older hosts.");
    expect(userFacingText("Pause an agent. Requires an r" + "259 host.")).toBe("Pause an agent. Requires a newer host.");
    expect(userFacingText("Codex 协议更新至 0.167.0，支持原生运行时 0.167.0-r60；已有智能体保持所选运行时。")).toBe("Codex 协议更新至 0.167.0，支持新版原生运行时；已有智能体保持所选运行时。");
    expect(userFacingText("Claude 智能体（claude-r21 运行时）支持侧边对话。")).toBe("Claude 智能体支持侧边对话。");
    expect(userFacingText("Claude agents on the claude-r21 runtime get Side chat.")).toBe("Claude agents get Side chat.");
  });

  it("leaves out sentences that are only about versions", () => {
    expect(userFacingText("完整功能搭配主机后端 r259 和运行时 claude-r28 使用。图片引用需要主机提供对应的新功能。")).toBe("图片引用需要主机提供对应的新功能。");
    expect(userFacingText("Use cutex r259 and claude-r28 for the complete release. Update each host separately.")).toBe("Update each host separately.");
    expect(userFacingText("Older r258 or r252 hosts remain usable.")).toBe("Older hosts remain usable.");
    expect(userFacingText("Use claude-r28.")).toBeNull();
    expect(userFacingText("快速翻阅会话历史时不再闪出空白行。")).toBe("快速翻阅会话历史时不再闪出空白行。");
  });
});

describe("userFacingBlock / userFacingRelease", () => {
  it("keeps the language that survives and drops an item with nothing left", () => {
    expect(userFacingBlock({ kind: "item", text: "Use claude-r28.", zh: "使用 claude-r28。" })).toBeNull();
    expect(userFacingBlock({ kind: "item", text: "Use claude-r28.", zh: "图片更快。" })).toEqual({ kind: "item", text: "图片更快。" });
    expect(userFacingBlock({ kind: "heading", text: "Hosts" })).toEqual({ kind: "heading", text: "Hosts" });
  });

  it("drops a heading left without items", () => {
    const r = userFacingRelease({ version: "9.9.9", blocks: [{ kind: "heading", text: "A" }, { kind: "item", text: "Use claude-r28." }, { kind: "heading", text: "B" }, { kind: "item", text: "Faster." }] });
    expect(r.blocks).toEqual([{ kind: "heading", text: "B" }, { kind: "item", text: "Faster." }]);
  });

  it("no bundled release shows an internal build name", () => {
    for (const release of (bundled as ChangelogDoc).releases) {
      for (const b of releaseItems(release)) {
        expect(b.text, `${release.version}: ${b.text}`).not.toMatch(INTERNAL);
        if (b.zh) expect(b.zh, `${release.version}: ${b.zh}`).not.toMatch(INTERNAL);
      }
    }
  });
});
