import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/demo/mandates');
  await expect(page.getByRole('heading', { level: 1, name: 'Authority Lab' })).toBeVisible();
});

test('preparation, one simulated commit and original-caller replay remain distinct', async ({ page }) => {
  const bookingRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/v[12](?:\/|$)/.test(new URL(request.url()).pathname)) bookingRequests.push(request.url());
  });
  await expect(page.getByText(/no real booking or agent credential is created/i)).toBeVisible();
  await expect(page.getByTestId('lab-booking-count')).toHaveText('0');
  await page.getByRole('button', { name: 'Prepare request', exact: true }).click();
  await expect(page.getByTestId('lab-decision')).toContainText('PREPARED');
  await expect(page.getByTestId('lab-booking-count')).toHaveText('0');
  // A draft scenario change cannot silently replace the displayed preparation.
  await page.getByLabel('Request scenario', { exact: true }).selectOption('other_host');
  await page.getByRole('button', { name: 'Commit simulated booking', exact: true }).click();
  await expect(page.getByTestId('lab-decision')).toContainText('CONFIRMED');
  await expect(page.getByTestId('lab-booking-count')).toHaveText('1');
  await expect(page.getByText('demo-host', { exact: true })).toHaveCount(2);
  await expect(page.getByText('another-host', { exact: true })).toHaveCount(0);
  const receipt = await page.getByTestId('lab-receipt-id').textContent();
  await page.getByRole('button', { name: 'Advance 20 minutes', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke permission', exact: true }).click();
  await page.getByRole('button', { name: 'Retry same request', exact: true }).click();
  await expect(page.getByTestId('lab-decision')).toContainText('REPLAYED');
  await expect(page.getByTestId('lab-receipt-id')).toHaveText(receipt ?? '');
  await expect(page.getByTestId('lab-booking-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Revoke agent key', exact: true }).click();
  await page.getByRole('button', { name: 'Retry same request', exact: true }).click();
  await expect(page.getByTestId('lab-decision')).toContainText('AUTHENTICATION_REQUIRED');
  expect(bookingRequests).toEqual([]);
});

test('an out-of-window request needs exact human approval before one simulated commit', async ({ page }) => {
  await page.getByLabel('Request scenario', { exact: true }).selectOption('outside_window');
  await page.getByRole('button', { name: 'Prepare request', exact: true }).click();
  await expect(page.getByTestId('lab-decision')).toContainText('STEP_UP_REQUIRED');
  await expect(page.getByTestId('lab-booking-count')).toHaveText('0');
  await page.getByRole('button', { name: 'Approve exact request', exact: true }).click();
  await expect(page.getByTestId('lab-decision')).toContainText('APPROVAL_RECORDED');
  await page.getByRole('button', { name: 'Commit simulated booking', exact: true }).click();
  await expect(page.getByTestId('lab-decision')).toContainText('CONFIRMED');
  await expect(page.getByTestId('lab-booking-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Simulate host cancellation', exact: true }).click();
  await page.getByRole('button', { name: 'Retry same request', exact: true }).click();
  await expect(page.getByTestId('lab-decision')).toContainText('SLOT_UNAVAILABLE');
  await expect(page.getByTestId('lab-booking-count')).toHaveText('1');
});

test('permission expiry and caller mismatch visibly refuse without offering a bypass', async ({ page }) => {
  await page.getByRole('button', { name: 'Prepare request', exact: true }).click();
  await page.getByRole('button', { name: 'Advance 20 minutes', exact: true }).click();
  await page.getByRole('button', { name: 'Commit simulated booking', exact: true }).click();
  await expect(page.getByTestId('lab-decision')).toContainText('MANDATE_EXPIRED');
  await expect(page.getByTestId('lab-booking-count')).toHaveText('0');
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await page.getByLabel('Request scenario', { exact: true }).selectOption('wrong_caller');
  await page.getByRole('button', { name: 'Prepare request', exact: true }).click();
  await expect(page.getByTestId('lab-decision')).toContainText('AUTHENTICATION_REQUIRED');
  await expect(page.getByRole('button', { name: 'Approve exact request', exact: true })).toHaveCount(0);
});

test('preparation does not reserve a slot and a refused write consumes nothing', async ({ page }) => {
  await page.getByRole('button', { name: 'Prepare request', exact: true }).click();
  await page.getByRole('button', { name: 'Change slot availability', exact: true }).click();
  await page.getByRole('button', { name: 'Commit simulated booking', exact: true }).click();
  await expect(page.getByTestId('lab-decision')).toContainText('SLOT_UNAVAILABLE');
  await expect(page.getByTestId('lab-booking-count')).toHaveText('0');
  await page.getByRole('button', { name: 'Change slot availability', exact: true }).click();
  await page.getByRole('button', { name: 'Commit simulated booking', exact: true }).click();
  await expect(page.getByTestId('lab-decision')).toContainText('CONFIRMED');
});

test('changed limits need applying and expired exact approval never restores the original permission', async ({ page }) => {
  await page.getByLabel('Maximum duration', { exact: true }).selectOption('15');
  await expect(page.getByRole('button', { name: 'Prepare request', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Apply permission limits', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare request', exact: true }).click();
  await expect(page.getByTestId('lab-decision')).toContainText('STEP_UP_REQUIRED');
  await page.getByRole('button', { name: 'Advance 5 minutes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve exact request', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Prepare request', exact: true }).click();
  await page.getByRole('button', { name: 'Approve exact request', exact: true }).click();
  await page.getByRole('button', { name: 'Advance 5 minutes', exact: true }).click();
  await page.getByRole('button', { name: 'Commit simulated booking', exact: true }).click();
  await expect(page.getByTestId('lab-decision')).toContainText('APPROVAL_EXPIRED');
  await page.getByRole('button', { name: 'Prepare request', exact: true }).click();
  await expect(page.getByTestId('lab-decision')).toContainText('FORBIDDEN');
  await expect(page.getByTestId('lab-booking-count')).toHaveText('0');
});

test('lab is discoverable from the existing demo and supports keyboard and mobile use', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('link', { name: 'Open Authority Lab', exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/mandates$/);
  await page.getByLabel('Request scenario', { exact: true }).focus();
  await expect(page.getByLabel('Request scenario', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Prepare request', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('lab-decision')).toContainText('PREPARED');
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
  }
});
