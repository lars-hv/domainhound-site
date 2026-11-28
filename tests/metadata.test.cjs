const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');

const read = path => readFileSync(new URL(path, `file://${__dirname}/`), 'utf8');

test('every sitemap page provides a social card and parseable structured data', () => {
  const urls = [...read('../sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)];
  assert.ok(urls.length > 0);
  for (const [, url] of urls) {
    const { pathname } = new URL(url);
    const html = read('..' + pathname + 'index.html');
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/, pathname);
    const graph = html.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)?.[1];
    assert.ok(graph, pathname + ' needs structured data');
    assert.equal(JSON.parse(graph)['@context'], 'https://schema.org', pathname);
  }
});
