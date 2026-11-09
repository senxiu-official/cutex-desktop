// The desk pet window's channels, apart from shared/deskPet.ts: preload/index.ts imports that file, and a module both
// preloads import would become a chunk, which a sandboxed preload cannot load (test/deskPetPack.test.ts).
export const DESK_PET_WINDOW_CHANNEL = "cutex-desktop:desk-pet-window";
export const DESK_PET_WINDOW_DRAG = "cutex-desktop:desk-pet-window-drag";
export const DESK_PET_WINDOW_STATE = "cutex-desktop:desk-pet-window-state";
export const DESK_PET_WINDOW_TICK = "cutex-desktop:desk-pet-window-tick";
