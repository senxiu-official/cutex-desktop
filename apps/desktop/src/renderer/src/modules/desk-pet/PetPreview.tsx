// One pet's rest pose, small: layers main made on request, drawn on top of each other. `lazy`: asked for only once it is near the screen.
import { useEffect, useRef, useState } from "react";
import type { DeskPetCharacter } from "../../../../shared/deskPet";
import { ownerWindowOf } from "../../lib/ownerWindow";
import { petBridge } from "./controller";

export function characterName(c: DeskPetCharacter, locale: string): string {
  if (typeof c.name === "string") return c.name;
  return c.name[locale] ?? c.name[locale.split("-")[0]!] ?? c.name.en ?? Object.values(c.name)[0] ?? c.id;
}

export function PetPreview({ id, size, lazy, pixel, mirror }: { id: string; size: number; lazy?: boolean; pixel?: boolean; mirror?: boolean }) {
  const box = useRef<HTMLSpanElement>(null);
  const [layers, setLayers] = useState<readonly string[]>([]);
  const [near, setNear] = useState(!lazy);
  useEffect(() => {
    if (near || !box.current) return;
    const seen = new (ownerWindowOf(box.current).IntersectionObserver)((entries) => {
      if (entries.some((e) => e.isIntersecting)) setNear(true);
    }, { rootMargin: "200px" });
    seen.observe(box.current);
    return () => seen.disconnect();
  }, [near]);
  useEffect(() => {
    if (!near) return;
    let live = true;
    void petBridge()?.preview(id).then((next) => {
      if (live) setLayers(next);
    }, () => {});
    return () => {
      live = false;
    };
  }, [id, near]);
  return (
    <span ref={box} aria-hidden className="relative block shrink-0" style={{ width: size, height: size, transform: mirror ? "scaleX(-1)" : undefined, imageRendering: pixel ? "pixelated" : undefined }}>
      {layers.map((src, i) => <img key={i} src={src} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" />)}
    </span>
  );
}
