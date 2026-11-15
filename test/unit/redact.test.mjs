import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactUrl, describeEvent } from '../../lib/steps.js';

const M = '\u2022\u2022\u2022';

test('masks credential-like query params, fragments and userinfo', () => {
  assert.equal(redactUrl('https://app.test/cb?code=abc123&state=xyz&page=2'), `https://app.test/cb?code=${M}&state=${M}&page=2`);
  assert.equal(redactUrl('https://app.test/#access_token=eyJhbGciOi&expires_in=3600'), `https://app.test/#access_token=${M}&expires_in=3600`);
  assert.equal(redactUrl('https://user:pw@app.test/x'), 'https://app.test/x');
  assert.equal(redactUrl('https://app.test/settings?tab=profile'), 'https://app.test/settings?tab=profile');
  assert.equal(redactUrl('not a url'), 'not a url');
});

test('recorded navigation steps use the redacted URL', () => {
  assert.equal(describeEvent({ kind: 'start', url: 'https://app.test/?api_key=SECRET' }), `Open https://app.test/?api_key=${M}`);
});
