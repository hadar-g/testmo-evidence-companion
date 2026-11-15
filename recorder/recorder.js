// Injected into the page under test only while "Record steps" is active.
// It observes clicks, typing, selections, key presses, scrolling and URL
// changes and reports them to the extension as raw events. It never reads
// anything the user did not interact with, and it is removed on stop.
(() => {
  if (window.__testmoRecorder) {
    window.__testmoRecorder.resume();
    return;
  }
  const send = (event) => {
    if (sent >= MAX_EVENTS) return;
    sent += 1;
    try {
      chrome.runtime.sendMessage({ type: 'rec-event', event: { ...event, at: Date.now(), href: location.href } });
    } catch {
      // extension went away; stop quietly
      stop();
    }
  };

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const INTERACTIVE = 'button, a, input, select, textarea, summary, label, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="option"], [contenteditable="true"]';

  function labelFor(el) {
    if (!el) return '';
    const aria = el.getAttribute && (el.getAttribute('aria-label') || '');
    if (aria) return clean(aria);
    const labelledBy = el.getAttribute && el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const t = labelledBy.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((n) => n.textContent).join(' ');
      if (clean(t)) return clean(t);
    }
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab && clean(lab.textContent)) return clean(lab.textContent);
    }
    const wrappingLabel = el.closest && el.closest('label');
    if (wrappingLabel) {
      const t = clean([...wrappingLabel.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ')) || clean(wrappingLabel.textContent);
      if (t) return t;
    }
    if (el.placeholder) return clean(el.placeholder);
    if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type) && el.value) return clean(el.value);
    const img = el.querySelector && el.querySelector('img[alt]');
    if (img && clean(img.alt)) return clean(img.alt);
    if (el.title) return clean(el.title);
    const text = clean(el.innerText || el.textContent);
    if (text) return text;
    if (el.name) return clean(el.name);
    if (el.id) return clean(el.id);
    if (el.getAttribute && el.getAttribute('data-testid')) return clean(el.getAttribute('data-testid'));
    return '';
  }

  function roleFor(el) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    if (tag === 'a' || role === 'link') return 'link';
    if (tag === 'button' || role === 'button' || (tag === 'input' && ['button', 'submit', 'reset'].includes(el.type))) return 'button';
    if (tag === 'input' && el.type === 'checkbox') return 'checkbox';
    if (tag === 'input' && el.type === 'radio') return 'radio';
    if (role === 'checkbox' || role === 'switch') return 'checkbox';
    if (tag === 'select') return 'select';
    if (tag === 'input' || tag === 'textarea' || el.isContentEditable) return 'field';
    if (role === 'tab') return 'tab';
    if (role === 'menuitem' || role === 'option') return 'menu item';
    if (tag === 'summary') return 'section';
    if (tag === 'label') return 'label';
    return tag;
  }

  const isSecret = (el) =>
    el.tagName === 'INPUT' &&
    (el.type === 'password' ||
      /passw|secret|token|otp|cvv|cvc|card|ssn|social|iban|account[-_ ]?num|routing|\bpin\b|api[-_]?key|license/i.test(`${el.name} ${el.id} ${el.autocomplete} ${el.getAttribute('aria-label') || ''} ${el.placeholder || ''}`) ||
      /^(cc-|one-time-code|new-password|current-password)/.test(el.autocomplete || ''));

  // Hard ceiling so a hostile or very busy page cannot flood the panel.
  let sent = 0;
  const MAX_EVENTS = 1000;

  // --- typing: aggregate per field, flush on change/blur/enter/click elsewhere
  let typing = null; // { el, label, secret }
  function flushTyping() {
    if (!typing) return;
    const { el, label, secret } = typing;
    typing = null;
    const value = el.isContentEditable ? el.innerText : el.value;
    if (value === undefined || value === '') return;
    send({ kind: 'type', label, role: 'field', value: secret ? null : clean(value), secret });
  }

  function onClick(e) {
    if (!e.isTrusted) return;
    const target = e.target.closest ? e.target.closest(INTERACTIVE) || e.target : e.target;
    if (typing && typing.el !== target) flushTyping();
    const role = roleFor(target);
    if (role === 'field' || role === 'select') return; // focusing a field is not a step
    const label = labelFor(target);
    const ev = { kind: 'click', role, label };
    if (role === 'checkbox' || role === 'radio') ev.checked = target.checked !== undefined ? !target.checked : null; // state before toggle
    send(ev);
  }
  function onInput(e) {
    if (!e.isTrusted) return;
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) return;
    if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'].includes(el.type)) return;
    if (typing && typing.el !== el) flushTyping();
    typing = typing || { el, label: labelFor(el), secret: isSecret(el) };
  }
  function onChange(e) {
    // change events are accepted even when synthetic (UI libraries and browser
    // automation fire them programmatically), but they are flagged so the
    // step list can say the page, not the tester, triggered them.
    const el = e.target;
    if (!el || !el.tagName) return;
    const synthetic = !e.isTrusted;
    if (el instanceof HTMLSelectElement) {
      const opt = el.selectedOptions && el.selectedOptions[0];
      send({ kind: 'select', label: labelFor(el), role: 'select', value: clean(opt ? opt.textContent : el.value), synthetic });
      return;
    }
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      send({ kind: 'toggle', label: labelFor(el), role: el.type, checked: el.checked, synthetic });
      return;
    }
    if (el instanceof HTMLInputElement && el.type === 'file') {
      send({ kind: 'file', label: labelFor(el), role: 'field', value: [...el.files].map((f) => f.name).join(', '), synthetic });
      return;
    }
    if (typing && typing.el === el) flushTyping();
  }
  function onKeydown(e) {
    if (!e.isTrusted) return;
    if (e.key === 'Enter' || e.key === 'Escape' || (e.key === 'Tab' && !typing)) {
      const el = document.activeElement;
      if (typing) flushTyping();
      send({ kind: 'key', key: e.key, label: el && el !== document.body ? labelFor(el) : '', role: el && el !== document.body ? roleFor(el) : '' });
    }
  }
  function onBlur() {
    flushTyping();
  }
  let scrollTimer = null;
  function onScroll() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const pct = Math.round((window.scrollY / max) * 100);
      send({ kind: 'scroll', pct: Math.max(0, Math.min(100, pct)) });
    }, 700);
  }
  let lastHref = location.href;
  const hrefTimer = setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      send({ kind: 'navigate', url: location.href, title: document.title });
    }
  }, 500);

  const opts = { capture: true, passive: true };
  document.addEventListener('click', onClick, opts);
  document.addEventListener('input', onInput, opts);
  document.addEventListener('change', onChange, opts);
  document.addEventListener('keydown', onKeydown, opts);
  window.addEventListener('blur', onBlur, opts);
  document.addEventListener('focusout', onBlur, opts);
  window.addEventListener('scroll', onScroll, opts);

  function stop() {
    flushTyping();
    document.removeEventListener('click', onClick, opts);
    document.removeEventListener('input', onInput, opts);
    document.removeEventListener('change', onChange, opts);
    document.removeEventListener('keydown', onKeydown, opts);
    window.removeEventListener('blur', onBlur, opts);
    document.removeEventListener('focusout', onBlur, opts);
    window.removeEventListener('scroll', onScroll, opts);
    clearInterval(hrefTimer);
    delete window.__testmoRecorder;
  }
  const onExtMessage = (msg) => {
    if (msg && msg.type === 'rec-stop') stopAll();
  };
  chrome.runtime.onMessage.addListener(onExtMessage);
  const stopAll = () => {
    stop();
    chrome.runtime.onMessage.removeListener(onExtMessage);
  };
  window.__testmoRecorder = { stop: stopAll, resume: () => {} };
  send({ kind: 'start', url: location.href, title: document.title });
})();
