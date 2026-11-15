// Screenshot capture helpers shared by the side panel and the service worker.

export function originPattern(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

// The page under test is the active tab of the last focused *normal* window.
// (The side panel itself is not a tab; in tests the panel may be a popup.)
export async function getActiveTab() {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (win) {
      const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
      if (tab) return tab;
    }
  } catch {
    // fall through
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) return tab;
  const [fallback] = await chrome.tabs.query({ active: true, currentWindow: true });
  return fallback || null;
}

// chrome.tabs.captureVisibleTab accepts exactly two grants: the temporary
// activeTab grant (given when the user clicks the toolbar icon, lost on
// navigation) or the literal <all_urls> host permission. Per-site host
// permissions do NOT work for capture (verified against Chromium 141), so the
// persistent option has to be <all_urls>, requested only when first needed.
export const CAPTURE_ORIGIN = '<all_urls>';

export async function hasCapturePermission() {
  return chrome.permissions.contains({ origins: [CAPTURE_ORIGIN] });
}

// Must be called from a user gesture.
export async function requestCapturePermission() {
  return chrome.permissions.request({ origins: [CAPTURE_ORIGIN] });
}

export async function revokeCapturePermission() {
  return chrome.permissions.remove({ origins: [CAPTURE_ORIGIN] });
}

export async function captureActiveTab() {
  const tab = await getActiveTab();
  if (!tab) throw new Error('No active tab to capture.');
  if (/^(chrome|edge|about|devtools|chrome-extension):/.test(tab.url || '')) {
    throw new Error('Chrome does not allow capturing browser-internal pages. Switch to the page under test.');
  }
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (err) {
    const msg = String(err && err.message || err);
    if (/permission|activeTab|<all_urls>/i.test(msg)) {
      const e = new Error(`Screenshot permission is needed for this site. (${msg})`);
      e.code = 'NEEDS_PERMISSION';
      e.tab = tab;
      throw e;
    }
    throw new Error(`Could not capture the tab: ${msg}`);
  }
  return { dataUrl, tabUrl: tab.url, tabTitle: tab.title, tabId: tab.id };
}
