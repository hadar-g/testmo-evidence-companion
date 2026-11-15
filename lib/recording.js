// Screen + action recording for one tab. Video comes from chrome.tabCapture
// when the extension was invoked on the tab (toolbar click), otherwise from
// the standard "share this tab" picker. Actions come from recorder/recorder.js
// injected into the tab for the duration of the recording.

const EVENT_KINDS = new Set(['start', 'navigate', 'click', 'type', 'select', 'toggle', 'file', 'key', 'scroll']);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// Only known fields, bounded in size, ever leave the content script's message.
export function sanitizeEvent(raw) {
  if (!raw || typeof raw !== 'object' || !EVENT_KINDS.has(raw.kind)) return null;
  return {
    kind: raw.kind,
    at: Number(raw.at) || Date.now(),
    href: str(raw.href, 2048),
    url: str(raw.url, 2048),
    title: str(raw.title, 200),
    label: str(raw.label, 80),
    role: str(raw.role, 30),
    value: raw.value === null ? null : str(raw.value, 80),
    key: str(raw.key, 20),
    secret: Boolean(raw.secret),
    synthetic: Boolean(raw.synthetic),
    checked: typeof raw.checked === 'boolean' ? raw.checked : null,
    pct: Number.isFinite(raw.pct) ? Math.max(0, Math.min(100, Math.round(raw.pct))) : null,
  };
}

export class TabRecorder {
  constructor({ onEvent, onStatus } = {}) {
    this.onEvent = onEvent || (() => {});
    this.onStatus = onStatus || (() => {});
    this.tabId = null;
    this.events = [];
    this.startedAt = null;
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.source = null;
    this._onMessage = (msg, sender) => {
      if (!msg || msg.type !== 'rec-event' || !sender || sender.id !== chrome.runtime.id || !sender.tab || sender.tab.id !== this.tabId) return;
      const ev = sanitizeEvent(msg.event);
      if (!ev) return;
      this.events.push(ev);
      this.onEvent(ev, this.events);
    };
    this._onUpdated = (tabId, info) => {
      if (tabId !== this.tabId || info.status !== 'complete') return;
      this.inject().catch(() => {});
    };
  }

  get active() {
    return Boolean(this.recorder);
  }

  async inject() {
    await chrome.scripting.executeScript({ target: { tabId: this.tabId, allFrames: false }, files: ['recorder/recorder.js'] });
  }

  async getStream(tab) {
    try {
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, maxWidth: 1920, maxHeight: 1200, maxFrameRate: 15 } },
      });
      this.source = 'tabCapture';
      return stream;
    } catch (err) {
      // Fall back to the picker; the user confirms which tab to share.
      this.onStatus('Pick the tab to record in Chrome’s dialog.');
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: { displaySurface: 'browser', frameRate: 15 },
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        monitorTypeSurfaces: 'exclude',
      });
      this.source = 'displayMedia';
      return stream;
    }
  }

  async start(tab) {
    if (this.active) throw new Error('Already recording.');
    if (!tab || /^(chrome|edge|about|devtools|chrome-extension):/.test(tab.url || '')) {
      throw new Error('Switch to the page under test first; browser pages cannot be recorded.');
    }
    this.tabId = tab.id;
    this.events = [];
    this.chunks = [];
    const stream = await this.getStream(tab);
    this.stream = stream;
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    this.recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000 } : undefined);
    this.recorder.ondataavailable = (e) => e.data && e.data.size && this.chunks.push(e.data);
    this.startedAt = Date.now();
    this.recorder.start(1000);
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      // User stopped sharing from Chrome's bar.
      if (this.active) this.onStatus('ended');
    });
    chrome.runtime.onMessage.addListener(this._onMessage);
    chrome.tabs.onUpdated.addListener(this._onUpdated);
    try {
      await this.inject();
    } catch (err) {
      this.onStatus(`Video is recording, but actions cannot be captured on this page (${err.message}).`);
    }
    return { source: this.source };
  }

  async stop() {
    if (!this.recorder) return null;
    const rec = this.recorder;
    const stopped = new Promise((resolve) => (rec.onstop = resolve));
    if (rec.state !== 'inactive') rec.stop();
    await stopped;
    this.stream.getTracks().forEach((t) => t.stop());
    chrome.runtime.onMessage.removeListener(this._onMessage);
    chrome.tabs.onUpdated.removeListener(this._onUpdated);
    try {
      await chrome.tabs.sendMessage(this.tabId, { type: 'rec-stop' });
    } catch {
      // page navigated away or never got the script
    }
    const blob = new Blob(this.chunks, { type: 'video/webm' });
    const result = { blob, events: this.events, startedAt: this.startedAt, duration: Math.round((Date.now() - this.startedAt) / 1000), source: this.source };
    this.recorder = null;
    this.stream = null;
    this.chunks = [];
    return result;
  }
}
