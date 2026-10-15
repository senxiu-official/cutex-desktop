// A model id as text: the profile's entry name, else the catalog name, else the id (lib/modelDisplay).
// The tooltip shows the raw id when the shown name differs (unless `title` is given).
import { rawIdTitle, useModelName } from "../lib/modelDisplay";

export function ModelName({ id, displayName, profile, className, title, fallback = "" }: { id: string | null | undefined; displayName?: string | null; /** Profile id or name whose entry names apply. */ profile?: string | null; className?: string; title?: string; /** Shown when there is no model. */ fallback?: string }) {
  const label = useModelName();
  const shown = label(id, displayName, profile);
  return (
    <span className={className} title={title ?? rawIdTitle(id, shown)}>
      {shown || fallback}
    </span>
  );
}
