// 设置 › 外观 › 头像 (lib/portraitSettingsNav): the avatar galleries and lists, in this order; the short avatar settings
// stay on 外观 next to the row that opens this page (AvatarEntrySection, owner 2026-11-28).
import { PortraitPackSection } from "./PortraitSettings";
import { HeadwearSection } from "./HeadwearSettings";

export function AvatarSubPage() {
  return (
    <>
      <PortraitPackSection />
      <HeadwearSection />
    </>
  );
}
