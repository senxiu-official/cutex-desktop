// Codex config pages (the connected host's codex config), group 工具: 插件, MCP, 技能, 钩子.
import { Anchor, Cable, Puzzle, Wand2 } from "lucide-react";
import { HooksPage, McpPage, SkillsPage } from "../../components/settings/CapabilitiesSettings";
import { PluginsPage } from "../../components/settings/PluginsSettings";
import { defineModule } from "../slots";

export default defineModule({
  id: "codex-config",
  titleKey: "codex-config.title",
  descriptionKey: "codex-config.description",
  contributes: {
    "settings.page": [
      { id: "codex-config.mcp", page: "mcp", group: "tools", order: 200, icon: Cable, titleKey: "codex-config.mcp", source: "codex", hintKey: "codex-config.codex.appliesNext", Page: McpPage, sections: [{ anchor: "configured", titleKey: "codex-config.mcp.configured", keywords: ["codex-config.mcp.add", "codex-config.mcp.command", "codex-config.mcp.tokenEnv"] }, { anchor: "builtin", titleKey: "codex-config.mcp.builtin" }] },
      { id: "codex-config.skills", page: "skills", group: "tools", order: 300, icon: Wand2, titleKey: "codex-config.skills", source: "codex", hintKey: "codex-config.skills.applies", Page: SkillsPage },
      { id: "codex-config.hooks", page: "hooks", group: "tools", order: 400, icon: Anchor, titleKey: "codex-config.hooks", source: "codex", hintKey: "codex-config.hooks.applies", Page: HooksPage, keywords: ["codex-config.hooks.trust", "codex-config.hooks.revoke"] },
      { id: "codex-config.plugins", page: "plugins", group: "tools", order: 100, icon: Puzzle, titleKey: "codex-config.plugins", source: "codex", hintKey: "codex-config.plugins.applies", Page: PluginsPage, keywords: ["codex-config.plugins.tab.browse", "codex-config.plugins.market.add"], sections: [{ anchor: "sync", titleKey: "codex-config.plugins.sync", keywords: ["codex-config.plugins.follow"] }] },
    ],
  },
});
