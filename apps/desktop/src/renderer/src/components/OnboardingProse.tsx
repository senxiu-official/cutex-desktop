// The introduction's and the tour's body text (components/OnboardingFlow, OnboardingDialog): `\n` = a new
// paragraph; a line starting with "• " = a bullet.
import type { ReactNode } from "react";

/** `large`: the onboarding flow's bigger body text. */
export function Prose({ text, large = false }: { text: string; large?: boolean }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) out.push(<ul key={`u${out.length}`} className="my-1 list-disc space-y-0.5 pl-5">{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>);
    bullets = [];
  };
  for (const line of lines) {
    if (line.startsWith("• ")) bullets.push(line.slice(2));
    else {
      flush();
      if (line.trim()) out.push(<p key={`p${out.length}`} className="my-1.5">{line}</p>);
    }
  }
  flush();
  return <div className={`${large ? "text-title font-normal" : "text-sm"} leading-relaxed text-muted`}>{out}</div>;
}
