# domainhound.dev

Static landing page for Domain Hound. Served by GitHub Pages.
Brand icons: Simple Icons (CC0), trademarks belong to their owners. Font: Mulish (OFL).

## IndexNow

After a successful GitHub Pages deployment from `main`, the IndexNow workflow
submits all URLs in the deployed commit's `sitemap.xml` in one request.

To submit manually, use Node.js 22 or newer and run this from a checkout of the
deployed commit:

```sh
node scripts/indexnow.mjs
```

Use `node scripts/indexnow.mjs --dry-run` to inspect the payload without sending
it. HTTP 200 confirms receipt. HTTP 202 confirms receipt with key validation
pending.
