// -------- Reconnect dialog --------
function openReconnect(id) {
  var p = providerById(id);
  var name = p ? p.displayName : id;
  app.reconnectId = id;
  $('reconnectTitle').textContent = 'Reconnect ' + name + '?';
  $('reconnectCopy').textContent =
    'Tokpet will re-test the credentials for ' + name + ' and reactivate it.';
  $('reconnectError').style.display = 'none';
  var btn = $('reconnectConfirmBtn');
  btn.disabled = false;
  btn.removeAttribute('aria-busy');
  btn.textContent = 'Reconnect';
  $('reconnectDialog').classList.add('on');
  setTimeout(function () {
    btn.focus();
  }, 50);
}
function closeReconnectDialog() {
  app.reconnectId = null;
  $('reconnectDialog').classList.remove('on');
}
function confirmReconnect() {
  var id = app.reconnectId;
  if (!id) return;
  var btn = $('reconnectConfirmBtn');
  var err = $('reconnectError');
  err.style.display = 'none';
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  btn.textContent = 'Reconnecting…';
  var pForName = providerById(id);
  var nameForErr = pForName && (pForName.displayName || pForName.id);
  api('POST', '/api/providers/' + encodeURIComponent(id) + '/activate', {})
    .then(function (result) {
      btn.removeAttribute('aria-busy');
      if (!result || !result.ok) {
        var info = errorInfo(result && result.error, nameForErr);
        err.innerHTML =
          '<strong>' +
          esc(info.title) +
          '</strong><span class="hint">' +
          esc(info.hint) +
          '</span>';
        err.style.display = 'grid';
        btn.disabled = false;
        btn.textContent = 'Try again';
        return;
      }
      showToast('Provider reconnected.', 'ok');
      closeReconnectDialog();
      refreshAll(false);
    })
    .catch(function () {
      btn.removeAttribute('aria-busy');
      err.innerHTML =
        '<strong>Network error.</strong><span class="hint">Check that the Tokpet companion is running.</span>';
      err.style.display = 'grid';
      btn.disabled = false;
      btn.textContent = 'Try again';
    });
}

// -------- Remove dialog --------
function openRemove(id) {
  var p = providerById(id);
  var name = p ? p.displayName : id;
  app.removeId = id;
  $('removeTitle').textContent = 'Remove ' + name + '?';
  $('removeCopy').textContent =
    'This only removes ' + name + ' from Tokpet. Your provider login or credentials are untouched.';
  var btn = $('removeConfirmBtn');
  btn.disabled = false;
  btn.removeAttribute('aria-busy');
  btn.textContent = 'Remove';
  $('removeDialog').classList.add('on');
  setTimeout(function () {
    btn.focus();
  }, 50);
}
function closeRemoveDialog() {
  app.removeId = null;
  $('removeDialog').classList.remove('on');
}
function removeSelectedProvider() {
  var id = app.removeId;
  if (!id) return;
  var btn = $('removeConfirmBtn');
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  btn.textContent = 'Removing…';
  api('DELETE', '/api/providers/' + encodeURIComponent(id))
    .then(function (result) {
      btn.removeAttribute('aria-busy');
      if (!result || !result.ok) {
        showToast('Could not remove provider.', 'bad');
        btn.disabled = false;
        btn.textContent = 'Remove';
        return;
      }
      showToast('Provider removed.', 'ok');
      closeRemoveDialog();
      refreshAll(false);
    })
    .catch(function () {
      btn.removeAttribute('aria-busy');
      showToast('Could not remove provider.', 'bad');
      btn.disabled = false;
      btn.textContent = 'Remove';
    });
}

// -------- Modal keyboard --------
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    if ($('removeDialog').classList.contains('on')) closeRemoveDialog();
    else if ($('reconnectDialog').classList.contains('on')) closeReconnectDialog();
    else if (app.wizardActive) showDashboard();
  } else if (e.key === 'Enter') {
    if ($('removeDialog').classList.contains('on')) {
      e.preventDefault();
      $('removeConfirmBtn').click();
    } else if ($('reconnectDialog').classList.contains('on')) {
      e.preventDefault();
      $('reconnectConfirmBtn').click();
    }
  }
});
// Backdrop click closes modal
['removeDialog', 'reconnectDialog'].forEach(function (id) {
  var el = $(id);
  el.addEventListener('click', function (e) {
    if (e.target === el) {
      if (id === 'removeDialog') closeRemoveDialog();
      else closeReconnectDialog();
    }
  });
});
