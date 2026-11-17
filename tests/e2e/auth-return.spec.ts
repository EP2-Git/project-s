import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { assertLocalIsolationStack } from '../helpers/authenticated-owner-isolation';

test.describe.configure({ retries: 0 });
// Real signup and sign-in sessions must not enter retained network traces.
test.use({ trace: 'off' });

const returnLoginPath = '/login?returnTo=%2Fprofile-settings';
const returnSignupPath = '/signup?returnTo=%2Fprofile-settings';

const expectLoginReturn = async (page: Page) => {
  await expect(page).toHaveURL(new URL(returnLoginPath, page.url()).href);
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await page.locator('.animate-scale-in').evaluate(async (card) => {
    await Promise.all(card.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
};

const assertAccessibleLogin = async (page: Page) => {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(result.violations).toEqual([]);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth
  ))).toBe(true);
};

test('protected profile settings return after real signup and keyboard sign-in', async ({
  browser,
  browserName,
  page,
}) => {
  test.setTimeout(90_000);
  const username = `return-${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}`;
  const email = `${username}@example.invalid`;
  const fullName = `Return ${browserName} Person`;
  const password = `Local-${crypto.randomUUID()}-Aa1!`;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/profile-settings');
  await expectLoginReturn(page);
  await assertLocalIsolationStack(page);
  await assertAccessibleLogin(page);
  await test.info().attach('login-return-mobile', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });

  const signup = page.getByRole('link', { name: 'Sign up', exact: true });
  await expect(signup).toHaveAttribute('href', returnSignupPath);
  await signup.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new URL(returnSignupPath, page.url()).href);
  await expect(page.getByRole('heading', { name: 'Create your account', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true }))
    .toHaveAttribute('href', returnLoginPath);

  await page.getByLabel('Full Name', { exact: true }).fill(fullName);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const create = page.getByRole('button', { name: 'Create Account', exact: true });
  await expect(create).toBeEnabled();
  await create.focus();
  await page.keyboard.press('Enter');

  // The local Auth service creates the account and session through the normal
  // UI. No administrative confirmation or seeded account substitutes for it.
  await expect(page).toHaveURL(/\/profile-settings$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Profile Settings', exact: true })).toBeVisible();
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue(username);
  await expect(page.getByLabel('Full Name', { exact: true })).toHaveValue(fullName);
  const appOrigin = new URL(page.url()).origin;

  // Sign out through the application so returning sign-in cannot reuse the
  // signup session. The second browser context also starts without that session.
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
  if (!(await signOut.isVisible())) {
    await page.getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
  }
  await signOut.click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/profile-settings');
  await expectLoginReturn(page);

  const returningContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const returning = await returningContext.newPage();
    await returning.goto(`${appOrigin}/profile-settings`);
    await expectLoginReturn(returning);
    await assertLocalIsolationStack(returning);
    await assertAccessibleLogin(returning);

    const emailField = returning.getByLabel('Email', { exact: true });
    await emailField.focus();
    await emailField.fill(email);
    await returning.keyboard.press('Tab');
    const passwordField = returning.getByLabel('Password', { exact: true });
    await expect(passwordField).toBeFocused();
    await passwordField.fill(password);
    await returning.keyboard.press('Tab');
    const login = returning.getByRole('button', { name: 'Log in', exact: true });
    await expect(login).toBeFocused();
    await returning.keyboard.press('Enter');

    await expect(returning).toHaveURL(/\/profile-settings$/, { timeout: 20_000 });
    await expect(returning.getByRole('heading', { name: 'Profile Settings', exact: true })).toBeVisible();
    await expect(returning.getByLabel('Username', { exact: true })).toHaveValue(username);
    await expect(returning.getByLabel('Full Name', { exact: true })).toHaveValue(fullName);
  } finally {
    await returningContext.close();
  }
});
