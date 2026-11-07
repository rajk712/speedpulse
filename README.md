# SpeedPulse

Internet speed test (ping, jitter, download, upload) in the style of speedtest.net, fast.com and nperf.com.

**Live:** https://speedpulse.speedpulse.workers.dev
It runs on Cloudflare Workers, so the test server sits in 300+ cities with no servers for you to manage.

## Run locally

```
npm install
npm run dev        # http://localhost:8787
```

Local results measure your own machine's loopback (often 1-2 Gbps), not your internet. Deploy to test real speeds.

## Deploy (your Cloudflare account)

1. Create a free account at cloudflare.com.
2. `npx wrangler login`
3. `npm run deploy`. You get `https://speedpulse.<your-subdomain>.workers.dev`.
4. Add a custom domain (Workers > speedpulse > Settings > Domains). A short brandable .com costs about $10/year.
5. Sanity check: run your site and speedtest.net back to back on the same connection. The numbers should be close.

## Files

- `src/worker.js`: API. `/api/ping`, `/api/down?bytes=N` (random bytes, max 100 MB), `/api/up` (POST, discards body), `/api/meta` (IP, ISP, city, Cloudflare colo).
- `public/index.html`, `app.js`, `style.css`: the test page. Results stay in the browser (localStorage). Share links look like `/?d=..&u=..&p=..&j=..`.
- `public/config.js`: AdSense IDs and the affiliate offer. Edit and redeploy, no code changes.
- `public/privacy.html`: required for AdSense. Fill in the bracketed fields.
- `public/ads.txt`: put your AdSense publisher line here after approval.

## Costs

- Workers Free: 100k requests/day. One test is about 40-150 requests, depending on connection speed.
- Workers Paid ($5/month): 10M requests/month included, and higher CPU limits. Move to it once you have real traffic.
- Bandwidth: Workers doesn't bill egress, but very heavy use falls under Cloudflare's terms. If you get serious traffic, read the current Workers pricing and terms, and talk to Cloudflare.

## Making money: realistic plan

Speed-test sites earn from high traffic volume and low revenue per visitor. Expect little income until you reach tens of thousands of visits a month. Traffic is the hard part, not the code.

1. **Ads (AdSense first, then Ezoic/Mediavine at higher traffic).**
   - Apply after the site has a real domain, the privacy page and some content.
   - Put your publisher ID in `config.js`. The ad slots stay hidden until you do.
   - Speed-test pages get repeat visits, but sessions are short.
2. **Affiliate offers.**
   - Set `offer` in `config.js`.
   - The offer shows only when the measured speed is slow (`showBelowMbps`). That's when "get a faster plan" or "try a VPN" converts best.
   - Good programs: broadband comparison sites in your target country, VPNs (NordVPN, Surfshark), mesh Wi-Fi routers (Amazon Associates).
3. **SEO pages (the main traffic engine).**
   - Pages like "Jio Fiber speed test", "Airtel speed test", "<city> broadband speed", "what is good ping for gaming".
   - Each one is a static HTML page in `public/` that embeds the same test.
4. **ISP rankings (the nperf model, phase 2).**
   - Store anonymous results: ISP, city, speeds. Use Cloudflare D1 (SQLite) and a `POST /api/result` endpoint.
   - Publish monthly "fastest ISP in India / in <city>" pages. These attract press links and long-tail search traffic.
   - Aggregated data can also be sold or licensed later.
   - Before collecting anything, update the privacy policy. Collect no raw IPs.
5. **Pro features (later).** Scheduled tests with email alerts ("your ISP dropped below what you pay for"), a CSV export and an embeddable widget for other sites. You could charge $2-3/month via Stripe or Razorpay.

## Things to know

- Don't use "Speedtest" in your name or logo. It's Ookla's trademark.
- Measuring is per browser connection, so results vary with Wi-Fi, VPNs and corporate proxies (Zscaler etc.).
- Accuracy above roughly 1 Gbps is limited by the browser, the same as competitors' browser tests.
