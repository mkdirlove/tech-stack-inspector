const stateEl = document.getElementById("state");
const resultsEl = document.getElementById("results");
const targetEl = document.getElementById("target");
const themeLightBtn = document.getElementById("theme-light");
const themeDarkBtn = document.getElementById("theme-dark");
const THEME_STORAGE_KEY = "site-stack-inspector-theme";
const extensionApi = globalThis.browser ?? globalThis.chrome;

function getInitialTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === "light" || savedTheme === "dark") {
    return savedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  const normalizedTheme = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = normalizedTheme;
  localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme);

  const isLight = normalizedTheme === "light";
  themeLightBtn.classList.toggle("is-active", isLight);
  themeDarkBtn.classList.toggle("is-active", !isLight);
  themeLightBtn.setAttribute("aria-pressed", String(isLight));
  themeDarkBtn.setAttribute("aria-pressed", String(!isLight));
}

function initThemeSwitcher() {
  applyTheme(getInitialTheme());
  themeLightBtn.addEventListener("click", () => applyTheme("light"));
  themeDarkBtn.addEventListener("click", () => applyTheme("dark"));
}

function setState(text) {
  stateEl.textContent = text;
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sanitizeVersion(version) {
  if (!version) return "";
  return String(version).trim().replace(/^v/i, "").replace(/^[^0-9]+/, "");
}

function chooseVersion(existingVersion, incomingVersion, incomingConfidence, existingConfidence) {
  const current = sanitizeVersion(existingVersion);
  const next = sanitizeVersion(incomingVersion);

  if (!next) return current;
  if (!current) return next;
  if (incomingConfidence > existingConfidence) return next;
  return next.length > current.length ? next : current;
}

function upsertDetection(map, name, confidence, evidence, version = "") {
  const existing = map.get(name);
  if (!existing) {
    map.set(name, { name, confidence, evidence, version: sanitizeVersion(version) });
    return;
  }

  const nextConfidence = Math.max(existing.confidence, confidence);
  const nextEvidence =
    existing.evidence.includes(evidence) || evidence.includes(existing.evidence)
      ? existing.evidence.length >= evidence.length
        ? existing.evidence
        : evidence
      : `${existing.evidence} | ${evidence}`;

  map.set(name, {
    name,
    confidence: nextConfidence,
    evidence: nextEvidence,
    version: chooseVersion(existing.version, version, confidence, existing.confidence)
  });
}

function normalizeDetections(detections) {
  return [...detections]
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name))
    .map((item) => ({
      ...item,
      confidence: Math.max(1, Math.min(100, Math.round(item.confidence))),
      evidence: item.evidence || "Matched known signals.",
      version: sanitizeVersion(item.version)
    }));
}

function renderResults(detections) {
  resultsEl.innerHTML = "";

  if (!detections.length) {
    setState("No known technologies detected.");
    return;
  }

  setState(`Detected ${detections.length} ${detections.length > 1 ? "technologies" : "technology"}.`);

  for (const item of detections) {
    const li = document.createElement("li");
    li.className = "result-item";
    const versionMarkup = item.version
      ? `<span class="version-pill">v${escapeHtml(item.version)}</span>`
      : "";
    li.innerHTML = `
      <div class="result-top">
        <span class="result-name-wrap">
          <span class="result-name">${escapeHtml(item.name)}</span>
          ${versionMarkup}
        </span>
        <span class="badge">${item.confidence}%</span>
      </div>
      <div class="evidence">${escapeHtml(item.evidence)}</div>
    `;
    resultsEl.appendChild(li);
  }
}


function getFirstHeader(headers, name) {
  return headers[name.toLowerCase()] || "";
}

function objectFromHeaders(headers) {
  return Object.fromEntries([...headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
}

function addHeaderTokenDetections(detections, token, signatures, evidencePrefix) {
  if (!token) return;

  for (const signature of signatures) {
    const match = token.match(signature.pattern);
    if (match) {
      const matchIndex = match.index ?? 0;
      const lookahead = token.slice(matchIndex, matchIndex + 48);
      const versionMatch = lookahead.match(/(?:\/|\s|v)(\d+(?:\.\d+){0,3}(?:[-+._][a-z0-9]+)*)/i);
      const version = versionMatch ? sanitizeVersion(versionMatch[1]) : "";
      upsertDetection(
        detections,
        signature.name,
        signature.confidence,
        `${evidencePrefix}: ${token.trim()}`,
        version
      );
    }
  }
}

function detectInPage() {
  const detections = new Map();
  const scripts = Array.from(document.scripts)
    .map((s) => s.src || "")
    .filter(Boolean);
  const html = document.documentElement.outerHTML;
  const lowerHtml = html.toLowerCase();
  const cookies = (document.cookie || "").toLowerCase();
  const generatorMeta =
    document.querySelector('meta[name="generator"]')?.getAttribute("content") || "";
  const lowerGeneratorMeta = generatorMeta.toLowerCase();

  function extractByRegex(source, pattern) {
    const match = source.match(pattern);
    return match ? sanitizeVersion(match[1]) : "";
  }

  function inferScriptVersion(pattern) {
    const script = scripts.find((src) => pattern.test(src));
    if (!script) return "";

    return (
      extractByRegex(script, /@(\d+(?:\.\d+){0,3}(?:[-+._][a-z0-9]+)*)/i) ||
      extractByRegex(script, /\/(\d+(?:\.\d+){0,3}(?:[-+._][a-z0-9]+)*)\//i) ||
      extractByRegex(script, /-(\d+(?:\.\d+){0,3}(?:[-+._][a-z0-9]+)*)\.min\./i)
    );
  }

  function upsert(name, confidence, evidence, version = "") {
    const existing = detections.get(name);
    if (!existing) {
      detections.set(name, { name, confidence, evidence, version: sanitizeVersion(version) });
      return;
    }

    const nextConfidence = Math.max(existing.confidence, confidence);
    const nextEvidence =
      existing.evidence.includes(evidence) || evidence.includes(existing.evidence)
        ? existing.evidence.length >= evidence.length
          ? existing.evidence
          : evidence
        : `${existing.evidence} | ${evidence}`;

    detections.set(name, {
      name,
      confidence: nextConfidence,
      evidence: nextEvidence,
      version: chooseVersion(existing.version, version, confidence, existing.confidence)
    });
  }

  function anyScriptMatch(patterns) {
    return scripts.some((src) => patterns.some((p) => p.test(src)));
  }

  function anyHtmlMatch(patterns) {
    return patterns.some((p) => p.test(html));
  }

  if (window.React || window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || anyScriptMatch([/react/i])) {
    upsert("React", 88, "React globals or script patterns found.", window.React?.version || "");
  }

  if (window.__NEXT_DATA__ || anyScriptMatch([/next(\.min)?\.js/i, /_next\//i])) {
    upsert("Next.js", 93, "__NEXT_DATA__ or Next asset path found.");
  }

  if (window.Vue || window.__VUE__ || anyScriptMatch([/vue(\.runtime)?(\.min)?\.js/i])) {
    upsert(
      "Vue.js",
      88,
      "Vue globals or script patterns found.",
      window.Vue?.version || window.__VUE__?.version || ""
    );
  }

  if (window.__NUXT__ || anyScriptMatch([/_nuxt\//i, /nuxt/i])) {
    upsert(
      "Nuxt.js",
      92,
      "__NUXT__ object or Nuxt asset path found.",
      window.__NUXT__?.config?.version || ""
    );
  }

  if (window.ng || document.querySelector("[ng-version]") || anyScriptMatch([/angular/i])) {
    upsert(
      "Angular",
      90,
      "Angular attributes/globals or script patterns found.",
      document.querySelector("[ng-version]")?.getAttribute("ng-version") || ""
    );
  }

  if (window.jQuery || anyScriptMatch([/jquery(\.min)?\.js/i])) {
    upsert("jQuery", 90, "jQuery global or script pattern found.", window.jQuery?.fn?.jquery || "");
  }

  if (window.Alpine || anyScriptMatch([/alpine(\.min)?\.js/i])) {
    upsert("Alpine.js", 85, "Alpine global or script pattern found.");
  }

  if (anyScriptMatch([/svelte/i]) || html.includes("svelte")) {
    upsert("Svelte", 70, "Svelte script or markup markers found.");
  }

  if (anyScriptMatch([/gatsby/i]) || html.includes("___gatsby")) {
    upsert("Gatsby", 75, "Gatsby bundle or runtime markers found.");
  }

  if (anyScriptMatch([/astro/i]) || html.includes("astro-island")) {
    upsert("Astro", 80, "Astro component markers found.");
  }

  if (anyScriptMatch([/preact/i]) || window.preact) {
    upsert("Preact", 82, "Preact global or script pattern found.");
  }

  if (anyScriptMatch([/ember/i]) || window.Ember) {
    upsert("Ember.js", 82, "Ember global or script pattern found.");
  }

  if (lowerGeneratorMeta.includes("wordpress") || lowerHtml.includes("wp-content")) {
    upsert(
      "WordPress",
      95,
      "WordPress generator/meta or wp-content found.",
      extractByRegex(generatorMeta, /wordpress\s+([0-9][\w.+-]*)/i)
    );
  }

  if (lowerGeneratorMeta.includes("drupal") || lowerHtml.includes("/sites/default/files/")) {
    upsert(
      "Drupal",
      90,
      "Drupal generator/meta or default files path found.",
      extractByRegex(generatorMeta, /drupal\s+([0-9][\w.+-]*)/i)
    );
  }

  if (lowerGeneratorMeta.includes("joomla") || /\/media\/system\/js\//i.test(html)) {
    upsert(
      "Joomla",
      88,
      "Joomla generator/meta or media path found.",
      extractByRegex(generatorMeta, /joomla[!\s]+([0-9][\w.+-]*)/i)
    );
  }

  if (lowerGeneratorMeta.includes("ghost") || anyHtmlMatch([/ghost-content/i, /ghost\//i])) {
    upsert(
      "Ghost",
      88,
      "Ghost generator or content markers found.",
      extractByRegex(generatorMeta, /ghost\s+([0-9][\w.+-]*)/i)
    );
  }

  if (lowerGeneratorMeta.includes("wix") || anyHtmlMatch([/static\.wixstatic\.com/i, /wix-code/i])) {
    upsert("Wix", 90, "Wix generator or platform assets found.");
  }

  if (lowerGeneratorMeta.includes("squarespace") || anyHtmlMatch([/static1\.squarespace\.com/i])) {
    upsert("Squarespace", 90, "Squarespace generator or asset host found.");
  }

  if (anyHtmlMatch([/webflow\.js/i, /webflow/i])) {
    upsert("Webflow", 84, "Webflow runtime markers found.");
  }

  if (anyHtmlMatch([/cdn\.bigcommerce\.com/i, /stencil-utils/i])) {
    upsert("BigCommerce", 86, "BigCommerce platform assets found.");
  }

  if (anyHtmlMatch([/mage\/cookies\.js/i, /magento/i])) {
    upsert("Magento", 86, "Magento asset or markup patterns found.");
  }

  if (anyHtmlMatch([/prestashop/i, /modules\/ps_/i])) {
    upsert("PrestaShop", 84, "PrestaShop module markers found.");
  }

  if (anyHtmlMatch([/opencart/i, /catalog\/view\/theme/i])) {
    upsert("OpenCart", 82, "OpenCart theme or path markers found.");
  }

  if (
    document.querySelector('script[src*="cdn.shopify.com"]') ||
    window.Shopify ||
    html.includes("shopify")
  ) {
    upsert("Shopify", 93, "Shopify script/global markers found.");
  }

  if (/woocommerce/i.test(html)) {
    upsert("WooCommerce", 82, "WooCommerce-related markup found.");
  }

  if (cookies.includes("laravel_session") || anyHtmlMatch([/\/vendor\/laravel/i])) {
    upsert("Laravel", 86, "Laravel session cookie or framework path found.");
    upsert("PHP", 74, "Laravel marker suggests PHP backend.");
  }

  if (cookies.includes("csrftoken") && cookies.includes("sessionid")) {
    upsert("Django", 84, "Django-style CSRF/session cookies found.");
    upsert("Python", 72, "Django marker suggests Python backend.");
  }

  if (cookies.includes("_rails_session") || cookies.includes("rack.session")) {
    upsert("Ruby on Rails", 86, "Rails/Rack session cookie markers found.");
    upsert("Ruby", 76, "Rails marker suggests Ruby backend.");
  }

  if (
    anyScriptMatch([/bootstrap(\.bundle)?(\.min)?\.js/i, /bootstrap(\.min)?\.css/i]) ||
    document.querySelector('[class*="container"]')
  ) {
    upsert(
      "Bootstrap",
      65,
      "Bootstrap asset pattern or container class found.",
      inferScriptVersion(/bootstrap/i)
    );
  }

  if (document.querySelector("[class*='tailwind'],[class*='tw-']") || /tailwind/i.test(html)) {
    upsert("Tailwind CSS", 62, "Tailwind-like utility class patterns found.", inferScriptVersion(/tailwind/i));
  }

  if (
    anyScriptMatch([/googletagmanager\.com\/gtag/i, /google-analytics\.com\/analytics\.js/i]) ||
    window.gtag
  ) {
    upsert("Google Analytics", 96, "Google Analytics script/global markers found.");
  }

  if (anyScriptMatch([/googletagmanager\.com\/gtm\.js/i])) {
    upsert("Google Tag Manager", 96, "GTM script pattern found.");
  }

  if (anyScriptMatch([/cdn\.segment\.com/i]) || window.analytics) {
    upsert("Segment", 88, "Segment script/global markers found.");
  }

  if (anyScriptMatch([/hotjar/i]) || window.hj) {
    upsert("Hotjar", 88, "Hotjar script/global markers found.");
  }

  if (anyScriptMatch([/matomo/i, /piwik/i]) || window._paq) {
    upsert("Matomo", 85, "Matomo/Piwik script/global markers found.");
  }

  return Array.from(detections.values());
}

async function fetchHeadersForUrl(url) {
  let headResponse;
  try {
    headResponse = await fetch(url, { method: "HEAD", redirect: "follow", cache: "no-store" });
  } catch {
    headResponse = null;
  }

  if (headResponse && headResponse.status !== 405) {
    return objectFromHeaders(headResponse.headers);
  }

  const getResponse = await fetch(url, { method: "GET", redirect: "follow", cache: "no-store" });
  return objectFromHeaders(getResponse.headers);
}

async function detectFromHeaders(url) {
  const detections = new Map();
  const headers = await fetchHeadersForUrl(url);

  const server = getFirstHeader(headers, "server");
  const poweredBy = getFirstHeader(headers, "x-powered-by");
  const via = getFirstHeader(headers, "via");
  const xGenerator = getFirstHeader(headers, "x-generator");
  const xDrupalCache = getFirstHeader(headers, "x-drupal-cache");
  const xDrupalDynamicCache = getFirstHeader(headers, "x-drupal-dynamic-cache");
  const xRuntime = getFirstHeader(headers, "x-runtime");
  const xShopifyShopApiCallLimit = getFirstHeader(headers, "x-shopify-shop-api-call-limit");
  const xWpTotal = getFirstHeader(headers, "x-wp-total");
  const xPoweredCms = getFirstHeader(headers, "x-powered-cms");
  const xAspNetVersion = getFirstHeader(headers, "x-aspnet-version");
  const xAspNetMvcVersion = getFirstHeader(headers, "x-aspnetmvc-version");

  function extractByRegex(source, pattern) {
    const match = source.match(pattern);
    return match ? sanitizeVersion(match[1]) : "";
  }

  const serverSignatures = [
    { pattern: /\bnginx\b/i, name: "Nginx", confidence: 99 },
    { pattern: /\bapache\b/i, name: "Apache HTTP Server", confidence: 99 },
    { pattern: /\blitespeed\b/i, name: "LiteSpeed", confidence: 99 },
    { pattern: /\bopenresty\b/i, name: "OpenResty", confidence: 98 },
    { pattern: /\bcaddy\b/i, name: "Caddy", confidence: 98 },
    { pattern: /\biis\b|microsoft-iis/i, name: "Microsoft IIS", confidence: 99 },
    { pattern: /\benvoy\b/i, name: "Envoy", confidence: 98 },
    { pattern: /\bgunicorn\b/i, name: "Gunicorn", confidence: 96 },
    { pattern: /\buvicorn\b/i, name: "Uvicorn", confidence: 96 },
    { pattern: /\bcloudflare\b/i, name: "Cloudflare", confidence: 99 },
    { pattern: /\bawselb\b/i, name: "AWS Elastic Load Balancer", confidence: 95 }
  ];

  const poweredBySignatures = [
    { pattern: /\bexpress\b/i, name: "Express", confidence: 96 },
    { pattern: /\bphp\b/i, name: "PHP", confidence: 97 },
    { pattern: /\basp\.?net\b/i, name: "ASP.NET", confidence: 97 },
    { pattern: /\bnext\.?js\b/i, name: "Next.js", confidence: 95 },
    { pattern: /\bnest(js)?\b/i, name: "NestJS", confidence: 94 },
    { pattern: /\blaravel\b/i, name: "Laravel", confidence: 94 },
    { pattern: /\bdjango\b/i, name: "Django", confidence: 94 },
    { pattern: /\bflask\b/i, name: "Flask", confidence: 94 },
    { pattern: /\bfastapi\b/i, name: "FastAPI", confidence: 94 },
    { pattern: /\bspring\b/i, name: "Spring", confidence: 93 },
    { pattern: /\brails\b/i, name: "Ruby on Rails", confidence: 94 },
    { pattern: /\bkoa\b/i, name: "Koa", confidence: 92 },
    { pattern: /\bhapi\b/i, name: "hapi", confidence: 92 }
  ];

  if (server) {
    addHeaderTokenDetections(detections, server, serverSignatures, "Server header");
  }

  if (poweredBy) {
    addHeaderTokenDetections(detections, poweredBy, poweredBySignatures, "X-Powered-By");
  }

  addHeaderTokenDetections(
    detections,
    poweredBy,
    [
      { pattern: /\bnode(\.js)?\b/i, name: "Node.js", confidence: 90 },
      { pattern: /\bpython\b/i, name: "Python", confidence: 90 },
      { pattern: /\bjava\b/i, name: "Java", confidence: 90 },
      { pattern: /\bruby\b/i, name: "Ruby", confidence: 90 },
      { pattern: /\bgo\b|\bgolang\b/i, name: "Go", confidence: 88 },
      { pattern: /\bphp\b/i, name: "PHP", confidence: 97 },
      { pattern: /\basp\.?net\b/i, name: "C#", confidence: 85 }
    ],
    "Language signal"
  );

  if (xGenerator) {
    addHeaderTokenDetections(
      detections,
      xGenerator,
      [
        { pattern: /\bwordpress\b/i, name: "WordPress", confidence: 95 },
        { pattern: /\bdrupal\b/i, name: "Drupal", confidence: 92 },
        { pattern: /\bjoomla\b/i, name: "Joomla", confidence: 90 }
      ],
      "X-Generator"
    );
  }

  if (xAspNetVersion || xAspNetMvcVersion) {
    upsertDetection(
      detections,
      "ASP.NET",
      98,
      "ASP.NET version headers found.",
      xAspNetVersion || xAspNetMvcVersion
    );
    upsertDetection(detections, "C#", 88, "ASP.NET version headers suggest C#.");
  }

  if (headers["cf-ray"] || headers["cf-cache-status"]) {
    upsertDetection(detections, "Cloudflare", 99, "Cloudflare headers found.");
  }

  if (headers["x-amz-cf-id"] || headers["x-amz-cf-pop"] || /cloudfront/i.test(via)) {
    upsertDetection(detections, "Amazon CloudFront", 96, "CloudFront headers or Via chain found.");
  }

  if (headers["x-served-by"]?.toLowerCase().includes("fastly") || headers["x-fastly-request-id"]) {
    upsertDetection(detections, "Fastly", 96, "Fastly headers found.");
  }

  if (headers["x-varnish"] || /varnish/i.test(via)) {
    upsertDetection(detections, "Varnish", 96, "Varnish headers found.");
  }

  if (headers["x-vercel-id"]) {
    upsertDetection(detections, "Vercel", 96, "Vercel deployment header found.");
  }

  if (headers["x-nf-request-id"]) {
    upsertDetection(detections, "Netlify", 96, "Netlify request header found.");
  }

  if (headers["x-shopify-stage"] || headers["x-shopid"]) {
    upsertDetection(detections, "Shopify", 96, "Shopify-specific response headers found.");
  }

  if (xShopifyShopApiCallLimit) {
    upsertDetection(detections, "Shopify", 97, "Shopify API call limit header found.");
  }

  if (/akamai/i.test(server) || /akamai/i.test(via) || headers["x-akamai-transformed"]) {
    upsertDetection(detections, "Akamai", 94, "Akamai response hints found.");
  }

  if (headers["fly-request-id"]) {
    upsertDetection(detections, "Fly.io", 94, "Fly.io response header found.");
  }

  if (xDrupalCache || xDrupalDynamicCache) {
    upsertDetection(detections, "Drupal", 97, "Drupal cache headers found.");
    upsertDetection(detections, "PHP", 78, "Drupal headers suggest PHP backend.");
  }

  if (xWpTotal || headers["x-wp-totalpages"]) {
    upsertDetection(detections, "WordPress", 97, "WordPress REST API headers found.");
    upsertDetection(detections, "PHP", 78, "WordPress headers suggest PHP backend.");
  }

  if (/wordpress/i.test(xPoweredCms) || /wordpress/i.test(xGenerator)) {
    upsertDetection(detections, "WordPress", 95, "CMS headers indicate WordPress.");
  }

  if (/drupal/i.test(xPoweredCms) || /drupal/i.test(xGenerator)) {
    upsertDetection(detections, "Drupal", 95, "CMS headers indicate Drupal.");
  }

  if (/joomla/i.test(xPoweredCms) || /joomla/i.test(xGenerator)) {
    upsertDetection(detections, "Joomla", 95, "CMS headers indicate Joomla.");
  }

  if (/next\.js/i.test(headers["x-powered-by"])) {
    upsertDetection(
      detections,
      "Next.js",
      95,
      "X-Powered-By indicates Next.js.",
      extractByRegex(poweredBy, /next\.?js[\/\s-]*v?([0-9][\w.+-]*)/i)
    );
    upsertDetection(detections, "Node.js", 90, "Next.js header implies Node.js runtime.");
  }

  if (/phusion passenger/i.test(server)) {
    upsertDetection(detections, "Phusion Passenger", 96, "Passenger server signature found.");
    upsertDetection(detections, "Ruby", 84, "Passenger often indicates Ruby stack.");
  }

  if (/werkzeug/i.test(server)) {
    upsertDetection(detections, "Werkzeug", 94, "Werkzeug server signature found.");
    upsertDetection(detections, "Python", 88, "Werkzeug indicates Python backend.");
  }

  if (/kestrel/i.test(server)) {
    upsertDetection(detections, "Kestrel", 96, "Kestrel server signature found.");
    upsertDetection(detections, "ASP.NET", 92, "Kestrel indicates ASP.NET stack.");
    upsertDetection(detections, "C#", 88, "Kestrel suggests C# backend.");
  }

  if (/cowboy/i.test(server)) {
    upsertDetection(detections, "Cowboy", 94, "Cowboy server signature found.");
    upsertDetection(detections, "Elixir", 84, "Cowboy often indicates Elixir/Phoenix stack.");
  }

  if (/unicorn|puma/i.test(server) || /rack/i.test(poweredBy)) {
    upsertDetection(detections, "Ruby", 88, "Ruby app server markers found.");
  }

  if (/gunicorn|uvicorn|uwsgi|hypercorn/i.test(server) || /python/i.test(poweredBy)) {
    upsertDetection(detections, "Python", 90, "Python server/runtime markers found.");
  }

  if (/php/i.test(poweredBy)) {
    upsertDetection(
      detections,
      "PHP",
      97,
      "X-Powered-By exposes PHP runtime.",
      extractByRegex(poweredBy, /php[\/\s-]*v?([0-9][\w.+-]*)/i)
    );
  }

  if (/express|node/i.test(poweredBy)) {
    upsertDetection(
      detections,
      "Node.js",
      92,
      "X-Powered-By suggests Node.js runtime.",
      extractByRegex(poweredBy, /node(?:\.js)?[\/\s-]*v?([0-9][\w.+-]*)/i)
    );
  }

  if (/servlet|tomcat|jetty|undertow/i.test(server) || /java/i.test(poweredBy)) {
    upsertDetection(
      detections,
      "Java",
      90,
      "Java app server/runtime markers found.",
      extractByRegex(poweredBy, /java[\/\s-]*v?([0-9][\w.+-]*)/i)
    );
  }

  if (/go|golang/i.test(poweredBy) || /caddy/i.test(server)) {
    upsertDetection(detections, "Go", 84, "Go runtime/server markers found.");
  }

  if (xRuntime) {
    upsertDetection(detections, "Ruby on Rails", 82, "X-Runtime header commonly used by Rails.");
    upsertDetection(detections, "Ruby", 76, "X-Runtime header suggests Ruby stack.");
  }

  return Array.from(detections.values());
}

function mergeDetections(...lists) {
  const merged = new Map();
  for (const list of lists) {
    for (const item of list) {
      upsertDetection(merged, item.name, item.confidence, item.evidence);
    }
  }
  return Array.from(merged.values());
}

async function inspectCurrentTab() {
  const [tab] = await extensionApi.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.id) {
    setState("No active tab found.");
    return;
  }

  targetEl.textContent = tab.url || "Unknown page";

  if (!tab.url || !/^https?:\/\//i.test(tab.url)) {
    setState("Open a normal website tab (http/https) and try again.");
    return;
  }

  setState("Scanning page and response headers...");

  const pageDetectionPromise = (async () => {
    if (extensionApi.scripting?.executeScript) {
      const injected = await extensionApi.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: detectInPage
      });
      return injected?.[0]?.result || [];
    }

    const legacyInjected = await extensionApi.tabs.executeScript(tab.id, {
      code: `(${detectInPage.toString()})();`
    });
    return legacyInjected?.[0] || [];
  })();

  const headerDetectionPromise = detectFromHeaders(tab.url).catch(() => []);

  const [pageResult, headerResult] = await Promise.allSettled([
    pageDetectionPromise,
    headerDetectionPromise
  ]);

  const pageDetections = pageResult.status === "fulfilled" ? pageResult.value || [] : [];
  const headerDetections = headerResult.status === "fulfilled" ? headerResult.value || [] : [];
  const normalizedDetections = normalizeDetections(mergeDetections(pageDetections, headerDetections));
  renderResults(normalizedDetections);
}

initThemeSwitcher();

inspectCurrentTab().catch((error) => {
  setState(`Failed to inspect page: ${error.message}`);
});
