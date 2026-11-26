import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
export const watchOrigin = 'https://domainhound-alerts.domainhound.workers.dev';

function checkout(root, variable, candidates, file) {
  const base = process.env[variable] || candidates.map(path => resolve(root, path))
    .find(path => existsSync(resolve(path, file)));
  if (!base) throw new Error('Set ' + variable + ' to the checkout containing ' + file);
  return base;
}

// The alerts service is a separate Worker. Use its production source with isolated
// storage and intercept every outbound request, including any confirmation email.
export async function startWatchWorker(root, siteOrigin) {
  const alerts = checkout(root, 'WATCH_WORKER_ROOT', ['../domain-hound-alerts', '../../domain-hound-alerts'], 'src/runtime.mjs');
  const search = checkout(root, 'SEARCH_WORKER_ROOT', ['../remote-webcheck', '../domain-hound-remote'], 'node_modules/miniflare');
  const { build } = require(resolve(search, 'node_modules/esbuild'));
  const { Miniflare, convertV4MiniflareOptions } = require(resolve(search, 'node_modules/miniflare'));
  const bundled = await build({
    entryPoints: [resolve(alerts, 'src/runtime.mjs')], bundle: true, write: false, format: 'esm',
    external: ['cloudflare:workers']
  });
  const messages = new Map();
  const unexpected = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    cf: false, modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-11-01',
    durableObjects: { ALERTS: { className: 'WatchAlerts', useSQLite: true } },
    ratelimits: {
      IP_LIMITER: { namespace_id: '1001', simple: { limit: 5, period: 60 } },
      EMAIL_LIMITER: { namespace_id: '1002', simple: { limit: 3, period: 60 } }
    },
    bindings: {
      SIGNING_SECRET: 'site-qa-synthetic-watch-secret-0123456789',
      RESEND_API_KEY: 're_site_qa_no_delivery',
      MAIL_FROM: 'Domain Hound <alerts@example.com>',
      PUBLIC_BASE_URL: watchOrigin,
      ALLOWED_ORIGIN: siteOrigin
    },
    async outboundService(request) {
      const url = new URL(request.url);
      if (url.href === 'https://api.resend.com/emails' && request.method === 'POST') {
        const message = await request.json();
        messages.set([message.to].flat()[0], message.text);
        return Response.json({ id: 'local-message' });
      }
      if (url.href === 'https://data.iana.org/rdap/dns.json') {
        return Response.json({ services: [[['com'], ['https://rdap.verisign.com/com/v1/']]] });
      }
      if (url.href === 'https://rdap.verisign.com/com/v1/domain/example.com') {
        return Response.json({ objectClassName: 'domain', ldhName: 'EXAMPLE.COM', status: ['active'],
          events: [{ eventAction: 'expiration', eventDate: '2030-01-01T00:00:00Z' }] });
      }
      if (url.href === 'https://example.com/') {
        return new Response('<h1>Example Domain</h1>', { headers: { 'content-type': 'text/html' } });
      }
      unexpected.push(url.origin + url.pathname);
      return new Response('Unexpected outbound request', { status: 500 });
    }
  }));
  return {
    fetch: (url, options) => mf.dispatchFetch(url, options),
    async manageLink(email) {
      for (let attempt = 0; !messages.has(email) && attempt < 100; attempt++) await delay(50);
      const link = messages.get(email)?.match(/https:\/\/domainhound-alerts\.domainhound\.workers\.dev\/manage\?[^\s]+/)?.[0];
      if (!link) throw new Error('No signed manage link in the local confirmation');
      return link;
    },
    unexpected,
    close: () => mf.dispose()
  };
}
