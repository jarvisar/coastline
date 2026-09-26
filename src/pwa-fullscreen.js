// If an installed app opens windowed despite the manifest, go fullscreen on the
// first user gesture, which the Fullscreen API requires.
export function setupPwaFullscreen() {
  if (window.coastlineDesktop) return;
  const matches = mode => window.matchMedia(`(display-mode: ${mode})`).matches;
  const installed = matches('standalone') || matches('minimal-ui') || navigator.standalone === true;
  if (!installed || matches('fullscreen')) return;
  const request = document.documentElement.requestFullscreen ?? document.documentElement.webkitRequestFullscreen;
  if (!request) return;

  const remove = () => {
    window.removeEventListener('pointerup', enter, true);
    window.removeEventListener('keydown', enter, true);
  };
  function enter(event) {
    if (!event.isTrusted || (event.type === 'keydown' && (event.repeat || event.ctrlKey || event.metaKey || event.altKey || ['Escape', 'Shift', 'Control', 'Alt', 'Meta'].includes(event.key)))) return;
    remove();
    // Explicit fullscreen controls make their own request.
    if (event.code === 'KeyF' || event.key === 'F11' || event.target.closest?.('#fullscreen, .vr-entry')) return;
    if (document.fullscreenElement || document.webkitFullscreenElement || matches('fullscreen')) return;
    try {
      Promise.resolve(request.call(document.documentElement, { navigationUI: 'hide' })).catch(() => {});
    } catch { /* Not supported everywhere. */ }
  }
  window.addEventListener('pointerup', enter, true);
  window.addEventListener('keydown', enter, true);
}
