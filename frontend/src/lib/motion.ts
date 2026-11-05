// The small amount of JavaScript behind the CSS motion in index.css. Nothing here runs per frame.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let observer: IntersectionObserver | null = null;

/** One shared observer settles every `.rise` element once, delayed by position so rows cascade. */
function riseObserver() {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        const across = entry.boundingClientRect.left / Math.max(window.innerWidth, 1);
        element.style.setProperty("--rise-delay", `${Math.round(across * 140)}ms`);
        element.classList.add("is-in");
        observer?.unobserve(element);
      }
    },
    { threshold: 0.04, rootMargin: "0px 0px -3% 0px" },
  );
  return observer;
}

export function useRise<E extends HTMLElement>() {
  const ref = useRef<E | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const shared = riseObserver();
    shared.observe(element);
    return () => shared.unobserve(element);
  }, []);
  return ref;
}

/** True once the element has been on screen. */
export function useSeen<E extends HTMLElement>(amount = 0.2): [RefObject<E | null>, boolean] {
  const ref = useRef<E | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    const once = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setSeen(true);
      },
      { threshold: amount },
    );
    once.observe(element);
    return () => once.disconnect();
  }, [amount, seen]);
  return [ref, seen];
}

/**
 * Positions a `.pill` behind whichever child matches `selector`. It sets transform and width only
 * when the selection or the container's size changes, and CSS animates the rest.
 */
export function useSlidingPill<C extends HTMLElement>(selector: string, selection: unknown) {
  const container = useRef<C | null>(null);
  const pill = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const host = container.current;
    const marker = pill.current;
    if (!host || !marker) return;
    const place = () => {
      const target = host.querySelector<HTMLElement>(selector);
      if (!target) {
        marker.style.opacity = "0";
        return;
      }
      marker.style.opacity = "1";
      marker.style.width = `${target.offsetWidth}px`;
      marker.style.transform = `translateX(${target.offsetLeft}px)`;
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(host);
    void document.fonts?.ready.then(place);
    return () => resize.disconnect();
  }, [selector, selection]);
  return { container, pill };
}

const CURTAIN_IN_MS = 520;
const CURTAIN_OUT_MS = 580;

/** Sweeps the curtain up, swaps the route behind it, then lifts it. Transform only. */
export function throughCurtain(go: () => void) {
  const root = document.documentElement;
  if (prefersReducedMotion() || root.dataset.curtain) {
    go();
    return;
  }
  root.dataset.curtain = "in";
  window.setTimeout(() => {
    go();
    // Two frames, so the new page has painted before the curtain starts to leave.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        root.dataset.curtain = "out";
        window.setTimeout(() => delete root.dataset.curtain, CURTAIN_OUT_MS);
      }),
    );
  }, CURTAIN_IN_MS);
}
