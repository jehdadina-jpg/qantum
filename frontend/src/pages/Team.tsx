import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import { useState, type CSSProperties } from "react";
import { Digits } from "../components/Digits";
import { TransitionLink } from "../components/TransitionLink";
import { Wordmark } from "../components/Wordmark";

const TEAM = [
  { name: "Jeh Dadina", id: "16010124038", photo: "jeh-dadina" },
  { name: "Rishi Dadia", id: "16010124037", photo: "rishi-dadia" },
  { name: "Shrish Alva", id: "16010124006", photo: "shrish-alva" },
];

const EXTENSIONS = ["jpg", "png", "webp"];

function Portrait({ name, photo }: { name: string; photo: string }) {
  const [attempt, setAttempt] = useState(0);
  const missing = attempt >= EXTENSIONS.length;
  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden">
      {!missing && (
        <img
          src={`/team/${photo}.${EXTENSIONS[attempt]}`}
          alt={`Portrait of ${name}`}
          onError={() => setAttempt((value) => value + 1)}
          className="absolute inset-0 size-full object-cover object-top transition-transform duration-700 ease-[var(--ease-smooth-out)] group-hover:scale-[1.04]"
        />
      )}
      {missing && (
        <div className="state-one absolute inset-0 flex flex-col justify-between p-5 md:p-6">
          <span className="poster text-[clamp(5rem,15vw,15rem)] select-none" aria-hidden>
            {name
              .split(" ")
              .map((part) => part[0])
              .join("")}
          </span>
          <div>
            <p className="text-[15px] font-bold">Photo goes here</p>
            <p className="mono-tight mt-1 text-[11px] leading-relaxed break-all">frontend/public/team/{photo}.jpg</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Team() {
  return (
    <div className="flex min-h-[100dvh] flex-col overflow-x-clip">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4 md:px-5">
        <TransitionLink to="/" aria-label="QANTUM home">
          <Wordmark className="text-[17px]" />
        </TransitionLink>
        <TransitionLink to="/" className="flex items-center gap-2 text-[13px] font-semibold text-dim transition-colors hover:text-text">
          <ArrowLeft size={14} weight="bold" /> Back
        </TransitionLink>
      </header>

      <main className="flex flex-1 flex-col">
        <div className="px-4 pt-6 pb-5 md:px-5 md:pt-8">
          <h1 className="poster text-[clamp(3.6rem,18.6vw,22rem)]">
            <span className="line-mask">
              <span className="line-rise" style={{ "--d": "80ms" } as CSSProperties}>
                Made by
              </span>
            </span>
          </h1>
          <p className="soft-in mt-4 text-[clamp(1rem,1.4vw,1.25rem)] leading-[1.4] text-dim" style={{ "--d": "280ms" } as CSSProperties}>
            QANTUM is our final-year project in the Department of Computer Engineering.
          </p>
        </div>

        <div className="grid border-t border-line md:grid-cols-3">
          {TEAM.map((member, index) => (
            <article key={member.id} className="group soft-in flex flex-col border-line md:border-l md:first:border-l-0" style={{ "--d": `${360 + index * 110}ms` } as CSSProperties}>
              <div>
                <Portrait name={member.name} photo={member.photo} />
              </div>
              <div className="border-t border-line px-4 py-4 md:px-5">
                <h2 className="poster text-[clamp(1.7rem,3.4vw,3.4rem)] !leading-[1]">{member.name}</h2>
                <p className="mt-2 font-mono text-[14px] text-em tnum [font-stretch:87.5%]">
                  <Digits value={member.id} />
                </p>
              </div>
            </article>
          ))}
        </div>

        <TransitionLink to="/terminal/optimise" className="fill-button group flex h-20 shrink-0 items-center justify-between px-4 md:h-24 md:px-5">
          <span className="poster text-[clamp(1.6rem,4vw,3.6rem)]">Open terminal</span>
          <ArrowRight size={32} weight="bold" className="nudge" />
        </TransitionLink>
      </main>
    </div>
  );
}
