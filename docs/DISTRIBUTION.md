# Sharing and distributing the extension

## 0. Build the package

```bash
npm run package
# → dist/testmo-evidence-companion-<version>.zip
```

The zip contains only what Chrome needs (`manifest.json`, `background.js`, `sidepanel/`,
`annotate/`, `lib/`, `recorder/`, `icons/`). Bump `version` in `manifest.json` **and** `package.json`
for each release; the Web Store rejects re-uploads with the same version.

## 1. Zip + "Load unpacked" (quick, small team)

1. Send the zip (or point people at the repository).
2. They unzip, open `chrome://extensions`, enable **Developer mode**, click **Load
   unpacked**, pick the folder.

Pros: zero setup, no accounts. Cons: Chrome shows a developer-mode warning at start-up,
no auto-update, and recent Chrome versions can disable unpacked extensions after a period
unless the browser is managed. Fine for a pilot, not for a whole department.

## 2. Chrome Web Store — unlisted

Best balance for an internal tool: installs like any extension, auto-updates, no
developer-mode warnings, but never appears in search.

1. Register at <https://chrome.google.com/webstore/devconsole> (one-time $5 fee, needs
   2-step verification on the Google account). Prefer a shared/company account over a
   personal one so the listing survives staff changes.
2. **New item** → upload the zip.
3. Fill in the listing: name, summary, description, at least one 1280×800 screenshot
   (take them from a demo Testmo project, not real customer data), category
   *Developer Tools*.
4. **Privacy practices** tab:
   - Single purpose: "Record Testmo test results with screenshot evidence from a side
     panel."
   - Permission justifications (copy from README → *Permissions explained*). For
     `<all_urls>` say explicitly that `chrome.tabs.captureVisibleTab` only accepts
     `activeTab` or `<all_urls>` and that the extension captures only on user click.
   - Data usage: declare "Authentication information" (the API key) and "Website
     content" (screenshots), both *not* sold, *not* used for unrelated purposes,
     *not* transferred except to the user's own Testmo instance.
   - Privacy policy URL: host `docs/PRIVACY.md` (a GitHub page or your intranet works),
     fill in the placeholders first.
5. **Distribution** tab → Visibility **Unlisted**. Submit for review (usually 1–3 days;
   `<all_urls>` can trigger a longer review).
6. Share the store URL internally. Users click **Add to Chrome**.

## 3. Chrome Web Store — private to your Google Workspace

Same steps as unlisted, but under **Distribution** choose **Private** and pick your
Workspace domain (the publisher account must belong to that domain). Only users signed
in to Chrome with an account from that domain can see and install it. A Workspace admin
can also pin it in the organisation's private Web Store collection.

## 4. Managed Chrome (force-install or allow-list)

For fleets managed through Google Admin console, Intune, Jamf or Group Policy:

1. Publish to the Web Store (unlisted or private) to get an extension ID and let Google
   host updates — or self-host: pack a `.crx` with a private key you keep offline and
   serve an update manifest XML (see Chrome's *Autoupdating* docs).
2. Set the policy:
   - `ExtensionInstallForcelist`: `"<extension-id>;https://clients2.google.com/service/update2/crx"`
     installs it for everyone with no user action and no uninstall option.
   - or `ExtensionInstallAllowlist` / `ExtensionSettings` with `installation_mode:
     "allowed"` if you only want to permit it while blocking other extensions.
3. With `ExtensionSettings` you can also pre-grant `runtime_allowed_hosts` for your
   Testmo host so users do not see the host permission prompt.

Note: dragging a raw `.crx` into `chrome://extensions` no longer works on Windows and
macOS; Chrome only accepts `.crx` files installed through the Web Store or policy.

## 5. Later: publishing publicly

Nothing in the code is tied to a specific company. To go public: switch visibility to
**Public**, add proper store artwork, keep the privacy policy hosted, and consider a
support address. Expect users on other Testmo instances to report differences in
custom statuses or templates; the panel reads both from the API, so most should work.

## Release checklist

- [ ] `npm test` passes
- [ ] `node test/e2e/run.mjs` passes against a scratch run
- [ ] version bumped in `manifest.json` and `package.json`, entry added to `CHANGELOG.md`
- [ ] `npm run package`
- [ ] screenshots in the listing contain no real customer data
- [ ] privacy policy still accurate
