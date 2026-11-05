import { memo } from "react";
import { useSeen } from "../lib/motion";

const STACK = "0123456789".split("");

const Reel = memo(function Reel({ digit, delay }: { digit: number; delay: number }) {
  return (
    <span className="reel" aria-hidden>
      <span className="reel-track" style={{ transform: `translateY(${-digit * 10}%)`, transitionDelay: `${delay}ms` }}>
        {STACK.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </span>
    </span>
  );
});

/** Slot-machine digits for a few showpiece numbers. Everyday values use Value, which is cheaper. */
export function Digits({ value, className = "" }: { value: string | number; className?: string }) {
  const [ref, seen] = useSeen<HTMLSpanElement>(0.2);
  const text = String(value);
  const chars = Array.from(text);
  return (
    <span ref={ref} className={`digits ${className}`} role="text" aria-label={text}>
      {chars.map((char, index) => {
        // Keys count from the right so that reels keep their identity as the number changes length.
        const key = chars.length - index;
        return /\d/.test(char) ? (
          <Reel key={key} digit={seen ? Number(char) : 0} delay={Math.min(index * 32, 420)} />
        ) : (
          <span key={key} aria-hidden style={{ whiteSpace: "pre" }}>
            {char}
          </span>
        );
      })}
    </span>
  );
}

/** A value that pops in again whenever its text changes. */
export function Value({ value, className = "" }: { value: string | number; className?: string }) {
  const text = String(value);
  return (
    <span key={text} className={`value-pop ${className}`}>
      {text}
    </span>
  );
}
