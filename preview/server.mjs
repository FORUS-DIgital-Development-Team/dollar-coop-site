import { createServer } from 'node:http';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const day = 86_400_000;
const root = new URL('../dist/', import.meta.url);
const pages = new Map([
  ['/', ['index.html', 'text/html']],
  ['/settlement/', ['settlement/index.html', 'text/html']],
  ['/trust/', ['trust/index.html', 'text/html']],
  ['/sitemap.xml', ['sitemap.xml', 'application/xml']],
  ['/robots.txt', ['robots.txt', 'text/plain']],
  ['/assets/site.css', ['assets/site.css', 'text/css']],
  ['/assets/coop-turquoise-official.png', ['assets/coop-turquoise-official.png', 'image/png']],
  ['/assets/forus-digital-cooperative-reversed.svg', ['assets/forus-digital-cooperative-reversed.svg', 'image/svg+xml']],
]);

const fields = [
  ['organisation', 'Organisation', 120],
  ['country', 'Country or jurisdiction', 80],
  ['email', 'Business email', 254, 'email'],
  ['role', 'Institutional role', 100],
  ['useCase', 'Use case', 1000],
  ['volume', 'Indicative volumes (optional)', 120],
];
const form = `<form method="post" action="/enquiry-preview/">
  ${fields.map(([key, label, max, type = 'text']) =>
    `<p><label for="${key}">${label}</label><br>${key === 'useCase'
      ? `<textarea id="${key}" name="${key}" maxlength="${max}" required rows="4" cols="32"></textarea>`
      : `<input id="${key}" name="${key}" type="${type}" maxlength="${max}" ${key === 'volume' ? '' : 'required'}>`}</p>`).join('')}
  <div hidden><label for="website">Website</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
  <button type="submit">Save sample enquiry</button>
</form>`;

function html(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/assets/coop-turquoise-official.png"><link rel="stylesheet" href="/assets/site.css"><title>${title}</title></head><body><main class="wrap content"><h1>${title}</h1>${body}<p><a href="/">Return to the site preview</a></p></main></body></html>`;
}

export function createPreview({ database = ':memory:', now = Date.now } = {}) {
  const db = new DatabaseSync(database, { timeout: 5000 });
  db.exec(`
    PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS enquiries (
      reference TEXT PRIMARY KEY, submitted INTEGER NOT NULL, details TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS limits (
      bucket TEXT PRIMARY KEY, expires INTEGER NOT NULL, count INTEGER NOT NULL
    ) STRICT;
  `);
  const salt = randomBytes(32);
  function purge() {
    const time = now();
    db.prepare('DELETE FROM enquiries WHERE submitted <= ?').run(time - 30 * day);
    db.prepare('DELETE FROM limits WHERE expires <= ?').run(time);
  }
  purge();
  const cleanup = setInterval(purge, 60_000).unref();

  const server = createServer({ requestTimeout: 10_000 }, async (req, res) => {
    const preview = req.url === '/enquiry-preview/';
    const reply = (status, body, type = 'text/html') => {
      res.writeHead(status, {
        'Content-Type': type.startsWith('image/') ? type : type + '; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': `default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action ${preview ? "'self'" : "'none'"}`,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    try {
      if (req.headers.host !== '127.0.0.1:' + server.address().port) return reply(421, 'Use the loopback preview address.');
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (preview) return reply(200, html('Discuss an institutional pilot', '<p>Local workflow test. Use fictitious data only. Do not enter account details or upload identity documents. Sample entries expire after 30 days while the preview is running or on the next start.</p>' + form));
        const page = pages.get(req.url);
        if (!page) return reply(404, 'Page not found.');
        return reply(200, await readFile(new URL(page[0], root)), page[1]);
      }
      if (!preview || req.method !== 'POST') return reply(405, 'Method unavailable.');
      if (req.headers.origin !== 'http://' + req.headers.host) return reply(403, 'Request origin rejected.');
      if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return reply(415, 'Expected form data.');

      const time = now();
      const windowMs = 15 * 60_000;
      const windowIndex = Math.floor(time / windowMs);
      const bucket = createHmac('sha256', salt).update(req.socket.remoteAddress + ':' + windowIndex).digest('hex');
      const { count } = db.prepare(`INSERT INTO limits VALUES (?,?,1)
        ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count`).get(bucket, (windowIndex + 1) * windowMs);
      if (count > 5) return reply(429, html('Try again later', '<p>The enquiry limit has been reached for this window.</p>'));

      let length = 0;
      const chunks = [];
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        length += chunk.length;
        if (length > 8192) {
          res.setHeader('Connection', 'close');
          return reply(413, 'Form is too large.');
        }
        chunks.push(chunk);
      }
      const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const allowed = new Set([...fields.map(([key]) => key), 'website']);
      const invalid = () => reply(422, html('Check the enquiry', '<p>Use the preview form and complete the required fields with sample data. <a href="/enquiry-preview/">Return to the form</a>.</p>'));
      if ([...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length > 1) || params.get('website')) return invalid();

      const details = {};
      for (const [key, , max] of fields) {
        const value = (params.get(key) ?? '').trim();
        if ((!value && key !== 'volume') || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>\ufffd]/u.test(value)) return invalid();
        details[key] = value;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) return invalid();
      const reference = randomUUID();
      db.prepare('INSERT INTO enquiries VALUES (?,?,?)').run(reference, time, JSON.stringify(details));
      return reply(201, html('Sample enquiry saved', `<p>Reference <strong>${reference}</strong>. The sample is in the local review queue.</p>`));
    } catch {
      if (!res.headersSent) reply(500, 'Unable to complete the preview request.');
    }
  });
  server.on('close', () => { clearInterval(cleanup); db.close(); });
  return { server, purge, queue: () => {
    purge();
    return db.prepare('SELECT * FROM enquiries ORDER BY submitted,reference').all();
  } };
}

if (import.meta.main) {
  const preview = createPreview({ database: process.argv[2] ?? ':memory:' });
  preview.server.listen(Number(process.env.DOLLAR_PREVIEW_PORT ?? 4176), '127.0.0.1', () => {
    console.log('Site preview: http://127.0.0.1:' + preview.server.address().port);
  });
}
