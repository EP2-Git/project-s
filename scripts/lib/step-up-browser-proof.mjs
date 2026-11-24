import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';

// Guarded disposable-browser proof only. Authentication uses the normal Login
// UI; no route interception, storage injection, HAR, tracing or Auth-body logs.
const failure = 'Synthetic approval browser assertion failed.';
const operationDeadline = 45_000;
const closeDeadline = 10_000;
const phone = { width: 390, height: 844 };
const desktop = { width: 1280, height: 900 };
const differenceLabels = {
  host: 'Host', meeting_type: 'Meeting type', meeting_window: 'Meeting time', duration: 'Duration',
};
const stages = new Set([
  'browser launch', 'phone signed-out review', 'phone login', 'phone pending fields',
  'phone accessibility', 'phone sanitized capture', 'phone sign-out', 'foreign login',
  'foreign review heading', 'foreign private state denial', 'foreign booking denial',
  'foreign accessibility', 'foreign sanitized capture', 'lost approval login', 'lost approval pending fields',
  'lost approval submit', 'lost approval uncertainty', 'same approval retry',
  'approval acknowledgement', 'approval reload recovery',
  'desktop decline login', 'desktop decline pending fields', 'desktop decline submit',
  'decline acknowledgement', 'browser context shutdown', 'browser shutdown',
]);
const check = (condition) => { if (!condition) throw new Error(failure); };
const bounded = async (operation, milliseconds) => {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(failure)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
};
const field = (page, name) => page.locator('dt').filter({ hasText: new RegExp(`^${name}$`) })
  .locator('..').locator('dd');
const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const reviewPath = (reviewId) => `/authority/review#review=${reviewId}`;
const loginPath = (reviewId) => `/login?${new URLSearchParams({ returnTo: reviewPath(reviewId) })}`;
const ruleId = /^[a-z][a-z0-9-]{0,63}(?![\s\S])/;
const diagnosticStage = /^(.+) \[axe:([a-z][a-z0-9-]{0,63}(?:,[a-z][a-z0-9-]{0,63}){0,19}); count:([1-9][0-9]{0,2})\](?![\s\S])/;

export const startStepUpBrowserProof = async ({ origin, owner, other, onStage } = {}) => {
  let base;
  try {
    const url = new URL(origin);
    check(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && origin === url.origin);
    for (const account of [owner, other]) {
      check(typeof account?.email === 'string' && account.email.endsWith('@example.invalid') &&
        typeof account.password === 'string' && account.password.length > 0);
    }
    check(onStage === undefined || typeof onStage === 'function');
    base = url.origin;
  } catch { throw new Error(failure); }
  let currentStage = 'browser launch';
  const report = (stage) => {
    const diagnostic = diagnosticStage.exec(stage);
    check(stages.has(stage) || (diagnostic && stages.has(diagnostic[1])));
    currentStage = stage;
    try { onStage?.(stage); } catch { throw new Error(failure); }
  };
  const safe = async (operation) => {
    try { return await operation(); } catch { throw new Error(failure); }
  };
  let browser;
  report('browser launch');
  try { browser = await chromium.launch({ headless: true, timeout: closeDeadline }); }
  catch { throw new Error(failure); }
  let closing;
  const contexts = new Set();
  const createPage = async (viewport) => {
    check(!closing && browser.isConnected());
    const context = await bounded(browser.newContext({ viewport }), closeDeadline);
    contexts.add(context);
    try {
      const page = await bounded(context.newPage(), closeDeadline);
      page.setDefaultTimeout(15_000);
      page.setDefaultNavigationTimeout(20_000);
      return { context, page };
    } catch {
      await bounded(context.close(), closeDeadline);
      contexts.delete(context);
      throw new Error(failure);
    }
  };
  const closeContext = async (context) => {
    if (!contexts.has(context)) return;
    await bounded(context.close(), closeDeadline);
    check(context.pages().length === 0);
    contexts.delete(context);
  };
  const inContext = async (viewport, operation) => {
    const { context, page } = await createPage(viewport);
    let result;
    let failedStage;
    try { result = await bounded(operation(page), operationDeadline); }
    catch { failedStage = currentStage; }
    try { await closeContext(context); }
    catch { report('browser context shutdown'); throw new Error(failure); }
    if (failedStage) { report(failedStage); throw new Error(failure); }
    return result;
  };
  const validate = ({ reviewId, exactReview } = {}) => {
    check(typeof reviewId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(reviewId));
    check(exactReview?.reviewId === reviewId && exactReview.state === 'pending' && exactReview.revision === 1 &&
      typeof exactReview.summaryDigest === 'string' && exactReview.exactSummary && Array.isArray(exactReview.differences));
    return { reviewId, exactReview };
  };
  const observe = (page, reviewId) => {
    const calls = [];
    let valid = true;
    const prefix = `/api/v2/authority/step-ups/${reviewId}`;
    page.on('request', (request) => {
      try {
        const url = new URL(request.url());
        if (url.origin !== base || (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`))) return;
        calls.push({ method: request.method(), path: url.pathname,
          input: request.method() === 'POST' ? request.postDataJSON() : null });
      } catch { valid = false; }
    });
    return {
      assert: (expected) => { check(valid && same(calls, expected)); },
      read: { method: 'GET', path: prefix, input: null },
      approve: (exact) => ({ method: 'POST', path: `${prefix}/approve`, input: {
        expectedRevision: exact.revision, summaryDigest: exact.summaryDigest,
      } }),
      decline: (exact) => ({ method: 'POST', path: `${prefix}/revoke`, input: { expectedRevision: exact.revision } }),
    };
  };
  const accessible = async (page) => {
    // Scan settled rendered styles, including the normal Login success toast.
    // Await real finite transitions; persistent progress motion must not hang
    // the proof, and a canceled animation still completes this settling step.
    await page.evaluate(async () => {
      await Promise.all(globalThis.document.getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map((animation) => animation.finished.catch(() => undefined)));
    });
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    if (result.violations.length > 0) {
      // Only bounded library rule IDs and a count may cross the diagnostic
      // callback. Never expose Axe nodes, targets, HTML, account data or URLs.
      const ids = [...new Set(result.violations.map((violation) => violation.id)
        .filter((id) => typeof id === 'string' && ruleId.test(id)))].sort().slice(0, 20);
      report(`${currentStage} [axe:${ids.join(',') || 'unclassified'}; count:${Math.min(result.violations.length, 999)}]`);
    }
    check(result.violations.length === 0);
    check(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
  };
  const noPrivateDetails = async (page, exact) => {
    for (const value of [exact.exactSummary.name, exact.exactSummary.email, exact.exactSummary.hostDisplayName]) {
      await expect(page.getByText(value, { exact: true })).toHaveCount(0);
    }
    for (const label of ['Host', 'Name', 'Email']) await expect(field(page, label)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve this request', exact: true })).toHaveCount(0);
  };
  const notBooked = async (page) => {
    await expect(page.getByRole('heading', { name: 'Booking confirmed', exact: true })).toHaveCount(0);
    await expect(page.getByText('Booking confirmed', { exact: true })).toHaveCount(0);
  };
  const capture = async (page, label) => {
    check(new URL(page.url()).pathname === '/authority/review');
    check(await page.locator('input[type="password"]').count() === 0);
    await expect(page.getByRole('complementary', { name: 'Synthetic local browser proof', exact: true })).toBeVisible();
    const directory = new URL('../../output/playwright/', import.meta.url);
    await mkdir(directory, { recursive: true });
    // Mask identity rows and any accidentally displayed account email. No
    // screenshot contains credentials, random profile IDs or a Login form.
    await page.screenshot({
      path: fileURLToPath(new URL(`live-step-up-browser-${label}.png`, directory)),
      fullPage: true, maskColor: '#94a3b8',
      mask: [field(page, 'Host'), field(page, 'Name'), field(page, 'Email'),
        page.getByText(owner.email, { exact: true }), page.getByText(other.email, { exact: true })],
    });
  };
  const signIn = async (page, reviewId, account) => {
    await page.goto(`${base}${reviewPath(reviewId)}`);
    await expect(page.getByRole('heading', { name: 'Sign in to review this request', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(`${base}${loginPath(reviewId)}`);
    await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
    await page.locator('.animate-scale-in').evaluate(async (card) => {
      await Promise.all(card.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
    });
    await accessible(page);
    const email = page.getByLabel('Email', { exact: true });
    const password = page.getByLabel('Password', { exact: true });
    await email.focus();
    await email.fill(account.email);
    await page.keyboard.press('Tab');
    await expect(password).toBeFocused();
    await password.fill(account.password);
    await page.keyboard.press('Tab');
    const submit = page.getByRole('button', { name: 'Log in', exact: true });
    await expect(submit).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${base}${reviewPath(reviewId)}`);
  };
  const pending = async (page, exact) => {
    const summary = exact.exactSummary;
    await expect(page.getByRole('heading', { name: 'Review this meeting', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Meeting details', exact: true })).toBeVisible();
    await expect(field(page, 'Host')).toContainText(summary.hostDisplayName);
    await expect(field(page, 'Host')).toContainText(summary.username);
    await expect(field(page, 'Meeting')).toHaveText(summary.meetingTypeTitle);
    await expect(field(page, 'Name')).toHaveText(summary.name);
    await expect(field(page, 'Email')).toHaveText(summary.email);
    await expect(field(page, 'Reviewed time zones')).toContainText(summary.guestTimeZone);
    await expect(field(page, 'Reviewed time zones')).toContainText(summary.hostTimeZone);
    const minutes = (Date.parse(summary.endAt) - Date.parse(summary.startAt)) / 60_000;
    check(Number.isInteger(minutes) && minutes > 0);
    await expect(field(page, 'Duration')).toHaveText(`${minutes} minutes`);
    const instants = await page.locator('time').evaluateAll((elements) => elements.map((element) => element.getAttribute('datetime')));
    check(instants.includes(summary.startAt) && instants.includes(summary.endAt) && instants.includes(exact.expiresAt));
    await expect(page.getByRole('heading', { name: 'Why approval is needed', exact: true })).toBeVisible();
    for (const difference of exact.differences) {
      check(Object.hasOwn(differenceLabels, difference.field));
      await expect(page.getByRole('heading', { name: differenceLabels[difference.field], exact: true })).toBeVisible();
      if (difference.field === 'meeting_window') {
        for (const value of [difference.reviewed, difference.proposed]) {
          for (const instant of value.split(' / ')) check(instants.includes(instant));
        }
      }
    }
    await expect(page.getByRole('button', { name: 'Approve this request', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Decline this request', exact: true })).toBeEnabled();
    await expect(page.getByText(/The time is not reserved\./)).toBeVisible();
    await notBooked(page);
  };
  const signOut = async (page, reviewId, exact) => {
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    // Verify removal before waiting for the final Login navigation.
    await noPrivateDetails(page, exact);
    await expect(page).toHaveURL(`${base}${loginPath(reviewId)}`);
    await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  };
  let signOutReview;

  return {
    inspectPending: (input) => safe(async () => {
      const { reviewId, exactReview } = validate(input);
      check(!signOutReview);
      const { context, page } = await createPage(phone);
      const observed = observe(page, reviewId);
      let failedStage;
      try {
        await bounded((async () => {
          report('phone signed-out review');
          await page.goto(`${base}${reviewPath(reviewId)}`);
          await expect(page.getByRole('heading', { name: 'Sign in to review this request', exact: true })).toBeVisible();
          await noPrivateDetails(page, exactReview);
          observed.assert([]);
          report('phone login');
          await signIn(page, reviewId, owner);
          report('phone pending fields');
          await pending(page, exactReview);
          observed.assert([observed.read]);
          report('phone accessibility');
          await accessible(page);
          report('phone sanitized capture');
          await capture(page, 'phone-pending');
        })(), operationDeadline);
        await inContext(phone, async (page) => {
          report('foreign login');
          await signIn(page, reviewId, other);
          report('foreign review heading');
          await expect(page.getByRole('heading', { name: 'This request is no longer available', exact: true })).toBeVisible();
          report('foreign private state denial');
          await noPrivateDetails(page, exactReview);
          report('foreign booking denial');
          await notBooked(page);
          report('foreign accessibility');
          await accessible(page);
          report('foreign sanitized capture');
          await capture(page, 'foreign-unavailable');
        });
        // Keep this original private snapshot solely to prove clearing on real
        // logout. Native changes later in the proof can make it stale; it is
        // never treated as a fresh or still-actionable pending request.
        signOutReview = { context, page, reviewId, exactReview, observed };
      } catch { failedStage = currentStage; }
      if (failedStage) {
        try { await closeContext(context); }
        catch { report('browser context shutdown'); throw new Error(failure); }
        report(failedStage);
        throw new Error(failure);
      }
    }),
    verifySignOut: () => safe(async () => {
      check(!closing && signOutReview);
      const retained = signOutReview;
      signOutReview = undefined;
      let failedStage;
      try {
        await bounded((async () => {
          report('phone sign-out');
          await signOut(retained.page, retained.reviewId, retained.exactReview);
          retained.observed.assert([retained.observed.read]);
        })(), operationDeadline);
      } catch { failedStage = currentStage; }
      finally {
        try { await closeContext(retained.context); }
        catch { failedStage = 'browser context shutdown'; }
      }
      if (failedStage) { report(failedStage); throw new Error(failure); }
    }),
    decline: (input) => safe(async () => {
      const { reviewId, exactReview } = validate(input);
      await inContext(desktop, async (page) => {
        const observed = observe(page, reviewId);
        report('desktop decline login');
        await signIn(page, reviewId, owner);
        report('desktop decline pending fields');
        await pending(page, exactReview);
        await accessible(page);
        const approve = page.getByRole('button', { name: 'Approve this request', exact: true });
        await approve.focus();
        await page.keyboard.press('Tab');
        const decline = page.getByRole('button', { name: 'Decline this request', exact: true });
        await expect(decline).toBeFocused();
        await capture(page, 'desktop-pending');
        report('desktop decline submit');
        await page.keyboard.press('Enter');
        report('decline acknowledgement');
        await expect(page.getByRole('heading', { name: 'Request declined', exact: true })).toBeVisible();
        observed.assert([observed.read, observed.decline(exactReview)]);
        await noPrivateDetails(page, exactReview);
        await notBooked(page);
        await accessible(page);
        await capture(page, 'declined-ack');
      });
    }),
    approveLost: (input) => safe(async () => {
      const { reviewId, exactReview } = validate(input);
      const { context, page } = await createPage(phone);
      const observed = observe(page, reviewId);
      let retried = false;
      let finished = false;
      const abandon = async () => {
        finished = true;
        try { await closeContext(context); }
        catch { report('browser context shutdown'); throw new Error(failure); }
      };
      const retained = async (operation) => {
        check(!closing && !finished);
        try { return await bounded(operation(), operationDeadline); }
        catch {
          const failedStage = currentStage;
          await abandon();
          report(failedStage);
          throw new Error(failure);
        }
      };
      await retained(async () => {
        report('lost approval login');
        await signIn(page, reviewId, owner);
        report('lost approval pending fields');
        await pending(page, exactReview);
        report('lost approval submit');
        await page.getByRole('button', { name: 'Approve this request', exact: true }).focus();
        await page.keyboard.press('Space');
        report('lost approval uncertainty');
        await expect(page.getByRole('heading', { name: 'We haven’t received the result yet.', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Retry the same approval', exact: true })).toBeEnabled();
        await expect(page.getByRole('button', { name: 'Decline this request', exact: true })).toBeDisabled();
        await expect(page.getByRole('heading', { name: 'Approval recorded', exact: true })).toHaveCount(0);
        observed.assert([observed.read, observed.approve(exactReview)]);
        await notBooked(page);
        await accessible(page);
        await capture(page, 'approval-uncertain');
      });
      return {
        retryApproval: () => safe(() => retained(async () => {
          check(!retried);
          report('same approval retry');
          const retry = page.getByRole('button', { name: 'Retry the same approval', exact: true });
          await retry.focus();
          await page.keyboard.press('Enter');
          report('approval acknowledgement');
          await expect(page.getByRole('heading', { name: 'Approval recorded', exact: true })).toBeVisible();
          observed.assert([observed.read, observed.approve(exactReview), observed.approve(exactReview)]);
          await noPrivateDetails(page, exactReview);
          await notBooked(page);
          await expect(page.getByText(/permission to book, not a booking confirmation/i)).toBeVisible();
          await accessible(page);
          await capture(page, 'approval-ack');
          retried = true;
        })),
        finish: () => safe(async () => {
          await retained(async () => {
            check(retried);
            report('approval reload recovery');
            await page.reload();
            await expect(page.getByRole('heading', { name: 'This request is no longer available', exact: true })).toBeVisible();
            await noPrivateDetails(page, exactReview);
            await notBooked(page);
            observed.assert([observed.read, observed.approve(exactReview), observed.approve(exactReview), observed.read]);
            await accessible(page);
            await capture(page, 'approval-reload-unavailable');
          });
          await abandon();
        }),
        close: () => safe(abandon),
      };
    }),
    close: () => {
      if (closing) return closing;
      report('browser shutdown');
      closing = safe(() => bounded((async () => {
        const owned = new Set([...contexts, ...browser.contexts()]);
        const contextClosures = [...owned].map((context) => context.close());
        const browserClosure = browser.close();
        const results = await Promise.allSettled([...contextClosures, browserClosure]);
        // A dropped transport is not proof that the browser process closed.
        // Require actual browser shutdown fulfillment. An individual context
        // close can race that shutdown, but its pages must still be closed.
        check(results[results.length - 1].status === 'fulfilled');
        check(!browser.isConnected() && browser.contexts().length === 0);
        for (const context of owned) check(context.pages().length === 0);
        contexts.clear();
      })(), closeDeadline));
      return closing;
    },
  };
};
