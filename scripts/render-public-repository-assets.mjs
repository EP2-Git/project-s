#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const repositoryRoot = process.cwd();
const captureRoot = resolve(
  repositoryRoot,
  'test-results',
  'authority-boundary-demo',
);
const outputRoot = resolve(repositoryRoot, 'docs', 'assets');

const renderMode = process.argv[2] ?? '--all';
if (!['--all', '--authority-only', '--social-only'].includes(renderMode)) {
  throw new Error(
    'Usage: node scripts/render-public-repository-assets.mjs [--all|--authority-only|--social-only]',
  );
}
const renderAuthority = renderMode !== '--social-only';
const renderSocial = renderMode !== '--authority-only';

const sourceFiles = {
  review: resolve(captureRoot, '02-review-mobile.png'),
  authority: resolve(captureRoot, '03-human-authority-recorded-mobile.png'),
  committed: resolve(captureRoot, '04-committed-booking.png'),
};

const sourceEntries = renderAuthority
  ? await Promise.all(
      Object.entries(sourceFiles).map(async ([name, path]) => {
        const bytes = await readFile(path);
        return [
          name,
          {
            dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          },
        ];
      }),
    )
  : [];
const sources = Object.fromEntries(sourceEntries);

const authorityHtml = renderAuthority ? `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 780px; overflow: hidden; }
    body {
      background:
        radial-gradient(circle at 82% 9%, rgba(121, 100, 255, .18), transparent 30%),
        #070817;
      color: #f7f7ff;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 46px 42px 38px;
    }
    header { margin-bottom: 26px; }
    .eyebrow {
      color: #a9a2ff;
      font-size: 24px;
      font-weight: 800;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    h1 {
      font-size: 54px;
      line-height: 1.03;
      letter-spacing: -.04em;
      margin: 12px 0 14px;
      max-width: 690px;
    }
    .intro {
      color: #c6c6da;
      font-size: 27px;
      line-height: 1.4;
      margin: 0;
      max-width: 690px;
    }
    .sequence { display: grid; gap: 18px; }
    .panel {
      align-items: center;
      background: rgba(16, 17, 43, .94);
      border: 1px solid #292a58;
      border-radius: 24px;
      display: block;
      overflow: hidden;
      padding: 28px 30px 30px;
      position: relative;
    }
    .panel.refused {
      background: linear-gradient(110deg, rgba(63, 20, 40, .98), rgba(18, 17, 43, .98) 64%);
      border: 3px solid #ff7c98;
      box-shadow: 0 0 0 7px rgba(255, 124, 152, .08);
    }
    .step {
      color: #a9a2ff;
      font-size: 22px;
      font-weight: 900;
      letter-spacing: .12em;
      margin-bottom: 10px;
      text-transform: uppercase;
    }
    .refused .step { color: #ff9caf; }
    h2 {
      font-size: 42px;
      letter-spacing: -.025em;
      line-height: 1.07;
      margin: 0 0 15px;
    }
    .panel p {
      color: #c8c8db;
      font-size: 27px;
      line-height: 1.42;
      margin: 0;
    }
    .result {
      color: #86f0d0;
      display: block;
      font-size: 23px;
      font-weight: 800;
      letter-spacing: .02em;
      margin-top: 14px;
    }
    .refused .result { color: #ffb0c0; }
    .capture {
      align-items: center;
      background: #090a1d;
      border: 1px solid #323466;
      border-radius: 18px;
      display: flex;
      height: 240px;
      justify-content: center;
      overflow: hidden;
      margin-top: 22px;
      padding: 8px;
    }
    canvas { display: block; height: 100%; width: 100%; }
    footer {
      align-items: center;
      color: #9a9aaf;
      display: grid;
      font-size: 19px;
      gap: 8px;
      margin-top: 24px;
    }
    .brand { color: #f7f7ff; font-weight: 800; }
  </style>
</head>
<body>
  <header>
    <div class="eyebrow">Project S authority boundary</div>
    <h1>One request. Three authorities. Four observable states.</h1>
    <p class="intro">Preparation gives an agent a reviewable request—not permission to create a booking.</p>
  </header>
  <main class="sequence">
    <section class="panel">
      <div>
        <div class="step">01 · Agent</div>
        <h2>Agent prepared</h2>
        <p>The MCP client prepared one exact, expiring request. The time was not held.</p>
        <span class="result">Non-holding intent</span>
      </div>
      <div class="capture"><canvas id="prepared" width="620" height="205"></canvas></div>
    </section>
    <section class="panel refused">
      <div>
        <div class="step">02 · Refusal</div>
        <h2>Create refused</h2>
        <p>The client tried immediately. Project S refused because no person had approved.</p>
        <span class="result">CONFIRMATION_REQUIRED</span>
      </div>
      <div class="capture"><canvas id="blocked" width="620" height="205"></canvas></div>
    </section>
    <section class="panel">
      <div>
        <div class="step">03 · Human</div>
        <h2>Authority recorded</h2>
        <p>The browser approved the exact preparation. Approval still did not create or reserve a booking.</p>
        <span class="result">Explicit authority, no booking yet</span>
      </div>
      <div class="capture"><canvas id="authority" width="620" height="205"></canvas></div>
    </section>
    <section class="panel">
      <div>
        <div class="step">04 · PostgreSQL</div>
        <h2>Committed once</h2>
        <p>The database rechecked the request under the host lock. Exact replay returned the same booking.</p>
        <span class="result">One matching booking asserted</span>
      </div>
      <div class="capture"><canvas id="committed" width="620" height="205"></canvas></div>
    </section>
  </main>
  <footer>
    <span>Synthetic local fixture · assertion-backed MCP, browser, and PostgreSQL run</span>
    <span class="brand">Project S Core · public pre-alpha</span>
  </footer>
  <script>
    const inputs = ${JSON.stringify({
      review: sources.review.dataUrl,
      authority: sources.authority.dataUrl,
      committed: sources.committed.dataUrl,
    })};

    const drawCrop = async (id, dataUrl, sx, sy, sw, sh) => {
      const canvas = document.getElementById(id);
      const context = canvas.getContext('2d');
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      context.fillStyle = '#08091b';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(canvas.width / sw, canvas.height / sh);
      const width = sw * scale;
      const height = sh * scale;
      const dx = (canvas.width - width) / 2;
      const dy = (canvas.height - height) / 2;
      context.drawImage(image, sx, sy, sw, sh, dx, dy, width, height);
    };

    Promise.all([
      drawCrop('prepared', inputs.review, 16, 108, 358, 178),
      drawCrop('blocked', inputs.review, 33, 310, 324, 184),
      drawCrop('authority', inputs.authority, 16, 350, 358, 260),
      drawCrop('committed', inputs.committed, 300, 250, 1100, 255),
    ]).then(() => { window.__assetsReady = true; });
  </script>
</body>
</html>` : '';

const socialHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    html, body { height: 640px; margin: 0; overflow: hidden; width: 1280px; }
    body {
      background: #f4f3ef;
      border-top: 12px solid #171716;
      color: #171716;
      display: grid;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      gap: 54px;
      grid-template-columns: 1.08fr .92fr;
      padding: 52px 68px 58px;
      position: relative;
    }
    body::after {
      background: #ded9ff;
      border: 2px solid #171716;
      border-radius: 36px;
      content: "";
      height: 462px;
      position: absolute;
      right: 48px;
      top: 104px;
      transform: rotate(2.5deg);
      width: 456px;
      z-index: 0;
    }
    .copy, .product { position: relative; z-index: 1; }
    .brand { align-items: center; display: flex; gap: 16px; }
    .mark { display: block; height: 62px; width: 62px; }
    .name { font-size: 32px; font-weight: 800; letter-spacing: -.035em; }
    .eyebrow {
      color: #6857d9;
      font-size: 17px;
      font-weight: 800;
      letter-spacing: .12em;
      margin-top: 54px;
      text-transform: uppercase;
    }
    h1 {
      font-size: 65px;
      letter-spacing: -.055em;
      line-height: .98;
      margin: 16px 0 22px;
      max-width: 620px;
    }
    .sub {
      color: #4c4b47;
      font-size: 22px;
      line-height: 1.42;
      margin: 0;
      max-width: 580px;
    }
    .meta {
      align-items: center;
      display: flex;
      gap: 10px;
      margin-top: 34px;
    }
    .meta span {
      border: 1px solid rgba(23, 23, 22, .24);
      border-radius: 999px;
      font-size: 14px;
      font-weight: 750;
      letter-spacing: .055em;
      padding: 9px 13px;
      text-transform: uppercase;
    }
    .meta span:first-child {
      background: #171716;
      border-color: #171716;
      color: #fff;
    }
    .product {
      align-self: center;
      justify-self: end;
      width: 450px;
    }
    .booking-card {
      background: #fff;
      border: 2px solid #171716;
      border-radius: 24px;
      box-shadow: 14px 14px 0 #171716;
      overflow: hidden;
      width: 430px;
    }
    .window {
      align-items: center;
      background: #fafaf8;
      border-bottom: 1px solid rgba(23, 23, 22, .13);
      display: flex;
      gap: 7px;
      height: 42px;
      padding: 0 16px;
    }
    .dot { background: rgba(23, 23, 22, .18); border-radius: 50%; height: 8px; width: 8px; }
    .address {
      background: rgba(23, 23, 22, .045);
      border-radius: 5px;
      color: #77756f;
      font-size: 11px;
      margin-left: 8px;
      padding: 5px 10px;
    }
    .booking-body { padding: 22px 24px 23px; }
    .booking-label {
      align-items: center;
      color: #6857d9;
      display: flex;
      font-size: 12px;
      font-weight: 800;
      gap: 7px;
      letter-spacing: .1em;
      text-transform: uppercase;
    }
    .calendar-icon {
      border: 2px solid currentColor;
      border-radius: 4px;
      height: 15px;
      position: relative;
      width: 15px;
    }
    .calendar-icon::after {
      border-top: 2px solid currentColor;
      content: "";
      left: 1px;
      position: absolute;
      right: 1px;
      top: 4px;
    }
    h2 {
      font-size: 27px;
      letter-spacing: -.04em;
      line-height: 1.05;
      margin: 12px 0 6px;
    }
    .timezone { color: #77756f; font-size: 13px; margin: 0; }
    .meeting {
      align-items: center;
      background: #f7f6ff;
      border: 1.5px solid #6857d9;
      border-radius: 14px;
      display: grid;
      gap: 12px;
      grid-template-columns: 42px 1fr 20px;
      margin-top: 18px;
      padding: 12px;
    }
    .clock {
      align-items: center;
      background: #6857d9;
      border-radius: 10px;
      color: #fff;
      display: flex;
      font-size: 20px;
      height: 42px;
      justify-content: center;
      width: 42px;
    }
    .meeting strong { display: block; font-size: 14px; }
    .meeting small { color: #77756f; display: block; font-size: 11px; margin-top: 3px; }
    .check { color: #6857d9; font-size: 19px; font-weight: 900; }
    .month {
      align-items: center;
      border-top: 1px solid rgba(23, 23, 22, .12);
      display: flex;
      font-size: 13px;
      font-weight: 750;
      justify-content: space-between;
      margin-top: 18px;
      padding-top: 15px;
    }
    .month span { color: #77756f; font-size: 17px; }
    .days { display: grid; gap: 6px; grid-template-columns: repeat(5, 1fr); margin-top: 11px; }
    .day {
      align-items: center;
      border: 1px solid transparent;
      border-radius: 9px;
      color: #696761;
      display: flex;
      flex-direction: column;
      font-size: 13px;
      font-weight: 750;
      height: 51px;
      justify-content: center;
    }
    .day small { font-size: 8px; letter-spacing: .08em; margin-bottom: 3px; }
    .day.selected { background: #6857d9; color: #fff; }
    .times { display: grid; gap: 8px; grid-template-columns: repeat(3, 1fr); margin-top: 12px; }
    .time {
      border: 1px solid rgba(23, 23, 22, .15);
      border-radius: 9px;
      color: #696761;
      font-size: 11px;
      font-weight: 750;
      padding: 10px 4px;
      text-align: center;
    }
    .time.selected { background: #171716; border-color: #171716; color: #fff; }
    .transports {
      align-items: center;
      color: #5f5d57;
      display: flex;
      font-size: 12px;
      font-weight: 750;
      gap: 11px;
      justify-content: center;
      letter-spacing: .04em;
      margin-top: 26px;
    }
    .transports b { color: #6857d9; }
  </style>
</head>
<body>
  <section class="copy">
    <div class="brand">
      <svg class="mark" viewBox="0 0 64 64" role="img" aria-label="Project S">
        <rect width="64" height="64" rx="14" fill="#9b87f5"></rect>
        <path d="M43.5 19.5c-3-2.4-6.8-3.7-11.4-3.7-8 0-13.4 4.2-13.4 10.4 0 5.4 3.6 8.4 11.8 10.2 5.2 1.1 6.8 2.2 6.8 4.2 0 2.3-2.2 3.7-5.8 3.7-4.4 0-8.1-1.6-11.3-4.8l-4.4 5.2c3.9 4 9.2 6.1 15.4 6.1 8.7 0 14.3-4.3 14.3-10.9 0-5.7-3.5-8.6-12-10.4-5-1.1-6.6-2.1-6.6-4 0-2.1 2-3.4 5.2-3.4 3.4 0 6.3 1.1 8.9 3.2z" fill="#fff"></path>
      </svg>
      <div class="name">Project S</div>
    </div>
    <div class="eyebrow">Open-source scheduling</div>
    <h1>Booking infrastructure for humans and agents.</h1>
    <p class="sub">A self-hostable booking system with a browser, HTTP API, TypeScript SDK, and local MCP.</p>
    <div class="meta"><span>Public pre-alpha</span><span>Apache-2.0</span></div>
  </section>
  <section class="product" aria-label="Synthetic Project S booking-page preview">
    <div class="booking-card">
      <div class="window">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        <span class="address">project-s.local/book/demo-host</span>
      </div>
      <div class="booking-body">
        <div class="booking-label"><span class="calendar-icon"></span> Booking page</div>
        <h2>Book time with Demo Host</h2>
        <p class="timezone">Times shown in America/Halifax</p>
        <div class="meeting">
          <span class="clock">◷</span>
          <span><strong>Intro call</strong><small>30 minutes · synthetic fixture</small></span>
          <span class="check">✓</span>
        </div>
        <div class="month"><span>‹</span>August 2026<span>›</span></div>
        <div class="days">
          <span class="day"><small>MON</small>24</span>
          <span class="day"><small>TUE</small>25</span>
          <span class="day selected"><small>WED</small>26</span>
          <span class="day"><small>THU</small>27</span>
          <span class="day"><small>FRI</small>28</span>
        </div>
        <div class="times">
          <span class="time">9:00 AM</span>
          <span class="time selected">10:30 AM</span>
          <span class="time">1:00 PM</span>
        </div>
      </div>
    </div>
    <div class="transports"><b>Browser</b> · HTTP · TypeScript · MCP</div>
  </section>
</body>
</html>`;

const toWebp = async (page, png) => {
  const dataUrl = await page.evaluate(async (base64) => {
    const image = new globalThis.Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/webp', 0.92);
  }, png.toString('base64'));
  return Buffer.from(dataUrl.split(',')[1], 'base64');
};

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  if (renderAuthority) {
    const authorityPage = await browser.newPage({ viewport: { width: 780, height: 720 } });
    await authorityPage.setContent(authorityHtml, { waitUntil: 'load' });
    await authorityPage.waitForFunction(() => globalThis.__assetsReady === true);
    const authorityPng = await authorityPage.screenshot({ type: 'png', fullPage: true });
    const authorityWebp = await toWebp(authorityPage, authorityPng);
    await writeFile(
      resolve(outputRoot, 'authority-boundary-overview.webp'),
      authorityWebp,
    );
  }

  if (renderSocial) {
    const socialPage = await browser.newPage({ viewport: { width: 1280, height: 640 } });
    await socialPage.setContent(socialHtml, { waitUntil: 'load' });
    await socialPage.screenshot({
      path: resolve(outputRoot, 'project-s-social-preview.png'),
      type: 'png',
    });
  }
} finally {
  await browser.close();
}

const outputs = [];
if (renderAuthority) {
  outputs.push(resolve(outputRoot, 'authority-boundary-overview.webp'));
}
if (renderSocial) {
  outputs.push(resolve(outputRoot, 'project-s-social-preview.png'));
}
for (const output of outputs) {
  const bytes = await readFile(output);
  console.log(`${output}: ${bytes.length} bytes, sha256=${createHash('sha256').update(bytes).digest('hex')}`);
}
for (const [name, source] of Object.entries(sources)) {
  console.log(`source ${name}: sha256=${source.sha256}`);
}
