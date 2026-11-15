// Service worker: opens the side panel on toolbar click and handles the
// keyboard shortcut for screenshot capture.
import { captureActiveTab } from './lib/capture.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // The API key lives in session storage; keep it out of reach of any injected script.
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-screenshot') return;
  try {
    const shot = await captureActiveTab();
    // The panel owns the "current case" context, so hand the image over and
    // let it decide where the screenshot belongs.
    await chrome.runtime.sendMessage({ type: 'shortcut-capture', dataUrl: shot.dataUrl, tabUrl: shot.tabUrl, tabTitle: shot.tabTitle });
  } catch (err) {
    // No panel open or no permission: nothing else to do from here.
    console.warn('capture-screenshot command failed:', err && err.message);
  }
});
