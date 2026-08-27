import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Demo from '@/pages/Demo';

describe('Authority Boundary Demo guide', () => {
  it('describes the real runnable flow without presenting simulated outcomes', () => {
    render(
      <MemoryRouter>
        <Demo />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Authority Boundary Demo' }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Run the real flow' }),
    ).toBeVisible();
    expect(screen.getByText('npm run demo:authority')).toBeVisible();
    expect(screen.getByText('npm run demo:authority:capture')).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Create is refused' }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Human authority' }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Database authority' }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'It does not prove' })).toBeVisible();
    expect(screen.queryByText('Available times')).not.toBeInTheDocument();
    expect(document.title).toBe('Authority Boundary Demo | Project S');
  });
});
