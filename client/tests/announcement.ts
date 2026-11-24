import { expect } from 'vitest';

/** Capture the actual region before the action. A replacement cannot pass. */
export function trackAnnouncement(selector: string) {
  const region = document.querySelector(selector);
  expect(region, selector).toBeInTheDocument();
  const previous = region?.textContent;
  return (message: string | RegExp) => {
    expect(document.querySelector(selector), selector).toBe(region);
    expect(region).toHaveTextContent(message);
    expect(region?.textContent).not.toBe(previous);
  };
}
