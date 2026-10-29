// openSettings(page, { anchor }) on a page whose cards load asynchronously (Settings → 用户 / 接入): scroll
// to the anchor once it is rendered (polled for a few seconds), then clear the focus.
import { useEffect } from "react";
import { useApp } from "../store";
import { settingsAnchorId } from "./settingsNav";
import { useOwnerDocument } from "./ownerContext";

export function useScrollToSettingsAnchor(): void {
  const doc = useOwnerDocument();
  const anchor = useApp((s) => s.settingsFocus?.anchor);
  useEffect(() => {
    if (!anchor) return;
    let tries = 0;
    const timer = setInterval(() => {
      const el = doc.getElementById(settingsAnchorId(anchor));
      if (!el && ++tries < 40) return;
      clearInterval(timer);
      el?.scrollIntoView({ block: "start" });
      useApp.setState({ settingsFocus: null });
    }, 100);
    return () => clearInterval(timer);
  }, [anchor]);
}
