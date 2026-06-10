import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { salesApi, settingsApi, branchesApi } from '../api';
import { Search, Eye, Loader2, Printer, Receipt } from 'lucide-react';
import Pagination from '../components/ui/Pagination';
import { useCurrencyStore } from '../stores/currencyStore';
import { useHardwareStore } from '../stores/hardwareStore';
import { buildReceiptDataFromSale, printReceipt, resolveReceiptPrintMode } from '../lib/hardware/printer';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  voided: 'bg-red-100 text-red-700',
  refunded: 'bg-blue-100 text-blue-700',
  partially_refunded: 'bg-purple-100 text-purple-700',
};

export default function SalesPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [branchId, setBranchId] = useState('');
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const hw = useHardwareStore();
  const { activeCurrency } = useCurrencyStore();
  const currency = activeCurrency?.symbol ?? '$';

  const { data: storeSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get().then(r => r.data?.data || {}),
    staleTime: 5 * 60 * 1000,
  });

  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.list().then(r => r.data?.data || []),
    staleTime: 120000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['sales', search, page, branchId],
    queryFn: () => salesApi.list({ search, page, per_page: 20, ...(branchId ? { branch_id: Number(branchId) } : {}) }).then(r => r.data?.data),
  });

  const { data: saleDetail } = useQuery({
    queryKey: ['sale', selectedSale?.id],
    queryFn: () => salesApi.get(selectedSale.id).then(r => r.data?.data),
    enabled: !!selectedSale?.id,
  });

  const reprintMutation = useMutation({
    mutationFn: async (saleId: number) => {
      const sale = (await salesApi.receipt(saleId)).data?.data;
      await printReceipt(
        buildReceiptDataFromSale(sale, {
          currency,
          storeName: storeSettings?.company_name,
          storeAddress: storeSettings?.company_address,
          storePhone: storeSettings?.company_phone,
        }),
        resolveReceiptPrintMode(hw.printerMode)
      );
      return sale;
    },
    onSuccess: (sale) => {
      toast.success(`Receipt ${sale?.reference ?? ''} sent to printer`);
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message ?? error?.message ?? 'Could not reprint receipt');
    },
  });

  const sales = data?.data || [];
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales History</h1>
          <p className="text-gray-500 text-sm">View and manage all transactions</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by reference..."
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 w-64"
            />
          </div>
          <select
            value={branchId}
            onChange={(e) => { setBranchId(e.target.value); setPage(1); }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <option value="">All Branches</option>
            {(branchData as any[] || []).map((b: any) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-amber-500" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  {['Reference', 'Date', 'Customer', 'Cashier', 'Items', 'Total', 'Status', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sales.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-12 text-gray-400"><Receipt size={32} className="mx-auto mb-2" /><p>No sales found</p></td></tr>
                ) : sales.map((s: any) => (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-mono font-medium text-gray-900">{s.reference}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{format(new Date(s.created_at), 'dd MMM yyyy HH:mm')}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.customer?.name || 'Walk-in'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.cashier?.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.items_count || s.items?.length || '—'}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-amber-600">R {parseFloat(s.total).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[s.status] || 'bg-gray-100 text-gray-600'}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => reprintMutation.mutate(s.id)}
                          disabled={reprintMutation.isPending && reprintMutation.variables === s.id}
                          className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg disabled:opacity-50"
                          title="Reprint receipt"
                        >
                          {reprintMutation.isPending && reprintMutation.variables === s.id ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                        </button>
                        <button type="button" onClick={() => setSelectedSale(s)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Eye size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} lastPage={meta?.last_page ?? 1} from={meta?.from} to={meta?.to} total={meta?.total} onPageChange={setPage} />
      </div>

      {/* Sale Detail Modal */}
      {selectedSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold">Sale Detail — {selectedSale.reference}</h2>
              <button type="button" onClick={() => setSelectedSale(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-6 space-y-4">
              {saleDetail ? (
                <>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><span className="text-gray-500">Date:</span> <span className="font-medium">{format(new Date(saleDetail.created_at), 'dd MMM yyyy HH:mm')}</span></div>
                    <div><span className="text-gray-500">Status:</span> <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[saleDetail.status]}`}>{saleDetail.status}</span></div>
                    <div><span className="text-gray-500">Customer:</span> <span className="font-medium">{saleDetail.customer?.name || 'Walk-in'}</span></div>
                    <div><span className="text-gray-500">Cashier:</span> <span className="font-medium">{saleDetail.cashier?.name}</span></div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-700 mb-2">Items</h3>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50"><tr><th className="px-3 py-2 text-left text-xs text-gray-500">Product</th><th className="px-3 py-2 text-right text-xs text-gray-500">Qty</th><th className="px-3 py-2 text-right text-xs text-gray-500">Price</th><th className="px-3 py-2 text-right text-xs text-gray-500">Total</th></tr></thead>
                        <tbody className="divide-y divide-gray-100">
                          {saleDetail.items?.map((item: any) => (
                            <tr key={item.id}><td className="px-3 py-2">{item.product?.name}</td><td className="px-3 py-2 text-right">{item.quantity}</td><td className="px-3 py-2 text-right">R {parseFloat(item.unit_price).toFixed(2)}</td><td className="px-3 py-2 text-right font-medium">R {parseFloat(item.total).toFixed(2)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>R {parseFloat(saleDetail.subtotal).toFixed(2)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Tax</span><span>R {parseFloat(saleDetail.tax_total).toFixed(2)}</span></div>
                    <div className="flex justify-between text-base font-bold border-t pt-2"><span>Total</span><span className="text-amber-600">R {parseFloat(saleDetail.total).toFixed(2)}</span></div>
                  </div>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => reprintMutation.mutate(selectedSale.id)}
                      disabled={reprintMutation.isPending && reprintMutation.variables === selectedSale.id}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50"
                    >
                      {reprintMutation.isPending && reprintMutation.variables === selectedSale.id ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                      Reprint Bill
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-amber-500" /></div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
