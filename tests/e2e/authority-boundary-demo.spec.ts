import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { createProjectSMcpClient } from '../../scripts/lib/project-s-mcp-client.mjs';

test.describe.configure({ retries: 0 });

const guestName = 'Authority Demo Guest';
const captureEnabled = process.env.PROJECT_S_AUTHORITY_CAPTURE === '1';
const captureDirectory = resolve(
  process.cwd(),
  'test-results',
  'authority-boundary-demo',
);

const addDays = (dateKey: string, days: number) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
};

const dateKeyIn = (timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
};

const expectNoBlockingAxeFindings = async (page: Page) => {
  const results = await new AxeBuilder({ page }).include('main').analyze();
  const blocking = results.violations.filter(
    ({ impact }) => impact === 'critical' || impact === 'serious',
  );
  expect(blocking).toEqual([]);
};

const expectNoHorizontalOverflow = async (page: Page) => {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
};

const capture = async (page: Page, name: string) => {
  if (!captureEnabled) return;
  await mkdir(captureDirectory, { recursive: true });
  await page.screenshot({
    path: resolve(captureDirectory, `${name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
};

test('MCP remains blocked until browser approval, then commits once, replays, and cancels', async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'The joined authority demonstration has one canonical browser.');

  const guestEmail = captureEnabled
    ? 'authority-demo@example.invalid'
    : `authority-demo-${randomUUID()}@example.invalid`;

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const webBaseUrl = 'http://127.0.0.1:4173';
  const mcp = createProjectSMcpClient({
    baseUrl: webBaseUrl,
    clientName: 'project-s-authority-boundary-e2e',
  });

  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/demo');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Authority Boundary Demo' }),
    ).toBeVisible();
    await expectNoBlockingAxeFindings(page);
    await expectNoHorizontalOverflow(page);
    await capture(page, '00-overview-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await capture(page, '00-overview-mobile');

    const discovery = await mcp.discover();
    expect(discovery.supportedVersions).toEqual(['2026-07-28']);
    const tools = await mcp.listTools();
    expect(tools.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'project_s_get_booking_page_v1',
      'project_s_list_free_slots_v1',
      'project_s_prepare_booking_v1',
      'project_s_create_booking_v1',
    ]);

    const pageResult = await mcp.callTool('project_s_get_booking_page_v1', {
      username: 'demo-host',
    });
    expect(pageResult.isError).toBe(false);
    const bookingPage = pageResult.structuredContent.data;
    const meetingType = bookingPage.meetingTypes[0];
    expect(meetingType).toBeTruthy();

    let selectedSlot: { startAt: string; endAt: string } | undefined;
    const today = dateKeyIn('America/Halifax');
    for (let offset = 1; offset <= 14 && !selectedSlot; offset += 1) {
      const slotsResult = await mcp.callTool('project_s_list_free_slots_v1', {
        username: bookingPage.username,
        meetingTypeId: meetingType.meetingTypeId,
        date: addDays(today, offset),
        displayTimeZone: 'America/Halifax',
      });
      expect(slotsResult.isError).toBe(false);
      selectedSlot = slotsResult.structuredContent.data.slots[0];
    }
    expect(selectedSlot).toBeTruthy();

    const preparedResult = await mcp.callTool('project_s_prepare_booking_v1', {
      username: bookingPage.username,
      meetingTypeId: meetingType.meetingTypeId,
      startAt: selectedSlot!.startAt,
      guestTimeZone: 'America/Halifax',
      booker: {
        name: guestName,
        email: guestEmail,
        notes: 'Synthetic authority-boundary demonstration.',
      },
    });
    expect(preparedResult.isError).toBe(false);
    const prepared = preparedResult.structuredContent.data;
    expect(prepared.notHeld).toBe(true);
    expect(prepared.confirmationUrl).toMatch(
      /\/booking\/confirm#preparation=/,
    );

    const idempotencyKey = randomUUID();
    const blockedResult = await mcp.callTool('project_s_create_booking_v1', {
      preparationToken: prepared.preparationToken,
      idempotencyKey,
    });
    expect(blockedResult.isError).toBe(true);
    expect(blockedResult.structuredContent.error.code).toBe(
      'CONFIRMATION_REQUIRED',
    );

    const privateConfirmationUrl = new URL(prepared.confirmationUrl);
    const browserConfirmationUrl = new URL(
      `${privateConfirmationUrl.pathname}${privateConfirmationUrl.search}${privateConfirmationUrl.hash}`,
      webBaseUrl,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(browserConfirmationUrl.toString());

    await expect(
      page.getByRole('heading', { name: 'Review a prepared booking' }),
    ).toBeVisible();
    await expect(page).not.toHaveURL(/preparation=/);
    await expect(page.getByText('Agent create is blocked')).toBeVisible();
    await expect(page.getByText(guestName, { exact: true })).toBeVisible();
    await expect(page.getByText(guestEmail, { exact: true })).toBeVisible();
    await expect(
      page.getByText('This preparation does not hold the time.'),
    ).toBeVisible();
    const approve = page.getByRole('button', { name: 'Approve booking' });
    await expect(approve).toBeDisabled();

    await expectNoBlockingAxeFindings(page);
    await expectNoHorizontalOverflow(page);
    await capture(page, '01-review-desktop');

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await capture(page, '02-review-mobile');

    await page
      .getByRole('checkbox', {
        name: /confirming this local development booking/i,
      })
      .check();
    await expect(approve).toBeDisabled();
    await page
      .getByRole('checkbox', { name: /accept terms and privacy notice/i })
      .check();
    await expect(approve).toBeEnabled();
    await approve.click();

    const approvalHeading = page.getByRole('heading', {
      name: 'Human authority recorded',
    });
    await expect(approvalHeading).toBeVisible();
    await expect(approvalHeading).toBeFocused();
    await expect(
      page.getByText(/It did not create or reserve a booking/i),
    ).toBeVisible();
    await expectNoBlockingAxeFindings(page);
    await expectNoHorizontalOverflow(page);
    await capture(page, '03-human-authority-recorded-mobile');

    const createdResult = await mcp.callTool('project_s_create_booking_v1', {
      preparationToken: prepared.preparationToken,
      idempotencyKey,
    });
    expect(createdResult.isError).toBe(false);
    expect(createdResult.structuredContent.data.status).toBe('confirmed');

    const replayResult = await mcp.callTool('project_s_create_booking_v1', {
      preparationToken: prepared.preparationToken,
      idempotencyKey,
    });
    expect(replayResult.isError).toBe(false);
    expect(replayResult.structuredContent.data).toEqual(
      createdResult.structuredContent.data,
    );

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/login');
    await page.getByLabel('Email').fill('demo@project-s.local');
    await page.getByLabel('Password').fill('project-s-demo-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole('button', { name: 'Bookings', exact: true }).click();

    const guestRows = page.getByRole('row').filter({ hasText: guestEmail });
    await expect(guestRows).toHaveCount(1);
    const confirmedRow = guestRows.first();
    await expect(confirmedRow).toBeVisible();
    await expect(confirmedRow).toContainText('confirmed');
    await expectNoBlockingAxeFindings(page);
    await expectNoHorizontalOverflow(page);
    if (captureEnabled) {
      await expect(
        page.getByText('Logged in successfully', { exact: true }),
      ).toBeHidden({ timeout: 10_000 });
    }
    await capture(page, '04-committed-booking');

    await confirmedRow
      .getByRole('button', { name: `Cancel booking with ${guestName}` })
      .click();
    const cancellationDialog = page.getByRole('alertdialog');
    await expect(cancellationDialog).toBeVisible();
    await cancellationDialog
      .getByRole('button', { name: 'Cancel booking', exact: true })
      .click();
    await expect(guestRows).toHaveCount(1);
    await expect(guestRows.first()).toContainText('cancelled');
    await expectNoBlockingAxeFindings(page);
    await expectNoHorizontalOverflow(page);
    await capture(page, '05-cancelled-booking');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await mcp.close();
  }
});
