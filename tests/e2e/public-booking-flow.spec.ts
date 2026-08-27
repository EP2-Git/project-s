import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

test.describe.configure({ retries: 0 });

const expectNoBlockingAxeFindings = async (page: Page) => {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    ({ impact }) => impact === "critical" || impact === "serious",
  );

  expect(blocking).toEqual([]);
};

const chooseAvailableSlot = async (page: Page, slotIndex: number) => {
  const slots = page.locator('button[aria-label^="Select "]');
  const noSlots = page.getByText("No available time slots for this date.");
  await expect(slots.first().or(noSlots)).toBeVisible();

  if (await slots.nth(slotIndex).isVisible().catch(() => false)) {
    await slots.nth(slotIndex).focus();
    await page.keyboard.press("Enter");
    return;
  }

  const calendar = page.locator('section[aria-labelledby="select-date-title"]');
  const candidateDays = calendar.locator('button[name="day"]:not([disabled])');
  const candidateCount = await candidateDays.count();

  for (let index = 0; index < candidateCount; index += 1) {
    const candidate = candidateDays.nth(index);
    if ((await candidate.getAttribute("aria-selected")) === "true") continue;

    const slotsResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/api/v1/public/free-slots/search"),
      { timeout: 10_000 },
    );

    await candidate.click();
    await slotsResponse;

    const slotBecameVisible = await slots
      .nth(slotIndex)
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (slotBecameVisible) {
      await slots.nth(slotIndex).focus();
      await page.keyboard.press("Enter");
      return;
    }
  }

  throw new Error("The seeded host did not expose an available slot in the visible calendar.");
};

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

const prepareThroughApi = async (page: Page) => {
  const pageResponse = await page.request.get(
    '/api/v1/public/booking-pages/demo-host',
  );
  expect(pageResponse.ok()).toBe(true);
  const bookingPage = (await pageResponse.json()).data;
  const meetingType = bookingPage.meetingTypes[0];
  expect(meetingType).toBeTruthy();

  let startAt: string | undefined;
  const today = dateKeyIn('America/Halifax');
  for (let offset = 1; offset <= 14 && !startAt; offset += 1) {
    const date = addDays(today, offset);
    const response = await page.request.post(
      '/api/v1/public/free-slots/search',
      {
        data: {
          username: bookingPage.username,
          meetingTypeId: meetingType.meetingTypeId,
          date,
          displayTimeZone: 'America/Halifax',
        },
      },
    );
    expect(response.ok()).toBe(true);
    startAt = (await response.json()).data.slots[0]?.startAt;
  }
  expect(startAt).toBeTruthy();

  const response = await page.request.post(
    '/api/v1/public/bookings/prepare',
    {
      data: {
        username: bookingPage.username,
        meetingTypeId: meetingType.meetingTypeId,
        startAt,
        guestTimeZone: 'America/Halifax',
        booker: {
          name: 'Fragment Retry Guest',
          email: `fragment-retry-${Date.now()}@example.invalid`,
          notes: 'Synthetic lost confirmation response test.',
        },
      },
    },
  );
  expect(response.ok()).toBe(true);
  return (await response.json()).data as {
    preparationId: string;
    preparationToken: string;
  };
};

test("an anonymous visitor is redirected away from the dashboard", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test('the fragment confirmation page recovers from a lost confirmation response', async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'One browser covers the retry protocol vector.');
  const preparation = await prepareThroughApi(page);

  await page.goto(
    `/booking/confirm#preparation=${encodeURIComponent(preparation.preparationToken)}`,
  );
  await expect(
    page.getByRole('heading', { name: 'Confirm these booking details' }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/preparation=/);
  await expect(page.getByText('Fragment Retry Guest')).toBeVisible();

  let confirmationResponseWasLost = false;
  await page.route('**/api/v1/public/booking-preparations/confirm', async (route) => {
    if (!confirmationResponseWasLost && route.request().method() === 'POST') {
      confirmationResponseWasLost = true;
      const upstreamHeaders = route.request().headers();
      const upstreamUrl = route.request().url();
      const upstreamMethod = route.request().method();
      const upstreamBody = route.request().postDataBuffer() ?? undefined;
      delete upstreamHeaders['content-length'];
      delete upstreamHeaders.host;
      delete upstreamHeaders.connection;
      await route.abort('connectionfailed');
      const upstream = await fetch(upstreamUrl, {
        method: upstreamMethod,
        headers: upstreamHeaders,
        body: upstreamBody,
      });
      expect(upstream.ok).toBe(true);
      return;
    }
    await route.continue();
  });

  const localApproval = page.getByRole('checkbox', {
    name: /confirming this local development booking/i,
  });
  await localApproval.check();
  await expect(
    page.getByRole('button', { name: 'Approve booking' }),
  ).toBeDisabled();
  await page
    .getByRole('checkbox', { name: /accept terms and privacy notice/i })
    .check();
  await page.getByRole('button', { name: 'Approve booking' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(confirmationResponseWasLost).toBe(true);

  await page.unroute('**/api/v1/public/booking-preparations/confirm');
  await localApproval.check();
  await page.getByRole('button', { name: 'Approve booking' }).click();
  await expect(
    page.getByRole('heading', { name: 'Human authority recorded' }),
  ).toBeVisible();
});

test("a guest books and the host cancels through the seeded local stack", async ({
  browserName,
  page,
}) => {
  test.setTimeout(60_000);
  const slotIndex = { chromium: 0, firefox: 10, webkit: 20 }[browserName];
  const guestName = `E2E ${browserName} Guest ${Date.now()}`;
  const guestEmail = `e2e-${Date.now()}@example.invalid`;

  await page.goto("/book/demo-host");
  await expect(
    page.getByRole("heading", { name: "Book time with Demo Host" }),
  ).toBeVisible();
  await expectNoBlockingAxeFindings(page);

  await chooseAvailableSlot(page, slotIndex);
  await page.getByLabel("Your name").fill(guestName);
  await page.getByLabel("Your email").fill(guestEmail);
  await page.getByLabel("Notes").fill("Synthetic browser-flow booking.");
  await page
    .getByRole("checkbox", { name: /accept terms and privacy notice/i })
    .check();
  await page.getByRole("button", { name: "Review booking" }).click();

  await expect(
    page.getByRole("heading", { name: "Confirm these booking details" }),
  ).toBeVisible();
  await expect(page.getByText("This preparation does not hold the time.")).toBeVisible();
  await page
    .getByRole("checkbox", { name: /confirming this local development booking/i })
    .check();

  if (browserName === "chromium") {
    let committedResponseWasLost = false;
    await page.route("**/api/v1/public/bookings", async (route) => {
      if (
        !committedResponseWasLost &&
        route.request().method() === "POST"
      ) {
        committedResponseWasLost = true;
        const upstreamHeaders = route.request().headers();
        const upstreamUrl = route.request().url();
        const upstreamMethod = route.request().method();
        const upstreamBody = route.request().postDataBuffer() ?? undefined;
        delete upstreamHeaders['content-length'];
        delete upstreamHeaders.host;
        delete upstreamHeaders.connection;
        await route.abort("connectionfailed");
        const upstream = await fetch(upstreamUrl, {
          method: upstreamMethod,
          headers: upstreamHeaders,
          body: upstreamBody,
        });
        expect(upstream.ok).toBe(true);
        return;
      }
      await route.continue();
    });

    await page.getByRole("button", { name: "Confirm and book" }).click();
    await expect(page.getByText("Human approval is recorded.")).toBeVisible();
    await page.unroute("**/api/v1/public/bookings");
    await page.getByRole("button", { name: "Create booking" }).click();
    expect(committedResponseWasLost).toBe(true);
  } else {
    await page.getByRole("button", { name: "Confirm and book" }).click();
  }

  await expect(
    page.getByRole("heading", { name: "Booking confirmed" }),
  ).toBeVisible();

  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@project-s.local");
  await page.getByLabel("Password").fill("project-s-demo-password");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expectNoBlockingAxeFindings(page);

  await page.getByRole("button", { name: "Bookings", exact: true }).click();
  const bookingRow = page.getByRole("row").filter({ hasText: guestName });
  await expect(bookingRow).toBeVisible();
  await bookingRow
    .getByRole("button", { name: `Cancel booking with ${guestName}` })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();

  await expect(bookingRow).toContainText("cancelled");

  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByText(guestName, { exact: true })).toHaveCount(0);
});
