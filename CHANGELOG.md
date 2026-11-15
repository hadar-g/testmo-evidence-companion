# Changelog

## Unreleased

- Fix: the run list groups tests by folder in Testmo's tree order. A case added with
  **Add case** now shows inside its folder, not at the bottom under a second folder header.
- **Attach** your own images to a test: drop PNG, JPEG, GIF or WebP files on the Evidence area, or
  pick them with the new **Attach** button. Uploads keep the file's real extension.
- New generic icon (viewfinder and check mark).
- Fix: the Submit button kept a stale "Uploading…" label and stayed enabled-looking after a
  result with attachments was saved.
- Demo environment (`demo/`): stand-in Testmo instance with fictional data, a fictional store
  as application under test, and scripts that record the product demo and build the media in
  `docs/media/`.
- Open-source housekeeping: MIT licence, contributing guide, code of conduct, CI workflow,
  issue and pull request templates, Chrome Web Store listing copy (`docs/STORE-LISTING.md`).
- Test fixtures and comments use neutral example ids.
- The store zip no longer includes the icon source (`icons/src/`).

## 0.4.0 — 2026-09-17

- **Add a test case** from the run (button under the test list): Gherkin editor with keyword buttons, Tab
  indentation, Enter keeps indentation, live preview, name derived from the Scenario
  title; folder and template pickers; fields rendered from the project's template
  definitions (dropdowns, text, step/expected rows). Creates the case in the repository
  and adds it to the current run, then opens it.

## 0.3.1 — 2026-09-17 (security hardening after audit)

- New toolbar icon (robot with wrench antenna).

- Explicit Content Security Policy for extension pages; `chrome.storage.session` locked
  to trusted contexts.
- Credential-like query parameters, fragments, userinfo and long opaque path segments
  are masked in recorded URLs and "Tested on" links, before anything is stored.
- Rich text from Testmo: images are only kept when hosted on the configured instance;
  protocol-relative links treated as external; iterative sanitizer walk.
- Status colours validated as hex before use in style attributes; dates escaped.
- Runtime messages accepted only from the extension's own contexts; recorder events
  whitelisted and size-bounded; recorder listener removed on stop; 1000-event ceiling.
- Page-triggered (synthetic) change events are labelled "(triggered by the page)".
- REST requests never follow redirects and never send cookies.
- Vault saved only after Testmo accepts the key; PBKDF2 raised to 600k iterations with a
  100k floor; passphrase must mix letters with digits or symbols.
- Host permission for the instance revoked on disconnect.
- Test fixtures scrubbed of organisation-specific identifiers.

## 0.3.0 — 2026-09-17

- **Record steps**: records the tab as WebM video (tabCapture, falling back to the
  tab-sharing dialog) while an injected recorder logs clicks, typing (passwords masked),
  selections, checkboxes, key presses, scrolling and page changes as timestamped
  "Steps to reproduce" appended to the notes. Recordings are queued as evidence, can be
  previewed with clickable steps, and are uploaded with the result.
- New permissions: `tabCapture`, `scripting`.

## 0.2.0 — 2026-09-17

- Runs screen: milestone filter, defaulting to the newest open milestone (remembered per
  project), plus *All* / *No milestone*.
- Runs screen: "Assigned to me" toggle. Uses Testmo's *My work* assignment table when
  signed in; falls back to results assigned to you through the REST API otherwise.
- Run screen redesign: header card with milestone, percentage and per-status chips;
  tests grouped by repository folder; status chips and coloured edges per test.
- Gherkin rendering for BDD / Cucumber cases: keyword colouring, quoted strings,
  `<parameters>`, examples tables, tags and comments.
- Typography and spacing pass across the panel.
- Fixes: `/user` response unwrapped, attachment upload response array, annotator text
  tool focus, per-folder case loading.

## 0.1.0 — 2026-09-17

Initial release.

- Side-panel UI: projects, runs, tests with status, test detail with instructions and
  history, notes, status buttons, timer, submit with auto-advance.
- Screenshot capture with annotator (rectangle, ellipse, arrow, pen, highlighter, text,
  numbered markers, pixelate, crop, undo/redo).
- Drafts (notes, status, timer, screenshots) persisted locally per instance/run/case.
- API key kept in session storage by default; optional passphrase-encrypted vault.
- Official REST API for everything it can do; signed-in web session used only to resolve
  run-test ids of untested cases and to attach files to results, with an API-only
  fallback.
- Unit tests and a Playwright end-to-end harness.
