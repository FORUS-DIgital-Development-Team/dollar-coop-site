import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPreview } from './server.mjs';

test('staged information and enquiry workflow enforce headers, validation, queueing and retention', async () => {
  let time = 0;
  const preview = createPreview({ now: () => time });
  preview.server.listen(0, '127.0.0.1');
  await once(preview.server, 'listening');
  const origin = 'http://127.0.0.1:' + preview.server.address().port;
  const body = new URLSearchParams({
    organisation: 'Fictitious Bank', country: 'Example', email: 'test@example.org', role: 'Treasury', useCase: 'Supplier payments',
  });
  const post = (data = body, requestOrigin = origin) => fetch(origin + '/enquiry-preview/', {
    method: 'POST', headers: { origin: requestOrigin }, body: data,
  });
  try {
    for (const path of ['/', '/settlement/', '/trust/', '/sitemap.xml', '/robots.txt', '/assets/site.css']) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
      assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      await response.text();
    }
    assert.equal((await post(body, 'https://other.example')).status, 403);
    assert.equal((await post(new URLSearchParams({ ...Object.fromEntries(body), website: 'bot' }))).status, 422);
    assert.equal((await post(new URLSearchParams({ ...Object.fromEntries(body), useCase: '<script>test</script>' }))).status, 422);
    const accepted = await post();
    assert.equal(accepted.status, 201);
    assert.match(await accepted.text(), /Sample enquiry saved/);
    assert.equal(preview.queue().length, 1);
    assert.deepEqual(JSON.parse(preview.queue()[0].details), { ...Object.fromEntries(body), volume: '' });
    assert.equal((await post(new URLSearchParams({ useCase: 'x'.repeat(8200) }))).status, 413);
    assert.equal((await post(new URLSearchParams({ ...Object.fromEntries(body), volume: 'sample' }))).status, 201);
    assert.equal((await post()).status, 429);
    assert.equal((await fetch(origin + '/queue')).status, 404);
    time += 30 * 86_400_000;
    assert.equal(preview.queue().length, 0);
    assert.equal((await post()).status, 201);
  } finally {
    await new Promise(resolve => preview.server.close(resolve));
  }
});
