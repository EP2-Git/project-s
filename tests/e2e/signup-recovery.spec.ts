import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

// These are synthetic transport fixtures, not account creation or email-delivery
// evidence. The separate fresh-host booking case uses the real local Auth stack.
test.describe.configure({ retries: 0 });

const synthetic = {
  name: 'Synthetic Signup Person',
  email: 'synthetic-signup@example.invalid',
  username: 'synthetic-signup',
  password: 'Synthetic-local-Aa1!',
};

const stubSignup = async (page: Page) => {
  const state = {
    available: true,
    lookupFails: false,
    signupAttempts: 0,
    signupSucceeds: false,
    unexpected: [] as string[],
    pageErrors: [] as string[],
  };
  page.on('pageerror', (error) => state.pageErrors.push(error.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (local && url.port === '4173') return route.continue();
    if (local && url.pathname === '/rest/v1/rpc/is_username_available_v1' && request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual({ p_username: synthetic.username });
      return route.fulfill({
        status: state.lookupFails ? 503 : 200,
        headers,
        body: JSON.stringify(state.lookupFails ? { message: 'Synthetic lookup unavailable' } : state.available),
      });
    }
    if (local && url.pathname === '/auth/v1/signup' && request.method() === 'POST') {
      state.signupAttempts += 1;
      expect(request.postDataJSON()).toMatchObject({
        email: synthetic.email, password: synthetic.password,
        data: { full_name: synthetic.name, username: synthetic.username },
      });
      return route.fulfill({
        status: state.signupSucceeds ? 200 : 503,
        headers,
        body: JSON.stringify(state.signupSucceeds ? {
          id: '40000000-0000-4000-8000-000000000026',
          aud: 'authenticated', role: 'authenticated', email: synthetic.email,
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: { full_name: synthetic.name, username: synthetic.username },
          identities: [], created_at: '2026-10-26T00:00:00Z',
        } : { code: 'unexpected_failure', msg: 'Synthetic Auth unavailable' }),
      });
    }
    state.unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
    return route.abort('blockedbyclient');
  });
  return state;
};

const waitForCard = async (page: Page) => {
  await page.getByRole('heading', { name: 'Create your account', exact: true }).waitFor();
  await page.locator('.animate-scale-in').evaluate(async (card) => {
    await Promise.all(card.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
};

const assertAxe = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
};

const fillOtherFields = async (page: Page) => {
  await page.getByLabel('Full Name', { exact: true }).fill(synthetic.name);
  await page.getByLabel('Email', { exact: true }).fill(synthetic.email);
  const checked = page.waitForResponse((response) => response.url().includes('/rest/v1/rpc/is_username_available_v1'));
  await page.getByLabel('Username', { exact: true }).fill(synthetic.username);
  await checked;
};

for (const width of [320, 390, 1280]) {
  test(`signup keyboard, validation and failed-Auth recovery at ${width}px`, async ({ page }) => {
    // Three complete WCAG scans plus keyboard, validation and two-submit recovery
    // exceed the default whole-case budget on Windows Firefox/WebKit. Individual
    // assertion deadlines and the no-retry policy remain unchanged.
    test.setTimeout(60_000);
    const fixture = await stubSignup(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/signup');
    await waitForCard(page);
    const password = page.getByLabel('Password', { exact: true });
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveAttribute('autocomplete', 'new-password');
    await expect(password).toHaveAccessibleDescription('Use at least 6 characters.');
    await assertAxe(page);

    await page.getByLabel('Full Name', { exact: true }).focus();
    for (const name of ['Email', 'Username', 'Password']) {
      await page.keyboard.press('Tab');
      await expect(page.getByLabel(name, { exact: true })).toBeFocused();
    }
    await password.fill('short');
    await expect(password).toHaveAttribute('aria-invalid', 'true');
    await expect(password).toHaveAccessibleDescription(/Password must be at least 6 characters/);
    await assertAxe(page);
    await password.fill(synthetic.password);
    await expect(password).toHaveAttribute('aria-invalid', 'false');
    await page.keyboard.press('Tab');
    const show = page.getByRole('button', { name: 'Show password', exact: true });
    await expect(show).toBeFocused();
    await expect(show).toHaveAttribute('aria-controls', await password.getAttribute('id') as string);
    await page.keyboard.press('Enter');
    await expect(password).toHaveAttribute('type', 'text');
    const hide = page.getByRole('button', { name: 'Hide password', exact: true });
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveValue(synthetic.password);

    await fillOtherFields(page);
    const submit = page.getByRole('button', { name: 'Create Account', exact: true });
    await expect(submit).toBeEnabled();
    await submit.focus();
    await page.keyboard.press('Enter');
    const error = page.getByRole('alert', { name: 'Account creation failed', exact: true });
    await expect(error).toBeFocused();
    await expect(error).toContainText('Your entries are still here.');
    await expect(error).not.toContainText('Synthetic Auth unavailable');
    await expect(page.getByLabel('Full Name', { exact: true })).toHaveValue(synthetic.name);
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue(synthetic.email);
    await expect(page.getByLabel('Username', { exact: true })).toHaveValue(synthetic.username);
    await expect(password).toHaveValue(synthetic.password);
    await expect(password).toHaveAttribute('type', 'password');
    await expect(page.getByRole('form', { name: 'Create your account', exact: true })).toHaveAttribute('aria-busy', 'false');
    await assertAxe(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const screenshot = test.info().outputPath(`synthetic-signup-recovery-${width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await test.info().attach(`synthetic-signup-recovery-${width}`, { path: screenshot, contentType: 'image/png' });
    expect(fixture.signupAttempts).toBe(1);

    fixture.signupSucceeds = true;
    await submit.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/email-verification$/);
    await expect(page.getByLabel('Account email', { exact: true })).toHaveValue(synthetic.email);
    expect(fixture.signupAttempts).toBe(2);
    expect(fixture.unexpected).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
  });
}

test('signup lookup failure and username conflict recover without sending an Auth request', async ({ page }) => {
  const fixture = await stubSignup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/signup');
  await waitForCard(page);
  await fillOtherFields(page);
  await page.getByLabel('Password', { exact: true }).fill(synthetic.password);
  const submit = page.getByRole('button', { name: 'Create Account', exact: true });
  await expect(submit).toBeEnabled();

  fixture.lookupFails = true;
  await submit.click();
  const error = page.getByRole('alert', { name: 'Account creation failed', exact: true });
  await expect(error).toBeFocused();
  await expect(error).toContainText('Your entries are still here.');
  await assertAxe(page);
  expect(fixture.signupAttempts).toBe(0);

  fixture.lookupFails = false;
  fixture.available = false;
  await submit.click();
  const username = page.getByLabel('Username', { exact: true });
  await expect(username).toBeFocused();
  await expect(username).toHaveAttribute('aria-invalid', 'true');
  await expect(username).toHaveAccessibleDescription(/This username is already taken/);
  await expect(submit).toBeDisabled();
  await assertAxe(page);
  expect(fixture.signupAttempts).toBe(0);

  fixture.available = true;
  await username.fill('');
  const checked = page.waitForResponse((response) => response.url().includes('/rest/v1/rpc/is_username_available_v1'));
  await username.fill(synthetic.username);
  await checked;
  await expect(submit).toBeEnabled();
  await expect(username).toHaveAttribute('aria-invalid', 'false');
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.pageErrors).toEqual([]);
});
