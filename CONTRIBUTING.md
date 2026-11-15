# Contributing

Thanks for helping make manual testing less tedious. Issues and pull requests are welcome.

## Before you start

- Check the [issue tracker](../../issues) for an existing report. Comment there instead of opening a duplicate.
- For anything larger than a bug fix, open an issue first so we can agree on the approach.
- Security problems: see [SECURITY.md](SECURITY.md). Do not open a public issue for them.

## Development setup

No build step; the extension is plain ES modules loaded by Chrome.

```bash
npm install          # Playwright, for the end-to-end harness and the demo only
npm test             # unit tests (node:test), no browser needed
```

Load the folder with **Load unpacked** at `chrome://extensions` (Developer mode on). Reload the extension card after editing files.

You do not need a Testmo account to work on the UI: `npm run demo:mock` starts a stand-in Testmo instance with fictional data on `https://localhost:8443` (self-signed certificate, API key `demo-api-key`). Because the extension only talks to `https://` hosts you have to accept the certificate once by opening that URL in the same Chrome profile. See [demo/README.md](demo/README.md).

## Making changes

- Keep the runtime free of dependencies. Everything shipped lives in `manifest.json`, `background.js`, `sidepanel/`, `annotate/`, `lib/`, `recorder/`, `icons/`.
- Only `lib/session.js` may talk to Testmo web routes (the ones that need the user's browser session). Everything else goes through the documented REST API in `lib/api.js`.
- Anything rendered from Testmo content goes through `lib/sanitize.js`.
- Add or update a unit test in `test/unit/` for logic changes. Run the e2e harness (`test/e2e/run.mjs`) against a scratch run if you touched result submission, recording or case creation.
- Bump `version` in both `manifest.json` and `package.json` and add a `CHANGELOG.md` entry when the change is user-visible.
- Do not add organisation-specific hosts, ids, names or credentials anywhere in the repository, including tests and fixtures.

## Pull requests

Describe what changed and why, list how you tested it, and include screenshots for UI changes. Small, focused pull requests are reviewed faster.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
