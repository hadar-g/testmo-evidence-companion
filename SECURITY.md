# Security notes

This document describes what the extension stores, where it sends data, and the risks
you accept by using or distributing it.

## What the extension can do

With a connected API key the extension can do whatever that key's Testmo user can do
through the REST API. In practice it only calls: list projects, runs, cases, statuses,
templates, fields, results; create results; upload attachments to cases. With a
Testmo browser session present it additionally calls three UI routes to look up test
ids, upload attachments and create results with attachments.

It talks to Testmo with cookies on a handful of web routes (session probe, test-id
search, attachment upload, result creation, assignment table), always with the CSRF token
and `X-Requested-With`; REST calls carry the bearer key, never cookies, and never follow
redirects.

It declares no persistent content scripts. While **Record steps** is running it injects
`recorder/recorder.js` into the tab under test; that script listens for click, input,
change, keydown, scroll and URL changes, reports the accessible label of the element and
the typed value (never for password or secret-looking fields), and is removed when the
recording stops. Pixels are read only when you trigger Capture or while a recording is
running. Recordings are stored locally like screenshots until submitted and may contain
anything visible in the tab, so the same hygiene applies.

## Data at rest (on the tester's machine)

| Data | Where | Protection |
| --- | --- | --- |
| Instance URL, project, UI preferences | `chrome.storage.local` | none (not sensitive) |
| API key (default) | `chrome.storage.session` | in memory only; gone when Chrome exits |
| API key ("remember on this device") | `chrome.storage.local` as `{salt, iv, iterations, ct}` | AES-256-GCM; key derived from the user's passphrase with PBKDF2-SHA256 (600 000 iterations, never fewer than 100 000 when reading). Saved only after Testmo has accepted the key. Nothing else can decrypt it. |
| Unsubmitted notes, chosen status, timer | IndexedDB (`testmo-companion` → `drafts`) | none |
| Unsubmitted screenshots (PNG) and recordings (WebM) | IndexedDB (`testmo-companion` → `shots`) | none |

`chrome.storage.local` and IndexedDB are stored under the Chrome profile directory in
plain LevelDB/SQLite files. Anyone with read access to the profile (another local user,
malware, a backup) can read them. Consequences:

- **Do not** use "remember on this device" with a weak passphrase. The vault resists
  offline guessing only as well as the passphrase does.
- **Screenshots may contain sensitive data** from the application under test
  (customer records, tokens in URLs, etc.). Pixelate before saving, submit promptly,
  and use *Settings → Delete all local drafts and screenshots* when done. Submitting a
  result deletes that case's local screenshots.
- On shared machines prefer the default memory-only key.

`chrome.storage.session` is not written to disk and is not exposed to content scripts.

## Data in transit

The extension makes HTTPS requests to exactly one origin: the Testmo instance you
entered (`https://…`). `http://` instances are rejected. There is no analytics, crash
reporting, update check or CDN; all code ships inside the extension.

Requests to the REST API carry the API key as `Authorization: Bearer …`. Requests to
the three UI routes carry your Testmo session cookies (Chrome attaches them because the
extension holds host permission for that origin) and the CSRF token Testmo embeds in
the run page.

## Permissions and what an attacker could do with them

- **`<all_urls>` (optional, requested on first capture).** After grant the extension
  *could* read any page's pixels and fetch any URL with the user's cookies. This
  extension only captures when the user clicks. The grant can be revoked in Settings or
  in `chrome://extensions`. If you publish to the Web Store, expect reviewers to ask
  for a justification; the honest one is that `captureVisibleTab` accepts nothing
  narrower.
- **Testmo host permission.** Lets the extension call Testmo with the user's cookies.
  Same power the user already has in a Testmo tab.
- **`activeTab`.** Temporary, gesture-scoped; the least-privilege way to capture.

## Content from Testmo

Case instructions, result notes and folder docs are rich text authored by other people.
The panel renders them through an allow-list sanitizer (`lib/sanitize.js`): scripts,
event handlers, `javascript:` URLs, iframes, styles and unknown attributes are removed,
links open in a new tab with `rel="noopener noreferrer"`, and images are only kept
when they point at the configured Testmo instance (or are inline `data:` images), so a
case author cannot plant a tracking pixel. The extension's own pages never use `eval`,
inline scripts or remote code, and the manifest sets an explicit Content Security
Policy: `script-src 'self'`, `object-src 'none'`, `connect-src https:`, no framing, no
forms, no `<base>`. Status colours from the API are validated as hex before they reach a
style attribute; every other API value is escaped before it reaches the DOM.

## Attack surface you should know about when distributing

1. **API key theft via local access.** Mitigated by default memory-only storage and the
   passphrase vault; not preventable if the machine is compromised.
2. **Key logging / phishing of the passphrase.** Out of scope for an extension.
3. **Malicious update.** If you self-host `.crx` updates or publish to the store, the
   publisher account controls what every user runs. Protect the store account with
   2-step verification; for self-hosting keep the private key offline.
4. **Testmo route changes.** Not a security risk, but the web-session path can stop
   working; the panel falls back to the API path and tells the user.
5. **Supply chain.** Runtime has zero dependencies. Dev dependency is Playwright for
   the end-to-end test only; it is not shipped.

## Recommendations for a team roll-out

- Create one API key per person in Testmo, named after the device, so revocation is
  granular.
- Tell testers which storage mode to use (memory-only on shared machines).
- Decide on a screenshot hygiene rule: pixelate personal data, submit or delete drafts
  before leaving.
- If you publish to the Web Store, fill in `docs/PRIVACY.md`, host it, and link it in
  the listing; the extension collects no data on your behalf, but the policy must say so.
- Review `lib/session.js` when Testmo announces UI changes; it is the only part that
  depends on non-public routes.

## Audit history

- 2026-09-17 — internal audit of 0.3.0 (static review by an independent reviewer plus a
  dynamic sanitizer fuzz in Chrome). No high-severity findings; medium/low items fixed in
  0.3.1. Report: `docs/SECURITY-AUDIT-2026-09-17.md`.

## Reporting

Report issues to the maintainer of this repository. Do not include API keys or
screenshots containing customer data in bug reports.
