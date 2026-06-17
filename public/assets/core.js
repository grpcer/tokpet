// -------- Static data --------
var MODE_META = {
  subscription: {
    title: 'Subscription',
    desc: 'Plan quota, rolling windows, vendor limits.',
    example: 'Claude Code · Codex · ChatGPT Plus',
    icon: 'shield',
    tone: 'ok',
    recommended: true,
  },
  'api-key': {
    title: 'Balance lookup',
    desc: 'Direct API key — wallet, spend and remaining credit.',
    example: 'Anthropic API · OpenAI API · Gemini',
    icon: 'zap',
    tone: 'default',
    recommended: false,
  },
  relay: {
    title: 'Relay / proxy',
    desc: 'Balance or quota from a third-party gateway.',
    example: 'OpenRouter · Together · KeyAI',
    icon: 'link',
    tone: 'warn',
    recommended: false,
  },
};
var MODES = ['subscription', 'api-key', 'relay'];

// Per-provider metadata that isn't (yet) in /api/providers
var PROVIDER_META = {
  claude: {
    tone: 'claude',
    mark: 'claude',
    logoUrl: '/brand-logos/claude.svg',
    blurb:
      'Plan quota, weekly rolling window and Opus limit fed straight from your Claude Code login.',
    sourceHint: 'Reuses your Claude Code login (macOS Keychain or ~/.claude/.credentials.json).',
    readList: 'Plan name, 5-hour window, this-week window and Opus usage percentage.',
    dashboardUrl: 'https://claude.ai/settings/usage',
    dashboardLabel: 'Open Claude usage',
    docsUrl: 'https://claude.ai/settings/usage',
    docsLabel: 'View on claude.ai',
  },
  codex: {
    tone: 'codex',
    mark: 'codex',
    logoUrl: '/brand-logos/openai.svg',
    blurb: 'ChatGPT-subscription rate-limit windows fed straight from your Codex CLI login.',
    sourceHint: 'Reuses your Codex CLI login (~/.codex/auth.json, ChatGPT subscription).',
    readList: 'Plan type, 5-hour window and this-week window usage percentage.',
    dashboardUrl: 'https://chatgpt.com/codex',
    dashboardLabel: 'Open ChatGPT',
    docsUrl: 'https://chatgpt.com/codex',
    docsLabel: 'View on chatgpt.com',
  },
  'openai-plus': {
    tone: 'openai',
    mark: 'openai',
    logoUrl: '/brand-logos/openai.svg',
    blurb: 'ChatGPT Plus / Team plan limits and rate windows.',
    readList: 'Plan tier, remaining messages, rate-limit windows.',
  },
  cursor: {
    tone: 'cursor',
    mark: 'cursor',
    logoUrl: '/brand-logos/cursor.svg',
    blurb: 'Cursor Pro completions and fast-request balance.',
    readList: 'Fast / slow request balance, refresh date.',
  },
  windsurf: {
    tone: 'windsurf',
    mark: 'windsurf',
    logoUrl: '/brand-logos/windsurf.svg',
    blurb: 'Windsurf Flow credits and plan quota.',
    readList: 'Flow credits, plan tier, reset schedule.',
  },
  'anthropic-api': {
    tone: 'anthropic',
    mark: 'anthropic',
    logoUrl: '/brand-logos/anthropic.svg',
    blurb: 'Anthropic API balance and credit burn.',
    readList: 'Workspace balance, recent spend, hourly throughput.',
  },
  'openai-api': {
    tone: 'openai',
    mark: 'openai',
    logoUrl: '/brand-logos/openai.svg',
    blurb: 'OpenAI API credit balance and rate limits.',
    readList: 'Hard limit, soft limit, usage so far this month.',
  },
  'gemini-api': {
    tone: 'gemini',
    mark: 'gemini',
    logoUrl: '/brand-logos/gemini.svg',
    blurb: 'Gemini API quotas and rate windows.',
    readList: 'Per-minute and per-day request quota.',
  },
  deepseek: {
    tone: 'deepseek',
    mark: 'deepseek',
    logoUrl: '/brand-logos/deepseek.svg',
    blurb: 'DeepSeek API wallet balance — pre-paid credits, read from /user/balance only.',
    readList: 'Remaining wallet balance and currency.',
    dashboardUrl: 'https://platform.deepseek.com/usage',
    dashboardLabel: 'Open DeepSeek usage',
    docsUrl: 'https://api-docs.deepseek.com/api/get-user-balance',
    docsLabel: 'View balance API docs',
  },
  openrouter: {
    tone: 'openrouter',
    mark: 'openrouter',
    logoUrl: '/brand-logos/openrouter.svg',
    blurb: 'OpenRouter wallet and per-model spend.',
    readList: 'Wallet balance, recent spend, throttling state.',
  },
};

// Vendors planned but not yet shipped — surfaced in the wizard so users see
// the roadmap instead of a dead end. Frontend-only; if a vendor lands in
// /api/providers it shadows the planned entry.
var ROADMAP = {
  subscription: [
    { id: 'codex', displayName: 'Codex CLI', eta: 'next up' },
    { id: 'openai-plus', displayName: 'ChatGPT Plus / Team', eta: 'planned' },
    { id: 'cursor', displayName: 'Cursor Pro', eta: 'planned' },
    { id: 'windsurf', displayName: 'Windsurf', eta: 'planned' },
  ],
  'api-key': [
    { id: 'anthropic-api', displayName: 'Anthropic API', eta: 'next up' },
    { id: 'openai-api', displayName: 'OpenAI API', eta: 'next up' },
    { id: 'gemini-api', displayName: 'Gemini API', eta: 'planned' },
  ],
  relay: [{ id: 'openrouter', displayName: 'OpenRouter', eta: 'next up' }],
};

var MOOD_LEGEND = {
  chill: { sub: 'calm and quiet', desc: 'Under 50% used — relaxed.', tone: 'ok' },
  nervous: { sub: 'keeping watch', desc: 'Past 50% — the cat is watching.', tone: 'warn' },
  panic: { sub: 'tail puffed up', desc: 'Over 80% — the cat is panicking.', tone: 'bad' },
  idle: { sub: 'waiting for data', desc: 'No usage data yet.', tone: 'idle' },
  empty: { sub: 'no providers', desc: 'No providers connected.', tone: 'idle' },
};

// -------- State --------
var app = {
  providers: [],
  runtime: null,
  snapshot: null,
  mode: null,
  provider: null,
  stateUrl: '/state',
  removeId: null,
  reconnectId: null,
  wizardActive: false,
  autoTimer: null,
  refreshing: false,
  online: true,
};

var $ = function (id) {
  return document.getElementById(id);
};

// -------- Networking --------
function api(method, url, body) {
  return fetch(url, {
    method: method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(function (res) {
    return res.text().then(function (text) {
      var json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch (e) {
        json = { ok: false, error: { message: text || 'Unexpected response from local service.' } };
      }
      if (!res.ok) {
        json.ok = false;
        json.__status = res.status;
        if (!json.error) json.error = { message: 'Request failed (' + res.status + ').' };
      }
      return json;
    });
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// -------- Helpers --------
function activeProviders() {
  return app.providers.filter(function (p) {
    return p.activated;
  });
}
function providerById(id) {
  return app.providers.find(function (p) {
    return p.id === id;
  });
}
function stateProvider(id) {
  return ((app.snapshot && app.snapshot.providers) || []).find(function (p) {
    return p.id === id;
  });
}
function modeLabel(mode) {
  return (MODE_META[mode] && MODE_META[mode].title) || mode;
}

function relativeTime(value) {
  if (!value) return null;
  var t = new Date(value).getTime();
  if (isNaN(t)) return null;
  var diff = (t - Date.now()) / 1000;
  var abs = Math.abs(diff);
  var sign = diff >= 0 ? 'in ' : '';
  var ago = diff >= 0 ? '' : ' ago';
  if (abs < 60) return diff >= 0 ? 'in <1m' : 'just now';
  if (abs < 3600) return sign + Math.round(abs / 60) + 'm' + ago;
  if (abs < 86400) {
    var h = Math.floor(abs / 3600);
    var m = Math.round((abs % 3600) / 60);
    return sign + h + 'h' + (m ? ' ' + m + 'm' : '') + ago;
  }
  if (abs < 86400 * 14) {
    var d = Math.floor(abs / 86400);
    var hh = Math.round((abs % 86400) / 3600);
    return sign + d + 'd' + (hh ? ' ' + hh + 'h' : '') + ago;
  }
  var w = Math.round(abs / (86400 * 7));
  return sign + w + 'w' + ago;
}

function absoluteTime(value) {
  if (!value) return '';
  var d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  var pad = function (n) {
    return n < 10 ? '0' + n : '' + n;
  };
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    ' ' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  );
}

function fillClass(pct) {
  // Premium-tool semantics: brand neutral up to 80%, warn above, bad at 95+.
  // "50% used" should not look the same shade of alarm as "90% used".
  if (pct >= 95) return 'fill--bad';
  if (pct >= 80) return 'fill--warn';
  return '';
}

// Pre-paid wallet renderer (DeepSeek, etc.). Reads balance.remaining + currency.
// `balance.remaining <= 0` flips the block to the empty/bad state without
// emitting a UsageError — the wallet is just out of credit.
var CURRENCY_SYMBOLS = { USD: '$', CNY: '¥', EUR: '€' };
function formatBalance(amount, currency) {
  var sym = CURRENCY_SYMBOLS[currency] || '';
  var n = Number(amount);
  if (!Number.isFinite(n)) n = 0;
  // Locale-aware thousands grouping with a fixed 2 decimals; fall back to
  // toFixed where Intl is unavailable.
  var formatted;
  try {
    formatted = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch (e) {
    formatted = n.toFixed(2);
  }
  return { sym: sym, num: formatted, ccy: currency };
}
function renderBalanceBlock(balance) {
  var f = formatBalance(balance.remaining, balance.currency);
  var empty = !(balance.remaining > 0);
  var blockCls = 'balance-block' + (empty ? ' is-empty' : '');
  var amtCls = 'balance-amount' + (empty ? ' is-empty' : '');
  return (
    '<div class="' +
    blockCls +
    '">' +
    '<div class="balance-row">' +
    '<span class="balance-label">Remaining</span>' +
    '<span class="' +
    amtCls +
    '">' +
    (f.sym
      ? esc(f.sym) + esc(f.num)
      : esc(f.num) + (f.ccy ? ' <span class="ccy">' + esc(f.ccy) + '</span>' : '')) +
    '</span>' +
    '</div>' +
    '</div>'
  );
}

// `title`/`hint` drive the full error banner; `short` is a terse status word
// for the uppercase status pill, so the pill never repeats the banner's whole
// sentence (which would also overflow the narrow pill).
function errorInfo(error, providerName) {
  var name = providerName || 'the provider';
  if (!error)
    return {
      title: 'Provider failed.',
      hint: 'Retry the request; Tokpet will pick up automatically.',
      short: 'Error',
    };
  if (error.code === 'rate-limited')
    return {
      title: 'Rate limited.',
      hint: 'Wait a few minutes; Tokpet will pick up automatically.',
      short: 'Rate limited',
    };
  if (error.code === 'auth-expired')
    return {
      title: 'Usage tracking paused.',
      hint: 'Use ' + name + ' once to refresh access; Tokpet will pick up automatically.',
      short: 'Paused',
    };
  if (error.code === 'not-configured')
    return {
      title: error.message || 'Credentials not found.',
      hint: 'Sign in to ' + name + ' on this machine to activate it.',
      short: 'Not connected',
    };
  return {
    title: error.message || 'Provider failed.',
    hint: 'Retry the request; Tokpet will pick up automatically.',
    short: 'Error',
  };
}

function icon(name, mod) {
  var cls = 'icon' + (mod ? ' icon--' + mod : '');
  return '<svg class="' + cls + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
}

function copyButton(value, label) {
  return (
    '<button class="btn btn--icon" type="button" aria-label="Copy ' +
    esc(label || 'value') +
    '" data-value="' +
    esc(value) +
    '" data-label="' +
    esc(label || 'value') +
    '" onclick="copyFromData(this)">' +
    icon('copy', 'sm') +
    '</button>'
  );
}

// -------- Toasts --------
function showToast(message, type) {
  type = type || 'ok';
  var el = document.createElement('div');
  el.className = 'toast toast--' + type;
  el.setAttribute('role', 'status');
  var iconName = type === 'bad' ? 'x' : type === 'warn' ? 'warn' : 'check';
  el.innerHTML =
    icon(iconName, 'sm') +
    '<span style="flex:1">' +
    esc(message) +
    '</span><button class="toast-close" type="button" aria-label="Close">×</button>';
  el.querySelector('.toast-close').addEventListener('click', function () {
    dismissToast(el);
  });
  $('toastStack').appendChild(el);
  var timeout = type === 'bad' ? 6000 : 3500;
  setTimeout(function () {
    dismissToast(el);
  }, timeout);
}
function dismissToast(el) {
  if (!el.parentNode) return;
  el.style.opacity = '0';
  el.style.transform = 'translateY(8px)';
  el.style.transition = 'all .2s';
  setTimeout(function () {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 220);
}

// -------- Copy --------
function copyFromData(btn) {
  copyText(btn.dataset.value, btn.dataset.label);
}
function copyText(value, label) {
  if (!value) {
    showToast('Nothing to copy.', 'warn');
    return;
  }
  var done = function () {
    showToast(
      (label ? label.charAt(0).toUpperCase() + label.slice(1) : 'Value') + ' copied.',
      'ok',
    );
  };
  var fail = function () {
    // Fallback: select text in a temp textarea
    try {
      var ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) done();
      else showToast('Copy failed — please select the text manually.', 'bad');
    } catch (e) {
      showToast('Copy failed — please select the text manually.', 'bad');
    }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(value).then(done).catch(fail);
  } else {
    fail();
  }
}

// -------- Refresh cycle --------
function setOnline(online) {
  app.online = online;
  $('connBanner').classList.toggle('on', !online);
}

function dismissUpdate() {
  app.updateDismissed = true;
  $('updateBanner').classList.remove('on');
}

function setRefreshing(busy) {
  app.refreshing = busy;
  var b = $('refreshBtn');
  b.disabled = busy;
  b.setAttribute('aria-busy', busy ? 'true' : 'false');
  var icn = b.querySelector('.icon');
  if (busy) icn.classList.add('spin');
  else icn.classList.remove('spin');
  var label = b.querySelector('.refresh-label');
  label.textContent = busy ? 'Refreshing…' : 'Refresh';
}

function refreshAll(manual) {
  if (app.refreshing) return Promise.resolve();
  setRefreshing(true);
  return Promise.all([
    api('GET', '/api/providers').catch(function () {
      return null;
    }),
    api('GET', '/api/runtime').catch(function () {
      return null;
    }),
    api('GET', '/state').catch(function () {
      return null;
    }),
  ])
    .then(function (results) {
      var prov = results[0];
      var runtime = results[1];
      var snap = results[2];

      var runtimeOk = runtime && runtime.ok;
      setOnline(runtimeOk || Array.isArray(prov));

      app.providers = Array.isArray(prov) ? prov : [];
      app.runtime = runtimeOk ? runtime : null;
      app.snapshot = snap && snap.version ? snap : null;
      renderDashboard();
      if (manual) showToast('State refreshed.', 'ok');
    })
    .catch(function () {
      setOnline(false);
    })
    .then(function () {
      setRefreshing(false);
    });
}

function scheduleAuto() {
  if (app.autoTimer) clearInterval(app.autoTimer);
  app.autoTimer = setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    if (app.wizardActive) return;
    refreshAll(false);
  }, 15000);
}
