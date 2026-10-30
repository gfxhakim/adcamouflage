import { useSyncExternalStore } from "react";

import { DECK_THEME_ATTR as ATTR, DECK_THEME_STORAGE_KEY as STORAGE_KEY } from "@/lib/deckThemeScript";

/**
 * Black / white background choice for the signed-in workspace pages.
 *
 * The choice lives on <html data-deck-theme="light">. Black is the default and
 * means "no attribute". The dark Command Deck styles and every Tailwind `dark:`
 * variant only switch on while that attribute is absent, so flipping it is all
 * the toggle has to do.
 */
export type DeckTheme = "dark" | "light";

const EVENT = "bc-deck-theme";

function read(): DeckTheme {
  return document.documentElement.getAttribute(ATTR) === "light" ? "light" : "dark";
}

export function setDeckTheme(theme: DeckTheme) {
  const root = document.documentElement;
  if (theme === "light") root.setAttribute(ATTR, "light");
  else root.removeAttribute(ATTR);
  try {
    if (theme === "light") localStorage.setItem(STORAGE_KEY, "light");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode / blocked storage: the switch still works for this visit.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function useDeckTheme(): DeckTheme {
  return useSyncExternalStore(subscribe, read, () => "dark");
}
