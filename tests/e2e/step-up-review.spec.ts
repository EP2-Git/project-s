import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type Route, test } from '@playwright/test';

// Component/client proof only: synthetic account token and mocked HTTP.
// No served v2 handler, real authentication, SQL action or booking is implied.
test.describe.configure({ retries: 0 });
const fixturePath = '/tests/fixtures/step-up-review/index.html';
const reviewId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const digest = 'a'.repeat(64);
const review = {
  reviewId, revision: 1, state: 'pending', summaryDigest: digest,
  expiresAt: '2030-02-04T12:05:00.000000Z',
  exactSummary: {
    username: 'demo-host', hostDisplayName: 'Synthetic Host',
    meetingTypeId: '11111111-1111-4111-8111-111111111111', meetingTypeTitle: 'Planning session',
    startAt: '2030-02-04T13:00:00.000000Z', endAt: '2030-02-04T13:30:00.000000Z',
    hostTimeZone: 'America/Halifax', guestTimeZone: 'America/Halifax',
    name: 'Synthetic Guest', email: 'reviewer@example.invalid',
  },
  differences: [{
    field: 'meeting_window',
    proposed: '2030-02-04T13:00:00.000000Z / 2030-02-04T13:30:00.000000Z',
    reviewed: '2030-02-04T12:00:00.000000Z / 2030-02-04T12:30:00.000000Z',
  }],
};
const approved = {
  reviewId, state: 'approved', preparationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  expiresAt: '2030-02-04T12:10:00.000000Z',
};
const revoked = { reviewId, state: 'revoked', revision: 2, revokedAt: '2030-02-04T12:00:00.000000Z' };
const envelope = (data: unknown) => ({ contractVersion: 2, requestId: 'fixture-step-up-request', data });
const respond = (route: Route, data: unknown) => route.fulfill({
  status: 200, contentType: 'application/vnd.project-s.v2+json',
  headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  body: JSON.stringify(envelope(data)),
});
const problem = (code: string, status: number) => ({
  contractVersion: 2, requestId: 'fixture-step-up-request', error: {
    code, status, requestId: 'fixture-step-up-request',
    title: 'Review request failed', type: 'https://project-s.local/problems/review',
    detail: 'private upstream diagnostic must never render',
    ...(code === 'AUTHORITY_BUSY' ? { retry: { action: 'retry_after', afterSeconds: 1 } } : {}),
  },
});
const accessible = async (page: Page) => {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
};
const capture = async (page: Page, label: string) => {
  const body = await page.screenshot({
    fullPage: true, path: `output/playwright/step-up-review-${test.info().project.name}-${label}.png`,
  });
  await test.info().attach(label, { body, contentType: 'image/png' });
};

test('synthetic pending review is readable on a phone and approves through focused keyboard controls', async ({ page }) => {
  const actions: Array<{ path: string; body: unknown }> = [];
  await page.route('**/api/v2/authority/step-ups/**', async (route) => {
    const request = route.request();
    expect(request.headers().authorization).toBe('Bearer synthetic-component-account-token');
    expect(request.headers().cookie).toBeUndefined();
    if (request.method() === 'GET') return respond(route, review);
    actions.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
    return respond(route, approved);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixturePath);
  await expect(page.getByText('Synthetic component/client test', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review this meeting', exact: true })).toBeVisible();
  await expect(page.getByText('Planning session', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic Guest', { exact: true })).toBeVisible();
  await expect(page.getByText('reviewer@example.invalid', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Why approval is needed', exact: true })).toBeVisible();
  await expect(page.getByText(/30 minutes/)).toBeVisible();
  await accessible(page);
  await capture(page, 'pending-phone');

  // Pressing Enter without a focused action cannot approve the meeting.
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('Enter');
  expect(actions).toEqual([]);
  const approve = page.getByRole('button', { name: 'Approve this request', exact: true });
  await approve.focus();
  await expect(approve).toBeFocused();
  expect(await approve.evaluate((button) => {
    const styles = getComputedStyle(button);
    return styles.boxShadow !== 'none' || styles.outlineStyle !== 'none';
  })).toBe(true);
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: 'Approval recorded', exact: true })).toBeVisible();
  expect(actions).toEqual([{ path: `/api/v2/authority/step-ups/${reviewId}/approve`, body: { expectedRevision: 1, summaryDigest: digest } }]);
  await expect(page.getByText(/^Booking confirmed$/i)).toHaveCount(0);
  await accessible(page);
  await capture(page, 'approved-phone');
});

test('synthetic lost approval response retries exactly after the pending deadline without a GET preflight', async ({ page }) => {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  let approvalAttempts = 0;
  await page.clock.install({ time: new Date('2030-02-04T12:00:00Z') });
  await page.route('**/api/v2/authority/step-ups/**', async (route) => {
    const request = route.request();
    calls.push({ method: request.method(), path: new URL(request.url()).pathname,
      body: request.method() === 'POST' ? request.postDataJSON() : null });
    if (request.method() === 'GET') return respond(route, review);
    approvalAttempts++;
    if (approvalAttempts === 1) return route.abort('connectionreset');
    return respond(route, approved);
  });
  await page.goto(fixturePath);
  await page.getByRole('button', { name: 'Approve this request', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Retry the same approval', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByRole('heading', { name: /Approval recorded|Request declined/ })).toHaveCount(0);
  const decline = page.getByRole('button', { name: 'Decline this request', exact: true });
  if (await decline.count()) await expect(decline).toBeDisabled();
  await page.clock.fastForward(6 * 60 * 1_000);
  await expect(retry).toBeEnabled();
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Approval recorded', exact: true })).toBeVisible();
  expect(calls).toEqual([
    { method: 'GET', path: `/api/v2/authority/step-ups/${reviewId}`, body: null },
    { method: 'POST', path: `/api/v2/authority/step-ups/${reviewId}/approve`, body: { expectedRevision: 1, summaryDigest: digest } },
    { method: 'POST', path: `/api/v2/authority/step-ups/${reviewId}/approve`, body: { expectedRevision: 1, summaryDigest: digest } },
  ]);
});

test('synthetic native-fetch deadline keeps a held approval uncertain and permits only its exact retry', async ({ page }) => {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  let approvalAttempts = 0;
  let firstApprovalStarted!: () => void;
  const firstApproval = new Promise<void>((resolve) => { firstApprovalStarted = resolve; });
  await page.clock.install({ time: new Date('2030-02-04T12:00:00Z') });
  await page.route('**/api/v2/authority/step-ups/**', async (route) => {
    const request = route.request();
    calls.push({ method: request.method(), path: new URL(request.url()).pathname,
      body: request.method() === 'POST' ? request.postDataJSON() : null });
    if (request.method() === 'GET') return respond(route, review);
    approvalAttempts++;
    if (approvalAttempts === 1) {
      // Deliberately leave the native fetch unresolved. Its client deadline,
      // rather than a fabricated network error or server response, must abort it.
      firstApprovalStarted();
      return;
    }
    return respond(route, approved);
  });
  await page.goto(fixturePath);
  await page.getByRole('button', { name: 'Approve this request', exact: true }).click();
  await firstApproval;
  await page.clock.fastForward(30_001);
  const retry = page.getByRole('button', { name: 'Retry the same approval', exact: true });
  await expect(retry).toBeVisible();
  await expect(retry).toBeEnabled();
  await expect(page.getByRole('heading', { name: /Approval recorded|Request declined/ })).toHaveCount(0);
  const decline = page.getByRole('button', { name: 'Decline this request', exact: true });
  if (await decline.count()) await expect(decline).toBeDisabled();
  expect(approvalAttempts).toBe(1);
  await retry.click();
  await expect(page.getByRole('heading', { name: 'Approval recorded', exact: true })).toBeVisible();
  expect(calls).toEqual([
    { method: 'GET', path: `/api/v2/authority/step-ups/${reviewId}`, body: null },
    { method: 'POST', path: `/api/v2/authority/step-ups/${reviewId}/approve`, body: { expectedRevision: 1, summaryDigest: digest } },
    { method: 'POST', path: `/api/v2/authority/step-ups/${reviewId}/approve`, body: { expectedRevision: 1, summaryDigest: digest } },
  ]);
});

test('synthetic desktop review supports a direct Tab path to pending decline', async ({ page }) => {
  const actions: unknown[] = [];
  await page.route('**/api/v2/authority/step-ups/**', async (route) => {
    if (route.request().method() === 'GET') return respond(route, review);
    expect(new URL(route.request().url()).pathname).toBe(`/api/v2/authority/step-ups/${reviewId}/revoke`);
    actions.push(route.request().postDataJSON());
    return respond(route, revoked);
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(fixturePath);
  const approve = page.getByRole('button', { name: 'Approve this request', exact: true });
  await expect(approve).toBeVisible();
  await approve.focus();
  await page.keyboard.press('Tab');
  const decline = page.getByRole('button', { name: 'Decline this request', exact: true });
  await expect(decline).toBeFocused();
  await accessible(page);
  await capture(page, 'pending-keyboard');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Request declined', exact: true })).toBeVisible();
  expect(actions).toEqual([{ expectedRevision: 1 }]);
  await expect(page.getByRole('heading', { name: 'Approval recorded', exact: true })).toHaveCount(0);
  await accessible(page);
});

test('synthetic generic conflict shows neutral recovery without guessing terminal state or exposing diagnostics', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/v2/authority/step-ups/**', async (route) => {
    reads++;
    return route.fulfill({ status: 409, contentType: 'application/problem+json', body: JSON.stringify(problem('VERSION_CONFLICT', 409)) });
  });
  await page.goto(fixturePath);
  await expect(page.getByRole('heading', { name: 'This request is no longer available', exact: true })).toBeVisible();
  await expect(page.getByText('reviewer@example.invalid', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Approval recorded|Request declined|Already handled|Expired/ })).toHaveCount(0);
  await expect(page.getByText('private upstream diagnostic must never render')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve this request', exact: true })).toHaveCount(0);
  expect(reads).toBe(1);
  await accessible(page);
});

test('synthetic maximum-length unbroken meeting and profile text fits a narrow phone', async ({ page }) => {
  const title = 'W'.repeat(160);
  const name = 'M'.repeat(120);
  const longReview = {
    ...review,
    exactSummary: { ...review.exactSummary, meetingTypeTitle: title, hostDisplayName: name, name },
    differences: [{ field: 'meeting_type', reviewed: 'P'.repeat(160), proposed: title }],
  };
  await page.route('**/api/v2/authority/step-ups/**', (route) => respond(route, longReview));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixturePath);
  await expect(page.getByRole('button', { name: 'Approve this request', exact: true })).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toHaveCount(2);
  await accessible(page);
  await capture(page, 'pending-long-phone');
});

test('the actual approval route remains unavailable and does not import the synthetic review fixture', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(`/authority/review#review=${reviewId}`);
  await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic component/client test', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve this request', exact: true })).toHaveCount(0);
  expect(requests.filter((path) => /step-up-review|stepUpReviewClient|\/api\/v2\//.test(path))).toEqual([]);
});
