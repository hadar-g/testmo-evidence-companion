# Demo environment

Everything in this folder exists so the extension can be shown, developed and
recorded without a real Testmo account. All data is fictional.

| Piece | What it is |
| --- | --- |
| `mock-testmo/` | A stand-in Testmo instance: the REST API v1 routes the panel uses and the web routes it reaches through the browser session (`runs/view`, `render_test_search`, `attachments/create`, `create_result`, `render_assignment_table`). Data lives in `data.mjs`: the project *Summit Outfitters – Web Store*, milestone *Release 3.2*, a partially tested *Checkout regression* run, Gherkin and step-based cases. HTTPS with a self-signed certificate, because the extension refuses `http://`. |
| `shop/` | *Summit Outfitters*, a small fictional web store used as the application under test. It has one intentional bug: a valid discount code shows the discount line but never reduces the total. |
| `record.mjs` | Drives the extension through a scripted session in Chrome for Testing and saves every frame plus a manifest. |
| `compose.py` | Turns those frames into the files in `docs/media/`: MP4 and GIF clips, 1280×800 screenshots and Chrome Web Store artwork, drawn inside a generic browser window with the panel docked on the right. |

## Run the mock instance by hand

```bash
npm run demo:mock                  # https://127.0.0.1:8443, API key: demo-api-key
npm run demo:shop                  # https://127.0.0.1:8444
```

Open both URLs once in Chrome and accept the certificate warning, then connect
the panel to `https://127.0.0.1:8443` with the key above. Control endpoints:

- `GET /__demo/session?on=0` — pretend the tester is not signed in to Testmo (exercises the API-only fallback); `on=1` restores it.
- `GET /__demo/reset` — fresh data.
- `GET /__demo/state` — JSON dump of runs, results, tests and attachments.

## Regenerate the media

Needs Playwright, a Chromium or Chrome for Testing binary (Google Chrome 137+
ignores `--load-extension`), Python 3 with Pillow, and ffmpeg.

```bash
PW_MODULE=/path/to/node_modules/playwright/index.mjs \
PW_EXECUTABLE="/path/to/Google Chrome for Testing" \
npm run demo:record -- /tmp/demo-frames
npm run demo:compose -- /tmp/demo-frames /tmp/demo-out
```

`record.mjs` launches a visible browser (recording needs a real window), maps
the fictional hosts `acme.testmo.net` and `summit-outfitters.example` to the
two local servers with `--host-resolver-rules`, and runs with
`--ignore-certificate-errors`. It takes about three minutes. Copy what you want
from `/tmp/demo-out` into `docs/media/`.

To change the story, edit the scenes at the bottom of `record.mjs`; to change
the data, edit `mock-testmo/data.mjs`.
