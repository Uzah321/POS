import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { ProtectedRoute, GuestRoute, StaffOnlyRoute } from './components/auth/RouteGuards';
import RequirePermission from './components/auth/PermissionRoute';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import POSPage from './pages/POSPage';
import CashierPage from './pages/CashierPage';
import SalesPage from './pages/SalesPage';
import RefundsPage from './pages/RefundsPage';
import ProductsPage from './pages/ProductsPage';
import IngredientsPage from './pages/IngredientsPage';
import InventoryPage from './pages/InventoryPage';
import PurchasesPage from './pages/PurchasesPage';
import SuppliersPage from './pages/SuppliersPage';
import CustomersPage from './pages/CustomersPage';
import ExpensesPage from './pages/ExpensesPage';
import ReportsPage from './pages/ReportsPage';
import UsersPage from './pages/UsersPage';
import SettingsPage from './pages/SettingsPage';
import CurrenciesPage from './pages/CurrenciesPage';
import OrdersPage from './pages/OrdersPage';
import MySalesPage from './pages/MySalesPage';
import ShiftEndPage from './pages/ShiftEndPage';
import DayEndPage from './pages/DayEndPage';
import HardwarePage from './pages/HardwarePage';
import CustomerDisplayPage from './pages/CustomerDisplayPage';
import KitchenDisplayPage from './pages/KitchenDisplayPage';
import QueueDisplayPage from './pages/QueueDisplayPage';
import LaybyPage from './pages/LaybyPage';
import QuotationsPage from './pages/QuotationsPage';
import StocktakePage from './pages/StocktakePage';
import StockTransferPage from './pages/StockTransferPage';
import AttendancePage from './pages/AttendancePage';
import CommissionsPage from './pages/CommissionsPage';
import AuditLogPage from './pages/AuditLogPage';
import RolePermissionPage from './pages/RolePermissionPage';
import WebhooksPage from './pages/WebhooksPage';
import BackupPage from './pages/BackupPage';
import EcocashPage from './pages/EcocashPage';
import CashflowPage from './pages/CashflowPage';
import FinancialReportPage from './pages/FinancialReportPage';
import SalariesPage from './pages/SalariesPage';
import RentalsPage from './pages/RentalsPage';
import StockReconciliationPage from './pages/StockReconciliationPage';
import BranchesPage from './pages/BranchesPage';
import StockProductionPage from './pages/StockProductionPage';
import BarcodeLabelsPage from './pages/BarcodeLabelsPage';
import ErrorBoundary from './components/ErrorBoundary';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 0,
      staleTime: 5 * 60 * 1000,       // 5 min — avoid re-fetching on every navigation
      gcTime: 15 * 60 * 1000,          // keep cached data for 15 min
      refetchOnWindowFocus: false,      // don't refetch when user alt-tabs back
      refetchOnReconnect: false,        // not useful in a local POS context
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
        <Routes>
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>
          {/* Public display screens — no auth, open on any machine */}
          <Route path="/customer-display" element={<CustomerDisplayPage />} />
          <Route path="/kitchen" element={<KitchenDisplayPage />} />
          <Route path="/queue" element={<QueueDisplayPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/pos" element={<LayoutWrapper><POSPage /></LayoutWrapper>} />
            <Route path="/cashier" element={<LayoutWrapper><CashierPage /></LayoutWrapper>} />
            <Route element={<StaffOnlyRoute />}>
              <Route path="/my-sales" element={<LayoutWrapper><MySalesPage /></LayoutWrapper>} />
              <Route path="/ecocash" element={<LayoutWrapper><EcocashPage /></LayoutWrapper>} />
              <Route path="/shift-end" element={<LayoutWrapper><ShiftEndPage /></LayoutWrapper>} />
              <Route path="/" element={<RequirePermission perm="view_dashboard"><LayoutWrapper><DashboardPage /></LayoutWrapper></RequirePermission>} />
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
              <Route path="/day-end" element={<RequirePermission perm="view_reports"><LayoutWrapper><DayEndPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/laybys" element={<RequirePermission perm="create_sales"><LayoutWrapper><LaybyPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/quotations" element={<RequirePermission perm="create_sales"><LayoutWrapper><QuotationsPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/stocktake" element={<RequirePermission perm="view_inventory"><LayoutWrapper><StocktakePage /></LayoutWrapper></RequirePermission>} />
              <Route path="/stock-transfers" element={<RequirePermission perm="view_inventory"><LayoutWrapper><StockTransferPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/attendance" element={<RequirePermission perm="view_reports"><LayoutWrapper><AttendancePage /></LayoutWrapper></RequirePermission>} />
              <Route path="/commissions" element={<RequirePermission perm="view_reports"><LayoutWrapper><CommissionsPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/audit-logs" element={<RequirePermission perm="manage_settings"><LayoutWrapper><AuditLogPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/roles-permissions" element={<RequirePermission perm="manage_settings"><LayoutWrapper><RolePermissionPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/webhooks" element={<RequirePermission perm="manage_settings"><LayoutWrapper><WebhooksPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/backups" element={<RequirePermission perm="manage_settings"><LayoutWrapper><BackupPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/cashflow" element={<RequirePermission perm="view_reports"><LayoutWrapper><CashflowPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/financial-report" element={<RequirePermission perm="view_reports"><LayoutWrapper><FinancialReportPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/salaries" element={<RequirePermission perm="view_reports"><LayoutWrapper><SalariesPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/rentals" element={<RequirePermission perm="view_reports"><LayoutWrapper><RentalsPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/stock-reconciliation" element={<RequirePermission perm="view_inventory"><LayoutWrapper><StockReconciliationPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/stock-production" element={<RequirePermission perm="view_inventory"><LayoutWrapper><StockProductionPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/barcode-labels" element={<RequirePermission perm="view_products"><LayoutWrapper><BarcodeLabelsPage /></LayoutWrapper></RequirePermission>} />
              <Route path="/branches" element={<RequirePermission perm="manage_settings"><LayoutWrapper><BranchesPage /></LayoutWrapper></RequirePermission>} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
      </ErrorBoundary>
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
    </QueryClientProvider>
  );
}
