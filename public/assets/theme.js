// -------- Theme toggle --------
// 3-state cycle: system → light → dark → system. localStorage 'tokpet-theme'
// holds 'light' | 'dark', or is absent to follow the system. The inline
// <head> script already applied an initial theme before paint; here we
// wire the toggle button and live-sync the icon/label, and listen for
// system theme changes so the 'system' state actually follows.
(function () {
  var btn = document.getElementById('themeToggle');
  if (!btn) return;
  var mq = window.matchMedia && matchMedia('(prefers-color-scheme: dark)');
  var STORE_KEY = 'tokpet-theme';
  function readStored() {
    try {
      var v = localStorage.getItem(STORE_KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) {
      return null;
    }
  }
  function writeStored(v) {
    try {
      if (v === null) localStorage.removeItem(STORE_KEY);
      else localStorage.setItem(STORE_KEY, v);
    } catch (e) {
      /* private mode etc. — keep working in-memory only */
    }
  }
  function apply() {
    var stored = readStored();
    var effective = stored || (mq && mq.matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = effective;
    var iconRef = stored === 'light' ? '#i-sun' : stored === 'dark' ? '#i-moon' : '#i-monitor';
    var label = stored === null ? 'System' : stored === 'light' ? 'Light' : 'Dark';
    var use = btn.querySelector('use');
    if (use) use.setAttribute('href', iconRef);
    btn.title = 'Theme: ' + label + ' — click to cycle (System → Light → Dark)';
    btn.setAttribute('aria-label', 'Theme: ' + label);
  }
  btn.addEventListener('click', function () {
    var cur = readStored();
    var next = cur === null ? 'light' : cur === 'light' ? 'dark' : null;
    writeStored(next);
    apply();
  });
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', function () {
      if (readStored() === null) apply();
    });
  }
  apply();
})();
