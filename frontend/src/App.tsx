import { lazy, Suspense, useEffect } from "react";
import { createBrowserRouter, createRoutesFromElements, Navigate, Outlet, Route, ScrollRestoration } from "react-router-dom";
import { Wordmark } from "./components/Wordmark";
import TerminalLayout from "./pages/terminal/Layout";

const pages = {
  Landing: () => import("./pages/Landing"),
  Team: () => import("./pages/Team"),
  Markets: () => import("./pages/terminal/Markets"),
  Optimise: () => import("./pages/terminal/Optimise"),
  Risk: () => import("./pages/terminal/Risk"),
  Simulate: () => import("./pages/terminal/Simulate"),
  Circuits: () => import("./pages/terminal/Circuits"),
  Benchmarks: () => import("./pages/terminal/Benchmarks"),
  Runs: () => import("./pages/terminal/Runs"),
};

const Landing = lazy(pages.Landing);
const Team = lazy(pages.Team);
const Markets = lazy(pages.Markets);
const Optimise = lazy(pages.Optimise);
const Risk = lazy(pages.Risk);
const Simulate = lazy(pages.Simulate);
const Circuits = lazy(pages.Circuits);
const Benchmarks = lazy(pages.Benchmarks);
const Runs = lazy(pages.Runs);

function Root() {
  // Fetch every page once idle, so a route change never waits on the network.
  useEffect(() => {
    const load = () => Object.values(pages).forEach((page) => void page());
    const handle = window.setTimeout(load, 2500);
    return () => window.clearTimeout(handle);
  }, []);

  return (
    <>
      <Suspense fallback={<div className="min-h-[100dvh]" />}>
        <Outlet />
      </Suspense>
      <ScrollRestoration />
      <div aria-hidden className="curtain curtain-mint" />
      <div aria-hidden className="curtain curtain-ink">
        <span className="curtain-mark">
          <Wordmark className="text-[clamp(1.6rem,3vw,2.6rem)]" />
        </span>
      </div>
    </>
  );
}

export const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<Root />}>
      <Route path="/" element={<Landing />} />
      <Route path="/team" element={<Team />} />
      <Route path="/terminal" element={<TerminalLayout />}>
        <Route index element={<Navigate to="optimise" replace />} />
        <Route path="markets" element={<Markets />} />
        <Route path="optimise" element={<Optimise />} />
        <Route path="risk" element={<Risk />} />
        <Route path="simulate" element={<Simulate />} />
        <Route path="circuits" element={<Circuits />} />
        <Route path="benchmarks" element={<Benchmarks />} />
        <Route path="runs" element={<Runs />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>,
  ),
);
