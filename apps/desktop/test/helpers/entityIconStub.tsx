// A light components/EntityIcon for tests whose store double is too thin for the avatar stack (agent looks,
// Profile pictures, portrait previews): `vi.mock("../src/renderer/src/components/EntityIcon", () => import("./helpers/entityIconStub"))`.
// The icon keeps the entity's kind and id as data attributes, so a test can still check which icon a row shows.
import type { ReactNode } from "react";
import type { EntityRef } from "../../src/renderer/src/lib/entityIcon";

const idOf = (entity: EntityRef) => ("id" in entity ? entity.id : "ref" in entity ? (entity.ref ?? entity.profile?.id) : undefined) ?? "";

export function EntityIcon({ entity }: { entity: EntityRef }) {
  return <span data-entity-icon={entity.kind} data-entity-id={idOf(entity)} aria-hidden />;
}

export function EntityMention({ entity, children }: { entity: EntityRef | null | undefined; children: ReactNode }) {
  return (
    <span data-entity-mention="">
      {entity && <EntityIcon entity={entity} />}
      {children}
    </span>
  );
}
