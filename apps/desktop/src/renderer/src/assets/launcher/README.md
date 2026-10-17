# Launcher portraits: what is (not) in this repository

The portrait and victory PNGs are not in Git (`.gitignore`) and are not part of the public
repository or the release packages. A build without them works: `lib/launchArt.ts` loads whatever
files of `LAUNCH_ART_FILES` are present, and a provider without both of its images falls back to the
icon + greeting intro. The file names the launcher uses are listed in `LAUNCH_ART_FILES`
(`src/shared/launchArt.ts`).

## Getting the art into an installed app (no rebuild)

Release builds bundle none of these images. Put the PNGs in one folder with the exact
`LAUNCH_ART_FILES` names, then in the app open 设置 → 外观 → 启动页立绘 (Settings → Appearance →
Launcher artwork) and click 「从文件夹导入…」 ("Import from folder…"). The main process (`main/launchArt.ts`):

- reads only those exact names at the top of the chosen folder; other files and sub-folders are ignored;
- accepts a file only if it is a regular file (not a symlink), at most 10 MiB, starting with the PNG signature;
- imports a provider only when both its portrait and its victory image pass; a lone file is reported, not used;
- copies them into `<userData>/launcher-art/` (the app's single userData: `%APPDATA%\Cutex`,
  `~/.config/Cutex`, or `CUTEX_DESKTOP_USER_DATA` for side instances), replacing that provider's earlier import;
- hands them to the window as `data:image/png` URLs over IPC (the renderer CSP is unchanged).

Imported art overrides bundled art per provider. 「清除」 ("Clear") deletes the imported files: the
bundled art shows again, else the icon + greeting intro. Each Settings row shows the provider's
source (已导入 / 内置 / 无) and the two file names it expects.

## Bundling the art into a local build

`scripts/copy-launcher-art.ps1` / `.sh` copy the owner's files into this folder before a build; the
eager glob in `lib/launchArt.ts` picks them up.

The notes below are historical generation records (the `*-prompt*.md` files next to this README are
the exact prompts). The images they describe are not published, and their statements about which
files the UI imports are superseded by `lib/launchArt.ts`.

# Launcher artwork

Original PNGs supplied by the user on 2026-10-11, copied unchanged from chat attachments.
Each provider has `*-portrait.png` (black-and-white ID portrait) and `*-victory.png`
(black-and-white victory declaration). Attachment order was DeepSeek, Codex/GPT,
Claude, Kimi, GLM, followed by victory pictures in the same order.

The UI crops portraits with CSS; the originals remain intact. Colour portraits have
not been supplied and are not required for this version. Z.ai shares GLM artwork.

## Transparent variants

The ten `*-cutout.png` siblings were produced with the built-in imagegen tool
(background-extraction), preserving the original 1122×1402 canvas and RGBA alpha.
Original files remain unchanged. The UI now imports these transparent variants.

Prompt set: remove only the outer white paper background to transparent alpha;
preserve character identity, face, eyes, ink lines, hair and all internal white
fills, framing and proportions; do not redraw. Preserve speech balloons, their
white fill and exact lettering `会赢的。` / `开工前的胜利宣言!!`, and white backing
immediately behind separate captions. Remove disconnected background flecks;
add nothing. The second batch also explicitly requested the same canvas size.

Cast heights are custom art direction, not official character canon: Codex 174,
Claude 168, Kimi 165, DeepSeek 162, GLM 158 cm. Optical scaling accounts for each
source's eye line; the shared bottom crop/fade aligns all five bodies. Display
order is GLM, Kimi, Codex, Claude, DeepSeek (tallest in the middle).

## Vertical-pupil portrait variants

`codex-portrait-slit.png` (dragon) and `glm-portrait-slit.png` (cat) were edited
with built-in imagegen from their transparent portrait cutouts. Both remain
1122×1402 RGBA. The launcher now uses these two variants; original portraits,
cutouts and all victory declarations are unchanged.

Prompt set: precise-object-edit; change only both pupils to clearly visible
narrow black vertical slits, elongated inside the existing irises and tapered
at both ends, appropriate for a dragon (Codex) or cat (GLM). Preserve irises,
highlights, eyelashes, eye contours, gaze, face, expression, hair, accessories,
anatomy, clothing, ink/shading, grayscale, framing, scale, 1122×1402 canvas,
transparent background and internal white fills. No new objects/text/color;
edit the ID portrait only, not the victory declaration.

## Facial differentiation v2

The launcher now imports all five `*-portrait-face-v2.png` siblings, edited with
built-in imagegen; 1122×1402 RGBA transparency verified. Codex retains dragon slit
pupils with slightly longer eyes/defined jaw; GLM retains cat slit pupils with a
subtle cat mouth and rounder, shorter face. Claude has a viewer-left tear mole and
softened oval face; Kimi has a smaller viewer-right tear mole close to the eyelid,
a narrower face and asymmetric smile (no mouth mole). DeepSeek has rounder eyes,
softer lower eyelids/cheeks and a relaxed smile. Full exact prompt set is saved in
[face-v2-prompts.md](face-v2-prompts.md). All previous assets and victory images remain.

## Kimi chin correction v3

`kimi-portrait-soft-chin-v3.png` replaces Kimi face-v2 in the launcher. Built-in
imagegen used the previous `kimi-portrait-cutout.png` as the only input, per user
request, not the new face-v2. The chin is shorter/rounded with soft cheek width;
viewer-right tear mole retained. 1122×1402 RGBA alpha 0–255. Exact prompt:
[kimi-v3-prompt.md](kimi-v3-prompt.md). All prior versions retained.

## Rounded chins and reference redraw comparison

Claude and DeepSeek now use `*-portrait-soft-chin-v3.png` on the default page;
[exact edit prompts](soft-chin-v3-prompts.md). Their chins were rounded/shortened,
retaining eye/mole details. Each remains 1122×1402 RGBA.

Five `*-portrait-redraw-v4.png` alternatives were requested as complete new
illustrations from character references, not local edits, using built-in imagegen.
Distinct fringe directions: Codex center part, Claude soft side part, DeepSeek
lighter wispy fringe, Kimi asymmetric opposite sweep, GLM fuller choppy fringe.
[Exact reference/redraw prompts](redraw-v4-prompts.md). All five are 1122×1402 RGBA.
The default page retains edited portraits; development-only `?portraits=redraw`
shows these alternatives for comparison. Victory assets remain unchanged.

## Codex redraw v5

The redraw comparison now uses `codex-portrait-redraw-v5.png`: fuller vertically
oval pupils with gently tapered ends, clearer highlights, asymmetric fringe,
softer cheek/jaw and a small knowing smile. Built-in imagegen was asked for a
complete redraw with v4 as character reference; exact prompt in codex-v5-prompt.md.
1122×1402 RGBA alpha verified. Default edited page, other four redraws and all
victory images unchanged. Prior Codex versions retained.

## Codex victory redraw trial
Redraw preview now uses codex-victory-redraw-v1.png when selecting Codex. Built-in
imagegen full redraw combines portrait v5 identity with old victory composition,
confident tooth-showing smile and original Chinese text. Original victory and other
providers unchanged. Exact prompt: codex-victory-v1-prompt.md. 1122×1402 RGBA.

## Codex coherent head structure (2026-10-12)

Redraw preview now uses `codex-portrait-redraw-v6.png` and
`codex-victory-redraw-v2.png`, both full built-in imagegen redraws. Portrait is
upright with level eyes/ears/horn roots and centered skull/part/nose/chin. Victory
uses coherent whole-head clockwise tilt; face, crown, hair roots and horns share
one orientation. Both 1122×1402 RGBA alpha 0–255. Earlier versions retained.
Exact reference roles and prompts: [codex-aligned-prompts.md](codex-aligned-prompts.md).

- codex-victory-redraw-v3.png: built-in imagegen redraw prioritizing original victory expression/composition; paired with portrait v6 in redraw preview. Exact prompt: codex-victory-v3-prompt.md. Earlier versions retained.
