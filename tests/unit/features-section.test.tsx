import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import FeaturesSection from '@/components/FeaturesSection';
import TermsOfService from '@/pages/TermsOfService';

describe('public feature boundary', () => {
  it('states the included abuse controls without claiming optional integrations ship in core', () => {
    render(<FeaturesSection />);

    const table = screen.getByRole('table', {
      name: 'Features included and excluded from Project S Core pre-alpha',
    });

    for (const capability of [
      'Persisted public request throttling',
      'Turnstile confirmation integration (when configured)',
    ]) {
      expect(
        within(table).getByRole('row', { name: `${capability} Included` }),
      ).toBeVisible();
    }

    for (const capability of [
      'Google or other calendar sync',
      'Booking email notifications',
      'AI booking assistant',
    ]) {
      expect(
        within(table).getByRole('row', { name: `${capability} Not included` }),
      ).toBeVisible();
    }

    expect(
      screen.queryByText(/no built-in CAPTCHA or application-level public request throttling/i),
    ).not.toBeInTheDocument();
  });

  it('keeps the terms page aligned with the implemented abuse-control boundary', () => {
    render(
      <MemoryRouter>
        <TermsOfService />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(/includes persisted public request limits and a reference Turnstile confirmation integration/i),
    ).toBeVisible();
    expect(
      screen.queryByText(/includes no .*built-in CAPTCHA.*public request throttling/i),
    ).not.toBeInTheDocument();
  });
});
