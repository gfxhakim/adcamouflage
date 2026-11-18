/**
 * For half a second, real clicks do nothing. Call it when a click replaces what
 * is under the pointer (a result list turning back into the menu, a drawer
 * closing): the second click of a double click would otherwise press whatever
 * came up underneath.
 */
export function swallowSecondClick(ms = 500): void {
  const swallow = (event: MouseEvent) => {
    // Code pressing a button for the owner (a search jump opening a panel) still goes through.
    if (!event.isTrusted) return;
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", swallow, true);
  window.setTimeout(() => window.removeEventListener("click", swallow, true), ms);
}
