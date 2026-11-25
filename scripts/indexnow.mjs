#!/usr/bin/env node
// Tell IndexNow search engines (Bing, Yandex, Seznam, Naver and others) about every URL in sitemap.xml.
// Run after the site is deployed:  node scripts/indexnow.mjs
// Check what would be sent:       node scripts/indexnow.mjs --dry-run
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HOST = 'domainhound.dev';
const KEY = 'a486ad900c8a321da66dd2adaa43dd58';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const root = new URL('..', import.meta.url);
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === '--dry-run')) {
  fail('usage: node scripts/indexnow.mjs [--dry-run]');
}
const dryRun = args.length === 1;

function fail(message) {
  console.error(`indexnow: ${message}`);
  process.exit(1);
}

const localKey = readFileSync(fileURLToPath(new URL(`${KEY}.txt`, root)), 'utf8').trim();
if (localKey !== KEY) fail(`${KEY}.txt does not contain the key`);

const sitemap = readFileSync(fileURLToPath(new URL('sitemap.xml', root)), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(match => match[1]);
if (urlList.length === 0) fail('sitemap.xml has no <loc> entries');
for (const url of urlList) {
  if (new URL(url).origin !== `https://${HOST}`) fail(`sitemap URL is not on ${HOST}: ${url}`);
}
if (new Set(urlList).size !== urlList.length) fail('sitemap.xml has duplicate URLs');

const body = { host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList };

if (dryRun) {
  console.log(JSON.stringify(body, null, 2));
  console.log(`indexnow: dry run, ${urlList.length} URLs, nothing sent`);
  process.exit(0);
}

// IndexNow rejects the batch unless the key file is live, so check the deployed copy first.
const live = await fetch(KEY_LOCATION, { redirect: 'follow' });
const liveKey = live.ok ? (await live.text()).trim() : '';
if (liveKey !== KEY) fail(`${KEY_LOCATION} is not live yet (HTTP ${live.status}); deploy first`);

const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});
const text = await response.text();
if (response.status !== 200 && response.status !== 202) {
  fail(`HTTP ${response.status} ${response.statusText} ${text}`.trim());
}
console.log(`indexnow: HTTP ${response.status}, submitted ${urlList.length} URLs`);
