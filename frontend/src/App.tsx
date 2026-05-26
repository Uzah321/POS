import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { ProtectedRoute, GuestRoute, StaffOnlyRoute } from './components/auth/RouteGuards';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import POSPage from './pages/POSPage';
import SalesPage from './pages/SalesPage';
import ProductsPage from './pages/ProductsPage';
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

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
});

function LayoutWrapper({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route path="/pos" element={<LayoutWrapper><POSPage /></LayoutWrapper>} />
            <Route path="/my-sales" element={<LayoutWrapper><MySalesPage /></LayoutWrapper>} />
            <Route element={<StaffOnlyRoute />}>
              <Route path="/" element={<LayoutWrapper><DashboardPage /></LayoutWrapper>} />
              <Route path="/orders" element={<LayoutWrapper><OrdersPage /></LayoutWrapper>} />
              <Route path="/sales" element={<LayoutWrapper><SalesPage /></LayoutWrapper>} />
              <Route path="/products" element={<LayoutWrapper><ProductsPage /></LayoutWrapper>} />
              <Route path="/inventory" element={<LayoutWrapper><InventoryPage /></LayoutWrapper>} />
              <Route path="/purchases" element={<LayoutWrapper><PurchasesPage /></LayoutWrapper>} />
              <Route path="/suppliers" element={<LayoutWrapper><SuppliersPage /></LayoutWrapper>} />
              <Route path="/customers" element={<LayoutWrapper><CustomersPage /></LayoutWrapper>} />
              <Route path="/expenses" element={<LayoutWrapper><ExpensesPage /></LayoutWrapper>} />
              <Route path="/reports" element={<LayoutWrapper><ReportsPage /></LayoutWrapper>} />
              <Route path="/users" element={<LayoutWrapper><UsersPage /></LayoutWrapper>} />
              <Route path="/settings" element={<LayoutWrapper><SettingsPage /></LayoutWrapper>} />
              <Route path="/currencies" element={<LayoutWrapper><CurrenciesPage /></LayoutWrapper>} />
              <Route path="/day-end" element={<LayoutWrapper><DayEndPage /></LayoutWrapper>} />
            </Route>
            <Route path="/shift-end" element={<LayoutWrapper><ShiftEndPage /></LayoutWrapper>} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
    </QueryClientProvider>
  );
}
