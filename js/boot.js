// Offline app + cross-origin isolation (needed for Python's shared memory) on hosts that cannot set headers.
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (self.crossOriginIsolated) sessionStorage.removeItem('pilab-coi');
  var again = function () { if (!self.crossOriginIsolated && !sessionStorage.getItem('pilab-coi')) { sessionStorage.setItem('pilab-coi', '1'); location.reload(); } };
  navigator.serviceWorker.register('sw.js').then(function (reg) {
    if (navigator.serviceWorker.controller) again(); else navigator.serviceWorker.addEventListener('controllerchange', again);
  }).catch(function () {});
})();
