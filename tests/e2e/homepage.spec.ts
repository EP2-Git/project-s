import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test("self-hosted root enters the application instead of marketing", async ({ page }) => {
  await expect(page).toHaveTitle(/Project S/i);
  await expect(page.getByText('Self-hosted scheduling,')).toHaveCount(0);
  await expect(page.getByText('V1 candidate feature boundary')).toHaveCount(0);
});

test('self-hosted root does not load hosted marketing modules', async ({ page }) => {
  const resources = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((entry) => entry.name),
  );

  expect(resources.some((resource) => (
    resource.includes('/src/pages/Index.tsx') ||
    resource.includes('/src/components/HeroSection.tsx') ||
    resource.includes('/src/components/FeaturesSection.tsx')
  ))).toBe(false);
});

test("self-hosted entry has no serious or critical axe findings", async ({ page }) => {
  const animatedCard = page.locator('.animate-scale-in');
  await animatedCard.evaluate(async (card) => {
    await Promise.all(
      card
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined)),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await expect(animatedCard).toHaveCSS('opacity', '1');
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(({ impact }) =>
    impact === "critical" || impact === "serious"
  );

  expect(blocking).toEqual([]);
});

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`self-hosted entry has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });
}

test('self-hosted mode preserves public and demo deep links', async ({ page }) => {
  await page.goto('/signup');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await expect(page).toHaveURL(/\/signup$/);

  await page.goto('/demo');
  await expect(page.getByRole('heading', { level: 1, name: 'Authority Boundary Demo' })).toBeVisible();

  const demoResources = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((entry) => entry.name),
  );
  expect(demoResources.some((resource) => (
    resource.includes('/src/components/Navbar.tsx') ||
    resource.includes('/src/components/Footer.tsx')
  ))).toBe(false);

  await page.goto('/book/demo-host');
  await expect(page.locator('main')).toBeVisible();
  await expect(page).toHaveURL(/\/book\/demo-host$/);

  await page.goto('/booking/confirm');
  await expect(page.getByRole('heading', { level: 1, name: 'Review a prepared booking' })).toBeVisible();
  await expect(page).toHaveURL(/\/booking\/confirm$/);
});

test('self-hosted reference notices use deployment chrome', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Deployment account' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Features' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'About' })).toHaveCount(0);
  await expect(page.getByText('Scheduling infrastructure operated by this deployment.')).toBeVisible();

  await page.goto('/terms');
  await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Features' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'About' })).toHaveCount(0);
});

test('self-hosted mode excludes hosted-only routes', async ({ page }) => {
  await page.goto('/features');
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
  await expect(page.getByText('A focused, self-hostable scheduling core')).toHaveCount(0);

  await page.goto('/design-lab/authority-pipeline');
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
  await expect(page.getByText('Agents prepare. People approve. Project S commits.')).toHaveCount(0);

  await page.goto('/design-lab/selected-direction');
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
  await expect(page.getByText('People define authority. Agents act within it. Project S commits.')).toHaveCount(0);

  const resources = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((entry) => entry.name),
  );
  expect(resources.some((resource) => (
    resource.includes('/src/pages/design-lab/SelectedDirection.tsx') ||
    resource.includes('/src/pages/design-lab/OwnBookingFlow.tsx')
  ))).toBe(false);
});
