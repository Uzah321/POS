import api from '../lib/axios';

export const authApi = {
  login: (data: { username: string; password: string }) => api.post('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  updateProfile: (data: FormData | object) => api.put('/auth/profile', data),
};

export const productsApi = {
  list: (params?: object) => api.get('/products', { params }),
  search: (q: string) => api.get('/products/search', { params: { q } }),
  get: (id: number) => api.get(`/products/${id}`),
  create: (data: object) => api.post('/products', data),
  update: (id: number, data: object) => api.put(`/products/${id}`, data),
  delete: (id: number) => api.delete(`/products/${id}`),
  getIngredients: (id: number) => api.get(`/products/${id}/ingredients`),
  syncIngredients: (id: number, ingredients: Array<{ ingredient_id: number; quantity: number }>) =>
    api.put(`/products/${id}/ingredients`, { ingredients }),
  getCaseUnit: (id: number) => api.get(`/products/${id}/case-unit`),
  setCaseUnit: (id: number, data: { unit_product_id: number; units_per_case: number }) =>
    api.put(`/products/${id}/case-unit`, data),
};

export const ingredientsApi = {
  list: (params?: object) => api.get('/ingredients', { params }),
  get: (id: number) => api.get(`/ingredients/${id}`),
  create: (data: object) => api.post('/ingredients', data),
  update: (id: number, data: object) => api.put(`/ingredients/${id}`, data),
  delete: (id: number) => api.delete(`/ingredients/${id}`),
  vendors: (id: number) => api.get(`/ingredients/${id}/vendors`),
  syncVendors: (id: number, vendors: Array<{ supplier_id: number; vendor_sku?: string; vendor_cost?: number }>) =>
    api.put(`/ingredients/${id}/vendors`, { vendors }),
  ordering: (id: number) => api.get(`/ingredients/${id}/ordering`),
  syncOrdering: (id: number, settings: Array<{ branch_id: number; recommended_quantity?: number; minimum_quantity?: number }>) =>
    api.put(`/ingredients/${id}/ordering`, { settings }),
  addStock: (id: number, data: { warehouse_id: number; quantity: number; reason?: string }) =>
    api.post(`/ingredients/${id}/add-stock`, data),
  subtractStock: (id: number, data: { warehouse_id: number; quantity: number; reason: string }) =>
    api.post(`/ingredients/${id}/subtract-stock`, data),
  stockHistory: (id: number, params?: object) => api.get(`/ingredients/${id}/stock-history`, { params }),
};

export const salesApi = {
  list: (params?: object) => api.get('/sales', { params }),
  get: (id: number) => api.get(`/sales/${id}`),
  create: (data: object) => api.post('/sales', data),
  hold: (data: object) => api.post('/sales/hold', data),
  listHeld: (params?: object) => api.get('/sales/held', { params }),
  heldSales: () => api.get('/sales/held'),
  deleteHeld: (id: number) => api.delete(`/sales/held/${id}`),
  updateHeldStatus: (id: number, status: string) => api.patch(`/sales/held/${id}/status`, { order_status: status }),
  receipt: (id: number) => api.get(`/sales/${id}/receipt`),
  cancel: (id: number) => api.patch(`/sales/${id}/cancel`),
};

export const refundsApi = {
  list: (params?: object) => api.get('/refunds', { params }),
  get: (id: number) => api.get(`/refunds/${id}`),
  create: (data: object) => api.post('/refunds', data),
};

export const customersApi = {
  list: (params?: object) => api.get('/customers', { params }),
  get: (id: number) => api.get(`/customers/${id}`),
  create: (data: object) => api.post('/customers', data),
  update: (id: number, data: object) => api.put(`/customers/${id}`, data),
  delete: (id: number) => api.delete(`/customers/${id}`),
  history: (id: number, params?: object) => api.get(`/customers/${id}/purchase-history`, { params }),
  getLoyalty: (id: number) => api.get(`/customers/${id}/loyalty`),
  redeemLoyalty: (id: number, points: number, note?: string) => api.post(`/customers/${id}/loyalty/redeem`, { points, note }),
};

export const suppliersApi = {
  list: (params?: object) => api.get('/suppliers', { params }),
  get: (id: number) => api.get(`/suppliers/${id}`),
  create: (data: object) => api.post('/suppliers', data),
  update: (id: number, data: object) => api.put(`/suppliers/${id}`, data),
  delete: (id: number) => api.delete(`/suppliers/${id}`),
};

export const purchaseOrdersApi = {
  list: (params?: object) => api.get('/purchase-orders', { params }),
  get: (id: number) => api.get(`/purchase-orders/${id}`),
  create: (data: object) => api.post('/purchase-orders', data),
  approve: (id: number) => api.post(`/purchase-orders/${id}/approve`),
  receive: (id: number, data: object) => api.post(`/purchase-orders/${id}/receive`, data),
};

export const inventoryApi = {
  stockLevels:     (params?: object)          => api.get('/inventory/stock-levels', { params }),
  adjust:          (data: object)             => api.post('/inventory/adjust', data),
  adjustments:     (params?: object)          => api.get('/inventory/adjustments', { params }),
  createTransfer:  (data: object)             => api.post('/inventory/transfers', data),
  receiveTransfer: (id: number, data: object) => api.post(`/inventory/transfers/${id}/receive`, data),
  importStock:     (data: object)             => api.post('/inventory/import', data),
  importTemplate:  ()                         => api.get('/inventory/import-template', { responseType: 'blob' }),
};

export const expensesApi = {
  list: (params?: object) => api.get('/expenses', { params }),
  get: (id: number) => api.get(`/expenses/${id}`),
  create: (data: object) => api.post('/expenses', data),
  update: (id: number, data: object) => api.put(`/expenses/${id}`, data),
  delete: (id: number) => api.delete(`/expenses/${id}`),
  categories: () => api.get('/expense-categories'),
};

export const reportsApi = {
  dashboard: () => api.get('/reports/dashboard'),
  sales: (params?: object) => api.get('/reports/sales', { params }),
  inventory: (params?: object) => api.get('/reports/inventory', { params }),
  profitLoss: (params?: object) => api.get('/reports/profit-loss', { params }),
  cashierPerformance: (params?: object) => api.get('/reports/cashier-performance', { params }),
};

export const usersApi = {
  list: (params?: object) => api.get('/users', { params }),
  get: (id: number) => api.get(`/users/${id}`),
  create: (data: object) => api.post('/users', data),
  update: (id: number, data: object) => api.put(`/users/${id}`, data),
  delete: (id: number) => api.delete(`/users/${id}`),
};

export const settingsApi = {
  get: () => api.get('/settings'),
  update: (data: object) => api.post('/settings', data),
};

export const categoriesApi = {
  list: () => api.get('/categories'),
  create: (data: object) => api.post('/categories', data),
  update: (id: number, data: object) => api.put(`/categories/${id}`, data),
  delete: (id: number) => api.delete(`/categories/${id}`),
};

export const brandsApi = {
  list: () => api.get('/brands'),
  create: (data: object) => api.post('/brands', data),
  update: (id: number, data: object) => api.put(`/brands/${id}`, data),
  delete: (id: number) => api.delete(`/brands/${id}`),
};

export const unitsApi = {
  list: () => api.get('/units'),
  create: (data: object) => api.post('/units', data),
  update: (id: number, data: object) => api.put(`/units/${id}`, data),
  delete: (id: number) => api.delete(`/units/${id}`),
};

export const branchesApi = {
  list: () => api.get('/branches'),
  create: (data: object) => api.post('/branches', data),
  update: (id: number, data: object) => api.put(`/branches/${id}`, data),
  delete: (id: number) => api.delete(`/branches/${id}`),
};

export const departmentsApi = {
  list: () => api.get('/departments'),
  create: (data: object) => api.post('/departments', data),
  update: (id: number, data: object) => api.put(`/departments/${id}`, data),
  delete: (id: number) => api.delete(`/departments/${id}`),
};

export const auditLogsApi = {
  list: (params?: object) => api.get('/audit-logs', { params }),
};

export const currenciesApi = {
  list: () => api.get('/currencies'),           // public — active only
  all: () => api.get('/currencies/all'),         // protected — all
  create: (data: object) => api.post('/currencies', data),
  update: (id: number, data: object) => api.put(`/currencies/${id}`, data),
  delete: (id: number) => api.delete(`/currencies/${id}`),
};

export const warehousesApi = {
  list: (params?: object) => api.get('/warehouses', { params }),
};

export const ecocashApi = {
  list:    (params?: object) => api.get('/ecocash', { params }),
  create:  (data: object)    => api.post('/ecocash', data),
  reverse: (id: number)      => api.post(`/ecocash/${id}/reverse`),
  summary: (params?: object) => api.get('/ecocash/summary', { params }),
  exportCsv: (params?: object) =>
    api.get('/ecocash', { params: { ...params, export: 'csv' }, responseType: 'blob' }),
};

export const cashflowApi = {
  list:    (params?: object)          => api.get('/cashflow', { params }),
  create:  (data: object)             => api.post('/cashflow', data),
  update:  (id: number, data: object) => api.put(`/cashflow/${id}`, data),
  delete:  (id: number)               => api.delete(`/cashflow/${id}`),
  exportCsv: (params?: object) =>
    api.get('/cashflow', { params: { ...params, export: 'csv' }, responseType: 'blob' }),
};

export const salariesApi = {
  list:     (params?: object)          => api.get('/salaries', { params }),
  create:   (data: object)             => api.post('/salaries', data),
  update:   (id: number, data: object) => api.put(`/salaries/${id}`, data),
  delete:   (id: number)               => api.delete(`/salaries/${id}`),
  markPaid: (id: number, data: object) => api.post(`/salaries/${id}/mark-paid`, data),
  exportCsv:(params?: object)          => api.get('/salaries', { params: { ...params, export: 'csv' }, responseType: 'blob' }),
};

export const rentalsApi = {
  list:       (params?: object)          => api.get('/rentals', { params }),
  create:     (data: object)             => api.post('/rentals', data),
  update:     (id: number, data: object) => api.put(`/rentals/${id}`, data),
  delete:     (id: number)               => api.delete(`/rentals/${id}`),
  addPayment: (id: number, data: object) => api.post(`/rentals/${id}/payments`, data),
  payments:   (id: number)               => api.get(`/rentals/${id}/payments`),
  exportCsv:  (params?: object)          => api.get('/rentals', { params: { ...params, export: 'csv' }, responseType: 'blob' }),
};

export const stockReconciliationApi = {
  reconcile: (params?: object) => api.get('/stock-reconciliation', { params }),
  exportCsv: (params?: object) => api.get('/stock-reconciliation', { params: { ...params, export: 'csv' }, responseType: 'blob' }),
};

export const financialReportApi = {
  summary:      (params?: object) => api.get('/reports/financial-summary', { params }),
  exportCsv:    (params?: object) =>
    api.get('/reports/financial-summary', { params: { ...params, export: 'csv' }, responseType: 'blob' }),
  dailyCsv:     (params?: object) =>
    api.get('/reports/daily/csv', { params, responseType: 'blob' }),
  monthlyCsv:   (params?: object) =>
    api.get('/reports/monthly/csv', { params, responseType: 'blob' }),
};
