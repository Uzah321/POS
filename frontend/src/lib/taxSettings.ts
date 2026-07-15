// Mirrors the backend tax logic in SaleController::store — a product's own
// tax rate (if assigned) overrides the store-wide rate; otherwise fall back
// to the global Settings tax rate, when tax is enabled. Used to show a live
// tax preview in the cart that matches what the backend will actually charge.
export function effectiveTaxRate(product: any, storeSettings: Record<string, any> | undefined): number {
  const taxEnabled = storeSettings?.tax_enabled === 'true' || storeSettings?.tax_enabled === true;
  if (!taxEnabled) return 0;
  const productRate = product?.tax_rate?.rate;
  if (productRate !== undefined && productRate !== null) return Number(productRate);
  return Number(storeSettings?.tax_rate ?? 0);
}
