import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { enabledCalendarDaySelector, nextMondayTarget } from '../helpers/booking-calendar-target';

test.describe.configure({ retries: 0 });

const expectNoBlockingAxeFindings = async (page: Page) => {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter(({ impact }) => (
    impact === 'critical' || impact === 'serious'
  ))).toEqual([]);
};

const saveWeeklyAvailability = async (page: Page) => {
  const saved = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes('/rest/v1/rpc/set_weekly_schedule_v1')
  ));
  const save = page.getByRole('button', { name: 'Save Weekly Availability', exact: true });
  await save.click();
  expect((await saved).ok()).toBe(true);
  await expect(save).toBeEnabled();
};

const chooseFirstAvailableTime = async (page: Page) => {
  const slots = page.locator('button[aria-label^="Select "]');
  const empty = page.getByText('No available time slots for this date.');
  const calendar = page.locator('section[aria-labelledby="select-date-title"]');
  await expect(slots.first().or(empty)).toBeVisible({ timeout: 15_000 });
  const today = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: 'America/Halifax', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
  });
  const target = nextMondayTarget(today);
  if (target.advanceMonth) {
    await calendar.getByRole('button', { name: /go to next month/i }).click();
  }
  const day = calendar.locator(enabledCalendarDaySelector).filter({ hasText: new RegExp(`^${target.day}$`) });
  await expect(day).toHaveCount(1);
  const searched = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes('/api/v1/public/free-slots/search')
    && response.request().postDataJSON().date === target.dateKey
  ));
  await day.click();
  expect((await searched).ok()).toBe(true);
  await expect(page.locator('section[aria-labelledby="available-times-title"] [aria-busy]')).toHaveAttribute('aria-busy', 'false');
  await expect(slots.first()).toBeVisible({ timeout: 15_000 });
  await slots.first().focus();
  await page.keyboard.press('Enter');
};

test('a fresh host completes saved setup and a guest books with human approval', async ({
  browser,
  browserName,
  page,
}) => {
  test.setTimeout(150_000);
  const identity = `setup-${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}`;
  const hostName = `Fresh ${browserName} Host`;
  const guestName = `Fresh ${browserName} Guest ${identity}`;
  const hostEmail = `${identity}@example.invalid`;
  const password = `Local-${crypto.randomUUID()}-Aa1!`;

  await page.goto('/signup');
  await page.getByLabel('Full Name', { exact: true }).fill(hostName);
  await page.getByLabel('Email', { exact: true }).fill(hostEmail);
  await page.getByLabel('Username', { exact: true }).fill(identity);
  await page.getByPlaceholder('••••••••', { exact: true }).fill(password);
  await expect(page.getByRole('button', { name: 'Create Account', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();

  // This exercises the checked-in local Auth configuration. No seeded login,
  // administrative confirmation, session injection or verification override.
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
  const setup = page.getByRole('region', { name: 'Booking setup', exact: true });
  await expect(setup.getByRole('heading', { name: 'Finish your booking setup' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy link', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open link', exact: true })).toBeVisible();
  await expectNoBlockingAxeFindings(page);

  const profileAction = setup.getByRole('link', { name: 'Profile and timezone', exact: true });
  await profileAction.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/profile-settings$/);
  await page.getByLabel('Times shown in', { exact: true }).selectOption('America/Halifax');
  // Ensure saving is a real edit even when the runner's browser uses Halifax.
  await page.getByLabel('Full Name', { exact: true }).fill(`${hostName} Ready`);
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByText('Profile updated successfully', { exact: true })).toBeVisible();
  await page.goto('/dashboard');

  await setup.getByRole('button', { name: 'Meeting types', exact: true }).click();
  await page.getByRole('button', { name: 'Create a Meeting Type', exact: true }).click();
  await page.getByLabel('Title *', { exact: true }).fill('Fresh signup conversation');
  await page.getByLabel('Duration (minutes) *', { exact: true }).fill('30');
  await page.getByRole('button', { name: 'Create Meeting Type', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fresh signup conversation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  // Signup's database trigger saves weekday hours; the active meeting type
  // completes setup until those persisted hours are deliberately removed.
  await expect(setup.getByRole('heading', { name: 'Your setup is saved' })).toBeVisible();

  await setup.getByRole('button', { name: 'Availability', exact: true }).click();
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  for (const day of weekdays) {
    await page.getByRole('switch', { name: `Set ${day} availability`, exact: true }).uncheck();
  }
  await saveWeeklyAvailability(page);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(setup.getByRole('heading', { name: 'Finish your booking setup' })).toBeVisible();

  await setup.getByRole('button', { name: 'Availability', exact: true }).click();
  await page.getByRole('switch', { name: 'Set Monday availability', exact: true }).check();
  await saveWeeklyAvailability(page);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(setup.getByRole('heading', { name: 'Your setup is saved' })).toBeVisible();
  await page.reload();
  await expect(setup.getByRole('heading', { name: 'Your setup is saved' })).toBeVisible();
  await test.info().attach('fresh-host-setup-desktop', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Copy link', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share link', exact: true })).toBeVisible();
  const openLink = page.getByRole('link', { name: 'Open link', exact: true });
  await openLink.focus();
  await expect(openLink).toBeFocused();
  const popupPromise = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  const preview = await popupPromise;
  await expect(preview).toHaveURL(new RegExp(`/book/${identity}$`));
  await preview.close();
  await expectNoBlockingAxeFindings(page);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth
  ))).toBe(true);
  await test.info().attach('fresh-host-setup-mobile', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });

  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: 'America/Halifax',
  });
  try {
    const guest = await guestContext.newPage();
    await guest.goto(`${new URL(page.url()).origin}/book/${identity}`);
    await expect(guest.getByRole('heading', { name: `Book time with ${hostName} Ready` })).toBeVisible();
    await chooseFirstAvailableTime(guest);
    await guest.getByLabel('Your name', { exact: true }).fill(guestName);
    await guest.getByLabel('Your email', { exact: true }).fill(`guest-${identity}@example.invalid`);
    await guest.getByRole('checkbox', { name: /accept terms and privacy notice/i }).check();
    await guest.getByRole('button', { name: 'Review booking', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Confirm these booking details' })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Confirm and book', exact: true })).toBeDisabled();
    await guest.getByRole('checkbox', { name: /confirming this local development booking/i }).check();
    await guest.getByRole('button', { name: 'Confirm and book', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Booking confirmed', exact: true })).toBeVisible();
    await expectNoBlockingAxeFindings(guest);
    expect(await guest.evaluate(() => (
      document.documentElement.scrollWidth <= window.innerWidth
    ))).toBe(true);

    // The guest has no host session, even though the original browser still does.
    await guest.goto(`${new URL(page.url()).origin}/dashboard`);
    await expect(guest).toHaveURL(/\/login$/);
  } finally {
    await guestContext.close();
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await page.getByRole('button', { name: 'Bookings', exact: true }).click();
  const booking = page.getByRole('row').filter({ hasText: guestName });
  await expect(booking).toBeVisible();
  await booking.getByRole('button', { name: `Cancel booking with ${guestName}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel booking', exact: true }).click();
  await expect(booking).toContainText('cancelled');
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByText(guestName, { exact: true })).toHaveCount(0);
});

