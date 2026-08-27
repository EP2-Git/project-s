import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

test.describe.configure({ retries: 0 });

const selectedRoute = '/design-lab/selected-direction';
const selectedHeading = 'People define authority. Agents act within it. Project S commits.';

const originalConcepts = [
  {
    route: '/design-lab/authority-pipeline',
    heading: 'Agents prepare. People approve. Project S commits.',
  },
  {
    route: '/design-lab/scheduling-kernel',
    heading: 'Scheduling infrastructure you can verify.',
  },
  {
    route: '/design-lab/own-your-booking-flow',
    heading: 'A booking system that belongs to you.',
  },
] as const;

const viewports = [
  { width: 1440, height: 900 },
  { width: 1200, height: 700 },
  { width: 900, height: 800 },
  { width: 768, height: 1024 },
  { width: 430, height: 932 },
  { width: 390, height: 844 },
  { width: 360, height: 800 },
] as const;

const captureEnabled = process.env.PROJECT_S_SELECTED_HOMEPAGE_CAPTURE === '1';
const captureRoot = resolve(process.cwd(), 'test-results', 'hosted-homepage-selected');

const observeErrors = (page: Page) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
};

const expectNoHorizontalOverflow = async (page: Page) => {
  await page.evaluate(() => document.fonts.ready);
  const dimensions = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.rootScrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
};

test('selected direction is isolated, noindex, truthful, semantic, and accessible', async ({ browserName, page }) => {
  test.setTimeout(60_000);
  const errors = observeErrors(page);
  if (browserName === 'firefox') {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  }
  await page.goto(selectedRoute);

  await expect(page).toHaveTitle('Project S selected homepage direction — human review');
  await expect(page.getByRole('heading', { level: 1, name: selectedHeading })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.getByText('Current proof · runnable today')).toBeVisible();
  await expect(page.getByText('Future direction · not available today')).toBeVisible();
  await expect(page.getByText('Planned · not available')).toBeVisible();
  await expect(page.getByText('Current Project S Core pre-alpha')).toBeVisible();

  const headings = await page.locator('h1, h2, h3').evaluateAll((elements) =>
    elements.map((element) => ({
      level: Number(element.tagName.slice(1)),
      text: element.textContent?.trim() ?? '',
    })),
  );
  expect(headings[0]).toEqual({ level: 1, text: selectedHeading });
  expect(headings.filter(({ level }) => level === 1)).toHaveLength(1);
  for (let index = 1; index < headings.length; index += 1) {
    expect(headings[index].level - headings[index - 1].level).toBeLessThanOrEqual(1);
  }

  const currentTop = await page.getByText('Current proof · runnable today').evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  const futureTop = await page.getByText('Future direction · not available today').evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  expect(currentTop).toBeLessThan(futureTop);

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(/\bfirst\b/i);
  expect(bodyText).toContain('CONFIRMATION_REQUIRED');
  expect(bodyText).toContain('A model statement or approved: true cannot substitute for a valid grant.');
  expect(bodyText).toContain('Bilateral agents, mandate-based authority, remote MCP, and Project S-to-Project S federation are product direction only.');
  expect(bodyText).toContain('There is no signup, pricing, uptime, or general-availability claim today.');

  const hrefs = await page.locator('a').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href')).filter((href): href is string => href !== null),
  );
  expect(hrefs.every((href) => (
    href === '/' ||
    href === '/demo' ||
    href === '/book/demo-host' ||
    href.startsWith('#')
  ))).toBe(true);
  expect(hrefs.some((href) => /pricing|signup|waitlist|cloud|github|remote/i.test(href))).toBe(false);

  await expectNoHorizontalOverflow(page);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});

test('keyboard users can skip, navigate, and operate the truthful interface preview', async ({ page }) => {
  const errors = observeErrors(page);
  await page.goto(selectedRoute);

  const skipLink = page.getByRole('link', { name: 'Skip to content' });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await skipLink.press('Enter');
  await expect(page).toHaveURL(/#main-content$/);

  const nextMonth = page.getByRole('button', { name: 'Next month' });
  await nextMonth.focus();
  await nextMonth.press('Enter');
  await expect(page.getByText('September 2026')).toBeVisible();

  const date = page.getByRole('button', { name: /THU\s+27/ });
  await date.focus();
  await date.press('Space');
  await expect(date).toHaveAttribute('aria-pressed', 'true');

  const time = page.getByRole('button', { name: '1:00 PM' });
  await time.focus();
  await time.press('Enter');
  await expect(time).toHaveAttribute('aria-pressed', 'true');

  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});

test('current and future meaning remains complete with reduced motion', async ({ page }) => {
  const errors = observeErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(selectedRoute);

  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await expect(page.getByRole('heading', { level: 1, name: selectedHeading })).toBeVisible();
  await expect(page.getByText('Current proof · runnable today')).toBeVisible();
  await expect(page.getByText('Future direction · not available today')).toBeVisible();
  await expect(page.getByText('Planned · not available')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});

test('future managed root and the three original review concepts remain separate', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Project S');
  await expect(page.getByRole('heading', { level: 1, name: selectedHeading })).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');

  for (const concept of originalConcepts) {
    await page.goto(concept.route);
    await expect(page.getByRole('heading', { level: 1, name: concept.heading })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  }
});

for (const viewport of viewports) {
  test(`selected direction fits ${viewport.width}x${viewport.height}`, async ({ browserName, page }) => {
    test.skip(browserName !== 'chromium', 'The complete viewport corpus has one canonical renderer.');
    const errors = observeErrors(page);
    await page.setViewportSize(viewport);
    await page.goto(selectedRoute);
    await expect(page.getByRole('heading', { level: 1, name: selectedHeading })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    if (captureEnabled) {
      await mkdir(captureRoot, { recursive: true });
      await page.screenshot({
        path: resolve(captureRoot, `selected-direction-${viewport.width}x${viewport.height}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
  });
}

for (const reflow of [
  { label: '200 percent zoom equivalent', width: 720, height: 900 },
  { label: '400 percent zoom equivalent', width: 360, height: 800 },
] as const) {
  test(`reflows at ${reflow.label}`, async ({ browserName, page }) => {
    test.skip(browserName !== 'chromium', 'Reflow equivalence has one canonical renderer.');
    await page.setViewportSize({ width: reflow.width, height: reflow.height });
    await page.goto(selectedRoute);
    await expect(page.getByRole('heading', { level: 1, name: selectedHeading })).toBeVisible();
    await expect(page.getByText('Current proof · runnable today')).toBeVisible();
    await expect(page.getByText('Future direction · not available today')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
