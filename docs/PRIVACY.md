# Privacy policy — Testmo Evidence Companion

_Last updated: <DATE>. Publisher: <YOUR ORGANISATION / NAME>, <CONTACT EMAIL>._

## What the extension does

Testmo Evidence Companion lets a tester read and record manual test results for a
Testmo instance they already have an account on, and attach screenshots as evidence.

## Data the extension handles

- **Testmo instance URL and API key** that you enter. The key is used solely to
  authenticate your requests to that instance. By default it is held in memory for the
  browser session; if you choose "remember on this device" it is stored encrypted with a
  passphrase only you know.
- **Screenshots** you take of the current tab, **screen recordings** you start with
  "Record steps", and **notes** you type. They are stored locally in the extension's
  storage until you submit them, then sent to your Testmo instance and deleted locally.
- **Actions during a recording.** While "Record steps" is running, a script is injected
  into the tab you are testing to log which elements you click, what you type (never in
  password or secret-looking fields), what you select and how you scroll. The script is
  removed when you stop. Credentials in page URLs are masked before they are written down.
- **Preferences** (selected project, last run, options), stored locally.

## Where data goes

Data is transmitted only to the Testmo instance whose URL you configured, over HTTPS.
The extension does not send any data to the publisher or to any third party. It
contains no analytics, advertising or tracking code.

## Data we (the publisher) collect

None. We have no server; we never see your key, screenshots, notes or usage.

## Permissions

- *Side panel, storage*: to show the UI and keep your settings and drafts.
- *Access to your Testmo host*: to call the Testmo API on your behalf.
- *Read data on all websites* (optional, requested on first screenshot): Chrome allows
  tab screenshots only with this permission or right after clicking the toolbar icon.
  The extension reads a page only when you press Capture or while you record. You can
  revoke it at any time in the extension's Settings or at `chrome://extensions`.
- *Capture tab video* and *run scripts in the tab*: used only by "Record steps", only
  while a recording is running.

## Your choices

Disconnect in Settings to delete the stored key; delete local drafts in Settings; remove
the extension to delete everything it stored. Revoke the API key in Testmo at any time.

## Affiliation

This extension is an independent open-source project. It is not affiliated with, endorsed by or supported by Testmo or its owner.

## Changes

We will update this page when the extension's data handling changes and note the date
above.
