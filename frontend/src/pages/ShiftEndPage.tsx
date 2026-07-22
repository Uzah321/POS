import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import api from '../lib/axios';
import toast from 'react-hot-toast';
import { offlineMutate } from '../lib/offlineMutation';
import { db } from '../lib/db';
import { useAuthStore } from '../stores/authStore';
import { useCurrencyStore } from '../stores/currencyStore';
import NumericKeypad from '../components/ui/NumericKeypad';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Download, Trash2, Pencil, Check, X, Loader2 } from 'lucide-react';

interface SaleSummaryItem {
  id: number;
  reference: string;
  completed_at: string;
  total: number;
  items_count: number;
  payments: { method: string; amount: number }[];
}

interface ShiftSummary {
  shift_start: string;
  total_sales: number;
  total_transactions: number;
  cash_sales: number;
  card_sales: number;
  mobile_money_sales: number;
  other_sales: number;
  expected_cash: number;
  sales: SaleSummaryItem[];
}

interface ShiftEndRecord {
  id: number;
  shift_end: string;
  shift_start: string;
  total_sales: number;
  total_transactions: number;
  declared_cash: number;
  expected_cash: number;
  variance: number;
  status: string;
  notes: string | null;
  user?: { name: string; username: string };
  branch?: { name: string };
}

interface FormData {
  declared_cash: string;
  notes: string;
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile_money: 'Mobile Money',
};

export default function ShiftEndPage() {
  const { hasRole, user } = useAuthStore();
  const { format, currencies } = useCurrencyStore();
  const qc = useQueryClient();
  const [submitted, setSubmitted] = useState(false);

  const isCashier = hasRole('cashier');
  const isManager = hasRole('admin') || hasRole('manager');

  // Inline edit state — used by both the manager's "All Records" table and the
  // cashier's own "My Previous Shifts" table, since a pending cash-up can be
  // corrected from either place (server enforces ownership either way).
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ declared_cash: string; notes: string }>({ declared_cash: '', notes: '' });

  // Per-currency cash declaration (one entry per active currency)
  const activeCurrencies = currencies.filter((c) => c.is_active);
  const [currencyCash, setCurrencyCash] = useState<Record<string, string>>({});

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    defaultValues: { declared_cash: '', notes: '' },
  });

  const declaredCashValue = parseFloat(watch('declared_cash') || '0') || 0;

  // Total declared cash converted to base currency from all currency entries
  const totalDeclaredFromCurrencies = activeCurrencies.reduce((sum, c) => {
    const amt = parseFloat(currencyCash[c.code] || '0') || 0;
    return sum + (c.exchange_rate > 0 ? amt / c.exchange_rate : amt);
  }, 0);

  // If per-currency entries exist, use their total; otherwise fall back to single field
  const effectiveDeclaredCash = activeCurrencies.length > 1
    ? totalDeclaredFromCurrencies
    : declaredCashValue;

  // Load shift summary (cashiers only)
  const { data: summary, isLoading: loadingSummary, refetch: refetchSummary } = useQuery({
    queryKey: ['shift-summary'],
    queryFn: async () => {
      try {
        return await api.get('/shift-end/summary').then(r => r.data.data as ShiftSummary);
      } catch {
        // API unavailable — compute shift summary from today's local IndexedDB sales
        const userId = user?.id ?? 0;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayStr = todayStart.toISOString();

        const todaySales = await db.sales
          .filter(s => s.cashier_id === userId && s.status === 'completed' && s.created_at >= todayStr)
          .toArray();

        const sumPayments = (method: string) =>
          todaySales.flatMap(s => s.payments ?? []).filter(p => p.method === method).reduce((sum, p) => sum + p.amount, 0);

        const cash_sales         = sumPayments('cash');
        const card_sales         = sumPayments('card');
        const mobile_money_sales = sumPayments('mobile_money');
        const other_sales = todaySales
          .flatMap(s => s.payments ?? [])
          .filter(p => !['cash', 'card', 'mobile_money'].includes(p.method))
          .reduce((sum, p) => sum + p.amount, 0);
        const total_sales = todaySales.reduce((sum, s) => sum + s.total, 0);

        const sorted = [...todaySales].sort((a, b) => a.created_at.localeCompare(b.created_at));

        return {
          shift_start: sorted.length > 0 ? sorted[0].created_at : new Date().toISOString(),
          total_sales,
          total_transactions: todaySales.length,
          cash_sales,
          card_sales,
          mobile_money_sales,
          other_sales,
          expected_cash: cash_sales,
          sales: todaySales
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map(s => ({
              id: Math.abs(s.id),
              reference: s.reference,
              completed_at: s.completed_at ?? s.created_at,
              total: s.total,
              items_count: s.items_count,
              payments: s.payments ?? [],
            })),
        } as ShiftSummary;
      }
    },
    enabled: isCashier,
    refetchInterval: 30000, // auto-refresh every 30s
  });

  // Load history
  const { data: historyData } = useQuery({
    queryKey: ['shift-history'],
    queryFn: () => api.get('/shift-end').then(r => r.data.data),
  });

  const history: ShiftEndRecord[] = Array.isArray(historyData)
    ? historyData
    : (historyData as any)?.data ?? [];

  const submitMutation = useMutation({
    mutationFn: (data: { declared_cash: number; notes: string }) => offlineMutate(() => api.post('/shift-end', data), 'shift_end', 'create', { _url: '/shift-end', _method: 'POST', ...data }),
    onSuccess: (result) => {
      if (result.offline) toast.success('Shift end saved offline - will sync when server is back');
      else { qc.invalidateQueries({ queryKey: ['shift-summary'] }); qc.invalidateQueries({ queryKey: ['shift-history'] }); qc.invalidateQueries({ queryKey: ['my-sales'] }); }
      setSubmitted(true);
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => offlineMutate(() => api.patch(`/shift-end/${id}/approve`), 'shift_end', 'approve', { _url: `/shift-end/${id}/approve`, _method: 'PATCH' }, id),
    onSuccess: (result) => {
      if (result.offline) toast.success('Approval saved offline - will sync when server is back');
      else { toast.success('Cash-up approved'); qc.invalidateQueries({ queryKey: ['shift-history'] }); }
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to approve'),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => api.patch(`/shift-end/${id}/reject`),
    onSuccess: () => { toast.success('Cash-up rejected'); qc.invalidateQueries({ queryKey: ['shift-history'] }); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to reject'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/shift-end/${id}`),
    onSuccess: () => { toast.success('Cash-up deleted'); qc.invalidateQueries({ queryKey: ['shift-history'] }); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to delete'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, declared_cash, notes }: { id: number; declared_cash: number; notes: string }) =>
      api.put(`/shift-end/${id}`, { declared_cash, notes }),
    onSuccess: () => {
      toast.success('Cash-up updated');
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['shift-history'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to update'),
  });

  const startEdit = (s: ShiftEndRecord) => {
    setEditingId(s.id);
    setEditForm({ declared_cash: String(s.declared_cash ?? 0), notes: s.notes ?? '' });
  };

  const onSubmit = (data: FormData) => {
    const finalDeclared = activeCurrencies.length > 1
      ? totalDeclaredFromCurrencies
      : parseFloat(data.declared_cash);
    submitMutation.mutate({
      declared_cash: finalDeclared,
      notes: data.notes,
    } as any);
  };

  const variance = summary ? effectiveDeclaredCash - summary.expected_cash : 0;

  const downloadCashupPdf = () => {
    if (!summary) return;
    const now = new Date();
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;
    let y = 40;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(30, 41, 59);
    doc.text('Cashup Report', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    y += 20;
    doc.text(`Cashier: ${user?.name ?? ''}`, margin, y);
    doc.text(`Generated: ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, pageWidth - margin, y, { align: 'right' });
    y += 14;
    doc.text(`Shift started: ${new Date(summary.shift_start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`, margin, y);
    y += 20;
    doc.setDrawColor(225, 228, 232);
    doc.line(margin, y, pageWidth - margin, y);
    y += 20;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Summary', 'Amount']],
      body: [
        ['Total Revenue', format(summary.total_sales ?? 0)],
        ['Transactions', String(summary.total_transactions ?? 0)],
        ['Cash Sales', format(summary.cash_sales ?? 0)],
        ['Card Sales', format(summary.card_sales ?? 0)],
        ['Mobile Money', format(summary.mobile_money_sales ?? 0)],
        ['Other Payments', format(summary.other_sales ?? 0)],
        ['Expected Cash in Drawer', format(summary.expected_cash ?? 0)],
        ['Declared Cash', format(effectiveDeclaredCash)],
        ['Variance', `${variance >= 0 ? '+' : ''}${format(variance)}`],
      ],
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    });
    y = (doc as any).lastAutoTable.finalY + 24;

    if (activeCurrencies.length > 1) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(30, 41, 59);
      doc.text('Declared Cash by Currency', margin, y);
      y += 10;
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Currency', 'Counted', '≈ Base currency']],
        body: activeCurrencies.map((cur) => {
          const amt = parseFloat(currencyCash[cur.code] || '0') || 0;
          return [`${cur.symbol} ${cur.code}`, amt.toFixed(2), format(cur.exchange_rate > 0 ? amt / cur.exchange_rate : amt)];
        }),
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 5 },
        headStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: 'bold' },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      });
      y = (doc as any).lastAutoTable.finalY + 24;
    }

    if (summary.sales && summary.sales.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(30, 41, 59);
      doc.text('Sales This Shift', margin, y);
      y += 10;
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin, bottom: 50 },
        head: [['Ref', 'Time', 'Items', 'Payment', 'Total']],
        body: summary.sales.map((s) => [
          s.reference,
          new Date(s.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          String(s.items_count),
          s.payments.map((p) => METHOD_LABEL[p.method] ?? p.method).join(', '),
          format(s.total),
        ]),
        theme: 'striped',
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 5 },
        headStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: 'bold' },
        columnStyles: { 4: { halign: 'right' } },
        didDrawPage: () => {
          const pageHeight = doc.internal.pageSize.getHeight();
          doc.setFontSize(8);
          doc.setTextColor(148, 163, 184);
          doc.text(`Page ${doc.getCurrentPageInfo().pageNumber} of ${doc.getNumberOfPages()}`, pageWidth - margin, pageHeight - 20, { align: 'right' });
        },
      });
    }

    doc.save(`cashup-${(user?.name ?? 'shift').replace(/\s+/g, '-').toLowerCase()}-${now.toISOString().slice(0, 10)}.pdf`);
    toast.success('Cashup report downloaded');
  };

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending:  'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  // --- Success screen ---â€â€â€â€â€â€
  if (isCashier && submitted) {
    return (
      <div className="p-6 max-w-lg mx-auto mt-20 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Shift Closed!</h2>
        <p className="text-gray-500 text-sm mb-6">Your shift has been submitted and is awaiting manager approval.</p>
        <button
          onClick={() => { setSubmitted(false); refetchSummary(); }}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-6 py-2 rounded-lg"
        >
          Start New Shift
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shift End</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {isCashier
              ? `Close your shift and declare your cash " ${user?.name ?? ''}`
              : 'Manage and approve cashier shift closures'}
          </p>
        </div>
        {isCashier && summary && (
          <div className="flex items-center gap-3">
            <button
              onClick={downloadCashupPdf}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md border border-blue-200 transition-colors"
              title="Download this shift's cashup report as a PDF"
            >
              <Download size={13} /> Download PDF
            </button>
            <button
              onClick={() => refetchSummary()}
              className="text-xs text-blue-600 hover:underline"
            >
              Refresh
            </button>
          </div>
        )}
      </div>

      {/* --- CASHIER VIEW --- */}
      {isCashier && (
        <>
          {/* Top stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {loadingSummary
              ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="bg-gray-100 rounded-md h-20 animate-pulse" />)
              : [
                  ['Total Revenue', format(summary?.total_sales ?? 0), 'text-blue-700', 'bg-blue-50 border-blue-100'],
                  ['Transactions',  String(summary?.total_transactions ?? 0), 'text-gray-900', 'bg-white border-gray-200'],
                  ['Cash in Drawer',format(summary?.expected_cash ?? 0), 'text-green-700', 'bg-green-50 border-green-100'],
                  ['Shift Started', summary?.shift_start ? new Date(summary.shift_start).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '"', 'text-gray-600', 'bg-white border-gray-200'],
                ].map(([label, value, textCls, bgCls]) => (
                  <div key={label} className={`rounded-md border p-4 ${bgCls}`}>
                    <p className="text-xs text-gray-500 mb-1">{label}</p>
                    <p className={`text-lg font-bold ${textCls}`}>{value}</p>
                  </div>
                ))}
          </div>

          {/* Payment breakdown */}
          {summary && (
            <div className="bg-white rounded-md border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Payment Breakdown</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  ['Cash',         summary.cash_sales,         'bg-emerald-50 text-emerald-700'],
                  ['Card',         summary.card_sales,         'bg-blue-50 text-blue-700'],
                  ['Mobile Money', summary.mobile_money_sales, 'bg-purple-50 text-purple-700'],
                  ['Other',        summary.other_sales,        'bg-gray-50 text-gray-700'],
                ].map(([label, amount, cls]) => (
                  <div key={label as string} className={`rounded-lg p-3 ${cls}`}>
                    <p className="text-xs font-medium opacity-70">{label as string}</p>
                    <p className="text-base font-bold mt-0.5">{format(amount as number)}</p>
                  </div>
                ))}
              </div>

              {/* Per-currency equivalent breakdown */}
              {activeCurrencies.length > 1 && (
                <div className="mt-4 border-t border-gray-100 pt-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Cash equivalents per currency</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {activeCurrencies.map((cur) => (
                      <div key={cur.code} className="bg-gray-50 rounded-lg p-2.5 border border-gray-100">
                        <p className="text-xs text-gray-500 font-medium">{cur.symbol} {cur.code}</p>
                        <p className="text-sm font-bold text-gray-800 mt-0.5">
                          {cur.symbol}{(summary.cash_sales * cur.exchange_rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sales list */}
          {summary?.sales && summary.sales.length > 0 && (
            <div className="bg-white rounded-md border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-800 text-sm">
                  Sales This Shift
                  <span className="ml-2 bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full font-normal">{summary.sales.length}</span>
                </h2>
              </div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left">Ref</th>
                      <th className="px-4 py-2 text-left">Time</th>
                      <th className="px-4 py-2 text-right">Items</th>
                      <th className="px-4 py-2 text-left">Payment</th>
                      <th className="px-4 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {summary.sales.map((sale) => (
                      <tr key={sale.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{sale.reference}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">
                          {new Date(sale.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{sale.items_count}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {sale.payments.map((p, i) => (
                              <span key={i} className="text-xs bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                                {METHOD_LABEL[p.method] ?? p.method}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-900">{format(sale.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-200">
                    <tr>
                      <td colSpan={4} className="px-4 py-2.5 font-semibold text-gray-700 text-right">Total</td>
                      <td className="px-4 py-2.5 text-right font-bold text-gray-900">{format(summary.total_sales)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {summary?.sales?.length === 0 && (
            <div className="bg-white rounded-md border border-gray-200 p-10 text-center text-gray-400">
              No sales recorded for this shift yet.
            </div>
          )}

          {/* Declare cash & close shift */}
          <div className="bg-white rounded-md border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-800 mb-1">Close Shift</h2>
            <p className="text-sm text-gray-500 mb-4">Count the cash in your drawer and enter the amount below.</p>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

              {/* Expected cash */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expected Cash in Drawer</label>
                <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm font-semibold text-green-700">
                  {format(summary?.expected_cash ?? 0)}
                </div>
              </div>

              {/* Per-currency cash declaration */}
              {activeCurrencies.length > 1 ? (
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-gray-700">Actual Cash by Currency <span className="text-red-500">*</span></label>
                  <div className="space-y-4">
                    {activeCurrencies.map((cur) => (
                      <div key={cur.code} className="border border-gray-200 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-bold text-gray-700">{cur.symbol} {cur.code}</span>
                          {cur.exchange_rate !== 1 && (
                            <span className="text-xs text-gray-400">
                              ≈ {format((parseFloat(currencyCash[cur.code] || '0') || 0) / cur.exchange_rate)} base
                            </span>
                          )}
                        </div>
                        <NumericKeypad
                          value={currencyCash[cur.code] ?? ''}
                          onChange={(v) => setCurrencyCash((prev) => ({ ...prev, [cur.code]: v }))}
                          label={`${cur.symbol} ${cur.code} cash in drawer`}
                          confirmLabel="✓ Set"
                          confirmCls="bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
                        />
                      </div>
                    ))}
                  </div>
                  {totalDeclaredFromCurrencies > 0 && (
                    <div className="flex justify-between text-sm font-semibold text-gray-700 border-t border-gray-200 pt-2">
                      <span>Total (base currency)</span>
                      <span className="text-blue-700">{format(totalDeclaredFromCurrencies)}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Actual Cash in Drawer <span className="text-red-500">*</span>
                  </label>
                  <NumericKeypad
                    value={watch('declared_cash') ?? ''}
                    onChange={(v) => {
                      // react-hook-form field sync
                      const event = { target: { value: v } } as React.ChangeEvent<HTMLInputElement>;
                      register('declared_cash').onChange(event);
                    }}
                    label="Cash in drawer"
                    confirmLabel="✓ Set Amount"
                    confirmCls="bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
                  />
                  {errors.declared_cash && (
                    <p className="text-red-500 text-xs mt-1">{errors.declared_cash.message}</p>
                  )}
                </div>
              )}

              {/* Live variance */}
              {(activeCurrencies.length > 1 ? totalDeclaredFromCurrencies > 0 : watch('declared_cash') !== '') && (
                <div className={`flex items-center justify-between rounded-lg px-4 py-3 text-sm font-medium ${
                  variance === 0 ? 'bg-gray-50 text-gray-700'
                  : variance > 0 ? 'bg-green-50 text-green-700'
                  : 'bg-red-50 text-red-700'
                }`}>
                  <span>Cash Variance</span>
                  <span>{variance >= 0 ? '+' : ''}{format(variance)}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea
                  {...register('notes')}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
                  placeholder="Any remarks about discrepancies..."
                />
              </div>

              {submitMutation.isError && (
                <p className="text-red-500 text-sm">
                  {(submitMutation.error as any)?.response?.data?.message ?? 'Failed to submit. Please try again.'}
                </p>
              )}

              <button
                type="submit"
                disabled={submitMutation.isPending}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
              >
                {submitMutation.isPending ? 'Closing Shift...' : 'Close Shift & Submit'}
              </button>
            </form>
          </div>

          {/* Cashier's own past shifts */}
          {history.length > 0 && (
            <div className="bg-white rounded-md border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-700 text-sm">My Previous Shifts</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-right">Sales</th>
                      <th className="px-4 py-2 text-right">Transactions</th>
                      <th className="px-4 py-2 text-right">Expected</th>
                      <th className="px-4 py-2 text-right">Declared</th>
                      <th className="px-4 py-2 text-right">Variance</th>
                      <th className="px-4 py-2 text-center">Status</th>
                      <th className="px-4 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {history.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-700">{new Date(s.shift_end).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td className="px-4 py-2.5 text-right">{format(s.total_sales)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-500">{s.total_transactions}</td>
                        <td className="px-4 py-2.5 text-right">{format(s.expected_cash)}</td>
                        <td className="px-4 py-2.5 text-right">
                          {editingId === s.id ? (
                            <input
                              type="number" step="0.01" min="0" autoFocus
                              value={editForm.declared_cash}
                              onChange={(e) => setEditForm((f) => ({ ...f, declared_cash: e.target.value }))}
                              className="w-24 border border-blue-300 rounded-md px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          ) : format(s.declared_cash)}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-medium ${s.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {s.variance >= 0 ? '+' : ''}{format(s.variance)}
                        </td>
                        <td className="px-4 py-2.5 text-center">{statusBadge(s.status)}</td>
                        <td className="px-4 py-2.5 text-center">
                          {editingId === s.id ? (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => updateMutation.mutate({ id: s.id, declared_cash: parseFloat(editForm.declared_cash) || 0, notes: editForm.notes })}
                                disabled={updateMutation.isPending}
                                title="Save"
                                className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg disabled:opacity-50"
                              >
                                {updateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                              </button>
                              <button onClick={() => setEditingId(null)} title="Cancel" className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
                                <X size={14} />
                              </button>
                            </div>
                          ) : s.status === 'pending' ? (
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => startEdit(s)} title="Edit" className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => { if (window.confirm('Delete this cash-up? You can close the shift again afterward.')) deleteMutation.mutate(s.id); }}
                                disabled={deleteMutation.isPending}
                                title="Delete"
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-gray-300 text-xs">"</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* --- MANAGER VIEW --- */}
      {isManager && (
        <div className="bg-white rounded-md border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">All Shift End Records</h2>
            <span className="text-xs text-gray-400">{history.length} record{history.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Cashier</th>
                  <th className="px-4 py-3 text-left">Shift End</th>
                  <th className="px-4 py-3 text-right">Sales</th>
                  <th className="px-4 py-3 text-right">Txns</th>
                  <th className="px-4 py-3 text-right">Expected</th>
                  <th className="px-4 py-3 text-right">Declared</th>
                  <th className="px-4 py-3 text-right">Variance</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-gray-400">No shift end records yet.</td>
                  </tr>
                ) : (
                  history.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{s.user?.name ?? '"'}</p>
                        <p className="text-xs text-gray-400">@{s.user?.username}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{new Date(s.shift_end).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td className="px-4 py-3 text-right">{format(s.total_sales)}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{s.total_transactions}</td>
                      <td className="px-4 py-3 text-right">{format(s.expected_cash)}</td>
                      <td className="px-4 py-3 text-right">
                        {editingId === s.id ? (
                          <input
                            type="number" step="0.01" min="0" autoFocus
                            value={editForm.declared_cash}
                            onChange={(e) => setEditForm((f) => ({ ...f, declared_cash: e.target.value }))}
                            className="w-24 border border-blue-300 rounded-md px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : format(s.declared_cash)}
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold ${s.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {s.variance >= 0 ? '+' : ''}{format(s.variance)}
                      </td>
                      <td className="px-4 py-3 text-center">{statusBadge(s.status)}</td>
                      <td className="px-4 py-3 text-center">
                        {editingId === s.id ? (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => updateMutation.mutate({ id: s.id, declared_cash: parseFloat(editForm.declared_cash) || 0, notes: editForm.notes })}
                              disabled={updateMutation.isPending}
                              title="Save"
                              className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg disabled:opacity-50"
                            >
                              {updateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                            </button>
                            <button onClick={() => setEditingId(null)} title="Cancel" className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            {s.status === 'pending' && (
                              <>
                                <button
                                  onClick={() => approveMutation.mutate(s.id)}
                                  disabled={approveMutation.isPending}
                                  className="text-xs bg-green-600 hover:bg-green-700 text-white px-2.5 py-1 rounded-lg disabled:opacity-50"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => rejectMutation.mutate(s.id)}
                                  disabled={rejectMutation.isPending}
                                  className="text-xs bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-2.5 py-1 rounded-lg disabled:opacity-50"
                                >
                                  Reject
                                </button>
                                <button onClick={() => startEdit(s)} title="Edit" className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                                  <Pencil size={13} />
                                </button>
                              </>
                            )}
                            {s.status !== 'approved' && (
                              <button
                                onClick={() => { if (window.confirm('Delete this cash-up record?')) deleteMutation.mutate(s.id); }}
                                disabled={deleteMutation.isPending}
                                title="Delete"
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                            {s.status === 'approved' && <span className="text-gray-300 text-xs">"</span>}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
