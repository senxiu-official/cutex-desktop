// 项目图标: a per-project emoji, lucide icon or short custom text (ChatGPT-style picker,
// components/ProjectIconPicker). cutex's project presentation has no icon field yet — only
// display_name / badge_label / colour (docs/research/project-icons-20261012.md) — so the choice is
// a device-local pref keyed by hostKey(hostId, projectId) and every surface falls back to the
// daemon's letter badge. The colour stays in cutex (presentation.color accepts #RRGGBB), so it is
// consistent across devices.
import type { LucideIcon } from "lucide-react";
import {
  Book,
  Braces,
  Brain,
  ChartColumn,
  Coins,
  Dumbbell,
  Earth,
  FlaskConical,
  Flower,
  Flower2,
  Folder,
  Globe,
  GraduationCap,
  Heart,
  Music,
  Notebook,
  Palette,
  PawPrint,
  Pen,
  Pencil,
  Plane,
  Popcorn,
  Scale,
  Scissors,
  ShoppingBag,
  Sprout,
  Stethoscope,
  Terminal,
  Weight,
  Wrench,
} from "lucide-react";
import { hostKey, parseHostKey } from "./hostKeys";
import type { SidebarGroup } from "./sidebar";

export interface ProjectIconChoice {
  /** `emoji` = any pasted emoji, `icon` = a catalog lucide id, `text` = 1–2 letters / a single hanzi. */
  kind: "emoji" | "icon" | "text";
  value: string;
}

/** The curated lucide line icons the picker offers (`id` is what gets stored; keywords feed the search). */
export interface ProjectLucideIcon {
  id: string;
  Icon: LucideIcon;
  keywords: string[];
}

// The same set as ChatGPT's project icons where lucide has them; lucide has no lotus / bag /
// kettlebell / globe-stand / plant, so those stand in: Flower2, ShoppingBag, Weight, Earth, Sprout.
export const PROJECT_LUCIDE_ICONS: ProjectLucideIcon[] = [
  { id: "folder", Icon: Folder, keywords: ["folder", "文件夹", "目录", "directory"] },
  { id: "coin", Icon: Coins, keywords: ["coin", "硬币", "钱", "money"] },
  { id: "book", Icon: Book, keywords: ["book", "书", "阅读", "reading"] },
  { id: "graduation-cap", Icon: GraduationCap, keywords: ["graduation", "毕业", "学习", "study", "学位"] },
  { id: "pencil", Icon: Pencil, keywords: ["pencil", "铅笔", "写", "write", "编辑"] },
  { id: "pen", Icon: Pen, keywords: ["pen", "钢笔", "签名"] },
  { id: "braces", Icon: Braces, keywords: ["braces", "花括号", "代码", "code"] },
  { id: "terminal", Icon: Terminal, keywords: ["terminal", "终端", "命令行", "cli", "shell"] },
  { id: "music", Icon: Music, keywords: ["music", "音乐", "歌曲", "audio"] },
  { id: "popcorn", Icon: Popcorn, keywords: ["popcorn", "爆米花", "电影", "movie"] },
  { id: "scissors", Icon: Scissors, keywords: ["scissors", "剪刀", "裁剪"] },
  { id: "palette", Icon: Palette, keywords: ["palette", "调色板", "颜色", "画", "paint"] },
  { id: "stethoscope", Icon: Stethoscope, keywords: ["stethoscope", "听诊器", "医疗", "medical", "医生"] },
  { id: "flower", Icon: Flower, keywords: ["flower", "花"] },
  { id: "lotus", Icon: Flower2, keywords: ["lotus", "莲花", "荷花", "冥想"] },
  { id: "bag", Icon: ShoppingBag, keywords: ["bag", "包", "购物", "shopping"] },
  { id: "chart", Icon: ChartColumn, keywords: ["chart", "图表", "统计", "数据"] },
  { id: "kettlebell", Icon: Weight, keywords: ["kettlebell", "壶铃", "健身", "gym"] },
  { id: "dumbbell", Icon: Dumbbell, keywords: ["dumbbell", "哑铃", "健身", "fitness"] },
  { id: "notebook", Icon: Notebook, keywords: ["notebook", "笔记本", "笔记", "notes"] },
  { id: "scales", Icon: Scale, keywords: ["scales", "天平", "平衡", "法律"] },
  { id: "globe-stand", Icon: Earth, keywords: ["globe stand", "地球仪", "地球", "earth"] },
  { id: "plane", Icon: Plane, keywords: ["plane", "飞机", "旅行", "travel"] },
  { id: "globe", Icon: Globe, keywords: ["globe", "全球", "网络", "web", "世界"] },
  { id: "wrench", Icon: Wrench, keywords: ["wrench", "扳手", "工具", "tools", "修理"] },
  { id: "paw", Icon: PawPrint, keywords: ["paw", "爪印", "宠物", "pet", "动物"] },
  { id: "flask", Icon: FlaskConical, keywords: ["flask", "烧瓶", "实验", "lab", "科学"] },
  { id: "brain", Icon: Brain, keywords: ["brain", "大脑", "思考", "mind"] },
  { id: "heart", Icon: Heart, keywords: ["heart", "心", "喜欢", "love"] },
  { id: "plant", Icon: Sprout, keywords: ["plant", "植物", "生长", "grow"] },
];

/** The curated emoji the picker offers. */
export interface ProjectEmoji {
  value: string;
  keywords: string[];
}

export const PROJECT_EMOJIS: ProjectEmoji[] = [
  { value: "😀", keywords: ["笑脸", "smile", "开心"] },
  { value: "😊", keywords: ["微笑", "blush", "高兴"] },
  { value: "😎", keywords: ["墨镜", "cool", "酷"] },
  { value: "🤖", keywords: ["机器人", "robot", "bot"] },
  { value: "👽", keywords: ["外星人", "alien"] },
  { value: "🎃", keywords: ["南瓜", "halloween", "万圣节"] },
  { value: "👻", keywords: ["幽灵", "ghost", "鬼"] },
  { value: "💡", keywords: ["灯泡", "idea", "想法", "灯"] },
  { value: "🔥", keywords: ["火", "fire", "热门"] },
  { value: "⭐", keywords: ["星", "star", "收藏"] },
  { value: "✨", keywords: ["闪光", "sparkles", "星星"] },
  { value: "🌈", keywords: ["彩虹", "rainbow"] },
  { value: "🦊", keywords: ["狐狸", "fox"] },
  { value: "🐱", keywords: ["猫", "cat", "猫咪"] },
  { value: "🐶", keywords: ["狗", "dog", "小狗"] },
  { value: "🐼", keywords: ["熊猫", "panda"] },
  { value: "🐧", keywords: ["企鹅", "penguin"] },
  { value: "🦉", keywords: ["猫头鹰", "owl"] },
  { value: "🐢", keywords: ["乌龟", "turtle", "龟"] },
  { value: "🦄", keywords: ["独角兽", "unicorn"] },
  { value: "🐝", keywords: ["蜜蜂", "bee"] },
  { value: "🦋", keywords: ["蝴蝶", "butterfly"] },
  { value: "🐳", keywords: ["鲸鱼", "whale"] },
  { value: "🦖", keywords: ["恐龙", "dinosaur", "t-rex"] },
  { value: "🍎", keywords: ["苹果", "apple"] },
  { value: "🍋", keywords: ["柠檬", "lemon"] },
  { value: "🍇", keywords: ["葡萄", "grapes"] },
  { value: "🍓", keywords: ["草莓", "strawberry"] },
  { value: "🍑", keywords: ["桃子", "peach"] },
  { value: "🥑", keywords: ["牛油果", "avocado"] },
  { value: "🍞", keywords: ["面包", "bread"] },
  { value: "🧁", keywords: ["杯子蛋糕", "cupcake", "蛋糕"] },
  { value: "🍵", keywords: ["茶", "tea"] },
  { value: "☕", keywords: ["咖啡", "coffee"] },
  { value: "🍺", keywords: ["啤酒", "beer"] },
  { value: "🍿", keywords: ["爆米花", "popcorn"] },
  { value: "📁", keywords: ["文件夹", "folder"] },
  { value: "📦", keywords: ["箱子", "box", "包裹"] },
  { value: "📚", keywords: ["书", "books", "阅读"] },
  { value: "✏️", keywords: ["铅笔", "pencil", "写"] },
  { value: "📌", keywords: ["图钉", "pin", "置顶"] },
  { value: "🔒", keywords: ["锁", "lock", "安全"] },
  { value: "🔑", keywords: ["钥匙", "key"] },
  { value: "🧩", keywords: ["拼图", "puzzle"] },
  { value: "🎯", keywords: ["靶心", "target", "目标"] },
  { value: "🎁", keywords: ["礼物", "gift", "礼物盒"] },
  { value: "🛠", keywords: ["工具", "tools", "锤子"] },
  { value: "💻", keywords: ["电脑", "laptop", "代码"] },
  { value: "⚙️", keywords: ["齿轮", "gear", "设置"] },
  { value: "🔬", keywords: ["显微镜", "microscope", "科学"] },
  { value: "🔭", keywords: ["望远镜", "telescope"] },
  { value: "🧠", keywords: ["大脑", "brain", "思考"] },
  { value: "🚀", keywords: ["火箭", "rocket", "启动"] },
  { value: "🛰", keywords: ["卫星", "satellite"] },
  { value: "💾", keywords: ["软盘", "floppy", "保存"] },
  { value: "📡", keywords: ["天线", "satellite dish", "信号"] },
  { value: "⚡", keywords: ["闪电", "zap", "快"] },
  { value: "🔌", keywords: ["插头", "plug", "电"] },
  { value: "🪫", keywords: ["电池", "battery", "低电量"] },
  { value: "🌸", keywords: ["樱花", "cherry blossom", "花"] },
  { value: "🌻", keywords: ["向日葵", "sunflower"] },
  { value: "🌵", keywords: ["仙人掌", "cactus"] },
  { value: "🌲", keywords: ["树", "tree", "松树"] },
  { value: "🍀", keywords: ["四叶草", "clover", "幸运"] },
  { value: "🌊", keywords: ["海浪", "wave", "海"] },
  { value: "🌙", keywords: ["月亮", "moon", "夜"] },
  { value: "☀️", keywords: ["太阳", "sun", "晴天"] },
  { value: "⛅", keywords: ["云", "cloud", "多云"] },
  { value: "❄️", keywords: ["雪", "snow", "冬天"] },
  { value: "🌍", keywords: ["地球", "earth", "世界"] },
  { value: "🌪", keywords: ["龙卷风", "tornado", "风"] },
  { value: "🎮", keywords: ["游戏", "game", "手柄"] },
  { value: "🎨", keywords: ["调色板", "art", "画"] },
  { value: "🎵", keywords: ["音符", "music", "音乐"] },
  { value: "🎬", keywords: ["电影", "movie", "场记板"] },
  { value: "📷", keywords: ["相机", "camera", "照片"] },
  { value: "🏃", keywords: ["跑步", "run", "运动"] },
  { value: "🧘", keywords: ["冥想", "yoga", "瑜伽"] },
  { value: "⚽", keywords: ["足球", "soccer", "球"] },
  { value: "🏀", keywords: ["篮球", "basketball"] },
  { value: "🏋️", keywords: ["健身", "weightlifting", "举重"] },
  { value: "♟", keywords: ["棋", "chess", "国际象棋"] },
  { value: "🎾", keywords: ["网球", "tennis"] },
  { value: "💜", keywords: ["紫心", "purple heart", "喜欢"] },
  { value: "❤️", keywords: ["红心", "heart", "爱"] },
  { value: "🎖", keywords: ["勋章", "medal"] },
  { value: "💰", keywords: ["钱袋", "money", "金"] },
  { value: "📈", keywords: ["上涨", "chart", "图表"] },
  { value: "📉", keywords: ["下跌", "chart down"] },
  { value: "🧭", keywords: ["指南针", "compass", "方向"] },
  { value: "⏳", keywords: ["沙漏", "hourglass", "时间"] },
  { value: "🔔", keywords: ["铃铛", "bell", "提醒"] },
  { value: "🗓", keywords: ["日历", "calendar", "日期"] },
  { value: "✅", keywords: ["对勾", "check", "完成"] },
  { value: "🚩", keywords: ["旗", "flag", "标记"] },
];

/** The picker's colour swatches (white / red / orange / yellow / green / blue / purple / pink), stored as cutex presentation colours. */
export const PROJECT_ICON_COLORS = ["#ffffff", "#e5484d", "#f76b15", "#ffb224", "#30a46c", "#3e63dd", "#6e56cf", "#d6409f"] as const;

/** cutex palette names (lib/sidebar projectColor) whose hue the swatch row also carries: a stored
 * name and its swatch are the same colour, so the swatch shows the selected ring for the name.
 * Cyan / magenta have no swatch twin — they get their own extra swatches writing the daemon token. */
const SWATCH_OF_NAMED: Record<string, string> = { blue: "#3e63dd", green: "#30a46c", yellow: "#ffb224", red: "#e5484d" };

/** The daemon palette names without a swatch twin, appended after PROJECT_ICON_COLORS. */
export const PROJECT_NAMED_SWATCHES = ["cyan", "magenta"] as const;

/** Whether presentation colour `current` is the swatch a button writes (`#RRGGBB`, or a
 * PROJECT_NAMED_SWATCHES token): direct match, or the named colour the swatch stands in for. */
export function sameProjectColor(current: string, swatch: string): boolean {
  const c = current.trim().toLowerCase();
  return c === swatch.toLowerCase() || SWATCH_OF_NAMED[c] === swatch;
}

/** Longest value we store (emoji hold; cutex session avatars cap at 64). */
export const PROJECT_ICON_MAX = 16;

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

/** What the picker would accept; null = letter badge. Emoji must actually contain an emoji, `text`
 * is 1–2 plain characters (a hanzi, letters — not emoji, no spaces), icon ids must be in the catalog. */
export function cleanProjectIcon(icon: ProjectIconChoice | null | undefined): ProjectIconChoice | null {
  if (!icon || (icon.kind !== "emoji" && icon.kind !== "icon" && icon.kind !== "text")) return null;
  const value = icon.value.trim();
  // eslint-disable-next-line no-control-regex
  if (!value || CONTROL.test(value) || /\s/u.test(value)) return null;
  const len = [...value].length;
  if (icon.kind === "icon") return PROJECT_LUCIDE_ICONS.some((i) => i.id === value) ? { kind: "icon", value } : null;
  if (icon.kind === "emoji") return len <= PROJECT_ICON_MAX && PICTOGRAPHIC.test(value) ? { kind: "emoji", value } : null;
  return len <= 2 && !PICTOGRAPHIC.test(value) ? { kind: "text", value } : null;
}

/** The 自定义 tab's input → a choice: any emoji (≤ PROJECT_ICON_MAX code points) stays `emoji`,
 * 1–2 plain characters (hanzi, letters) become `text`; null = not usable. */
export function parseCustomIcon(input: string): ProjectIconChoice | null {
  return cleanProjectIcon({ kind: PICTOGRAPHIC.test(input.trim()) ? "emoji" : "text", value: input });
}

/** Sanitised `projectIcons` from storage: host keys only, valid choices only. */
export function migrateIcons(value: unknown): Record<string, ProjectIconChoice> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, ProjectIconChoice> = {};
  for (const [key, icon] of Object.entries(value as Record<string, unknown>)) {
    if (!parseHostKey(key)) continue;
    const clean = cleanProjectIcon(icon as ProjectIconChoice | null);
    if (clean) out[key] = clean;
  }
  return out;
}

const sameChoice = (a: ProjectIconChoice | null | undefined, b: ProjectIconChoice | null): boolean => !!a === !!b && (!a || !b || (a.kind === b.kind && a.value === b.value));

/** `icons` with the choice of `projectId` on `hostId` set (null removes it). Same object when unchanged. */
export function withIcon(icons: Readonly<Record<string, ProjectIconChoice>>, hostId: string, projectId: string, icon: ProjectIconChoice | null): Record<string, ProjectIconChoice> {
  const key = hostKey(hostId, projectId);
  const clean = cleanProjectIcon(icon);
  if (sameChoice(icons[key], clean)) return icons as Record<string, ProjectIconChoice>;
  const next = { ...icons };
  if (clean) next[key] = clean;
  else delete next[key];
  return next;
}

/** The icon choice of a project (null = letter badge). */
export function projectIcon(icons: Readonly<Record<string, ProjectIconChoice>>, hostId: string, projectId: string): ProjectIconChoice | null {
  return icons[hostKey(hostId, projectId)] ?? null;
}

/** The icon of a sidebar group (projects only; a group without a host is the focus host's). */
export function groupIcon(icons: Readonly<Record<string, ProjectIconChoice>>, group: Pick<SidebarGroup, "kind" | "id" | "hostId">, focus: string): ProjectIconChoice | null {
  return group.kind === "project" ? projectIcon(icons, group.hostId ?? focus, group.id) : null;
}

/** A stored icon id → its lucide component (null when the catalog no longer has it; falls back to the letter badge). */
export function projectLucideIcon(id: string): LucideIcon | null {
  return PROJECT_LUCIDE_ICONS.find((i) => i.id === id)?.Icon ?? null;
}

const matches = (q: string, terms: readonly string[]): boolean => terms.some((term) => term.includes(q) || q.includes(term));

/** The emoji (tab 表情符号) matching `query` (lower-cased); all when empty. */
export function searchProjectEmoji(query: string): ProjectEmoji[] {
  const q = query.trim().toLowerCase();
  if (!q) return PROJECT_EMOJIS;
  return PROJECT_EMOJIS.filter((e) => matches(q, [e.value, ...e.keywords]));
}

/** The lucide icons (tab 图标) matching `query` (lower-cased); all when empty. */
export function searchProjectIcons(query: string): ProjectLucideIcon[] {
  const q = query.trim().toLowerCase();
  if (!q) return PROJECT_LUCIDE_ICONS;
  return PROJECT_LUCIDE_ICONS.filter((i) => matches(q, [i.id, ...i.keywords]));
}
