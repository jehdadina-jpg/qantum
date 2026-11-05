import { Suspense, useEffect, useRef, type CSSProperties } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { TransitionLink } from "../../components/TransitionLink";
import { Wordmark } from "../../components/Wordmark";
import { ErrorNote, Skeleton } from "../../components/ui";
import type { Meta } from "../../lib/api";
import { useFetch } from "../../lib/hooks";
import { date, shortHash } from "../../lib/format";
import { useSlidingPill } from "../../lib/motion";

const NAV = [
  { to: "markets", label: "Markets" },
  { to: "optimise", label: "Optimise" },
  { to: "risk", label: "Risk" },
  { to: "simulate", label: "Simulate" },
  { to: "circuits", label: "Circuits" },
  { to: "benchmarks", label: "Benchmarks" },
  { to: "runs", label: "Runs" },
];

export default function TerminalLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: meta, error } = useFetch<Meta>("/meta");
  const { container, pill } = useSlidingPill<HTMLElement>('a[aria-current="page"]', pathname);

  // The new workspace slides in from the direction of travel along the nav.
  const index = NAV.findIndex((item) => pathname.endsWith(item.to));
  const previous = useRef(index);
  const direction = index >= previous.current ? 1 : -1;
  useEffect(() => {
    previous.current = index;
  }, [index]);

  // On narrow screens the nav scrolls, so keep the active workspace in view.
  useEffect(() => {
    const center = () => {
      const nav = container.current;
      const active = nav?.querySelector<HTMLElement>('a[aria-current="page"]');
      if (nav && active) nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    };
    center();
    // Tab widths change when the web font arrives.
    void document.fonts.ready.then(center);
  }, [pathname, container]);

  // Keys 1 to 7 switch workspace, as the proposal asks for a keyboard-navigable terminal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      const item = NAV[Number(event.key) - 1];
      if (item) navigate(`/terminal/${item.to}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-30 flex h-12 items-stretch border-b border-line bg-ink pl-4">
        <TransitionLink to="/" className="mr-5 flex shrink-0 items-center" aria-label="QANTUM home">
          <Wordmark className="text-[17px]" />
        </TransitionLink>
        <nav ref={container} className="relative flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]" aria-label="Workspaces">
          <span ref={pill} className="pill bg-em" />
          {NAV.map((item, position) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={`Press ${position + 1}`}
              className={({ isActive }) => `relative flex shrink-0 items-center px-3.5 text-[13px] font-semibold transition-colors duration-100 ${isActive ? "text-ink" : "text-dim hover:text-text"}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        {meta && (
          <div className="mono-tight hidden shrink-0 items-center gap-4 pl-4 text-[11px] text-dim tnum xl:flex">
            <span>
              prices to <span className="text-text">{date(meta.snapshot.end)}</span>
            </span>
            <span>
              snapshot <span className="text-text">{shortHash(meta.snapshot.sha256)}</span>
            </span>
          </div>
        )}
        <TransitionLink to="/team" className="hidden shrink-0 items-center px-4 text-[13px] font-semibold text-dim transition-colors hover:text-text sm:flex">
          Team
        </TransitionLink>
      </header>
      <main className="min-w-0 flex-1 overflow-x-clip p-2 md:p-3">
        {error && (
          <div className="mb-2">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        <div key={pathname} className="page-in" style={{ "--page-dir": direction } as CSSProperties}>
          <Suspense fallback={<Skeleton className="h-[70vh]" />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
