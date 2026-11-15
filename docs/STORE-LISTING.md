# Chrome Web Store listing

Copy for the Developer Dashboard. Everything below is generic; fill in the
publisher name, support address and privacy policy URL before submitting.

## Store listing

**Name** (45 chars max)
Testmo Evidence Companion

**Summary** (132 chars max)
Run Testmo test cases from Chrome's side panel: read steps, capture and annotate screenshots, record steps, submit results.

**Category:** Developer Tools
**Language:** English

**Description**

Work through a Testmo test run without leaving the page you are testing.

Testmo Evidence Companion docks in Chrome's side panel next to the application under test. Pick a project, a milestone and a run, and every test is right there with its status. Open one and read the full instructions — steps and expected results, or a Gherkin scenario rendered with highlighted keywords, parameters and example tables.

When you find something, capture the tab with one click and annotate the screenshot: rectangle, ellipse, arrow, pen, highlighter, text, numbered markers, pixelate for sensitive data, crop. Or press Record steps: the tab is recorded as video while every click, typed value, selection and page change is written down as a numbered, timestamped list of steps to reproduce (passwords are never logged). Write your notes, pick a status, submit. The result, notes, screenshots and recording land in Testmo on that test.

What else it does
• Filters runs by milestone (defaults to your current one) and by "assigned to me".
• Groups tests by repository folder with status chips, drafts and pending evidence.
• Keeps unsubmitted notes, statuses and screenshots as local drafts, so closing the panel or restarting Chrome loses nothing.
• Adds a missing test case to the run from the panel: write it in Gherkin with a live preview, and it is created in the right folder and added to the run in one step.
• Works with your project's own statuses, templates and custom fields — nothing is hard-coded.
• Keyboard shortcuts for next/previous test, capture, status and submit.

Privacy and security
• You connect with your own Testmo instance URL and a personal API key. The key is kept in memory by default; if you choose to remember it, it is encrypted with a passphrase only you know.
• The extension talks to exactly one host: your Testmo instance. No telemetry, no analytics, no third-party servers, no remote code.
• Rich text from Testmo is sanitised before it is rendered. Screenshots are taken only when you press Capture.

Open source under the MIT licence. Report issues and read the security notes in the repository.

Requires a Testmo account with API access. Testmo is a trademark of its owner; this extension is an independent project and is not affiliated with or endorsed by Testmo.

## Graphic assets (all in `docs/media/`)

| Asset | File | Store requirement |
| --- | --- | --- |
| Icon | `icons/icon128.png` | 128×128 PNG |
| Screenshots (up to 5) | `screenshots/captioned/04-test-gherkin-captioned.png`, `05-annotate-captioned.png`, `07-recording-captioned.png`, `09-add-case-captioned.png`, `03-run-captioned.png` | 1280×800 |
| Small promo tile | `store-small-tile-440x280.png` | 440×280 |
| Marquee promo tile | `store-marquee-1400x560.png` | 1400×560 |
| Promo video | upload `video/full-demo.mp4` to YouTube and paste the URL | YouTube link |

Suggested screenshot order and captions (the captioned versions already carry them):

1. Read the scenario next to the page you are testing
2. Annotate: rectangle, arrow, text, pixelate, crop, then save to the test
3. Record steps: tab video plus a log of every click and keystroke
4. Missed a scenario? Add a Gherkin case to the run in one step
5. Every test in the run, grouped by folder, with status and drafts

## Privacy practices tab

**Single purpose**
Record manual test results with screenshot and video evidence for Testmo test runs from Chrome's side panel.

**Permission justifications**

- `sidePanel` — the whole UI lives in the side panel.
- `storage` — settings, local drafts index and the (optionally, passphrase-encrypted) API key.
- `unlimitedStorage` — unsubmitted screenshots and recordings are stored in IndexedDB until the user submits them.
- `activeTab` — lets Capture and Record steps work on the current tab right after the user clicks the toolbar icon, without a host permission.
- `tabCapture` — records the tab as video during Record steps, only while the user has started a recording.
- `scripting` — injects the action recorder into the tab under test only while a recording is running; it is removed on stop. There are no persistent content scripts.
- Host permission for the user's Testmo instance (optional, requested on connect) — to call the Testmo REST API and, when the user is signed in, a few of Testmo's own web routes that the public API lacks (looking up run-test ids, attaching files to results).
- `<all_urls>` (optional, requested on first capture) — `chrome.tabs.captureVisibleTab` accepts only `activeTab` or the literal `<all_urls>`; per-site host permissions do not work for screenshots. The extension reads pixels only when the user presses Capture or is recording. The grant can be revoked in Settings.

**Remote code:** No. All code ships in the package; the content security policy forbids remote and inline scripts.

**Data usage:** declare *Authentication information* (the API key) and *Website content* (screenshots, recordings, the labels of elements interacted with during a recording). Certify: not sold, not used for purposes unrelated to the single purpose, not transferred to third parties except to the user's own Testmo instance.

**Privacy policy URL:** host `docs/PRIVACY.md` (GitHub Pages works) after filling in the publisher placeholders.

## Distribution

Start **Unlisted** to verify the review passes with `<all_urls>` declared, then switch to **Public**. Reviews with broad host permissions can take longer than the usual 1–3 days.
