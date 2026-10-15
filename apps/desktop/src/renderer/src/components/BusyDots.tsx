// Three bouncing accent dots: "the agent is working" (the timeline's live line, the scroll-to-bottom
// button while a turn runs).
export function BusyDots({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`flex gap-0.5 ${className}`}>
      {[0, 150, 300].map((d) => (
        <span key={d} className="h-1 w-1 animate-bounce rounded-full motion-reduce:animate-none bg-accent" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}
