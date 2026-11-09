// The desk pet's art inside its signed pack, through the pack service's re-hashed read (docs/desktop-modules.md §29). Apart
// from main/deskPet.ts so it stays free of Electron.
import type { PackArt } from "./deskPetArt";

export function packArtOf(files: { paths(prefix: string): string[]; read(path: string): Buffer | null }): PackArt | null {
  const paths = files.paths("art/");
  if (!paths.length) return null;
  return {
    characters: () => [...new Set(paths.map((p) => p.split("/")[1]!).filter((id) => paths.includes(`art/${id}/pet.json`)))],
    read: (character, file) => files.read(`art/${character}/${file}`),
  };
}
