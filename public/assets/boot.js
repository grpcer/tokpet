// -------- History --------
window.addEventListener('popstate', function () {
  if (location.hash === '#add-provider') {
    if (!app.wizardActive) startAddProvider();
  } else if (app.wizardActive) {
    app.wizardActive = false;
    document.body.classList.remove('mode-add');
    refreshAll(false);
  }
});

// -------- Boot --------
refreshAll(false).then(function () {
  if (location.hash === '#add-provider') startAddProvider();
});
scheduleAuto();
