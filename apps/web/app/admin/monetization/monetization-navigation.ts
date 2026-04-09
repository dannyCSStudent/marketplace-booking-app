"use client";

export function scrollToMonetizationSection(sectionId: string) {
  const element = document.getElementById(sectionId);
  if (!element) {
    return;
  }

  element.scrollIntoView({ behavior: "smooth", block: "start" });
  highlightMonetizationSection(sectionId);
}

export function highlightMonetizationSection(sectionId: string) {
  const element = document.getElementById(sectionId);
  if (!element) {
    return;
  }

  if (typeof element.animate === "function") {
    element.animate(
      [
        { boxShadow: "0 0 0 0 rgba(202, 164, 106, 0)", backgroundColor: "rgba(255, 247, 235, 0)" },
        { boxShadow: "0 0 0 4px rgba(202, 164, 106, 0.65)", backgroundColor: "rgba(255, 247, 235, 0.95)" },
        { boxShadow: "0 0 0 0 rgba(202, 164, 106, 0)", backgroundColor: "rgba(255, 247, 235, 0)" },
      ],
      { duration: 1400, easing: "ease-out" },
    );
    return;
  }

  const previousTransition = element.style.transition;
  const previousBoxShadow = element.style.boxShadow;
  const previousBackgroundColor = element.style.backgroundColor;
  element.style.transition = "box-shadow 0.25s ease, background-color 0.25s ease";
  element.style.boxShadow = "0 0 0 4px rgba(202, 164, 106, 0.65)";
  element.style.backgroundColor = "rgba(255, 247, 235, 0.95)";

  window.setTimeout(() => {
    element.style.boxShadow = previousBoxShadow;
    element.style.backgroundColor = previousBackgroundColor;
    element.style.transition = previousTransition;
  }, 1400);
}
