import { create } from 'zustand';

// Shared open/close state for POS action modals (Customer, Loyalty, Covers)
// — lets the top nav (AppLayout) trigger them even though the modals
// themselves render inside POSPage.
interface PosUIState {
  showCustomerPicker: boolean;
  showLoyaltyPanel: boolean;
  showCoversKeypad: boolean;
  coversInput: string;
  setShowCustomerPicker: (v: boolean) => void;
  setShowLoyaltyPanel: (v: boolean) => void;
  setShowCoversKeypad: (v: boolean) => void;
  setCoversInput: (v: string) => void;
}

export const usePosUIStore = create<PosUIState>()((set) => ({
  showCustomerPicker: false,
  showLoyaltyPanel: false,
  showCoversKeypad: false,
  coversInput: '',
  setShowCustomerPicker: (v) => set({ showCustomerPicker: v }),
  setShowLoyaltyPanel: (v) => set({ showLoyaltyPanel: v }),
  setShowCoversKeypad: (v) => set({ showCoversKeypad: v }),
  setCoversInput: (v) => set({ coversInput: v }),
}));
