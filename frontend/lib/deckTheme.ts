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

export const DECK_THEME_EVENT = "bc-deck-theme";
const EVENT = DECK_THEME_EVENT;

function read(): DeckTheme {
  return document.documentElement.getAttribute(ATTR) === "light" ? "light" : "dark";
}

export function setDeckTheme(theme: DeckTheme) {
  const root = document.documentElement;
  if (theme === "light") root.setAttribute(ATTR, "light");
  else root.removeAttribute(ATTR);
  try {
    // Remember "dark" too, so an admin-set light default does not override it.
    localStorage.setItem(STORAGE_KEY, theme);
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
