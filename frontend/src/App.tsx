import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { ProtectedRoute, GuestRoute, StaffOnlyRoute } from './components/auth/RouteGuards';
import RequirePermission from './components/auth/PermissionRoute';
import ShopGuard from './components/auth/ShopGuard';
import AppLayout from './layouts/AppLayout';
import ErrorBoundary from './components/ErrorBoundary';

// Every page is loaded on demand instead of bundled into one ~2.8MB chunk
// every user downloaded up front (including jsPDF/xlsx/recharts, which most
// sessions never touch) — this is what made first load slow. Login/POS/
// Cashier/Dashboard are the screens almost everyone hits first, so they're
// still worth prefetching eagerly below; everything else loads when routed to.
const LoginPage               = lazy(() => import('./pages/LoginPage'));
const DashboardPage           = lazy(() => import('./pages/DashboardPage'));
const POSPage                 = lazy(() => import('./pages/POSPage'));
const CashierPage             = lazy(() => import('./pages/CashierPage'));
const SalesPage                = lazy(() => import('./pages/SalesPage'));
const RefundsPage              = lazy(() => import('./pages/RefundsPage'));
const ProductsPage             = lazy(() => import('./pages/ProductsPage'));
const IngredientsPage          = lazy(() => import('./pages/IngredientsPage'));
const InventoryPage            = lazy(() => import('./pages/InventoryPage'));
const PurchasesPage            = lazy(() => import('./pages/PurchasesPage'));
const SuppliersPage            = lazy(() => import('./pages/SuppliersPage'));
const CustomersPage            = lazy(() => import('./pages/CustomersPage'));
const ExpensesPage             = lazy(() => import('./pages/ExpensesPage'));
const ReportsPage              = lazy(() => import('./pages/ReportsPage'));
const UsersPage                = lazy(() => import('./pages/UsersPage'));
const SettingsPage             = lazy(() => import('./pages/SettingsPage'));
const CurrenciesPage           = lazy(() => import('./pages/CurrenciesPage'));
const OrdersPage               = lazy(() => import('./pages/OrdersPage'));
const ShiftEndPage             = lazy(() => import('./pages/ShiftEndPage'));
const DayEndPage               = lazy(() => import('./pages/DayEndPage'));
const HardwarePage             = lazy(() => import('./pages/HardwarePage'));
const CustomerDisplayPage      = lazy(() => import('./pages/CustomerDisplayPage'));
const KitchenDisplayPage       = lazy(() => import('./pages/KitchenDisplayPage'));
const TablesPage               = lazy(() => import('./pages/TablesPage'));
const StartPage                = lazy(() => import('./pages/StartPage'));
const QueueDisplayPage         = lazy(() => import('./pages/QueueDisplayPage'));
const LaybyPage                = lazy(() => import('./pages/LaybyPage'));
const QuotationsPage           = lazy(() => import('./pages/QuotationsPage'));
const StocktakePage            = lazy(() => import('./pages/StocktakePage'));
const StockTransferPage        = lazy(() => import('./pages/StockTransferPage'));
const AttendancePage           = lazy(() => import('./pages/AttendancePage'));
const CommissionsPage          = lazy(() => import('./pages/CommissionsPage'));
const AuditLogPage             = lazy(() => import('./pages/AuditLogPage'));
const RolePermissionPage       = lazy(() => import('./pages/RolePermissionPage'));
const WebhooksPage             = lazy(() => import('./pages/WebhooksPage'));
const BackupPage               = lazy(() => import('./pages/BackupPage'));
const EcocashPage              = lazy(() => import('./pages/EcocashPage'));
const CashflowPage             = lazy(() => import('./pages/CashflowPage'));
const FinancialReportPage      = lazy(() => import('./pages/FinancialReportPage'));
const SalariesPage             = lazy(() => import('./pages/SalariesPage'));
const RentalsPage              = lazy(() => import('./pages/RentalsPage'));
const StockReconciliationPage  = lazy(() => import('./pages/StockReconciliationPage'));
const BranchesPage             = lazy(() => import('./pages/BranchesPage'));
const BranchComparisonPage     = lazy(() => import('./pages/BranchComparisonPage'));
const LicensePage              = lazy(() => import('./pages/LicensePage'));
const StockProductionPage      = lazy(() => import('./pages/StockProductionPage'));
const BarcodeLabelsPage        = lazy(() => import('./pages/BarcodeLabelsPage'));

function RouteFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Loader2 size={28} className="animate-spin text-blue-500" />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 0,
      // 30s, not 5 min — a page revisited after a short while (or another
      // till/device changing data) should show current data on its own
      // instead of serving a stale cache until someone manually reloads.
      // Individual queries that need something fresher already set their
      // own shorter staleTime; this just lowers the "do nothing" default.
      staleTime: 30 * 1000,
      gcTime: 15 * 60 * 1000,          // keep cached data for 15 min
      refetchOnWindowFocus: true,       // catch changes made elsewhere while this tab was in the background
      refetchOnReconnect: true,         // catch up once connectivity comes back after being offline
      networkMode: 'offlineFirst',
    },
  },
});

function LayoutWrapper({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>
          {/* Public display screens — no auth, open on any machine */}
          <Route path="/customer-display" element={<CustomerDisplayPage />} />
          <Route path="/kitchen" element={<KitchenDisplayPage />} />
          <Route path="/queue" element={<QueueDisplayPage />} />
          <Route element={<ProtectedRoute />}>
            {/* Front of House / Back of House choice right after sign-in */}
            <Route path="/start" element={<StartPage />} />
            <Route path="/pos" element={<LayoutWrapper><ShopGuard shop="restaurant"><POSPage /></ShopGuard></LayoutWrapper>} />
            <Route path="/cashier" element={<LayoutWrapper><ShopGuard shop="supermarket"><CashierPage /></ShopGuard></LayoutWrapper>} />
            <Route element={<StaffOnlyRoute />}>
              <Route path="/ecocash" element={<LayoutWrapper><EcocashPage /></LayoutWrapper>} />
              <Route path="/shift-end" element={<LayoutWrapper><ShiftEndPage /></LayoutWrapper>} />
              <Route path="/" element={<RequirePermission perm="view_dashboard"><LayoutWrapper><DashboardPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/tables" element={<RequirePermission perm="create_sales"><LayoutWrapper><TablesPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/orders" element={<RequirePermission perm="view_sales"><LayoutWrapper><OrdersPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/sales" element={<RequirePermission perm="view_sales"><LayoutWrapper><SalesPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/refunds" element={<RequirePermission perm="process_refunds"><LayoutWrapper><RefundsPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/products" element={<RequirePermission perm="view_products"><LayoutWrapper><ProductsPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/ingredients" element={<RequirePermission perm="view_inventory"><LayoutWrapper><IngredientsPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/inventory" element={<RequirePermission perm="view_inventory"><LayoutWrapper><InventoryPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/purchases" element={<RequirePermission perm="view_purchase_orders"><LayoutWrapper><PurchasesPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/suppliers" element={<RequirePermission perm="view_suppliers"><LayoutWrapper><SuppliersPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/customers" element={<RequirePermission perm="view_customers"><LayoutWrapper><CustomersPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/expenses" element={<RequirePermission perm="view_expenses"><LayoutWrapper><ExpensesPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/reports" element={<RequirePermission perm="view_reports"><LayoutWrapper><ReportsPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/users" element={<RequirePermission perm="manage_users"><LayoutWrapper><UsersPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/settings" element={<RequirePermission perm="manage_settings"><LayoutWrapper><SettingsPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/currencies" element={<RequirePermission perm="manage_settings"><LayoutWrapper><CurrenciesPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/hardware" element={<RequirePermission perm="manage_settings"><LayoutWrapper><HardwarePage /></LayoutWrapper></RequirePermission>} />
              <Route path="/day-end" element={<RequirePermission perm="manage_day_end"><LayoutWrapper><DayEndPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/laybys" element={<RequirePermission perm="create_sales"><LayoutWrapper><LaybyPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/quotations" element={<RequirePermission perm="create_sales"><LayoutWrapper><QuotationsPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/stocktake" element={<RequirePermission perm="manage_stocktake"><LayoutWrapper><StocktakePage /></LayoutWrapper></RequirePermission>} />
              <Route path="/stock-transfers" element={<RequirePermission perm="view_inventory"><LayoutWrapper><StockTransferPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/attendance" element={<RequirePermission perm="view_reports"><LayoutWrapper><AttendancePage /></LayoutWrapper></RequirePermission>} />
              <Route path="/commissions" element={<RequirePermission perm="view_reports"><LayoutWrapper><CommissionsPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/audit-logs" element={<RequirePermission perm="manage_settings"><LayoutWrapper><AuditLogPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/roles-permissions" element={<RequirePermission perm="manage_settings"><LayoutWrapper><RolePermissionPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/webhooks" element={<RequirePermission perm="manage_settings"><LayoutWrapper><WebhooksPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/backups" element={<RequirePermission perm="manage_settings"><LayoutWrapper><BackupPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/cashflow" element={<RequirePermission perm="view_reports"><LayoutWrapper><CashflowPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/financial-report" element={<RequirePermission perm="view_financial_reports"><LayoutWrapper><FinancialReportPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/salaries" element={<RequirePermission perm="view_reports"><LayoutWrapper><SalariesPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/rentals" element={<RequirePermission perm="view_reports"><LayoutWrapper><RentalsPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/stock-reconciliation" element={<RequirePermission perm="view_inventory"><LayoutWrapper><StockReconciliationPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/stock-production" element={<RequirePermission perm="view_inventory"><LayoutWrapper><StockProductionPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/barcode-labels" element={<RequirePermission perm="view_products"><LayoutWrapper><BarcodeLabelsPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/license" element={<RequirePermission perm="manage_settings"><LayoutWrapper><LicensePage /></LayoutWrapper></RequirePermission>} />
              <Route path="/branches" element={<RequirePermission perm="manage_settings"><LayoutWrapper><BranchesPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/branch-comparison" element={<RequirePermission perm="manage_settings"><LayoutWrapper><BranchComparisonPage /></LayoutWrapper></RequirePermission>} />
            </Route>
          </Route>
        </Routes>
        </Suspense>
      </BrowserRouter>
      </ErrorBoundary>
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
    </QueryClientProvider>
  );
}
