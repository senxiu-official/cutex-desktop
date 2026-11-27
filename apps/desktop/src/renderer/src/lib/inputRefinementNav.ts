// Where 输入优化 lives in Settings (owner 2026-11-26: a module's settings go on the page they belong to, not a nav row
// each; docs/desktop-modules.md §5.1): a card 「输入优化」 in 面板 → 会话 → 输入, and a detail page
// under 会话 (no nav row) for the host's templates (text-rewrite-v2) or the 提示词增强 Profiles (v1), with the template
// editor as its sub-page. It was a page of its own (工具 → 输入优化, page id `input-refinement`); old links land on the
// card, an old `template` sub-page on the detail page (lib/settingsNav MOVED_PAGES).
// No imports: the pure settings helpers, the 会话 page and the module all read these names.

/** The card on 会话 (`settings.section` id; also its anchor). */
export const INPUT_REFINEMENT_SECTION = "input-refinement.card";
/** The detail page under 会话: templates (v2 hosts) or which Profiles (v1). */
export const INPUT_REFINEMENT_PAGE = "input-refinement-detail";
/** The detail page's sub-page: one template's editor. */
export const INPUT_REFINEMENT_TEMPLATE_SUB = "template";
/** The old page id (Settings → 工具 → 输入优化). */
export const INPUT_REFINEMENT_OLD_PAGE = "input-refinement";
