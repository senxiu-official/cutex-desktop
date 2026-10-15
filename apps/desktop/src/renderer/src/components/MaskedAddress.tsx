import { useState } from "react";
import { useI18n } from "../i18n";
import { maskAddress } from "../lib/maskAddress";

/** A device's network address, masked until clicked (click again to hide). */
export function MaskedAddress({ address }: { address: string }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  return (
    <button
      type="button"
      className="cursor-pointer tabular-nums hover:text-fg"
      title={shown ? t("address.hide") : t("address.show")}
      aria-label={shown ? t("address.hide") : t("address.show")}
      onClick={(e) => {
        e.stopPropagation();
        setShown((v) => !v);
      }}
    >
      {shown ? address : maskAddress(address)}
    </button>
  );
}
