/**
 * Runs in <head> before the page paints. The intro belongs between opening the
 * site's link and the landing page, so it is switched off when the landing page
 * was reached by a hop inside the site (signing out, an ended session) rather
 * than by opening the link or refreshing. Without this the server-rendered
 * intro would flash before the component could hide it.
 */
export const INTRO_GATE_SCRIPT = `(function(){try{
var d=document.documentElement;
var nav=performance.getEntriesByType&&performance.getEntriesByType("navigation")[0];
if(nav&&nav.type==="reload")return;
var r=document.referrer;
if(r&&new URL(r).origin===location.origin)d.setAttribute("data-intro","off");
}catch(e){}})();`;
