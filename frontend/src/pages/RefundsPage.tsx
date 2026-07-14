import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { refundsApi } from '../api';
import { Undo2, Loader2, Eye, X } from 'lucide-react';
import Pagination from '../components/ui/Pagination';
import { useCurrencyStore } from '../stores/currencyStore';
import { format } from 'date-fns';

export default function RefundsPage() {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<any>(null);
  const { format: formatAmount } = useCurrencyStore();

  const { data, isLoading } = useQuery({
    queryKey: ['refunds-list', page],
    queryFn: () => refundsApi.list({ page, per_page: 20 }).then((r) => r.data?.data),
  });

  const refunds: any[] = data?.data ?? [];
  const meta = data?.meta;

  const { data: detail } = useQuery({
    queryKey: ['refund', selected?.id],
    queryFn: () => refundsApi.get(selected.id).then((r) => r.data?.data),
    enabled: !!selected?.id,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Refunds</h1>
        <p className="text-gray-500 text-sm">Review every refund processed across the store</p>
      </div>

      <div className="bg-white rounded-md shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-amber-500" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  {['Reference', 'Sale', 'Date', 'Processed By', 'Reason', 'Amount', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {refunds.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-12 text-gray-400"><Undo2 size={32} className="mx-auto mb-2" /><p>No refunds recorded</p></td></tr>
                ) : refunds.map((r: any) => (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-mono font-medium text-gray-900">{r.reference}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{r.sale?.reference ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{format(new Date(r.created_at), 'dd MMM yyyy HH:mm')}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{r.user?.name ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">{r.reason || '-'}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-red-600">-{formatAmount(parseFloat(r.amount))}</td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => setSelected(r)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Eye size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} lastPage={meta?.last_page ?? 1} from={meta?.from} to={meta?.to} total={meta?.total} onPageChange={setPage} />
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-lg w-full max-w-lg shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold">Refund {selected.reference}</h2>
              <button type="button" onClick={() => setSelected(null)}><X size={20} className="text-gray-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">Sale:</span> <span className="font-medium">{selected.sale?.reference ?? '-'}</span></div>
                <div><span className="text-gray-500">Processed by:</span> <span className="font-medium">{selected.user?.name ?? '-'}</span></div>
                <div><span className="text-gray-500">Date:</span> <span className="font-medium">{format(new Date(selected.created_at), 'dd MMM yyyy HH:mm')}</span></div>
                <div><span className="text-gray-500">Amount:</span> <span className="font-medium text-red-600">-{formatAmount(parseFloat(selected.amount))}</span></div>
              </div>
              {selected.reason && (
                <div className="text-sm"><span className="text-gray-500">Reason:</span> <p className="mt-1">{selected.reason}</p></div>
              )}
              {!detail ? (
                <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-amber-500" /></div>
              ) : detail.items && detail.items.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-700 mb-2 text-sm">Items Refunded</h3>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50"><tr>
                        <th className="px-3 py-2 text-left text-xs text-gray-500">Product</th>
                        <th className="px-3 py-2 text-right text-xs text-gray-500">Qty</th>
                        <th className="px-3 py-2 text-right text-xs text-gray-500">Amount</th>
                        <th className="px-3 py-2 text-center text-xs text-gray-500">Restocked</th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {detail.items.map((it: any) => (
                          <tr key={it.id}>
                            <td className="px-3 py-2">{it.sale_item?.product?.name ?? '-'}</td>
                            <td className="px-3 py-2 text-right">{it.quantity}</td>
                            <td className="px-3 py-2 text-right">{formatAmount(parseFloat(it.amount))}</td>
                            <td className="px-3 py-2 text-center">{it.restock ? 'Yes' : 'No'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
