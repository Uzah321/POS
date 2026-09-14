import { createContext, useContext } from 'react';

// Lets a page (e.g. CashierPage) portal its own header controls into a slot
// inside AppLayout's topbar, so a page-specific row and the app's global
// topbar render as one physical line instead of stacked rows.
export const TopbarSlotContext = createContext<HTMLDivElement | null>(null);

export function useTopbarSlot() {
  return useContext(TopbarSlotContext);
}
