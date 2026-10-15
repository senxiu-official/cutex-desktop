// The UI languages offered (Settings → 通用 → 界面语言 and the identity menu's 语言 ▸), each named in itself.
import type { Locale } from "../i18n";

export const LANGUAGES: readonly { value: Locale; label: string }[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-Hant-CN", label: "繁體中文" },
  { value: "en", label: "English (US)" },
  { value: "en-AU", label: "English (Australia)" },
  { value: "ru-RU", label: "Русский" },
  { value: "fr-FR", label: "Français" },
  { value: "es-ES", label: "Español (España)" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "it-IT", label: "Italiano" },
  { value: "de-DE", label: "Deutsch" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" },
];
