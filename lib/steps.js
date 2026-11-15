// Turns raw recorder events into human-readable reproduction steps.

const q = (s) => `"${String(s).replace(/"/g, '”')}"`;

// Query parameters and fragments that commonly carry credentials are masked
// before a URL ends up in notes or in Testmo.
const SECRET_PARAM = /^(access_?token|id_?token|refresh_?token|token|auth(orization)?|api[-_]?key|apikey|key|secret|client_?secret|password|passwd|pwd|pass|session(_?id)?|sid|jwt|bearer|code|state|nonce|sig(nature)?|otp|ticket|assertion|saml(response)?)$/i;
const MASK = '\u2022\u2022\u2022';

export function redactUrl(url) {
  try {
    const u = new URL(String(url));
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
    }
    for (const k of [...u.searchParams.keys()]) if (SECRET_PARAM.test(k)) u.searchParams.set(k, MASK);
    if (u.hash) {
      const h = new URLSearchParams(u.hash.replace(/^#/, ''));
      let changed = false;
      for (const k of [...h.keys()]) {
        if (SECRET_PARAM.test(k)) {
          h.set(k, MASK);
          changed = true;
        }
      }
      if (changed) u.hash = h.toString();
      else if (/[A-Za-z0-9_-]{32,}/.test(u.hash)) u.hash = MASK;
    }
    // Long opaque path segments (reset/invite tokens, signed ids) are masked too.
    u.pathname = u.pathname
      .split('/')
      .map((seg) => (/^[A-Za-z0-9_-]{32,}$/.test(seg) || /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(seg) ? MASK : seg))
      .join('/');
    return u.toString().replace(/%E2%80%A2%E2%80%A2%E2%80%A2/g, MASK);
  } catch {
    return String(url || '');
  }
}

export function describeEvent(ev) {
  const label = ev.label ? ` ${q(ev.label)}` : '';
  switch (ev.kind) {
    case 'start':
      return `Open ${redactUrl(ev.url)}`;
    case 'navigate':
      return `Page changes to ${redactUrl(ev.url)}`;
    case 'click': {
      if (ev.role === 'link') return `Click the${label} link`;
      if (ev.role === 'button') return `Click${label ? ` the${label} button` : ' a button'}`;
      if (ev.role === 'checkbox' || ev.role === 'radio') return null; // the change event describes it
      if (ev.role === 'tab') return `Open the${label} tab`;
      if (ev.role === 'menu item') return `Choose${label}`;
      if (ev.role === 'section') return `Expand${label}`;
      return `Click${label || ` the ${ev.role} element`}`;
    }
    case 'type':
      if (ev.secret) return `Enter a value into the${label} field (hidden)`;
      return `Type ${q(ev.value)} into the${label} field`;
    case 'select':
      return `Select ${q(ev.value)} in${label}`;
    case 'toggle':
      if (ev.role === 'radio') return `Choose${label}`;
      return `${ev.checked ? 'Check' : 'Uncheck'}${label}`;
    case 'file':
      return `Attach ${q(ev.value)} to${label}`;
    case 'key':
      if (ev.key === 'Enter') return `Press Enter${label ? ` in${label}` : ''}`;
      if (ev.key === 'Escape') return 'Press Escape';
      return `Press ${ev.key}`;
    case 'scroll':
      if (ev.pct >= 95) return 'Scroll to the bottom of the page';
      if (ev.pct <= 2) return 'Scroll back to the top of the page';
      return `Scroll down to about ${ev.pct}% of the page`;
    default:
      return null;
  }
}

// Collapse noise: consecutive scrolls keep only the last; identical adjacent
// steps are merged; "navigate" right after a click stays (it explains the click).
export function eventsToSteps(events, startedAt) {
  const steps = [];
  for (const ev of events) {
    let text = describeEvent(ev);
    if (!text) continue;
    if (ev.synthetic) text += ' (triggered by the page)';
    const at = startedAt ? Math.max(0, Math.round((ev.at - startedAt) / 1000)) : null;
    const prev = steps[steps.length - 1];
    if (prev && ev.kind === 'scroll' && prev.kind === 'scroll') {
      steps[steps.length - 1] = { kind: ev.kind, text, at };
      continue;
    }
    if (prev && prev.text === text) continue;
    steps.push({ kind: ev.kind, text, at });
  }
  return steps;
}

export function fmtClock(sec) {
  if (sec === null || sec === undefined) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function stepsToText(steps, { withTimestamps = true } = {}) {
  return steps.map((s, i) => `${i + 1}. ${s.text}${withTimestamps && s.at !== null ? ` (${fmtClock(s.at)})` : ''}`).join('\n');
}
