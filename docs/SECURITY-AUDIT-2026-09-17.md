# Security audit — Testmo Evidence Companion 0.3.0 → 0.3.1

_Date: 2026-09-17. Scope: every shipped file (manifest, service worker, side panel, annotator,
recorder, lib), the test harness, the packaging script and the docs. Method: full static
review by an independent reviewer with a checklist (secret exposure, crypto, HTML injection,
message passing, permissions, network, data hygiene, packaging), plus dynamic checks in
Chrome for Testing: a 24-payload sanitizer fuzz and the end-to-end harness. Secrets scan:
the real API key and bot password used in testing were grepped for across the repository,
the built zip and the screenshot folder — no hits._

## Verdict

No high-severity issue. The API key and the vault passphrase are never written to disk in
clear text, never logged, never placed in the DOM or in URLs, and only ever sent as a bearer
header to `https://<your-instance>/api/v1`. The rich-text sanitizer resisted every payload
tried (SVG/MathML event handlers, encoded and whitespace-padded `javascript:` schemes,
`srcdoc`, `formaction`, `<base>`, `<meta refresh>`, `<template>`, `<noscript>`, inline
styles, `data:text/html` images). Medium and low findings were fixed in 0.3.1 as listed
below.

## Findings and fixes

| # | Severity | Finding | Fix (0.3.1) |
|---|---|---|---|
| 1 | Medium | The new CSP (`connect-src https:`) broke `fetch(data:…)` used to turn a screenshot into a blob. Found by the harness. | Decode the data URL directly (`atob` → `Blob`). |
| 2 | Medium | Built zip lagged behind the tree at the same version. | Rebuilt; version bumped to 0.3.1. Release checklist already requires a rebuild. |
| 3 | Low | `status.color` from the API was interpolated into `style` attributes unvalidated; `fmtDate` could return raw input unescaped. Script execution was already blocked by CSP, but HTML/content spoofing from a hostile instance was possible. | `statusColor` accepts only 3/6/8-digit hex, else default grey; dates escaped. |
| 4 | Low | Sanitizer kept `<img src>` from any https host, letting a case author plant a tracking pixel that fires when a tester opens the case. | Images kept only when relative, `data:image/*`, or on the configured instance. |
| 5 | Low | `chrome.runtime.onMessage` handlers did not check the sender; recorder events were stored verbatim (unbounded `url`/`title`). Web pages cannot reach these handlers (no `externally_connectable`), so defence in depth. | Panel accepts messages only from its own extension contexts; recorder events pass a field whitelist with size caps; 1000-event ceiling in the content script. |
| 6 | Low | Synthetic `change` events (fired by the page, not the tester) produced steps indistinguishable from real ones. | Flagged and rendered as "(triggered by the page)". |
| 7 | Low | REST `fetch` followed redirects with the bearer header attached. | `redirect: 'error'`, `credentials: 'omit'`. |
| 8 | Low | Vault written before the key was validated; 8-char minimum with 310k PBKDF2 iterations. | Vault saved only after `GET /user` succeeds; 600k iterations, 100k floor when reading; passphrase must mix letters with digits/symbols. |
| 9 | Low | URL redaction missed path-embedded tokens; `tabUrl` stored unredacted in IndexedDB. | Long opaque path segments and JWT-shaped segments masked; redaction applied before storage. |
| 10 | Info | Unit fixtures contained organisation-specific ids/names and a string that trips secret scanners. | Replaced with neutral values. |
| 11 | Info | Docs drift: zip contents, CSP statement, list of web routes, privacy policy silent on recording. | Updated README, SECURITY.md, DISTRIBUTION.md, PRIVACY.md. |
| 12 | Info | Sanitizer re-walked the parent after each unwrap (quadratic on nested unknown tags). | Iterative single pass. |
| 13 | Info | Housekeeping: instance host permission not revoked on disconnect; recorder listener stacked across recordings; service worker logged an error object carrying the tab URL. | All three fixed. |

## Verified as sound (no change needed)

- **Key handling.** Session storage by default (memory only; access level `TRUSTED_CONTEXTS`),
  cleared on disconnect. Password-type input with autocomplete off, cleared after a
  successful connect. Bearer header only, only to the configured https instance. Host
  permission scoped to that instance. The injected recorder only sends, never receives.
- **Vault.** Fresh 16-byte salt and 12-byte IV per save, PBKDF2-SHA256, AES-256-GCM,
  non-extractable key, passphrase never stored. Plaintext absence is asserted by a unit test
  and by the end-to-end harness reading `chrome.storage.local` after connecting.
- **Sanitizer.** Allow-list of tags and attributes; no `style`, `on*`, `srcdoc`,
  `formaction`; comments and non-element nodes dropped; unknown elements flattened to
  text; anchored URL scheme check; class allow-list; `rel="noopener noreferrer"`.
- **Gherkin renderer** escapes every interpolation and reads `textContent`, never HTML.
- **Network.** Cookies only on the web-session routes, with CSRF token and
  `X-Requested-With`; no third-party hosts; no telemetry; CSP forbids remote and inline
  scripts, objects, framing, forms and `<base>`.
- **Recorder.** Trusted events required for click/input/keydown; passwords and
  secret-looking fields (name, id, autocomplete, aria-label, placeholder heuristics) never
  logged; labels/values truncated; injected into the top frame only; events accepted only
  from the recorded tab.
- **Packaging.** Zero runtime dependencies; zip excludes tests, docs, dist and git
  metadata; tests take credentials from environment variables; no organisation-specific
  hosts in shipped code.

## Residual risks (by design, documented in SECURITY.md)

- Anyone with read access to the Chrome profile can read `chrome.storage.local` and
  IndexedDB: unsubmitted screenshots and recordings, and the encrypted vault blob (which
  then resists only as well as the passphrase does).
- `<all_urls>` is the only permission Chrome accepts for tab screenshots; once granted it is
  technically broad. Revocable in Settings.
- The API key is as powerful as its Testmo user. Entering it into a phishing "instance"
  URL would leak it; the extension can only enforce https.
- Recorded values typed into non-secret fields, and anything visible in a recording, may
  be sensitive. Pixelate, edit the notes, or delete drafts before submitting.
