// -------- Wizard --------
function startAddProvider() {
  if (!Array.isArray(app.providers)) {
    // Still loading — wait a tick
    refreshAll(false).then(startAddProvider);
    return;
  }
  app.mode = null;
  app.provider = null;
  app.wizardActive = true;

  document.body.classList.add('mode-add');
  document.querySelector('.wizard').classList.remove('wizard--key-only');
  $('wizardTitle').textContent = 'Add provider';
  $('wizardSub').textContent = 'Pick a method, vendor, and connect — all on one page.';
  $('stepDone').setAttribute('hidden', '');
  $('wizardForm').removeAttribute('hidden');

  renderModes();
  renderProviderOptions();
  renderConnectPanel();
  updateConnectButton();

  if (history.pushState) {
    history.pushState({ wizard: true }, '', '#add-provider');
  }
  setTimeout(function () {
    var first = document.querySelector('.wizard .mode:not(:disabled)');
    if (first) first.focus();
  }, 50);
}

// Merged list per mode: registered providers (connected/available) plus the
// roadmap entries that aren't shipped yet. Status drives UI affordances.
function vendorsForMode(mode) {
  var registered = app.providers.filter(function (p) {
    return p.mode === mode;
  });
  var list = registered.map(function (p) {
    return {
      id: p.id,
      displayName: p.displayName,
      mode: p.mode,
      status: p.activated ? 'connected' : p.available ? 'available' : 'unavailable',
      eta: null,
    };
  });
  var seen = {};
  list.forEach(function (v) {
    seen[v.id] = true;
  });
  (ROADMAP[mode] || []).forEach(function (r) {
    if (seen[r.id]) return;
    list.push({
      id: r.id,
      displayName: r.displayName,
      mode: mode,
      status: 'planned',
      eta: r.eta,
    });
  });
  return list;
}
function actionableVendors(mode) {
  return vendorsForMode(mode).filter(function (v) {
    return v.status === 'available' || v.status === 'connected';
  });
}

function showDashboard() {
  app.wizardActive = false;
  document.body.classList.remove('mode-add');
  var w = document.querySelector('.wizard');
  if (w) w.classList.remove('wizard--key-only');
  if (location.hash) {
    history.replaceState({}, '', location.pathname + location.search);
  }
  refreshAll(false);
}

function providersIn(mode) {
  return app.providers.filter(function (p) {
    return p.mode === mode && p.available && !p.activated;
  });
}
function allProvidersIn(mode) {
  return app.providers.filter(function (p) {
    return p.mode === mode && p.available;
  });
}

function renderModes() {
  $('modes').innerHTML = MODES.map(function (mode) {
    var meta = MODE_META[mode];
    var list = vendorsForMode(mode);
    var available = list.filter(function (v) {
      return v.status === 'available';
    }).length;
    var connected = list.filter(function (v) {
      return v.status === 'connected';
    }).length;
    var planned = list.filter(function (v) {
      return v.status === 'planned';
    }).length;

    var tagText, tagCls;
    if (available) {
      tagText = available + ' ready';
      tagCls = '';
    } else if (connected && planned) {
      tagText = connected + ' active · ' + planned + ' planned';
      tagCls = 'tag--ok';
    } else if (connected) {
      tagText = connected + ' active';
      tagCls = 'tag--ok';
    } else if (planned) {
      tagText = planned + ' planned';
      tagCls = 'tag--muted';
    } else {
      tagText = 'No vendors yet';
      tagCls = 'tag--muted';
    }
    var tagIcon = tagCls === 'tag--ok' ? 'check' : available ? 'sparkle' : 'info';

    var iconCls =
      meta.tone === 'ok'
        ? 'mode-icon mode-icon--ok'
        : meta.tone === 'warn'
          ? 'mode-icon mode-icon--warn'
          : 'mode-icon';
    var selCls = app.mode === mode ? ' sel' : '';
    return (
      '<button class="mode' +
      selCls +
      '" type="button"' +
      ' onclick="pickMode(\'' +
      esc(mode) +
      '\', this)">' +
      (meta.recommended && available ? '<span class="ribbon">recommended</span>' : '') +
      '<div class="' +
      iconCls +
      '">' +
      icon(meta.icon || 'info', 'lg') +
      '</div>' +
      '<div class="mode-text">' +
      '<h3 class="mode-title">' +
      esc(meta.title) +
      '</h3>' +
      '<p class="mode-desc">' +
      esc(meta.desc) +
      '</p>' +
      '</div>' +
      '<span class="mode-tag ' +
      tagCls +
      '">' +
      icon(tagIcon, 'sm') +
      tagText +
      '</span>' +
      (meta.example ? '<div class="mode-example">e.g. ' + esc(meta.example) + '</div>' : '') +
      '</button>'
    );
  }).join('');
}

function pickMode(mode, el) {
  if (app.mode === mode) return;
  // Guard: if the user already started filling out a connect form, ask
  // before discarding it. A silent reset is the textbook "feels janky"
  // moment that reviewers flagged.
  if (hasPendingConnectInput()) {
    var prev = providerById(app.provider);
    var prevName = prev ? prev.displayName : 'your selection';
    showInlineConfirm(
      'sectionMode',
      'Switching method will discard ' + prevName + '. Continue?',
      function onConfirm() {
        applyModePick(mode, el);
      },
    );
    return;
  }
  applyModePick(mode, el);
}

function applyModePick(mode, el) {
  app.mode = mode;
  app.provider = null; // vendor list belongs to the new mode
  document.querySelectorAll('.mode').forEach(function (n) {
    n.classList.remove('sel');
  });
  if (!el) el = document.querySelector('.mode[onclick*="\'' + mode + '\'"]');
  if (el) el.classList.add('sel');
  renderProviderOptions();
  renderConnectPanel();
  updateConnectButton();
  // Slide section 2 into view so the next choice is visible without scrolling.
  var vendorSection = $('sectionVendor');
  if (vendorSection && vendorSection.scrollIntoView) {
    vendorSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// True iff the user has typed something into the connect form OR has a
// vendor selected. Used to gate destructive context resets.
function hasPendingConnectInput() {
  if (!app.provider) return false;
  var keyEl = document.getElementById('connectApiKey');
  var baseEl = document.getElementById('connectBaseUrl');
  var key = keyEl ? (keyEl.value || '').trim() : '';
  var base = baseEl ? (baseEl.value || '').trim() : '';
  return !!(key || base);
}

// Inline confirm bar attached to the bottom of a section. Lighter than
// a native browser dialog and stays in the page flow so the user sees
// what they're discarding. Auto-dismisses on Cancel or Confirm.
function showInlineConfirm(sectionId, message, onConfirm) {
  var section = document.getElementById(sectionId);
  if (!section) {
    onConfirm();
    return;
  }
  var existing = section.querySelector('.wz-confirm');
  if (existing) existing.remove();
  var bar = document.createElement('div');
  bar.className = 'wz-confirm';
  bar.innerHTML =
    '<span class="wz-confirm-msg"></span>' +
    '<div class="wz-confirm-actions">' +
    '<button type="button" class="btn btn--sm" data-act="cancel">Keep</button>' +
    '<button type="button" class="btn btn--sm btn--danger" data-act="confirm">Discard</button>' +
    '</div>';
  bar.querySelector('.wz-confirm-msg').textContent = message;
  section.appendChild(bar);
  bar.querySelector('[data-act="cancel"]').onclick = function () {
    bar.remove();
  };
  bar.querySelector('[data-act="confirm"]').onclick = function () {
    bar.remove();
    onConfirm();
  };
  // Focus the discard button so Enter / Space confirms quickly for keyboard users.
  setTimeout(function () {
    bar.querySelector('[data-act="confirm"]').focus();
  }, 50);
}

function renderProviderOptions() {
  var section = $('sectionVendor');
  var host = $('providerOptions');
  if (!app.mode) {
    section.setAttribute('data-locked', 'true');
    $('vendorSectionTitle').textContent = 'Pick a vendor';
    $('vendorSectionHint').textContent = 'Pick a method above first.';
    host.innerHTML = '<div class="wz-empty">Pick a method above to see vendors.</div>';
    return;
  }
  section.removeAttribute('data-locked');
  $('vendorSectionTitle').textContent = 'Pick a ' + modeLabel(app.mode).toLowerCase() + ' vendor';

  var vendors = vendorsForMode(app.mode);
  var actionable = vendors.filter(function (v) {
    return v.status === 'available' || v.status === 'connected';
  });
  $('vendorSectionHint').textContent = actionable.length
    ? 'Tap any vendor to ' +
      (actionable.some(function (v) {
        return v.status === 'available';
      })
        ? 'connect or reconnect'
        : 'reconnect') +
      '. Planned ones preview the roadmap.'
    : 'Nothing connectable yet — every vendor in this category is on the roadmap.';

  host.innerHTML = vendors
    .map(function (v) {
      var meta = PROVIDER_META[v.id] || {};
      var blurb = meta.blurb || modeLabel(v.mode) + ' · ready to connect';
      var pill, attrs;
      if (v.status === 'connected') {
        pill = '<span class="pill pill--ok">Connected</span>';
        attrs = 'onclick="pickProvider(\'' + esc(v.id) + '\', this)"';
      } else if (v.status === 'available') {
        pill =
          '<span class="pill" style="background:var(--neutral-soft);color:var(--brand-1)">Ready</span>';
        attrs = 'onclick="pickProvider(\'' + esc(v.id) + '\', this)"';
      } else {
        pill = '<span class="pill pill--warn">' + esc(v.eta || 'planned') + '</span>';
        attrs =
          'disabled aria-disabled="true" title="Not shipped yet — Tokpet will surface this vendor as soon as it lands."';
      }
      var selCls = app.provider === v.id ? ' sel' : '';
      return (
        '<button class="provider-option' +
        selCls +
        '" type="button" ' +
        attrs +
        '>' +
        brandMark(v.id, v.displayName, 'opt-mark') +
        '<div class="opt-body">' +
        '<div class="opt-name">' +
        esc(v.displayName) +
        ' ' +
        pill +
        '</div>' +
        '<div class="opt-sub">' +
        esc(blurb) +
        '</div>' +
        '</div>' +
        (v.status === 'planned'
          ? '<div class="opt-arrow" style="opacity:.35">' + icon('info', 'sm') + '</div>'
          : '<div class="opt-arrow">' + icon('arrow-right', 'sm') + '</div>') +
        '</button>'
      );
    })
    .join('');
}

function pickProvider(id, el) {
  if (app.provider === id) return;
  app.provider = id;
  document.querySelectorAll('.provider-option').forEach(function (n) {
    n.classList.remove('sel');
  });
  if (el) el.classList.add('sel');
  renderConnectPanel();
  updateConnectButton();
  var connectSection = $('sectionConnect');
  if (connectSection && connectSection.scrollIntoView) {
    connectSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  // For api-key vendors, drop focus into the key field so the user can paste right away.
  var p = providerById(id);
  if (p && p.mode === 'api-key') {
    setTimeout(function () {
      var k = $('connectApiKey');
      if (k) k.focus();
    }, 250);
  }
}

// Populate the connect card from app.provider. Lock the section (and hide
// the card) when no vendor is chosen yet.
function renderConnectPanel() {
  var section = $('sectionConnect');
  var card = $('connectCard');
  var hintEl = $('connectHint');

  if (!app.provider) {
    section.setAttribute('data-locked', 'true');
    $('connectTitle').textContent = 'Review & connect';
    hintEl.textContent = app.mode ? 'Pick a vendor above first.' : 'Pick a method, then a vendor.';
    if (card) card.setAttribute('hidden', '');
    $('connectError').style.display = 'none';
    return;
  }
  section.removeAttribute('data-locked');

  var p = providerById(app.provider);
  var pmeta = PROVIDER_META[app.provider] || {};
  var label = p ? p.displayName : 'provider';
  $('connectTitle').textContent = 'Review & connect ' + label;
  hintEl.textContent =
    "Tokpet tests the credentials before activating, so a broken provider can't get enabled.";

  if (card) card.removeAttribute('hidden');

  // Replace #connectMark in-place with a freshly-rendered brand mark, then
  // re-stamp the id so subsequent renderConnectPanel calls can find it again.
  var markHost = $('connectMark');
  markHost.outerHTML = brandMark(app.provider, label, 'opt-mark');
  var ckHd = $('connectCard').querySelector('.ck-hd');
  var newMark = ckHd && ckHd.firstElementChild;
  if (newMark) newMark.id = 'connectMark';

  $('connectMethod').textContent =
    p && p.mode === 'subscription'
      ? 'Local credential reuse'
      : p && p.mode === 'api-key'
        ? 'API key on this machine'
        : 'Configured upstream';
  $('connectCopy').textContent =
    pmeta.blurb ||
    (p && p.mode === 'subscription'
      ? 'Tokpet will reuse credentials already stored on this machine.'
      : 'Tokpet will validate the credentials configured for this provider.');

  $('connectReadList').textContent =
    pmeta.readList || 'Plan windows, used percentage, reset times.';

  var hint = $('connectSourceHint');
  var hintText = $('connectSourceText');
  if (pmeta.sourceHint) {
    hintText.textContent = pmeta.sourceHint;
    hint.removeAttribute('hidden');
  } else {
    hint.setAttribute('hidden', '');
  }

  var docs = $('connectDocs');
  if (pmeta.docsUrl) {
    docs.href = pmeta.docsUrl;
    $('connectDocsLabel').textContent = pmeta.docsLabel || 'Provider docs';
    docs.removeAttribute('hidden');
  } else {
    docs.setAttribute('hidden', '');
  }

  $('connectError').style.display = 'none';

  // Toggle api-key fields. Pre-fill baseUrl per-provider so users see the
  // expected default and don't accidentally point at a stale proxy.
  var fields = $('connectFields');
  var keyInput = $('connectApiKey');
  var baseInput = $('connectBaseUrl');
  if (p && p.mode === 'api-key') {
    fields.removeAttribute('hidden');
    keyInput.value = '';
    baseInput.value = '';
    baseInput.placeholder = providerBaseUrlPlaceholder(p.id);
    $('connectAdvanced').open = false;
    resetApiKeyVisibility(); // re-entry always starts masked
  } else {
    fields.setAttribute('hidden', '');
  }
}

// Compute Connect button enabled state + label from current selection.
function updateConnectButton() {
  var btn = $('connectBtn');
  if (!btn) return;
  var p = providerById(app.provider);
  var span = btn.querySelector('span');
  btn.removeAttribute('aria-busy');
  if (!app.provider) {
    btn.disabled = true;
    if (span) span.textContent = 'Connect';
    return;
  }
  if (p && p.mode === 'api-key') {
    var key = ($('connectApiKey').value || '').trim();
    btn.disabled = !key;
  } else {
    btn.disabled = false;
  }
  if (span) span.textContent = p && p.activated ? 'Reconnect' : 'Connect';
}

function providerBaseUrlPlaceholder(id) {
  if (id === 'deepseek') return 'https://api.deepseek.com';
  return 'https://api.example.com';
}

function onConnectFieldInput() {
  // Don't reuse updateConnectButton — it also rewrites the label, which
  // would clobber the "Save & reconnect" label set by startUpdateKey.
  var btn = $('connectBtn');
  if (!btn) return;
  var key = ($('connectApiKey').value || '').trim();
  btn.disabled = !key;
}

// Show / hide the API key so users can verify what's currently stored
// (during Update key) or what they're about to submit (during Add).
function toggleApiKeyVisibility() {
  var input = $('connectApiKey');
  var toggle = $('connectApiKeyToggle');
  if (!input || !toggle) return;
  var showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  var label = showing ? 'Show key' : 'Hide key';
  toggle.setAttribute('aria-label', label);
  toggle.setAttribute('title', label);
  toggle.classList.toggle('is-on', !showing);
}

function resetApiKeyVisibility() {
  var input = $('connectApiKey');
  var toggle = $('connectApiKeyToggle');
  if (input) input.type = 'password';
  if (toggle) {
    toggle.setAttribute('aria-label', 'Show key');
    toggle.setAttribute('title', 'Show key');
    toggle.classList.remove('is-on');
  }
}

function collectConnectBody() {
  var p = providerById(app.provider);
  if (p && p.mode === 'api-key') {
    var body = { apiKey: ($('connectApiKey').value || '').trim() };
    var base = ($('connectBaseUrl').value || '').trim();
    if (base) body.baseUrl = base;
    return body;
  }
  return {};
}

function setConnectBtnLabel(text) {
  var btn = document.getElementById('connectBtn');
  if (!btn) return;
  var span = btn.querySelector('span');
  if (span) span.textContent = text;
}

function activateProvider() {
  var id = app.provider;
  if (!id) return;
  var err = $('connectError');
  var btn = $('connectBtn');
  var body = $('wizardForm');
  err.style.display = 'none';
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  if (body) body.classList.add('is-submitting'); // locks the rest of the page so a stray click can't race the request
  setConnectBtnLabel('Connecting…');
  var pForName = providerById(id);
  var nameForErr = pForName && (pForName.displayName || pForName.id);
  api('POST', '/api/providers/' + encodeURIComponent(id) + '/activate', collectConnectBody())
    .then(function (result) {
      btn.removeAttribute('aria-busy');
      if (body) body.classList.remove('is-submitting');
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
        setConnectBtnLabel('Try again');
        return;
      }
      showToast('Provider connected.', 'ok');
      app.wizardActive = false;
      document.body.classList.remove('mode-add');
      document.querySelector('.wizard').classList.remove('wizard--key-only');
      if (location.hash) history.replaceState({}, '', location.pathname);
      refreshAll(false);
    })
    .catch(function () {
      btn.removeAttribute('aria-busy');
      if (body) body.classList.remove('is-submitting');
      err.innerHTML =
        '<strong>Network error reaching the local service.</strong><span class="hint">Check that the Tokpet companion is running, then try again.</span>';
      err.style.display = 'grid';
      btn.disabled = false;
      setConnectBtnLabel('Try again');
    });
}

// Cmd/Ctrl+Enter (or Enter from inside the api-key field) submits the
// connect form — the keyboard shortcut every native-feeling form has.
function onConnectKeydown(e) {
  if (e.key !== 'Enter') return;
  var btn = document.getElementById('connectBtn');
  if (!btn || btn.disabled || btn.hasAttribute('aria-busy')) return;
  // For the API key / base URL fields: plain Enter or Cmd/Ctrl+Enter both submit.
  var fromKey = e.target && (e.target.id === 'connectApiKey' || e.target.id === 'connectBaseUrl');
  if (fromKey || e.metaKey || e.ctrlKey) {
    e.preventDefault();
    activateProvider();
  }
}
