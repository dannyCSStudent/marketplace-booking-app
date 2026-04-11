"use client";

import { useEffect, useState } from "react";

type HomeResumeTarget = {
  label: string;
  href: string;
};

type HomeResumeState = {
  label: string;
  href: string;
  createdAt: string;
};

const HOME_RESUME_KEY = "buyer_home_resume_target";

function formatResumeTimestamp(createdAt: string) {
  return new Date(createdAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function readHomeResumeState() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(HOME_RESUME_KEY);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as Partial<HomeResumeState>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.label !== "string" ||
      typeof parsed.href !== "string" ||
      typeof parsed.createdAt !== "string"
    ) {
      return null;
    }

    return {
      label: parsed.label,
      href: parsed.href,
      createdAt: parsed.createdAt,
    } satisfies HomeResumeState;
  } catch {
    window.localStorage.removeItem(HOME_RESUME_KEY);
    return null;
  }
}

function writeHomeResumeState(target: HomeResumeTarget) {
  if (typeof window === "undefined") {
    return;
  }

  const next: HomeResumeState = {
    ...target,
    createdAt: new Date().toISOString(),
  };
  window.localStorage.setItem(HOME_RESUME_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("home-resume-target-updated"));
}

export function saveHomeResumeTarget(target: HomeResumeTarget) {
  writeHomeResumeState(target);
}

export function clearHomeResumeTarget() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(HOME_RESUME_KEY);
  window.dispatchEvent(new Event("home-resume-target-updated"));
}

export function HomeResumeHeaderCue() {
  const [savedTarget, setSavedTarget] = useState<HomeResumeState | null>(null);

  useEffect(() => {
    const sync = () => setSavedTarget(readHomeResumeState());

    sync();
    window.addEventListener("home-resume-target-updated", sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener("home-resume-target-updated", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (!savedTarget) {
    return (
      <span className="inline-flex rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/56">
        No saved section
      </span>
    );
  }

  return (
    <a
      href={savedTarget.href}
      className="inline-flex rounded-full border border-foreground bg-foreground px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-background transition hover:opacity-90"
    >
      Resume last section · {savedTarget.label}
    </a>
  );
}

export function HomeResumePanel({
  sections,
}: {
  sections: HomeResumeTarget[];
}) {
  const [savedTarget, setSavedTarget] = useState<HomeResumeState | null>(null);

  useEffect(() => {
    const sync = () => setSavedTarget(readHomeResumeState());

    sync();
    window.addEventListener("home-resume-target-updated", sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener("home-resume-target-updated", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function resumeSavedTarget() {
    if (!savedTarget) {
      return;
    }

    if (savedTarget.href.startsWith("#")) {
      document.querySelector(savedTarget.href)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }

    window.location.assign(savedTarget.href);
  }

  function setSection(target: HomeResumeTarget) {
    writeHomeResumeState(target);

    if (target.href.startsWith("#")) {
      document.querySelector(target.href)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }

    window.location.assign(target.href);
  }

  return (
    <section className="card-shadow rounded-[2rem] border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-foreground/52">
            Resume Session
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
            Continue where you left off
          </h2>
          <p className="mt-2 text-sm leading-6 text-foreground/68">
            Keep the last homepage destination in view so you can jump back into the same browse
            lane without rebuilding it.
          </p>
        </div>
        {savedTarget ? (
          <button
            type="button"
            onClick={clearHomeResumeTarget}
            className="rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-accent hover:text-accent"
          >
            Clear history
          </button>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {savedTarget ? (
          <button
            type="button"
            onClick={resumeSavedTarget}
            className="rounded-full border border-foreground bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-background"
          >
            Resume last section · {savedTarget.label}
          </button>
        ) : (
          <span className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground/56">
            No saved section
          </span>
        )}
        {savedTarget ? (
          <span className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground/56">
            Saved {formatResumeTimestamp(savedTarget.createdAt)}
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {sections.map((section) => (
          <button
            key={section.label}
            type="button"
            onClick={() => setSection(section)}
            className="rounded-full border border-border bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-accent hover:text-accent"
          >
            {section.label}
          </button>
        ))}
      </div>
    </section>
  );
}
