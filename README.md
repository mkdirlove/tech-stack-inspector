# Tech Stack Inspector (Browser Extension)

A browser extension that inspects the active tab and detects common web technologies, similar to Wappalyzer-style fingerprinting.

## Features

- Detects technologies from page signals (scripts, globals, DOM/meta markers)
- Detects server and backend technologies from HTTP response headers
- Shows confidence and evidence for each detection
- Runs on-demand from extension popup

## Included detections

CMS / E-commerce:

- React
- Next.js
- Vue.js
- Nuxt.js
- Angular
- jQuery
- WordPress
- Shopify
- Wix
- Squarespace
- Webflow
- Ghost
- BigCommerce
- Magento
- PrestaShop
- OpenCart
- Bootstrap
- Tailwind CSS
- Google Analytics
- Cloudflare
- Apache HTTP Server
- Nginx
- LiteSpeed
- OpenResty
- Caddy
- Microsoft IIS
- Envoy
- Gunicorn
- Uvicorn
- Express
- PHP
- ASP.NET
- Amazon CloudFront
- Fastly
- Varnish
- Vercel
- Netlify
- Akamai
- Fly.io
- Laravel
- Django
- Flask
- FastAPI
- Ruby on Rails
- Spring
- Koa
- hapi
- Node.js
- Python
- Ruby
- Java
- Go
- C#
- Elixir

## Notes

- Detection is signature-based and best-effort. Some sites hide or strip headers, so server/backend identification may be limited.

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`EXT/chrome`)

## Load in Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Select `/home/user/EXT/firefox/manifest.json`

## Project files

- `chrome/manifest.json` - Chrome extension manifest
- `chrome/popup.html` - Chrome popup UI
- `chrome/popup.css` - Chrome popup styles
- `chrome/popup.js` - Chrome detection logic + rendering
- `firefox/manifest.json` - Firefox extension manifest
