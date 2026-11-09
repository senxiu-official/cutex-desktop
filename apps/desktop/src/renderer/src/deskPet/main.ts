// The desk pet window's document (main/deskPet.ts). Plain DOM, no React: it stacks the layers main sends and shows one
// at a time. Hard cuts: every layer is decoded up front, a pose is a visibility change; nothing here runs between
// messages from main. Talks only to `window.deskPet` (preload/deskPet.ts). A format 2 character is played by ./scene.
import "./deskPet.css";
import { DESK_PET_ICON_MS, fanPoints, shownPose, type DeskPetPose, type DeskPetWindowBridge, type DeskPetWindowState, type DeskPetWindowTick } from "../../../shared/deskPet";
import { createScenePlayer, type SceneInput, type ScenePlayer } from "./scene";

declare global {
  interface Window {
    deskPet: DeskPetWindowBridge;
  }
}

const bridge = window.deskPet;
const pet = document.getElementById("pet")!;
const count = document.getElementById("count")!;
const layers = new Map<string, HTMLImageElement>();
let pose: DeskPetPose = "both";
let blink = false;
let mirror = false;
let drawn = "";
const IDLE_BLINK_EVERY_MS = 5000;
const IDLE_BLINK_HOLD_MS = 250;

function layer(name: string, src: string | null): void {
  const existing = layers.get(name);
  if (!src) {
    existing?.remove();
    layers.delete(name);
    return;
  }
  if (existing) {
    if (existing.src !== src) existing.src = src;
    return;
  }
  const img = document.createElement("img");
  img.alt = "";
  img.draggable = false;
  img.src = src;
  layers.set(name, img);
  pet.append(img);
}

function show(): void {
  const face = layers.has("face");
  const closedFace = blink && layers.has("faceBlink");
  const visible = (name: string): boolean => {
    if (name === "face") return face && !closedFace;
    if (name === "faceBlink") return closedFace;
    if (name === "blink") return blink;
    if (name === "accessory") return true;
    return name === shownPose(pose, mirror);
  };
  for (const [name, img] of layers) img.style.visibility = visible(name) ? "visible" : "hidden";
}

// Tokens: 950, 12.3K, 1.2M (the same short form in every language).
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
function setCount(total: number): void {
  count.textContent = compact.format(total);
}

// ---- over the head: the waiting mark, and icons that rise when tokens arrive (main holds the room only meanwhile) ----

let icons: Readonly<Record<string, string>> = {};
let pixelArt = false;
/** Drawn size of a set's icon (DIP): pixel sets get an even 2 DIP per pixel of a 16-pixel grid. The coin is 20. */
const iconSide = () => (pixelArt ? 32 : 24);
let mark: HTMLElement | null = null;
function setMark(on: boolean): void {
  if (on === !!mark) return;
  if (!on) {
    mark!.remove();
    mark = null;
    return;
  }
  mark = document.createElement("div");
  mark.id = "mark";
  mark.textContent = "!";
  document.body.append(mark);
  placeOverhead();
}
/** Over the character's head: the middle of the picture, or of a scene's character beside its pile. */
function headLeft(): number {
  const share = player ? (mirror ? 1 - player.headX : player.headX) : 0.5;
  return pet.offsetLeft + pet.offsetWidth * share;
}
function placeOverhead(): void {
  if (!mark) return;
  mark.style.left = `${headLeft()}px`;
  // In the room over the head; without that room (Wayland), on the top of the picture.
  mark.style.top = document.body.classList.contains("native-drag") ? `${pet.offsetTop + 2}px` : `${pet.offsetTop - 34}px`;
}

// Icons rise in a few steps on one shared timer that runs only while an icon is up: a transparent always-on-top window
// pays for every frame it composites, so a 60 fps animation here cost as much as the rest of the pet (measured).
const RISE_STEPS = 8;
const rising = new Map<HTMLElement, { step: number; rise: number }>();
let riseTimer: number | null = null;
function riseStep(): void {
  for (const [el, r] of rising) {
    r.step++;
    if (r.step > RISE_STEPS) {
      el.remove();
      rising.delete(el);
      continue;
    }
    el.style.transform = `translateY(${Math.round((r.rise * r.step) / RISE_STEPS)}px)`;
    el.style.opacity = String(1 - r.step / (RISE_STEPS + 1));
  }
  if (!rising.size && riseTimer !== null) {
    window.clearInterval(riseTimer);
    riseTimer = null;
  }
}
function riseIcon(family: string): void {
  // At most a few at once: the module limits the rate, this keeps a burst from piling up.
  if (rising.size >= 3) return;
  const src = icons[family] ?? icons.any;
  const el = document.createElement(src ? "img" : "div");
  el.className = src ? "icon" : "icon coin";
  const side = src ? iconSide() : 20;
  if (src) {
    (el as HTMLImageElement).src = src;
    (el as HTMLImageElement).alt = "";
    el.style.width = el.style.height = `${side}px`;
    el.style.marginLeft = `${-side / 2}px`;
  }
  // From just over the head to the top of the room over it (DESK_PET_OVERHEAD: 60 high).
  el.style.left = `${headLeft() + (rising.size - 1) * 12}px`;
  el.style.top = `${pet.offsetTop - 6 - side}px`;
  rising.set(el, { step: 0, rise: -(60 - 6 - side) });
  document.body.append(el);
  riseTimer ??= window.setInterval(riseStep, DESK_PET_ICON_MS / (RISE_STEPS + 1));
}

// ---- format 2: one scene player at a time; its images come once per character ----

let player: ScenePlayer | null = null;
let playerKey: string | null = null;
let sceneInput: SceneInput = { work: false, books: { active: null, pile: [] }, attention: false, breathing: true };
let sceneSize = { width: 0, height: 0, pixel: false };

function applyScene(state: DeskPetWindowState): void {
  sceneInput = { work: state.work, books: state.books, attention: state.mark, breathing: state.idleBlink };
  sceneSize = { width: state.artWidth, height: state.artHeight, pixel: state.pixel };
  const scene = state.scene;
  if (!scene) {
    player?.destroy();
    player = null;
    playerKey = null;
    return;
  }
  if (playerKey !== scene.key) {
    // Without its art this key was sent before (main sends the images once per window).
    if (!scene.art) return;
    player?.destroy();
    player = null;
    playerKey = scene.key;
    void createScenePlayer(pet, scene.key, scene.art, sceneInput).then((made) => {
      if (playerKey !== scene.key) return made?.destroy();
      player = made;
      // What arrived while its images decoded.
      player?.set(sceneInput);
      player?.resize(sceneSize.width, sceneSize.height, sceneSize.pixel);
      placeOverhead();
    });
    return;
  }
  player?.set(sceneInput);
  player?.resize(sceneSize.width, sceneSize.height, sceneSize.pixel);
}

function apply(state: DeskPetWindowState): void {
  const signature = `${state.artWidth}x${state.artHeight}`;
  if (signature !== drawn) {
    drawn = signature;
    pet.style.width = `${state.artWidth}px`;
    pet.style.height = `${state.artHeight}px`;
  }
  // Bottom to top; the order is fixed once a layer exists.
  layer("face", state.face);
  layer("faceBlink", state.faceBlink);
  for (const name of ["both", "left", "right"] as const) layer(name, state.frames[name]);
  layer("blink", state.blink);
  layer("accessory", state.accessory);
  const order = ["face", "faceBlink", "both", "left", "right", "blink", "accessory"];
  for (const name of order) {
    const img = layers.get(name);
    if (img) img.style.zIndex = String(order.indexOf(name));
  }
  count.hidden = !state.showCount;
  mirror = state.mirror;
  // Only the picture: the count, the fan and the bubble read normally.
  pet.style.transform = state.mirror ? "scaleX(-1)" : "";
  pet.classList.toggle("pixel", state.pixel);
  document.body.style.opacity = String(state.opacity);
  document.body.style.padding = `${state.insetY}px ${state.insetX}px`;
  document.body.classList.toggle("native-drag", state.nativeDrag);
  setCount(state.total);
  icons = state.icons;
  pixelArt = state.pixel;
  document.body.classList.toggle("pixel", state.pixel);
  applyScene(state);
  setMark(state.mark);
  placeOverhead();
  show();
  setIdleBlink(state.idleBlink && (!!state.blink || !!state.faceBlink));
}

// At rest this is the document's one timer, and only with something to blink.
let idleTimer: number | null = null;
function setIdleBlink(on: boolean): void {
  if (on === (idleTimer !== null)) return;
  if (idleTimer !== null) window.clearInterval(idleTimer);
  idleTimer = on
    ? window.setInterval(() => {
        blink = true;
        show();
        window.setTimeout(() => {
          blink = false;
          show();
        }, IDLE_BLINK_HOLD_MS);
      }, IDLE_BLINK_EVERY_MS)
    : null;
}

function tick(t: DeskPetWindowTick): void {
  const scene: Partial<SceneInput> = {};
  if (t.work !== undefined) scene.work = t.work;
  if (t.books) scene.books = t.books;
  if (t.mark !== undefined) scene.attention = t.mark;
  if (Object.keys(scene).length) {
    sceneInput = { ...sceneInput, ...scene };
    player?.set(scene);
  }
  if (t.pose) pose = t.pose;
  if (t.total !== undefined) setCount(t.total);
  if (t.mark !== undefined) setMark(t.mark);
  if (t.icon) riseIcon(t.icon);
  if (t.pose) show();
}

bridge.onState(apply);
bridge.onTick(tick);
void bridge.state().then((state) => {
  if (state) apply(state);
});

// ---- emotes: right click opens a fan round the pet, a pick shows a bubble for a moment. Timers only while one is up. ----

const EMOTES = ["❤️", "😊", "😴", "🎉", "❓", "❗"];
const MORE = "⋯";
const FAN_BUTTON = 32;
const FAN_OPEN_MS = 6000;
const BUBBLE_MS = 2500;
let fan: HTMLElement | null = null;
let bubble: HTMLElement | null = null;
let stageTimer: number | null = null;
// A newer open or close wins over an answer still on its way from main.
let stageTurn = 0;

function clearStage(): void {
  fan?.remove();
  fan = null;
  bubble?.remove();
  bubble = null;
  if (stageTimer !== null) window.clearTimeout(stageTimer);
  stageTimer = null;
}

function closeStage(): void {
  stageTurn++;
  clearStage();
  void bridge.stage("none");
}

async function openFan(): Promise<void> {
  const turn = ++stageTurn;
  clearStage();
  const box = await bridge.stage("fan");
  if (turn !== stageTurn) return;
  // The window cannot grow here: the plain menu instead.
  if (!box) return bridge.menu();
  const el = document.createElement("div");
  el.id = "fan";
  const centreX = pet.offsetLeft + pet.offsetWidth / 2;
  const centreY = pet.offsetTop + pet.offsetHeight / 2;
  // The middle of the arc stays reachable next to a display's side edge: the rest of the menu is there.
  const middle = EMOTES.length / 2;
  const items = [...EMOTES.slice(0, middle), MORE, ...EMOTES.slice(middle)];
  fanPoints(items.length, pet.offsetWidth, pet.offsetHeight, box.below).forEach((point, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = items[i]!;
    button.style.left = `${centreX + point.x - FAN_BUTTON / 2}px`;
    button.style.top = `${centreY + point.y - FAN_BUTTON / 2}px`;
    button.addEventListener("click", () => {
      if (items[i] === MORE) {
        closeStage();
        bridge.menu();
      } else void showBubble(items[i]!);
    });
    el.append(button);
  });
  fan = el;
  document.body.append(el);
  stageTimer = window.setTimeout(closeStage, FAN_OPEN_MS);
}

async function showBubble(emote: string): Promise<void> {
  const turn = ++stageTurn;
  clearStage();
  const box = await bridge.stage("bubble");
  if (turn !== stageTurn || !box) return;
  const el = document.createElement("div");
  el.id = "bubble";
  el.textContent = emote;
  el.style.left = `${pet.offsetLeft + pet.offsetWidth / 2}px`;
  el.style.top = box.below ? `${pet.offsetTop + pet.offsetHeight + count.offsetHeight + 8}px` : `${pet.offsetTop - 48}px`;
  bubble = el;
  document.body.append(el);
  stageTimer = window.setTimeout(closeStage, BUBBLE_MS);
}

// Dragging moves the window through main, which reads the cursor itself.
let dragging = false;
document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (fan) closeStage();
  else void openFan();
});
document.addEventListener("pointerdown", (event) => {
  if (fan) {
    // On a button its click decides; anywhere else in the fan's window closes it, and nothing is dragged.
    if (event.button === 0 && !(event.target as Element).closest("#fan button")) closeStage();
    return;
  }
  if (event.button !== 0 || document.body.classList.contains("native-drag")) return;
  if (bubble) closeStage();
  dragging = true;
  document.documentElement.setPointerCapture(event.pointerId);
  bridge.dragStart();
});
document.addEventListener("pointermove", () => {
  if (dragging) bridge.dragMove();
});
const end = () => {
  if (!dragging) return;
  dragging = false;
  bridge.dragEnd();
};
document.addEventListener("pointerup", end);
document.addEventListener("pointercancel", end);
document.addEventListener("lostpointercapture", end);
