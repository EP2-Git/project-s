import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SignupForm from '@/components/auth/SignupForm';

const fixtures = vi.hoisted(() => ({ signUp: vi.fn(), available: vi.fn(), success: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: { signUp: fixtures.signUp } } }));
vi.mock('@/services/usernameService', () => ({ isUsernameAvailable: fixtures.available }));
vi.mock('sonner', () => ({ toast: { success: fixtures.success } }));

const passwordValue = 'Synthetic-local-Aa1!';
const values = { fullName: 'Example Person', email: 'PERSON@example.invalid', username: 'example-person', password: passwordValue };
const verification = () => ({ data: { session: null }, error: null });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

function Destination() {
  const location = useLocation();
  return <h1>{location.pathname} {location.state?.email}</h1>;
}

const draw = () => render(
  <MemoryRouter initialEntries={['/signup']}>
    <Routes>
      <Route path="/signup" element={<SignupForm />} />
      <Route path="/dashboard" element={<Destination />} />
      <Route path="/email-verification" element={<Destination />} />
    </Routes>
  </MemoryRouter>,
);

const fill = async () => {
  fireEvent.change(screen.getByLabelText('Full Name', { exact: true }), { target: { value: values.fullName } });
  fireEvent.change(screen.getByLabelText('Email', { exact: true }), { target: { value: values.email } });
  fireEvent.change(screen.getByLabelText('Username', { exact: true }), { target: { value: values.username } });
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: values.password } });
  await waitFor(() => expect(fixtures.available).toHaveBeenCalledWith(values.username), { timeout: 2500 });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create Account', exact: true })).toBeEnabled());
};

const expectEntries = () => {
  expect(screen.getByLabelText('Full Name', { exact: true })).toHaveValue(values.fullName);
  expect(screen.getByLabelText('Email', { exact: true })).toHaveValue(values.email);
  expect(screen.getByLabelText('Username', { exact: true })).toHaveValue(values.username);
  expect(screen.getByLabelText('Password', { exact: true })).toHaveValue(passwordValue);
};

describe('signup accessibility and recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.available.mockReset().mockResolvedValue(true);
    fixtures.signUp.mockReset().mockResolvedValue(verification());
  });

  it('associates the password label and hint with the input and supports keyboard visibility controls', async () => {
    const user = userEvent.setup();
    draw();
    const password = screen.getByLabelText('Password', { exact: true });
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(password).toHaveAccessibleDescription('Use at least 6 characters.');
    expect(screen.getByLabelText('Full Name', { exact: true })).toHaveAttribute('autocomplete', 'name');
    await user.type(password, passwordValue);
    await user.tab();
    const show = screen.getByRole('button', { name: 'Show password', exact: true });
    expect(show).toHaveFocus();
    expect(show).toHaveAttribute('aria-controls', password.id);
    expect(show).toHaveAttribute('aria-pressed', 'false');
    await user.keyboard('{Enter}');
    expect(password).toHaveAttribute('type', 'text');
    const hide = screen.getByRole('button', { name: 'Hide password', exact: true });
    expect(hide).toHaveFocus();
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard(' ');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue(passwordValue);
    expect(document.body.textContent).not.toContain(passwordValue);
    expect(fixtures.signUp).not.toHaveBeenCalled();
  });

  it('links validation errors to the password input and preserves the existing six-character boundary', async () => {
    draw();
    const password = screen.getByLabelText('Password', { exact: true });
    fireEvent.change(password, { target: { value: 'short' } });
    await waitFor(() => expect(password).toHaveAttribute('aria-invalid', 'true'));
    expect(password).toHaveAccessibleDescription(/Use at least 6 characters\. Password must be at least 6 characters\./);
    expect(screen.getByRole('button', { name: 'Create Account', exact: true })).toBeDisabled();
    fireEvent.change(password, { target: { value: 'sixsix' } });
    await waitFor(() => expect(password).toHaveAttribute('aria-invalid', 'false'));
    expect(screen.queryByText('Password must be at least 6 characters.')).not.toBeInTheDocument();
    expect(password).toHaveAccessibleDescription('Use at least 6 characters.');
  });

  it('announces a pending username check and disables submission until it resolves', async () => {
    const lookup = deferred<boolean>();
    fixtures.available.mockReturnValue(lookup.promise);
    draw();
    fireEvent.change(screen.getByLabelText('Username', { exact: true }), { target: { value: values.username } });
    expect(await screen.findByRole('status')).toHaveTextContent('Checking username...');
    expect(screen.getByRole('button', { name: 'Create Account', exact: true })).toBeDisabled();
    lookup.resolve(true);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(fixtures.signUp).not.toHaveBeenCalled();
  });

  it('focuses a retryable lookup failure, keeps entries, and retries through the existing verification destination', async () => {
    draw();
    await fill();
    fixtures.available.mockRejectedValueOnce(new Error('PRIVATE transport detail'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Account', exact: true }));
    const error = await screen.findByRole('alert', { name: 'Account creation failed' });
    await waitFor(() => expect(error).toHaveFocus());
    expect(error).toHaveTextContent('Failed to create account. Check your details and try again.');
    expect(error).toHaveTextContent('Your entries are still here.');
    expect(error).not.toHaveTextContent('PRIVATE');
    expectEntries();
    expect(fixtures.signUp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create Account', exact: true }));
    expect(await screen.findByRole('heading', { name: '/email-verification person@example.invalid' })).toBeVisible();
    expect(fixtures.signUp).toHaveBeenCalledOnce();
    expect(fixtures.signUp).toHaveBeenCalledWith({
      email: 'person@example.invalid', password: passwordValue,
      options: { data: { full_name: values.fullName, username: values.username }, emailRedirectTo: `${window.location.origin}/dashboard` },
    });
  });

  it('keeps a failed Auth submission private and allows a successful retry without changing session routing', async () => {
    fixtures.signUp.mockResolvedValueOnce({ data: { session: null }, error: new Error('PRIVATE auth detail') })
      .mockResolvedValueOnce({ data: { session: { access_token: 'synthetic-token' } }, error: null });
    draw();
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create Account', exact: true }));
    const error = await screen.findByRole('alert', { name: 'Account creation failed' });
    await waitFor(() => expect(error).toHaveFocus());
    expect(error).not.toHaveTextContent('PRIVATE');
    expectEntries();
    fireEvent.click(screen.getByRole('button', { name: 'Create Account', exact: true }));
    expect(await screen.findByRole('heading', { name: '/dashboard' })).toBeVisible();
    expect(fixtures.signUp).toHaveBeenCalledTimes(2);
  });

  it('focuses a submission-time username conflict, performs no Auth write, and recovers after an edit', async () => {
    draw();
    await fill();
    fixtures.available.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Create Account', exact: true }));
    const username = screen.getByLabelText('Username', { exact: true });
    await waitFor(() => expect(username).toHaveFocus());
    expect(username).toHaveAttribute('aria-invalid', 'true');
    expect(username).toHaveAccessibleDescription(/This username is already taken/);
    expect(fixtures.signUp).not.toHaveBeenCalled();
    fireEvent.change(username, { target: { value: 'another-person' } });
    await waitFor(() => expect(fixtures.available).toHaveBeenCalledWith('another-person'), { timeout: 2500 });
    const submit = screen.getByRole('button', { name: 'Create Account', exact: true });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    expect(await screen.findByRole('heading', { name: '/email-verification person@example.invalid' })).toBeVisible();
    expect(fixtures.signUp).toHaveBeenCalledOnce();
  });

  it('marks a pending Auth submission busy and prevents repeat UI submissions', async () => {
    const signup = deferred<ReturnType<typeof verification>>();
    fixtures.signUp.mockReturnValue(signup.promise);
    const user = userEvent.setup();
    draw();
    await fill();
    await user.click(screen.getByRole('button', { name: 'Create Account', exact: true }));
    const form = screen.getByRole('form', { name: 'Create your account', exact: true });
    await waitFor(() => expect(form).toHaveAttribute('aria-busy', 'true'));
    const pending = screen.getByRole('button', { name: 'Creating account...' });
    expect(pending).toBeDisabled();
    await user.click(pending);
    await user.keyboard('{Enter}');
    expect(fixtures.signUp).toHaveBeenCalledOnce();
    signup.resolve(verification());
    expect(await screen.findByRole('heading', { name: '/email-verification person@example.invalid' })).toBeVisible();
  });

  it('fences same-tick submits before both username and Auth promises resolve', async () => {
    const lookup = deferred<boolean>();
    const signup = deferred<ReturnType<typeof verification>>();
    draw();
    await fill();
    fixtures.available.mockClear().mockReturnValue(lookup.promise);
    fixtures.signUp.mockReturnValue(signup.promise);
    const form = screen.getByRole('form', { name: 'Create your account', exact: true });
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(fixtures.available).toHaveBeenCalledOnce());
    expect(form).toHaveAttribute('aria-busy', 'true');
    expect(fixtures.signUp).not.toHaveBeenCalled();
    lookup.resolve(true);
    await waitFor(() => expect(fixtures.signUp).toHaveBeenCalledOnce());
    fireEvent.submit(form);
    await waitFor(() => expect(fixtures.available).toHaveBeenCalledOnce());
    signup.resolve(verification());
    expect(await screen.findByRole('heading', { name: '/email-verification person@example.invalid' })).toBeVisible();
  });

  it('refocuses each identical immediate failure without stealing focus during retained-field edits', async () => {
    fixtures.signUp.mockResolvedValue({ data: { session: null }, error: new Error('Synthetic immediate Auth failure') });
    const user = userEvent.setup();
    draw();
    await fill();
    const submit = screen.getByRole('button', { name: 'Create Account', exact: true });
    await user.click(submit);
    const firstError = await screen.findByRole('alert', { name: 'Account creation failed' });
    await waitFor(() => expect(fixtures.signUp).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(firstError).toHaveFocus());

    const fullName = screen.getByLabelText('Full Name', { exact: true });
    await user.click(fullName);
    await user.type(fullName, ' Revised');
    expect(fullName).toHaveFocus();
    expect(firstError).toBeVisible();
    expect(fullName).toHaveValue(`${values.fullName} Revised`);
    expect(screen.getByLabelText('Password', { exact: true })).toHaveValue(passwordValue);

    await user.click(submit);
    await waitFor(() => expect(fixtures.signUp).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('alert', { name: 'Account creation failed' })).toHaveFocus());
    expect(screen.getByRole('alert', { name: 'Account creation failed' })).toHaveTextContent(firstError.textContent ?? '');
    expect(fullName).toHaveValue(`${values.fullName} Revised`);
    expect(screen.getByLabelText('Password', { exact: true })).toHaveValue(passwordValue);
  });
});
