import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderGherkin, looksLikeGherkin } from '../../lib/gherkin.js';

const SAMPLE = `Scenario: the user receives the staging OTA update on a fresh install
\tGiven the user has installed the ad hoc build from the latest test build (branch "feature-x")
\tAnd a staging update is already published for the platform (v5 for iOS, v1 for Android)
\tWhen the user opens the app
\tThen the update banner shows <version>
\tBut no restart prompt is displayed
\t| platform | version |
\t| iOS      | 5       |
\t# a comment
\t@smoke @ota`;

test('detects gherkin', () => {
  assert.equal(looksLikeGherkin(SAMPLE), true);
  assert.equal(looksLikeGherkin('<p>Just a description</p>'), false);
});

test('renders headers, steps, strings, params, tables, comments, tags', () => {
  const html = renderGherkin(SAMPLE);
  assert.match(html, /gk-scenario.*<span class="gk-kw">Scenario<\/span>/);
  assert.match(html, /gk-step gk-given"><span class="gk-step-kw">Given<\/span>/);
  assert.match(html, /gk-step gk-given"><span class="gk-step-kw">And<\/span>/, 'And inherits Given');
  assert.match(html, /gk-step gk-then"><span class="gk-step-kw">But<\/span>/, 'But inherits Then');
  assert.match(html, /gk-str">&quot;feature-x&quot;<\/span>/);
  assert.match(html, /gk-param">&lt;version&gt;<\/span>/);
  assert.match(html, /<table class="gk-table"><thead><tr><th>platform<\/th><th>version<\/th>/);
  assert.match(html, /gk-comment">#/);
  assert.match(html, /gk-tag">@smoke<\/span>/);
});

test('escapes html in the source', () => {
  const html = renderGherkin('Given <script>alert(1)</script> "x"');
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});
