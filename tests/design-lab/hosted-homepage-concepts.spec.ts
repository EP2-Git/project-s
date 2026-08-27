import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

test.describe.configure({ retries: 0 });

const concepts = [
  {
    slug: 'authority-pipeline',
    heading: 'Agents prepare. People approve. Project S commits.',
  },
  {
    slug: 'scheduling-kernel',
    heading: 'Scheduling infrastructure you can verify.',
  },
  {
    slug: 'own-your-booking-flow',
    heading: 'A booking system that belongs to you.',
  },
] as const;

const viewports = [
  { width: 1440, height: 900 },
  { width: 1200, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 430, height: 932 },
  { width: 390, height: 844 },
  { width: 360, height: 800 },
] as const;

const captureEnabled = process.env.PROJECT_S_HOMEPAGE_LAB_CAPTURE === '1';
const captureRoot = resolve(process.cwd(), 'test-results', 'hosted-homepage-lab');

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
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
};

test('future managed root remains separate from every review concept', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Project S');
  for (const concept of concepts) {
    await expect(page.getByRole('heading', { name: concept.heading })).toHaveCount(0);
  }
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
});

for (const concept of concepts) {
  test.describe(concept.slug, () => {
    test('is semantic, noindex, keyboard reachable, accessible, and error free', async ({ page }) => {
      const errors = observeErrors(page);
      await page.goto(`/design-lab/${concept.slug}`);
      await expect(page.getByRole('heading', { level: 1, name: concept.heading })).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      await expectNoHorizontalOverflow(page);

      const headingLevels = await page.locator('h1, h2, h3').evaluateAll((headings) =>
        headings.map((heading) => Number(heading.tagName.slice(1))),
      );
      expect(headingLevels[0]).toBe(1);
      expect(headingLevels.filter((level) => level === 1)).toHaveLength(1);

      await page.keyboard.press('Tab');
      const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? '');
      expect(focusedTag).not.toBe('BODY');

      const axe = await new AxeBuilder({ page }).analyze();
      expect(
        axe.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
      ).toEqual([]);
      expect(errors.consoleErrors).toEqual([]);
      expect(errors.pageErrors).toEqual([]);

      await page.locator('a[href="/"]').first().press('Enter');
      await expect(page).toHaveURL(/\/$/);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    });

    test('has a complete reduced-motion presentation', async ({ page }) => {
      const errors = observeErrors(page);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/design-lab/${concept.slug}`);
      await expect(page.getByRole('heading', { level: 1, name: concept.heading })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(
        await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
      ).toBe(true);
      expect(errors.consoleErrors).toEqual([]);
      expect(errors.pageErrors).toEqual([]);
    });

    for (const viewport of viewports) {
      test(`fits ${viewport.width}x${viewport.height}`, async ({ browserName, page }) => {
        test.skip(browserName !== 'chromium', 'The complete viewport corpus has one canonical renderer.');
        const errors = observeErrors(page);
        await page.setViewportSize(viewport);
        await page.goto(`/design-lab/${concept.slug}`);
        await expect(page.getByRole('heading', { level: 1, name: concept.heading })).toBeVisible();
        await expectNoHorizontalOverflow(page);

        if (captureEnabled) {
          await mkdir(captureRoot, { recursive: true });
          await page.screenshot({
            path: resolve(captureRoot, `${concept.slug}-${viewport.width}x${viewport.height}.png`),
            fullPage: true,
            animations: 'disabled',
          });
        }

        expect(errors.consoleErrors).toEqual([]);
        expect(errors.pageErrors).toEqual([]);
      });
    }
  });
}
