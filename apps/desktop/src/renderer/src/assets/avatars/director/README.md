# 「Director 头像」 portrait collection

Portraits meant for Directors. A Director's avatar picker lists them first (编辑信息 → the
「Director 头像」 tab, opened by default when the Director has no avatar of its own; the new-agent
picker with 「设为 Director」 ticked lists them above the emoji). Any other agent can still pick one
from the same tab, which comes last for them. Code: `src/renderer/src/lib/directorAvatars.ts`,
`src/shared/directorAvatars.ts`, `src/main/directorAvatars.ts`.

The stored avatar is `{kind: "icon", value: "director:<bundled|user>/<stem>"}` in cutex; the image
itself is resolved on each device. A device that does not have the file shows the default avatar.

## Two places to put images

1. **Bundled (this folder)**: shipped with the app and in Git, so the public repository and every
   release include them. Use it for images you want on every machine. Rebuild the app (or restart
   `pnpm dev`) to pick up new files.
2. **Personal folder**: `<userData>/avatars/director/`, which is
   `%APPDATA%\Cutex\avatars\director\` on Windows, `~/.config/Cutex/avatars/director/` on Linux, or
   under `CUTEX_DESKTOP_USER_DATA` for side instances. It is not in Git and needs no rebuild: drop
   the files in, then click 「重新扫描」 ("Rescan") in the picker. 「打开头像文件夹」 creates and
   opens it. Use it for private images, or to try a large batch before choosing some to bundle.

## Format, size, naming

- **Format**: PNG (preferred) or JPEG. This folder also accepts WebP and SVG. The personal folder
  accepts only PNG and JPEG, checked by file signature, not extension.
- **Shape**: square, subject centred with some headroom. Avatars are cropped to a circle
  (`object-cover`), so keep the face inside the middle ~70 %. Plain or soft backgrounds read best at
  20 px in the sidebar.
- **Size**: at least 512 × 512 px. 1024 × 1024 (a typical GPT image) is fine. The personal folder
  takes up to 8 MB per file and the first 120 files by name. Main shrinks each to a 192 px PNG
  thumbnail, so large originals cost nothing in the UI. For **this** folder, shrink to 256–512 px
  (≤ ~200 KB) before adding, because every file here ships in the app and the repo.
- **Naming**: lowercase `a–z 0–9 - _`, e.g. `director-07-silver-fox.png`. Other characters become
  `-`, and names are cut to 40 characters. The name (without extension) is the portrait's id and the
  tooltip in the picker. **Do not rename a file once an agent uses it**, because the agent would
  fall back to its default avatar. Files with the same id are ignored after the first. The order is
  by name (numbers compare naturally), bundled first, then personal.
- Only the top level is read. Sub-folders, hidden files and symlinks are ignored. Skipped files
  (too large, not a real PNG / JPEG, beyond 120) are counted next to 「重新扫描」.

## Placeholders

`placeholder-01-ink.svg`, `placeholder-02-amber.svg` and `placeholder-03-sage.svg` are simple
hand-written SVG busts, so the collection is never empty. Delete them once real portraits are
bundled. An agent already wearing one then shows its default avatar again.
