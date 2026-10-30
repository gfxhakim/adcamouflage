export const DECK_THEME_STORAGE_KEY = "bc-deck-theme";
export const DECK_THEME_ATTR = "data-deck-theme";

/** Runs in <head> before paint, so a saved white background never flashes black. */
export const DECK_THEME_SCRIPT = `(function(){try{if(localStorage.getItem("${DECK_THEME_STORAGE_KEY}")==="light")document.documentElement.setAttribute("${DECK_THEME_ATTR}","light");}catch(e){}})();`;
