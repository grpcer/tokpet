// -------- Render --------
function renderDashboard() {
  renderUpdateBanner();
  renderStatus();
  renderNow();
  renderProviders();
  renderDevices();
  renderNetwork();
  renderDiagnostics();
}

function renderUpdateBanner() {
  var banner = $('updateBanner');
  if (!banner) return;
  var info = app.runtime && app.runtime.update;
  var show = !!(info && info.available && info.latest && !app.updateDismissed);
  if (show) {
    $('updateBannerText').innerHTML =
      'Tokpet ' + esc(info.latest) + ' is available. Update with <code>brew upgrade tokpet</code>.';
  }
  banner.classList.toggle('on', show);
}

function renderStatus() {
  var sv = $('serviceStatus');
  var svSub = $('serviceSub');
  var st = $('stateStatus');
  var stSub = $('stateSub');
  var dv = $('deviceStatus');
  var dvSub = $('deviceSub');
  var pv = $('providerStatus');
  var pvSub = $('providerSub');

  var portMatch = (
    (app.runtime && app.runtime.service && app.runtime.service.localUrl) ||
    ''
  ).match(/:(\d+)/);
  var port = portMatch ? portMatch[1] : '4717';

  if (!app.online) {
    sv.innerHTML = '<span class="dot dot--bad"></span>Offline';
    svSub.textContent = 'tap retry above';
  } else {
    sv.innerHTML = '<span class="dot dot--ok"></span>Running';
    svSub.textContent = 'port ' + port;
  }

  if (!app.snapshot) {
    st.innerHTML = '<span class="dot dot--warn"></span>Unavailable';
    stSub.textContent = 'no fetch yet';
  } else {
    var rel = relativeTime(app.snapshot.fetchedAt) || '—';
    st.innerHTML = '<span class="dot dot--ok"></span>v' + app.snapshot.version;
    stSub.textContent = 'updated ' + rel;
  }

  var devices = (app.runtime && app.runtime.devices) || [];
  var connected = devices.filter(function (d) {
    return d.status === 'connected';
  }).length;
  var recent = devices.filter(function (d) {
    return d.status === 'recent';
  }).length;
  if (!devices.length) {
    dv.innerHTML = '<span class="dot"></span>Waiting';
    dvSub.textContent = 'no devices yet';
  } else if (connected) {
    dv.innerHTML = '<span class="dot dot--ok"></span>' + connected + ' online';
    dvSub.textContent = recent ? recent + ' recently seen' : devices[0].ip || 'one Tokpet';
  } else if (recent) {
    dv.innerHTML = '<span class="dot dot--warn"></span>' + recent + ' recent';
    dvSub.textContent = 'may have slept';
  } else {
    dv.innerHTML = '<span class="dot dot--bad"></span>' + devices.length + ' silent';
    dvSub.textContent = 'check Wi-Fi';
  }

  var active = activeProviders().length;
  var total = app.providers.length;
  var dotCls = active ? 'dot--ok' : 'dot--warn';
  pv.innerHTML = '<span class="dot ' + dotCls + '"></span>' + active + ' active';
  if (!total) {
    pvSub.textContent = 'none connected';
  } else if (total > active) {
    pvSub.textContent = total - active + ' more available';
  } else {
    pvSub.textContent = 'all wired up';
  }
}

function renderNow() {
  var ring = $('nowRing');
  var metric = $('nowMetric');
  var label = $('nowLabel');
  var sub = $('nowSub');
  var mood = $('nowMood');
  var moodSub = $('nowMoodSub');
  var moodName = mood.querySelector('.mood-name');

  function setMood(key) {
    var meta = MOOD_LEGEND[key] || MOOD_LEGEND.idle;
    moodName.textContent = key;
    moodSub.textContent = meta.sub;
    mood.title = meta.desc;
  }
  // Arc tween — set the registered @property --ring-pct; the conic-gradient
  // in CSS animates the sweep angle for us. Clear any inline background
  // override left over from the empty state.
  function setRing(pct) {
    ring.style.background = '';
    ring.style.setProperty('--ring-pct', String(pct));
  }
  // Number tween — rAF-driven so it works in browsers without @property
  // counter() support and stays cancellable between renders. Snaps under
  // prefers-reduced-motion or when source/target match.
  function tweenNumText(el, from, to, suffix, dur) {
    if (!el) return;
    if (el._raf) cancelAnimationFrame(el._raf);
    var reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || from === to || typeof requestAnimationFrame !== 'function') {
      el.textContent = to + suffix;
      return;
    }
    var start = performance.now();
    function step(t) {
      var p = Math.min(1, (t - start) / dur);
      // easeOutCirc — mirrors the CSS --ease curve.
      var eased = Math.sqrt(1 - Math.pow(1 - p, 2));
      var v = Math.round(from + (to - from) * eased);
      el.textContent = v + suffix;
      if (p < 1) el._raf = requestAnimationFrame(step);
      else {
        el._raf = 0;
        el.textContent = to + suffix;
      }
    }
    el._raf = requestAnimationFrame(step);
  }

  var primary = app.snapshot && app.snapshot.primary;
  if (!primary) {
    metric.classList.add('is-empty');
    metric.removeAttribute('data-pct');
    var hasActive = activeProviders().length;
    metric.innerHTML =
      '<span class="num">' +
      (hasActive ? '…' : '—') +
      '</span><span class="cap">' +
      (hasActive ? 'fetching' : 'no data') +
      '</span>';
    label.textContent = hasActive ? 'Providers are wired up.' : 'No data yet.';
    sub.textContent = hasActive
      ? 'Waiting for the first usage sample.'
      : 'Add a provider so the cat has something to watch.';
    setMood(hasActive ? 'idle' : 'empty');
    // Faint empty-state track. Reset --ring-pct so the next active sweep
    // tweens from 0 instead of snapping back to the last value.
    ring.style.background =
      'conic-gradient(from -90deg, rgba(255,255,255,.18) 0deg, rgba(255,255,255,.08) 0deg)';
    ring.style.setProperty('--ring-pct', '0');
    return;
  }

  var provider = providerById(primary.providerId);
  var pct = Math.max(0, Math.min(100, Math.round(primary.usedPct)));
  var prevPct = parseFloat(metric.getAttribute('data-pct'));
  var hasPrev = !isNaN(prevPct);
  metric.setAttribute('data-pct', String(pct));
  metric.classList.remove('is-empty');
  // First render shows the target value directly so screen readers / tests
  // see the correct number without waiting on a frame. Subsequent renders
  // start at prev and tween to pct.
  var startVal = hasPrev ? prevPct : pct;
  metric.innerHTML = '<span class="num">' + startVal + '%</span><span class="cap">used</span>';
  if (hasPrev && prevPct !== pct) {
    tweenNumText(metric.querySelector('.num'), prevPct, pct, '%', 500);
  }

  var sp = stateProvider(primary.providerId);
  var win = null;
  if (sp && sp.result && Array.isArray(sp.result.windows)) {
    win = sp.result.windows.find(function (w) {
      return w.id === primary.windowId;
    });
  }
  label.textContent =
    (provider ? provider.displayName : primary.providerId) +
    ' · ' +
    (win && win.label ? win.label : primary.windowId);

  if (win && win.resetsAt) {
    sub.innerHTML = 'Resets ' + esc(relativeTime(win.resetsAt) || 'soon');
    sub.title = absoluteTime(win.resetsAt);
  } else {
    sub.textContent = '';
  }

  setMood(primary.mood || 'idle');
  setRing(pct);
}

var _providersSig = '';
function renderProviders() {
  var active = activeProviders();
  // Signature covers identity + order + mode so cosmetic data ticks
  // (usage % changing) don't trigger a View Transition every 5s.
  var sig =
    active
      .map(function (p) {
        return p.id + ':' + (p.mode || '');
      })
      .join(';') || '@empty';
  var prevSig = _providersSig;
  _providersSig = sig;
  var animate =
    prevSig !== '' &&
    prevSig !== sig &&
    typeof document.startViewTransition === 'function' &&
    document.visibilityState === 'visible';
  if (animate) {
    document.startViewTransition(function () {
      renderProvidersInner(active);
    });
  } else {
    renderProvidersInner(active);
  }
}
function renderProvidersInner(active) {
  var list = $('providersList');
  if (!active.length) {
    var detectedAvailable = app.providers.filter(function (p) {
      return p.available && !p.activated;
    }).length;
    var sampleChips = app.providers
      .slice(0, 4)
      .map(function (p) {
        return (
          '<span class="chip">' +
          brandMarkSmall(p.id, p.displayName) +
          esc(p.displayName) +
          '</span>'
        );
      })
      .join('');
    list.innerHTML =
      '<div class="empty-hero">' +
      '<div class="illus">' +
      icon('rocket', 'lg') +
      '</div>' +
      '<h3>Wire up your first provider</h3>' +
      '<p>Tokpet only reads what’s already on this Mac — your Claude Code login, API keys you store locally, that kind of thing. Nothing leaves the machine.</p>' +
      (sampleChips ? '<div class="chips">' + sampleChips + '</div>' : '') +
      '<div class="empty-actions">' +
      '<button class="btn btn--primary" onclick="startAddProvider()">' +
      icon('plus', 'sm') +
      'Add provider</button>' +
      (detectedAvailable
        ? '<span class="hint" style="font-size:var(--fs-sm)">' +
          detectedAvailable +
          ' detected on this Mac</span>'
        : '') +
      '</div>' +
      '</div>';
    return;
  }
  list.innerHTML = active
    .map(function (p, i) {
      return renderProviderCard(p, i, active.length);
    })
    .join('');
}

function brandMarkSmall(providerId, displayName) {
  var meta = PROVIDER_META[providerId] || {};
  var name = displayName || providerId || '';
  if (meta.logoUrl) {
    return (
      '<span class="source-mark source-mark--xs">' +
      '<img class="logo-img" src="' +
      esc(meta.logoUrl) +
      '" alt="" loading="lazy">' +
      '</span>'
    );
  }
  var initial = (name || '?').charAt(0).toUpperCase();
  return (
    '<span class="source-mark source-mark--xs source-mark--initial">' + esc(initial) + '</span>'
  );
}

function brandMark(providerId, displayName, cls) {
  var meta = PROVIDER_META[providerId] || {};
  var rootCls = cls || 'source-mark';
  // Brand SVGs in /brand-logos/ now ship their own brand-colour fill, so
  // render via <img> (no CSS mask) — that preserves multi-colour glyphs
  // like Gemini's gradient and keeps each vendor instantly recognisable.
  if (meta.logoUrl) {
    return (
      '<div class="' +
      rootCls +
      '">' +
      '<img class="logo-img" src="' +
      esc(meta.logoUrl) +
      '" alt="" loading="lazy">' +
      '</div>'
    );
  }
  var initial = (displayName || providerId || '?').charAt(0).toUpperCase();
  return '<div class="' + rootCls + ' ' + rootCls + '--initial">' + esc(initial) + '</div>';
}

function providerStatus(provider, sp) {
  var result = sp && sp.result;
  if (!result) {
    return { pillClass: '', label: 'Fetching…', iconName: null, kind: 'loading' };
  }
  if (result.kind === 'error') {
    var info = errorInfo(result, provider && (provider.displayName || provider.id));
    var bad = result.code === 'auth-expired' || result.code === 'not-configured';
    return {
      pillClass: bad ? 'pill--bad' : 'pill--warn',
      label: info.short,
      kind: 'error',
      info: info,
    };
  }
  // Pre-paid wallet: balance.remaining <= 0 overrides the source-based pill
  // so users see the empty state without scrolling past the freshness chrome.
  var emptyWallet =
    result.mode === 'api-key' &&
    result.balance &&
    typeof result.balance.remaining === 'number' &&
    result.balance.remaining <= 0;
  // Healthy / cached / stale / live
  var source = result.source || 'live';
  var fetched = result.fetchedAt ? new Date(result.fetchedAt).getTime() : null;
  var ageSec = fetched ? (Date.now() - fetched) / 1000 : null;
  if (source === 'stale') {
    var staleAgeLabel = relativeTime(result.staleSince || result.fetchedAt) || 'moments ago';
    if (emptyWallet) return { pillClass: 'pill--bad', label: 'Empty', kind: 'ok' };
    // Stale = something's actually wrong → keep warn colour.
    return { pillClass: 'pill--warn', label: 'Stale · ' + staleAgeLabel, kind: 'stale' };
  }
  if (source === 'cached' || (ageSec != null && ageSec > 300)) {
    var ageLabel = relativeTime(result.fetchedAt) || 'stale';
    if (emptyWallet) return { pillClass: 'pill--bad', label: 'Empty', kind: 'ok' };
    // Cached = metadata, not alarm. Use neutral meta styling so the row
    // doesn't compete visually with real warnings.
    return { pillClass: 'pill--meta', label: 'Cached · ' + ageLabel, kind: 'cached' };
  }
  if (emptyWallet) return { pillClass: 'pill--bad', label: 'Empty', kind: 'ok' };
  return { pillClass: 'pill--ok', label: 'Healthy', kind: 'ok' };
}

function renderProviderCard(provider, index, total) {
  var sp = stateProvider(provider.id);
  var result = sp && sp.result;
  var status = providerStatus(provider, sp);
  var meta = PROVIDER_META[provider.id] || {};
  var primaryId =
    app.snapshot && app.snapshot.primary && app.snapshot.primary.providerId === provider.id
      ? app.snapshot.primary.windowId
      : null;

  var body = '';
  if (status.kind === 'loading') {
    body =
      '<div class="empty"><div class="empty-icon">' +
      icon('refresh') +
      '</div><div><div class="empty-title">Fetching first sample…</div>The companion will report usage shortly.</div></div>';
  } else if (status.kind === 'error') {
    body =
      '<div class="error-banner"><strong>' +
      esc(status.info.title) +
      '</strong><span class="hint">' +
      esc(status.info.hint) +
      '</span></div>';
  } else if (result && Array.isArray(result.windows) && result.windows.length) {
    body =
      '<div class="usage">' +
      result.windows
        .map(function (w) {
          var pct = Math.max(0, Math.min(100, Math.round(w.usedPct || 0)));
          var isPrimary = w.id === primaryId;
          return (
            '<div class="window-row">' +
            '<div class="window-label">' +
            esc(w.label || w.id) +
            (isPrimary
              ? '<span class="featured-mark">' + icon('pet', 'sm') + 'Featured</span>'
              : '') +
            '</div>' +
            '<div class="window-pct">' +
            pct +
            '%</div>' +
            '<div class="bar"><div class="fill ' +
            fillClass(pct) +
            '" style="width:' +
            (pct > 0 ? 'max(' + pct + '%, 10px)' : '0') +
            '"></div></div>' +
            (w.resetsAt
              ? '<div class="window-meta">Resets ' +
                esc(relativeTime(w.resetsAt) || 'soon') +
                ' <span class="abs" title="' +
                esc(absoluteTime(w.resetsAt)) +
                '">(' +
                esc(absoluteTime(w.resetsAt)) +
                ')</span></div>'
              : '') +
            '</div>'
          );
        })
        .join('') +
      '</div>';
  } else if (result && result.balance && typeof result.balance.remaining === 'number') {
    body = renderBalanceBlock(result.balance);
  } else {
    body =
      '<div class="empty"><div class="empty-icon">' +
      icon('info') +
      '</div><div>This provider is active but reported no usage in the current window.</div></div>';
  }

  var nameHtml = '<span>' + esc(provider.displayName || provider.id) + '</span>';
  if (meta.dashboardUrl) {
    nameHtml =
      '<a class="name-link" href="' +
      esc(meta.dashboardUrl) +
      '" target="_blank" rel="noopener" title="' +
      esc(meta.dashboardLabel || 'Open provider') +
      '">' +
      esc(provider.displayName || provider.id) +
      ' ' +
      icon('external', 'sm') +
      '</a>';
  }

  var lastUpdate =
    result && result.fetchedAt
      ? relativeTime(result.fetchedAt)
      : app.snapshot
        ? relativeTime(app.snapshot.fetchedAt)
        : null;

  // Display order controls. We render them when there are 2+ cards so a
  // single-provider console doesn't grow disabled chrome.
  var orderControls = '';
  if (typeof total === 'number' && total > 1) {
    var atTop = index <= 0;
    var atBot = index >= total - 1;
    orderControls =
      '<div class="order-controls" role="group" aria-label="Reorder provider">' +
      '<button class="btn btn--sm order-btn" title="Move up"' +
      (atTop ? ' disabled' : '') +
      ' onclick="moveProvider(\'' +
      esc(provider.id) +
      '\', -1)">' +
      icon('arrow-up', 'sm') +
      '</button>' +
      '<button class="btn btn--sm order-btn" title="Move down"' +
      (atBot ? ' disabled' : '') +
      ' onclick="moveProvider(\'' +
      esc(provider.id) +
      '\', 1)">' +
      icon('arrow-down', 'sm') +
      '</button>' +
      '</div>';
  }

  // View-transition-name lets the browser morph card position when the
  // list reorders. Sanitise the provider id to a valid <custom-ident>.
  var vtName = 'provider-' + String(provider.id).replace(/[^a-z0-9]/gi, '-');
  return (
    '<article class="provider" style="view-transition-name:' +
    vtName +
    '">' +
    '<div class="provider-head">' +
    '<div><div class="source-main">' +
    brandMark(provider.id, provider.displayName) +
    '<div style="min-width:0">' +
    '<div class="name">' +
    nameHtml +
    '</div>' +
    '<div class="meta">' +
    esc(modeLabel(provider.mode)) +
    (lastUpdate ? ' · updated ' + esc(lastUpdate) : '') +
    '</div>' +
    '</div>' +
    '</div></div>' +
    '<div class="provider-head-right">' +
    orderControls +
    '<span class="pill ' +
    status.pillClass +
    '">' +
    esc(status.label) +
    '</span>' +
    '</div>' +
    '</div>' +
    body +
    '<div class="provider-actions">' +
    // Refresh: icon-only — it's the most frequent / least destructive
    // action so it doesn't need to shout. Tooltip carries the label.
    '<button class="btn btn--sm btn--icon" title="Refresh" aria-label="Refresh" onclick="refreshAll(true)">' +
    icon('refresh', 'sm') +
    '</button>' +
    '<button class="btn btn--sm" onclick="openReconnect(\'' +
    esc(provider.id) +
    '\')">' +
    icon('reconnect', 'sm') +
    'Reconnect</button>' +
    // api-key providers (DeepSeek, future OpenAI/Anthropic API, ...) keep
    // a user-provided secret in ~/.tokpet/config.json. "Reconnect" just
    // re-tests the stored one; "Update key" lets the user rotate it.
    (provider.mode === 'api-key'
      ? '<button class="btn btn--sm" onclick="startUpdateKey(\'' +
        esc(provider.id) +
        '\')">' +
        icon('key', 'sm') +
        'Update key</button>'
      : '') +
    // Remove pushed to the far right, icon-only, danger colour only on
    // hover — destructive action should NOT visually compete with daily ops.
    '<button class="btn btn--sm btn--icon btn--remove" title="Remove" aria-label="Remove" onclick="openRemove(\'' +
    esc(provider.id) +
    '\')">' +
    icon('trash', 'sm') +
    '</button>' +
    '</div>' +
    '</article>'
  );
}

// Open the wizard pointed straight at the connect card, with the existing
// api-key + baseUrl prefilled so the user can rotate / fix the credential
// without re-walking the picker.
function startUpdateKey(id) {
  if (!Array.isArray(app.providers)) {
    refreshAll(false).then(function () {
      startUpdateKey(id);
    });
    return;
  }
  var p = providerById(id);
  if (!p || p.mode !== 'api-key') return;
  app.mode = p.mode;
  app.provider = id;
  app.wizardActive = true;
  document.body.classList.add('mode-add');

  // Key-only chrome: hide sections 1 & 2 via the modifier class, drop the
  // step dots and rewrite the header for rotation context.
  document.querySelector('.wizard').classList.add('wizard--key-only');
  $('stepDone').setAttribute('hidden', '');
  $('wizardForm').removeAttribute('hidden');
  $('wizardTitle').textContent = 'Update API key';
  $('wizardSub').textContent =
    'Paste a new key for ' +
    p.displayName +
    ' — the existing one stays until this one tests green.';

  renderConnectPanel();
  $('connectTitle').textContent = 'Update ' + p.displayName + ' key';
  // updateConnectButton owns disabled state; override the label after it runs
  // so the rotation flow reads "Save & reconnect" instead of "Reconnect".
  updateConnectButton();
  var cBtn = $('connectBtn');
  if (cBtn) {
    var span = cBtn.querySelector('span');
    if (span) span.textContent = 'Save & reconnect';
  }

  if (history.pushState) {
    history.pushState({ wizard: true }, '', '#update-key/' + encodeURIComponent(id));
  }
  // Pull the stored config from the loopback /api/config endpoint and
  // prefill the form. /api/config returns the same JSON we wrote to
  // ~/.tokpet/config.json so we can recover the original apiKey + baseUrl.
  api('GET', '/api/config').then(function (cfg) {
    var stored = cfg && cfg.providers && cfg.providers[id];
    if (!stored || typeof stored !== 'object') return;
    var keyEl = $('connectApiKey');
    var baseEl = $('connectBaseUrl');
    var helpEl = $('connectApiKeyHelp');
    if (typeof stored.apiKey === 'string' && stored.apiKey) {
      keyEl.value = stored.apiKey;
      onConnectFieldInput();
      // Make clear this is the existing key, not an empty placeholder —
      // otherwise users habitually paste over it without realising.
      if (helpEl)
        helpEl.textContent = 'Loaded current key. Paste a new one to replace, or close to keep it.';
    }
    if (typeof stored.baseUrl === 'string' && stored.baseUrl) {
      baseEl.value = stored.baseUrl;
      var adv = $('connectAdvanced');
      if (adv) adv.open = true;
    }
  });
}

// Reorder the activated providers by ±1 step. Persists the new order via
// POST /api/providers/reorder; the next /state poll reflects the change on
// both the console and the device tiles.
function moveProvider(id, delta) {
  var active = activeProviders();
  var idx = active.findIndex(function (p) {
    return p.id === id;
  });
  if (idx < 0) return;
  var target = idx + delta;
  if (target < 0 || target >= active.length) return;
  var ids = active.map(function (p) {
    return p.id;
  });
  var tmp = ids[idx];
  ids[idx] = ids[target];
  ids[target] = tmp;
  // Optimistically reorder the local list so the cards animate immediately;
  // we re-sync from the next refreshAll().
  var moved = app.providers.slice();
  moved.sort(function (a, b) {
    var ia = ids.indexOf(a.id);
    var ib = ids.indexOf(b.id);
    if (ia < 0 && ib < 0) return 0;
    if (ia < 0) return 1;
    if (ib < 0) return -1;
    return ia - ib;
  });
  app.providers = moved;
  renderDashboard();
  api('POST', '/api/providers/reorder', { order: ids }).then(function (result) {
    if (!result || !result.ok) {
      // Snapshot drift will get re-synced on the next poll.
      refreshAll(false);
    } else {
      refreshAll(false);
    }
  });
}

function renderDevices() {
  var list = $('devicesList');
  var devices = (app.runtime && app.runtime.devices) || [];
  if (!devices.length) {
    list.innerHTML =
      '<div class="empty-hero">' +
      '<div class="illus" style="background:linear-gradient(135deg,#ffd9b8,#ffb38a);color:#a14b13">' +
      icon('device', 'lg') +
      '</div>' +
      '<h3>No Tokpet hardware yet</h3>' +
      '<p>Plug a device in, follow the captive portal at <span class="mono">tokpet-setup</span> Wi-Fi, then come back — it should appear within seconds.</p>' +
      '</div>';
    return;
  }
  list.innerHTML = devices
    .map(function (device) {
      var cls =
        device.status === 'connected'
          ? 'pill--ok'
          : device.status === 'recent'
            ? 'pill--warn'
            : 'pill--bad';
      var statusLabel =
        device.status === 'connected'
          ? 'Online'
          : device.status === 'recent'
            ? 'Recently seen'
            : 'Silent';
      var ua = device.userAgent || 'unknown client';
      var lastSeen = relativeTime(device.lastSeenAt) || '—';
      var sub =
        device.status === 'connected'
          ? 'polling now · ' + device.pollCount + ' requests so far'
          : 'last seen ' + lastSeen + ' · ' + device.pollCount + ' requests';
      return (
        '<article class="device">' +
        '<div class="device-head">' +
        '<div>' +
        '<div class="device-name">' +
        icon('device', 'sm') +
        '<span class="name">Tokpet · ' +
        esc(device.ip) +
        '</span></div>' +
        '<div class="meta">' +
        esc(sub) +
        '</div>' +
        '<details class="dev-detail"><summary>Details</summary>' +
        '<dl class="dl">' +
        '<dt>Client</dt><dd>' +
        esc(ua) +
        '</dd>' +
        '<dt>IP</dt><dd>' +
        esc(device.ip) +
        '</dd>' +
        '<dt>Last seen</dt><dd>' +
        esc(absoluteTime(device.lastSeenAt)) +
        '</dd>' +
        '<dt>Requests</dt><dd>' +
        esc(String(device.pollCount)) +
        '</dd>' +
        '</dl>' +
        '</details>' +
        '</div>' +
        '<span class="pill ' +
        cls +
        '">' +
        esc(statusLabel) +
        '</span>' +
        '</div>' +
        '</article>'
      );
    })
    .join('');
}

function mdnsPill(status) {
  var label =
    status === 'published'
      ? 'Published'
      : status === 'stopped'
        ? 'Stopped'
        : status === 'failed'
          ? 'Failed'
          : status === 'unknown' || !status
            ? 'Unknown'
            : status;
  var cls = status === 'published' ? 'pill--ok' : status === 'failed' ? 'pill--bad' : 'pill--warn';
  return '<span class="pill ' + cls + '">' + esc(label) + '</span>';
}

function renderNetwork() {
  var runtime = app.runtime;
  var service = runtime && runtime.service;
  var lanUrls =
    service && Array.isArray(service.lanStateUrls)
      ? service.lanStateUrls.filter(function (u) {
          return u && u.indexOf('http') === 0;
        })
      : [];
  var localUrl = service && service.localUrl ? service.localUrl : 'http://localhost:4717/';
  var mdnsStatus = runtime && runtime.mdns ? runtime.mdns.status : 'unknown';
  var mdnsRaw =
    runtime && runtime.mdns ? runtime.mdns : { service: '_tokpet._tcp.local', port: 4717 };
  var mdnsService = (mdnsRaw.service || '_tokpet._tcp.local') + ':' + (mdnsRaw.port || 4717);

  app.stateUrl = lanUrls[0] || location.origin + '/state';

  function openBtn(u, label) {
    return (
      '<a class="btn btn--sm" href="' +
      esc(u) +
      '" target="_blank" rel="noopener" aria-label="' +
      esc(label || 'Open ' + u) +
      '">' +
      icon('external', 'sm') +
      'Open</a>'
    );
  }

  var deviceBlock =
    '<div class="net-section">' +
    '<div class="net-section-head"><div><h3>Tokpet device discovery</h3><p>How official hardware finds this companion.</p></div>' +
    mdnsPill(mdnsStatus) +
    '</div>' +
    '<div class="url-list">' +
    '<div class="url-line url-line--actions"><code>' +
    esc(mdnsService) +
    '</code>' +
    copyButton(mdnsService, 'mDNS service') +
    '<span></span></div>' +
    '<div class="url-line url-line--actions"><code>' +
    esc(localUrl) +
    '</code>' +
    copyButton(localUrl, 'console URL') +
    openBtn(localUrl, 'Open console') +
    '</div>' +
    '</div>' +
    '</div>';

  var stateBlock;
  if (!lanUrls.length) {
    stateBlock =
      '<div class="net-section">' +
      '<div class="net-section-head"><div><h3>State API for third-party clients</h3><p>No LAN address detected yet — connect to a network and refresh.</p></div></div>' +
      '</div>';
  } else {
    stateBlock =
      '<div class="net-section">' +
      '<div class="net-section-head"><div><h3>State API for third-party clients</h3><p><span class="mono">GET /state</span> · no auth · cacheable JSON.</p></div></div>' +
      '<div class="url-list">' +
      lanUrls
        .map(function (u) {
          return (
            '<div class="url-line url-line--actions"><code>' +
            esc(u) +
            '</code>' +
            copyButton(u, 'state URL') +
            openBtn(u, 'Open state URL') +
            '</div>'
          );
        })
        .join('') +
      '</div>' +
      '</div>';
  }

  $('networkList').innerHTML = deviceBlock + stateBlock;
}

function renderDiagnostics() {
  var snap = app.snapshot;
  $('stateJson').textContent = JSON.stringify(snap || {}, null, 2);
  $('diagSchema').textContent = snap ? 'v' + snap.version : 'v—';
  $('diagFetched').textContent = snap ? relativeTime(snap.fetchedAt) || '—' : '—';
  $('diagProviderCount').textContent = snap ? (snap.providers || []).length : 0;
  renderSnippet();
}

function renderSnippet() {
  var url = app.stateUrl || 'http://localhost:4717/state';
  var kind = app.snippet || 'curl';
  var code = url;
  if (kind === 'curl') code = 'curl ' + url;
  else if (kind === 'httpie') code = 'http ' + url;
  else if (kind === 'fetch') code = 'fetch("' + url + '").then(r => r.json()).then(console.log)';
  $('diagSnippet').textContent = code;
}

function pickSnippet(kind) {
  app.snippet = kind;
  var btns = document.querySelectorAll('.tabs [data-snippet]');
  btns.forEach(function (b) {
    b.classList.toggle('on', b.dataset.snippet === kind);
  });
  renderSnippet();
}
