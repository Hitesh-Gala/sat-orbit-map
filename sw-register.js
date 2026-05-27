// Register the offline-cache service worker on every page that includes
// this file.  Quiet on browsers without SW support.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
