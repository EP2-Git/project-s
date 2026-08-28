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

const sourceFiles = {
  review: resolve(captureRoot, '02-review-mobile.png'),
  authority: resolve(captureRoot, '03-human-authority-recorded-mobile.png'),
  committed: resolve(captureRoot, '04-committed-booking.png'),
};

const sourceEntries = await Promise.all(
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
);
const sources = Object.fromEntries(sourceEntries);

const authorityHtml = `<!doctype html>
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
</html>`;

const socialHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    html, body { height: 640px; margin: 0; overflow: hidden; width: 1280px; }
    body {
      background:
        radial-gradient(circle at 80% 20%, rgba(121, 100, 255, .28), transparent 34%),
        linear-gradient(145deg, #070817, #0c0d25);
      color: #f8f8ff;
      display: grid;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      grid-template-columns: 1.45fr 1fr;
      padding: 64px 70px;
    }
    .brand { align-items: center; display: flex; gap: 18px; }
    .mark {
      align-items: center;
      background: linear-gradient(145deg, #9b8bff, #6f58ed);
      border-radius: 14px;
      display: flex;
      font-size: 42px;
      font-weight: 900;
      height: 66px;
      justify-content: center;
      width: 66px;
    }
    .name { font-size: 34px; font-weight: 850; letter-spacing: -.03em; }
    h1 {
      font-size: 58px;
      letter-spacing: -.045em;
      line-height: 1.02;
      margin: 60px 0 24px;
      max-width: 700px;
    }
    .sub {
      color: #bdbdd1;
      font-size: 24px;
      line-height: 1.45;
      margin: 0;
      max-width: 660px;
    }
    .meta {
      color: #a9a2ff;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: .08em;
      margin-top: 42px;
      text-transform: uppercase;
    }
    .flow {
      align-self: center;
      display: grid;
      gap: 14px;
      margin-left: 50px;
    }
    .state {
      background: rgba(17, 18, 47, .92);
      border: 1px solid #343564;
      border-radius: 16px;
      padding: 20px 24px;
    }
    .state strong { display: block; font-size: 25px; margin-bottom: 5px; }
    .state span { color: #bfc0d4; font-size: 17px; }
    .state.refused { border: 2px solid #ff7c98; }
    .state.refused strong { color: #ffb0c0; }
    .arrow { color: #7367e9; font-size: 20px; margin-left: 26px; }
  </style>
</head>
<body>
  <section>
    <div class="brand"><div class="mark">S</div><div class="name">Project S</div></div>
    <h1>People define authority.<br>Agents act within it.<br>PostgreSQL commits.</h1>
    <p class="sub">Open-source, authority-bounded booking for humans and agents.</p>
    <div class="meta">Apache-2.0 · public pre-alpha</div>
  </section>
  <section class="flow" aria-label="Authority flow">
    <div class="state"><strong>Prepared</strong><span>Non-holding request</span></div>
    <div class="arrow">↓</div>
    <div class="state refused"><strong>Refused</strong><span>No human authority yet</span></div>
    <div class="arrow">↓</div>
    <div class="state"><strong>Human authority</strong><span>Exact request approved</span></div>
    <div class="arrow">↓</div>
    <div class="state"><strong>Committed once</strong><span>Exact replay, no duplicate</span></div>
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
  const authorityPage = await browser.newPage({ viewport: { width: 780, height: 720 } });
  await authorityPage.setContent(authorityHtml, { waitUntil: 'load' });
  await authorityPage.waitForFunction(() => globalThis.__assetsReady === true);
  const authorityPng = await authorityPage.screenshot({ type: 'png', fullPage: true });
  const authorityWebp = await toWebp(authorityPage, authorityPng);
  await writeFile(
    resolve(outputRoot, 'authority-boundary-overview.webp'),
    authorityWebp,
  );

  const socialPage = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  await socialPage.setContent(socialHtml, { waitUntil: 'load' });
  await socialPage.screenshot({
    path: resolve(outputRoot, 'project-s-social-preview.png'),
    type: 'png',
  });
} finally {
  await browser.close();
}

const outputs = [
  resolve(outputRoot, 'authority-boundary-overview.webp'),
  resolve(outputRoot, 'project-s-social-preview.png'),
];
for (const output of outputs) {
  const bytes = await readFile(output);
  console.log(`${output}: ${bytes.length} bytes, sha256=${createHash('sha256').update(bytes).digest('hex')}`);
}
for (const [name, source] of Object.entries(sources)) {
  console.log(`source ${name}: sha256=${source.sha256}`);
}
