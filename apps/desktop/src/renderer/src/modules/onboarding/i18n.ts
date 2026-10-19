// Strings of the `onboarding` module: the one-time introduction, the per-version 新功能 dialog
// (components/OnboardingDialog) and their card on Settings → 关于. Copy reviewed 2026-10-19 (owner + GPT review, docs/research/onboarding-copy-20261019.md); the owner settles changes
// (docs/research/onboarding-copy-20261019.md lists every key); only these values change, not the code.
// \n in a body = a new paragraph; a line starting with "• " = a bullet.
export const zhCN = {
  "onboarding.title": "使用引导与更新说明",
  "onboarding.description": "了解 Cutex 的基本用法，以及新版本的更新内容。",
  "onboarding.dialogLabel": "认识 Cutex",
  "onboarding.step": "第 {n} 步，共 {total} 步",
  "onboarding.skip": "跳过引导",
  "onboarding.back": "上一步",
  "onboarding.next": "下一步",
  "onboarding.finish": "开始使用",
  "onboarding.close": "关闭",

  "onboarding.language.title": "选择界面语言",
  "onboarding.language.body": "选择你习惯的语言，界面会立即切换。之后也可以在「设置 → 通用 → 界面语言」中更改。",

  "onboarding.appearance.title": "调整界面外观",
  "onboarding.appearance.body": "选择你喜欢的主题、配色和界面缩放，调整会立即生效。字体、对比度等更多选项见「设置 → 外观」。",

  "onboarding.intro.title": "{{agent}}，从一个会话开始",
  "onboarding.intro.body":
    "你可以把「{{agent}}」理解为一个会话：像使用 Claude Code 或 Codex 一样，通过对话提出需求，让它在工作文件夹中使用工具完成任务。\n在 Cutex 中，你可以同时管理多个会话，让它们互相发送消息、委托任务。\n任务运行在主机上，也就是运行 cutex 后端的电脑，可以是本机或远程电脑。只要主机和后端正常运行，关闭桌面窗口不会结束任务。",

  "onboarding.project.title": "用项目组织协作",
  "onboarding.project.body":
    "项目把工作文件夹和一组「{{agent}}」组织在一起。需要分工协作时，可以让「{{director}}」根据你的要求创建成员、分配任务并汇总结果。\n也可以先从独立会话开始，不必创建项目。",

  "onboarding.profile.title": "添加第一个 Profile",
  "onboarding.profile.body":
    "Profile 用于配置模型服务和登录方式，例如 API 密钥或订阅账号登录。新建会话时，可以选择要使用的 Profile。\n当前主机还没有 Profile。选择「添加 Profile」会结束引导并打开添加页面；也可以先点「开始使用」，稍后再添加。",
  "onboarding.profile.add": "添加 Profile",

  "onboarding.terms.title": "用你习惯的术语",
  "onboarding.terms.body": "选择一套你习惯的界面用词，选择后立即生效。这只改变界面显示，不会改变{{agent}}的行为。\n之后可以在「设置 → 通用 → 术语」中更换预设，或逐项自定义。",
  "onboarding.terms.preview": "预览",
  "onboarding.preset.default": "智能体",
  "onboarding.preset.daili": "代理",
  "onboarding.preset.english": "agent（英文）",
  "onboarding.preset.maid": "Maid",
  "onboarding.preset.custom": "当前使用自定义术语。选择预设会替换当前语言的整套术语设置。",

  "onboarding.whatsNew.title": "{version} 更新摘要",
  "onboarding.whatsNew.more": "查看完整更新记录",
  "onboarding.whatsNew.empty": "此版本暂无更新摘要。",

  "onboarding.section": "使用引导与更新说明",
  "onboarding.sectionHint": "重新查看使用引导，或了解当前版本的更新内容。",
  "onboarding.whatsNewToggle": "自动显示更新摘要",
  "onboarding.whatsNewToggleHint": "更新到新版本后，在首次启动时显示一次更新摘要",
  "onboarding.replayIntro": "重新查看使用引导",
  "onboarding.replayWhatsNew": "查看当前版本的更新摘要",
  "onboarding.preset.more": "更多术语预设",
  "onboarding.testEveryBuild": "测试：每次更新都显示全部引导",
  "onboarding.testEveryBuildHint": "仅开发版可见。每装一个新构建，启动时先显示整套引导，再显示最新版本的更新摘要",
};

export const en: Record<keyof typeof zhCN, string> = {
  "onboarding.title": "Introduction and release notes",
  "onboarding.description": "Get to know Cutex and see what's changed in each release.",
  "onboarding.dialogLabel": "Getting to know Cutex",
  "onboarding.step": "Step {n} of {total}",
  "onboarding.skip": "Skip introduction",
  "onboarding.back": "Back",
  "onboarding.next": "Next",
  "onboarding.finish": "Get started",
  "onboarding.close": "Close",

  "onboarding.language.title": "Choose your interface language",
  "onboarding.language.body": "Choose the language you prefer. The interface switches immediately. You can change it later in Settings → General → Language.",

  "onboarding.appearance.title": "Make the interface your own",
  "onboarding.appearance.body": "Choose a theme, palette and zoom level. Changes apply immediately. More options, including fonts and contrast, are in Settings → Appearance.",

  "onboarding.intro.title": "Think of {{an agent}} as a session",
  "onboarding.intro.body":
    "In Cutex, {{an agent}} works much like a session in Claude Code or Codex: describe what you need, and it uses tools to work in a folder.\nManage several {{agents}} in one place, and let them exchange messages and delegate tasks.\nWork runs on the host—the computer running the cutex backend—which can be local or remote. Closing the desktop window does not end tasks while the host and backend keep running.",

  "onboarding.project.title": "Organize collaboration with projects",
  "onboarding.project.body":
    "A project brings a working folder and a group of {{agents}} together. Its {{director}} can add {{agents}}, assign tasks and summarize the results based on your instructions.\nYou can also start with a standalone {{agent}}—no project required.",

  "onboarding.profile.title": "Add your first Profile",
  "onboarding.profile.body":
    "A Profile contains the settings for connecting to a model service, using an API key or a subscription login. Choose a Profile when creating {{an agent}}.\nThis host has no Profiles yet. “Add a Profile” ends this introduction and opens the setup form. You can also choose Get started and add one later.",
  "onboarding.profile.add": "Add a Profile",

  "onboarding.terms.title": "Use the terms you prefer",
  "onboarding.terms.body": "Choose the terms you prefer to see in the app. Changes apply immediately and affect only interface wording, not how your {{agents}} behave.\nYou can switch presets or customize individual terms later in Settings → General → Terms.",
  "onboarding.terms.preview": "Preview",
  "onboarding.preset.default": "agent",
  "onboarding.preset.daili": "Daili",
  "onboarding.preset.english": "agent (English)",
  "onboarding.preset.maid": "Maid",
  "onboarding.preset.custom": "Custom terms are in use. Selecting a preset replaces all term settings for this language.",

  "onboarding.whatsNew.title": "What's new in {version}",
  "onboarding.whatsNew.more": "View full changelog",
  "onboarding.whatsNew.empty": "No update summary is available for this version.",

  "onboarding.section": "Introduction and release notes",
  "onboarding.sectionHint": "Revisit the introduction or see what's changed in this version.",
  "onboarding.whatsNewToggle": "Show update summaries automatically",
  "onboarding.whatsNewToggleHint": "Show a summary once, when you first open a newly updated version",
  "onboarding.replayIntro": "View the introduction again",
  "onboarding.replayWhatsNew": "View this version's update summary",
  "onboarding.preset.more": "More term presets",
  "onboarding.testEveryBuild": "Testing: show the whole introduction after every update",
  "onboarding.testEveryBuildHint": "Development builds only. Each new build starts with the whole introduction, then the newest update summary",
};

declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;
