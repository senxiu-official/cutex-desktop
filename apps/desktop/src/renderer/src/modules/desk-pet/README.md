# Desk pet

A little character that sits anywhere on your screen. It types while your agents use tokens: the more and the closer together, the faster. The number under it is today's tokens, and a mark over its head shows when something waits on you. Turn it on under Settings → Modules.

It comes with six original characters, one per model family; they are AI generated, and `art/manifest.json` records the tool and prompt of each image. A seventh, Reader, is a drawn example of format 2: it reads books from a pile beside it. Pick one under Settings → Desk pet → All pets.

**You can add your own art files; you supply them and you are responsible for them.**

## Your own characters

Open Settings → Desk pet → Open folder. Make one subfolder per character. Its name is the id: lowercase letters, digits and hyphens, at most 32 letters long. Then press Read again. All pets lists them; click one to use it.

```text
art/
  my-character/
    pet.json
    both.png
    left.png
    right.png
    face.png          (optional)
    face-blink.png    (optional)
    blink.png         (optional)
    accessory.png     (optional)
    icon.png          (optional)
    icon-claude.png   (optional, one per model family)
```

`pet.json`:

```json
{ "format": 1, "name": "My character", "scale": 1 }
```

`name` is a string, or an object by language (`{ "en": "…", "zh-CN": "…" }`). `scale` (0.25–2), `family` and `pixel` (`true` for pixel art: scaled by nearest neighbour so the grid stays crisp) are optional. The format has no paths.

| File | Content |
|---|---|
| `both.png` | Rest pose: both hands in the same position |
| `left.png` | Left hand raised, left as seen on screen |
| `right.png` | Right hand raised, right as seen on screen |
| `face.png` | Head, drawn under the hand frame. With it, the hand frames need only arms |
| `face-blink.png` | The same head with eyes closed; swapped in for `face.png` during a blink |
| `blink.png` | Closed eyes only, drawn over the hand frame. For whole-image sets without `face.png` |
| `accessory.png` | Always on top |
| `icon.png`, `icon-<family>.png` | Rises over the head when tokens arrive (if that setting is on). `<family>` is `claude`, `gpt`, `gemini`, `deepseek`, `kimi` or `glm`; `icon.png` is for any family without its own. Without either, a plain coin |

Rules:

- PNG with alpha, not animated. Every file in a set the same size, 64–1024 pixels per side, at most 2 MiB each.
- Icons are the exception: square, 32–256 pixels per side, at most 256 KiB, any size of their own. They are drawn about 24 pixels high.
- All layers lie on the same canvas with no offsets. Only arms and hands should differ between the hand frames.
- The background must be truly transparent. A pixel with alpha of at least 16 in any layer is drawn and catches clicks; everything else passes clicks to what is behind.

Anything that does not fit is refused, and Settings → Desk pet says which file and why. The rest still list.

## Format 2: a character that reads

Format 2 describes a whole little scene in `pet.json`: bodies that breathe, a book that appears in the hands, pages that turn, a blink, sleep, and a pile of books beside the character. It is data only; the desk pet plays it with its own fixed player, and nothing in an art folder ever runs. Format 1 sets keep working.

All images sit beside `pet.json`, named in it (lowercase letters, digits, `-` and `_`, ending in `.png`; no folders). Each is a still PNG of 1–2048 pixels per side and at most 2 MiB; a set has at most 256 images, 48 MiB and 64 million pixels in all. Images need not share a size: each fills its own box.

```json
{
  "format": 2,
  "name": "My reader",
  "canvas": [320, 256],
  "character": [0, 0, 256, 256],
  "breathMs": 3600,
  "bodies": {
    "up": { "still": "up.png", "breath": ["up-0.png", "up-1.png", "up-2.png"] },
    "read": { "still": "read.png" },
    "read-blink": { "still": "read-blink.png" }
  },
  "props": { "open": { "image": "book.png", "cover": {} } },
  "pages": { "turn": "page.png" },
  "hands": "hands.png",
  "covers": { "green": { "kind": "book" }, "plum": { "kind": "diary", "tint": [1.15, 0.6, 1.25] } },
  "pile": { "image": "pile-book.png", "at": [240, 226], "size": [72, 24], "step": 7, "max": 20, "deck": [{ "cover": "green" }, { "cover": "plum" }] },
  "clips": {
    "idle": [{ "body": "up", "ms": 2400 }],
    "opening": [{ "body": "read", "prop": "open", "ms": 90, "magic": 0.5 }, { "body": "read", "prop": "open", "ms": 300 }],
    "reading": [{ "body": "read", "prop": "open", "ms": 3000 }, { "body": "read-blink", "prop": "open", "ms": 180 }, { "body": "read", "prop": "open", "ms": 150, "page": "turn" }],
    "closing": [{ "body": "read", "prop": "open", "ms": 90, "magic": 0.5 }, { "body": "up", "ms": 400 }]
  }
}
```

- `canvas` is the whole picture in units; `character` the box the character fills. Size measures the character's box (100 % = 160 pixels on its longest side); the pile beside it comes on top. Bodies, props, pages and `hands` all fill the character's box.
- A body has one `still` image and optionally 2–48 `breath` images, played round once every `breathMs` whatever else happens.
- A frame of a clip names a `body`, and optionally a `prop` (held in front), a `page` (a turning page drawn over the prop, with `hands` over it) and `magic` (0–1: the prop appearing or going; `hands` and the optional `sparkle` are drawn over it). `ms` is how long it shows.
- Clips have fixed names: `idle` and `reading` are required; `opening` and `closing` play when she starts and stops reading; `switchOut` and `switchIn` (both or none) take the next book while she keeps reading, without looking up: only bodies used in `reading`, the book in hand on every frame, no page turns (art without them closes and opens between books); `fallAsleep`, `sleeping` and `wake` (all three or none) after a minute at rest; `attention` (optional) while the mark is up.
- `covers`: each book on the pile has one. `tint` recolours the green pixels of a prop with a `cover` and of the pile image; `image` is projected onto the prop's `cover.quad` and the pile's `cover` (four corners, clockwise from top-left); `cover.over` is drawn over it (fingers in front of the cover).
- `pile`: one image per book, the lowest at `at` (its top-left), each next one `step` units higher, at most `max` (1–20). New books take their covers from `deck` in turn; `units` (1–8) makes a book thicker.

Anything unknown, out of range or naming something that is not there refuses the whole set, and Settings → Desk pet says why. The full rules are in the app's documentation (desktop modules, §29.9).

## Books

A format 2 character with a pile works off the tokens your agents use. Every token counted in today's number (input that was not cached, plus output) goes into a balance, once: a reconnect or a corrected count never adds it twice. The balance lies beside the pet as books: new tokens fill the newest book on top, then new books land on the pile. While the pet is shown and the balance is not empty it reads, at the work speed you set; a finished book is put away and the next comes off the top. When nothing is left it stops, reads on for 15 seconds, closes the book and rests. Nothing comes for free: no books come back on their own, and there is no full pile in the morning. At most 20 books lie beside it; the real balance, which has no limit, is in Settings → Desk pet, with the tokens per book (default 50k) and the work speed (default 50k a minute). Nothing is worked off while the pet is hidden or the app is closed.

## How it moves

Every time an agent reports token usage, the pet gets a little energy: log2(1 + tokens), so a huge report lasts only a little longer than a small one. Energy fades by a fixed share each second; with nothing new it stops after ten to fifteen seconds. Reports close together stack up and make it type faster, from 1.5 to 6 taps a second.

Some runtimes report tokens only when a turn ends (Claude agents do); in between, each finished request still gives it a small push. A runtime that reports no usage at all moves it by its commands and tool calls. By default every agent on your connected hosts counts; Settings → Desk pet can limit it to the open conversation.

## Today's tokens

The number under the pet is the tokens cutex agents on your connected hosts used today (this device's date): input not read from a cache, plus output. Cached input never counts. Each host's usage ledger is asked once an hour, on reconnect and after midnight, and live reports are added in between.

Not counted: hosts that are not connected, and usage cutex imported from other tools. With a provider that does not report cache hits, all of its input counts.

## The mark

A mark over the head means a message, a question or an approval from an agent waits on you and you have not opened that agent yet. It goes once you have. Messages between agents do not count. Settings → Desk pet can turn it off.

## What it can and cannot count

Settings → Desk pet also keeps exact counts of messages, commands and tool calls. They stay on this device.

- Counted: messages sent from this desktop; commands and tool calls of agents, subagents included, on connected hosts.
- Not counted: hosts that are not connected, the time the app is closed, a gap skipped on reconnect, messages sent from other devices, and calls your connection may not see.

## Right click

Right click opens a fan round the pet: pick an emote and a bubble shows for a moment; the middle button is the full menu. Click anywhere else in the fan, or wait, and it closes. Emotes are your system's emoji. On Wayland the window cannot grow, so right click goes straight to the menu.

## Getting it back

Hidden or set to click-through, the pet cannot be reached by itself. The way back is the button in the tray, Desk pet in the bottom-left menu, or Settings → Desk pet.

## Linux

On Wayland the system decides where windows go: the position is not kept across restarts, and transparent parts may catch clicks. Wayland also has no way for an app to keep its window on top. On KDE Plasma the app asks KWin (through a small KWin script for the pet's window only) to keep the pet above other windows, on every desktop and out of the taskbar; on GNOME and other Wayland desktops the pet goes behind any window you click, and Settings says so.
