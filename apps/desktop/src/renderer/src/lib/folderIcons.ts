// The icons a folder can be given by hand (外观…, owner 2026-11-06: a much bigger set), in groups for scanning. The
// stored value is the lucide name in kebab case (`id`). The automatic picks (lib/folderLook FOLDER_ICONS) and the
// earlier choices (FOLDER_ICON_CHOICES, which also has the project icons' ids such as `lotus` or `kettlebell`) keep
// resolving through lib/folderLook folderIcon. Never the archive box, which marks 「更早的项目」.
import {
  Activity, Anchor, Apple, Atom, Baby, Battery, Bed, Bell, Bike, Bird, Blocks, Book, BookOpen, Bookmark, Bot, Box, Braces, Brain, Briefcase, Brush,
  Bug, Building2, Calculator, Calendar, Camera, Car, Cat, ChartColumn, ChartLine, ChartPie, Clapperboard, ClipboardList, Clock, Cloud, CloudRain,
  Code, Coffee, Cog, Coins, Compass, CookingPot, Cpu, CreditCard, Crown, Database, Diamond, Dna, Dog, Droplet, Dumbbell, Earth, Feather, Files,
  FileText, Film, Fish, Flag, Flame, FlaskConical, Flower, Flower2, Folder, Gamepad2, Gem, Gift, GitBranch, Glasses, Globe, GraduationCap, Hammer,
  Handshake, Headphones, Heart, HeartPulse, Home, Hourglass, Image, Inbox, Infinity as InfinityIcon, Kanban, Key, Landmark, Languages, Lasso,
  Layers, Leaf, Library, Lightbulb, ListTodo, Lock, Luggage, Mail, Map as MapIcon, MapPin, Medal, Mic, Microscope, Moon, Mountain, Music, Notebook,
  NotebookPen, Palette, Paperclip, PawPrint, Pen, Pencil, PenTool, PiggyBank, Pill, Pin, Plane, Plug, Podcast, Popcorn, Presentation, Printer,
  Puzzle, Rabbit, Radio, Receipt, Rocket, Salad, Scale, Scissors, Server, Settings, Shapes, Shield, Ship, Shirt, ShoppingBag, ShoppingCart,
  Sigma, Smile, Snowflake, Sofa, Sparkles, Sprout, Star, Stethoscope, Store, Sun, Tag, Target, Telescope, Tent, Terminal, TestTubes,
  TrainFront, Trees, Trophy, Turtle, Tv, Umbrella, Users, Utensils, Video, Wallet, Waves, Webhook, Weight, Workflow, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";

export interface FolderIconGroup {
  /** i18n `section.iconGroup.<id>`. */
  id: string;
  icons: readonly { id: string; Icon: LucideIcon }[];
}

const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const group = (id: string, icons: Record<string, LucideIcon>): FolderIconGroup => ({ id, icons: Object.entries(icons).map(([name, Icon]) => ({ id: kebab(name), Icon })) });

export const FOLDER_ICON_GROUPS: readonly FolderIconGroup[] = [
  group("basic", { Folder, Layers, Briefcase, Box, Bookmark, Flag, Shapes, Tag, Star, Sparkles, Pin, Heart, Target, Trophy, Medal, Crown, Diamond, Gem, Bell, Clock, Hourglass, Infinity: InfinityIcon }),
  group("work", { Calendar, ClipboardList, FileText, Files, Inbox, Mail, Presentation, Kanban, ListTodo, Notebook, NotebookPen, Pencil, Pen, Paperclip, Printer, Building2, Users, Handshake, Landmark }),
  group("dev", { Code, Terminal, Braces, GitBranch, Bug, Cpu, Database, Server, Cloud, Bot, Puzzle, Blocks, Workflow, Webhook, Plug, Key, Lock, Shield }),
  group("science", { Microscope, FlaskConical, TestTubes, Atom, Dna, Telescope, Sigma, Calculator, Brain, Lightbulb, GraduationCap, Book, BookOpen, Library, Languages, ChartColumn, ChartLine, ChartPie, Scale }),
  group("media", { Music, Headphones, Mic, Radio, Podcast, Camera, Image, Film, Video, Clapperboard, Tv, Popcorn, Gamepad2, Palette, Brush, PenTool, Feather }),
  group("travel", { Plane, Car, Bike, TrainFront, Ship, Anchor, Rocket, Map: MapIcon, MapPin, Compass, Globe, Earth, Mountain, Tent, Luggage, Umbrella }),
  group("life", { Home, Sofa, Bed, Utensils, Coffee, CookingPot, Apple, Salad, Baby, Gift, Shirt, Glasses, Scissors, Smile }),
  group("money", { ShoppingCart, ShoppingBag, Store, CreditCard, Wallet, Coins, PiggyBank, Receipt }),
  group("tools", { Wrench, Hammer, Settings, Cog, Battery, Zap, Lasso }),
  group("nature", { Leaf, Trees, Flower, Flower2, Sprout, Sun, Moon, CloudRain, Snowflake, Flame, Droplet, Waves, Dog, Cat, PawPrint, Rabbit, Bird, Fish, Turtle }),
  group("health", { HeartPulse, Stethoscope, Pill, Activity, Dumbbell, Weight }),
];

/** Every grouped icon by id (the first group listing one wins). */
export const FOLDER_ICON_BY_ID: ReadonlyMap<string, LucideIcon> = new Map(FOLDER_ICON_GROUPS.flatMap((g) => g.icons.map((i) => [i.id, i.Icon] as const)).reverse());

/**
 * The groups filtered by `query` (lower-cased, trimmed): an icon matches by its id's words, or every icon of a group
 * whose shown name (`groupName`, the current language) matches. Empty groups are left out.
 */
export function searchFolderIcons(query: string, groupName: (id: string) => string): FolderIconGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...FOLDER_ICON_GROUPS];
  return FOLDER_ICON_GROUPS.map((g) => (groupName(g.id).toLowerCase().includes(q) || g.id.includes(q) ? g : { ...g, icons: g.icons.filter((i) => i.id.includes(q)) })).filter((g) => g.icons.length > 0);
}
