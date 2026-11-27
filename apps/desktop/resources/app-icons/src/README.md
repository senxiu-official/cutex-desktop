# 外观 → 应用图标: style masters (the drop-in point)

The owner's drawings go here to be built. They are **not committed** (`.gitignore` here) and not packaged: about
1.1–1.4 MB each, and only the built sets are needed (`../<id>/`, and `../../icons/` for the default style). The
2026-11-28 set came from `cutex-desktop-app-side/image-references/two-butterflies-compact-ref/sixteen-styles-ordered.zip`
(copy it out, do not edit that folder): `<id>.png` per style, and `pixel/master.png`, `pixel/32.png`, `pixel/48.png`,
saved here as `pixel.png`, `pixel-32.png`, `pixel-48.png`.

Per style:

| File | Format | Notes |
| --- | --- | --- |
| `<id>.png` | square RGBA PNG, at least 1024 px (the set is 1254), transparent background | the master; every size without a hand-made picture is scaled from it |
| `<id>-small.png` (optional) | square RGBA PNG, at least 64 px, transparent | a simplified drawing for 16 and 24 px: thicker lines, no fine detail |
| `<id>-<n>.png` (optional) | exactly n×n RGBA PNG | hand-made, used as is at n px; a size that divides n (16 from 32, 24 from 48) takes every k-th pixel (pixel art) |

- `<id>`: lowercase letters, digits and dashes (≤ 40 chars), not `default` or `ink-dragon` (the old logo, built by
  `scripts/make-icons.mjs` from `resources/logo.png`).
- SVG or layered files must be exported to PNG first; the build is pure Node and cannot rasterize SVG.
- Keep about 5% transparent margin; Windows shows the art edge to edge in the taskbar and Start menu.

Then:

1. Add `{ id, label: { "zh-CN", en } }` to `APP_ICON_STYLES` in `src/shared/appIcons.ts`, in picker order.
2. Run `node scripts/make-app-icons.mjs <id>` from the repo root. It writes `../<id>/icon-{16,24,32,48,64,128,256}.png`
   and `icon.ico` (the default style, `luodian`: `../../icons/`, with 512 too: it is also cutex.exe's and the .app's icon).
3. `test/appIcons.test.ts` fails when an entry has no built files, or when built files have no entry.
