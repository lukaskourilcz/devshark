import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import DevPage from '../src/components/dev/DevPage';

function Where() {
  const location = useLocation();
  return <p>{location.pathname}</p>;
}

const at = (entry: string) => render(<MemoryRouter initialEntries={[entry]}><Routes>
  <Route path="/dev" element={<DevPage />} />
  <Route path="/admin/*" element={<Where />} />
</Routes></MemoryRouter>);

describe('the old control room address', () => {
  it('opens the same section in the administration', () => {
    at('/dev?section=settings');
    expect(screen.getByText('/admin/settings')).toBeInTheDocument();
  });
  it('opens the question bank for /dev and for an unknown section', () => {
    at('/dev');
    expect(screen.getByText('/admin/questions')).toBeInTheDocument();
  });
  it('opens Users, the administration home, for its section', () => {
    at('/dev?section=users');
    expect(screen.getByText('/admin')).toBeInTheDocument();
  });
});
