import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { salesApi, settingsApi, branchesApi, refundsApi } from '../api';
import RowActionsMenu from '../components/ui/RowActionsMenu';
import { Search, Eye, Loader2, Printer, Receipt, Undo2, X, Calendar, Download, FileText, FileSpreadsheet } from 'lucide-react';
import Pagination from '../components/ui/Pagination';
import { useCurrencyStore } from '../stores/currencyStore';
import { useHardwareStore } from '../stores/hardwareStore';
import { useAuthStore } from '../stores/authStore';
import { buildReceiptDataFromSale, printReceipt, resolveReceiptPrintMode } from '../lib/hardware/printer';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { exportToExcel } from '../utils/excel';

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  voided: 'bg-red-100 text-red-700',
  refunded: 'bg-blue-100 text-blue-700',
  partially_refunded: 'bg-purple-100 text-purple-700',
};

function RefundModal({ sale, onClose, formatAmount }: { sale: any; onClose: () => void; formatAmount: (v: number) => string }) {
  const qc = useQueryClient();
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState('');

  const { data: priorRefunds = [] } = useQuery({
    queryKey: ['refunds', sale.id],
    queryFn: () => refundsApi.list({ sale_id: sale.id }).then((r) => r.data?.data?.data ?? r.data?.data ?? []),
  });

  const items: any[] = sale.items ?? [];
  const alreadyRefundedBySaleItem: Record<number, number> = {};
  for (const refund of priorRefunds as any[]) {
    for (const ri of refund.items ?? []) {
      alreadyRefundedBySaleItem[ri.sale_item_id] = (alreadyRefundedBySaleItem[ri.sale_item_id] ?? 0) + parseFloat(ri.quantity);
    }
  }
  const refundableFor = (item: any) => Math.max(0, parseFloat(item.quantity) - (alreadyRefundedBySaleItem[item.id] ?? 0));

  const refundMutation = useMutation({
    mutationFn: () => {
      const selected = items
        .map((item) => ({ sale_item_id: item.id, quantity: parseFloat(qtys[item.id] || '0'), restock }))
        .filter((i) => i.quantity > 0);
      return refundsApi.create({ sale_id: sale.id, reason: reason || undefined, items: selected });
    },
    onSuccess: () => {
      toast.success('Refund processed');
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['sale', sale.id] });
      // A restocked refund puts stock back — refresh every view that shows a
      // quantity, not just this sale's own record.
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-low-count'] });
      qc.invalidateQueries({ queryKey: ['inventory-out-count'] });
      qc.invalidateQueries({ queryKey: ['pos-products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Refund failed — check the local server is reachable'),
  });

  const totalRefund = items.reduce((s, item) => {
    const q = parseFloat(qtys[item.id] || '0');
    return s + (q > 0 ? (parseFloat(item.total) / parseFloat(item.quantity)) * q : 0);
  }, 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-lg w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
          <h2 className="text-lg font-bold flex items-center gap-2"><Undo2 size={18} className="text-red-500" /> Refund — {sale.reference}</h2>
          <button type="button" onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead className="bg-gray-50"><tr>
                <th className="px-3 py-2 text-left text-xs text-gray-500">Product</th>
                <th className="px-3 py-2 text-right text-xs text-gray-500">Sold</th>
                <th className="px-3 py-2 text-right text-xs text-gray-500">Refundable</th>
                <th className="px-3 py-2 text-right text-xs text-gray-500 w-24">Refund Qty</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => {
                  const max = refundableFor(item);
                  return (
                    <tr key={item.id} className={max === 0 ? 'opacity-40' : ''}>
                      <td className="px-3 py-2">{item.product?.name}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{item.quantity}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{max}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          max={max}
                          step="0.001"
                          disabled={max === 0}
                          value={qtys[item.id] ?? ''}
                          onChange={(e) => setQtys((q) => ({ ...q, [item.id]: e.target.value }))}
                          className="w-20 text-right border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 disabled:bg-gray-50"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="w-4 h-4 accent-red-600" />
            <span className="text-sm text-gray-700">Return items to stock</span>
          </label>
          <div>
            <label className="text-sm font-medium text-gray-700">Reason (optional)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none" />
          </div>
          <div className="flex justify-between text-base font-bold border-t pt-3">
            <span>Refund Total</span><span className="text-red-600">{formatAmount(totalRefund)}</span>
          </div>
        </div>
        <div className="p-6 border-t flex-shrink-0">
          <button
            type="button"
            onClick={() => refundMutation.mutate()}
            disabled={refundMutation.isPending || totalRefund <= 0}
            className="w-full flex items-center justify-center gap-2 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg text-sm disabled:opacity-50"
          >
            {refundMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Undo2 size={16} />}
            Process Refund
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SalesPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [branchId, setBranchId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [refundSale, setRefundSale] = useState<any>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const { hasPermission, hasRole } = useAuthStore();
  const canRefund = hasPermission('process_refunds') || hasRole('admin');
  const hw = useHardwareStore();
  const { activeCurrency, format: formatAmount } = useCurrencyStore();
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

  // Shared by the paginated list query and the "export everything currently
  // filtered" actions below, so the two never drift apart.
  const salesFilterParams = (extra: Record<string, unknown> = {}) => ({
    search,
    ...(branchId ? { branch_id: Number(branchId) } : {}),
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
    ...extra,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['sales', search, page, branchId, dateFrom, dateTo],
    queryFn: () => salesApi.list(salesFilterParams({ page, per_page: 20 })).then(r => r.data?.data),
  });

  // Close the row's "..." actions menu, or the export menu, on an outside click.
  useEffect(() => {
    if (openMenuId === null && !showExportMenu) return;
    const onClickOutside = (e: MouseEvent) => {
      if (openMenuId !== null && menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenuId(null);
      if (showExportMenu && exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setShowExportMenu(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [openMenuId, showExportMenu]);

  const branchName = branchId ? (branchData as any[] || []).find((b: any) => String(b.id) === branchId)?.name : null;
  const dateRangeLabel = dateFrom || dateTo ? `${dateFrom || 'earliest'} to ${dateTo || 'today'}` : 'All dates';

  // Pulls every sale matching the current filters (not just the visible page)
  // so an export reflects what the user has filtered for, not one page of it.
  const fetchAllFilteredSales = async (): Promise<any[]> => {
    const res = await salesApi.list(salesFilterParams({ page: 1, per_page: 5000 })).then(r => r.data?.data);
    return res?.data || [];
  };

  const saleExportRow = (s: any) => {
    const items: any[] = s.items || [];
    const itemNames = items.map((it: any) => it.product?.name).filter(Boolean).join(', ') || `${s.items_count || items.length || 0} items`;
    return [
      s.reference,
      format(new Date(s.created_at), 'dd MMM yyyy HH:mm'),
      itemNames,
      s.customer?.name || 'Walk-in',
      s.cashier?.name || '',
      formatAmount(parseFloat(s.total)),
      s.status,
    ];
  };

  const handleExportExcel = async () => {
    setShowExportMenu(false);
    setExporting(true);
    try {
      const sales = await fetchAllFilteredSales();
      exportToExcel(
        [['Reference', 'Date', 'Items', 'Customer', 'Cashier', 'Total', 'Status'], ...sales.map(saleExportRow)],
        `sales-history-${format(new Date(), 'yyyy-MM-dd')}`
      );
      toast.success(`Exported ${sales.length} sale${sales.length !== 1 ? 's' : ''}`);
    } catch {
      toast.error('Could not export sales — check the local server is reachable');
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setShowExportMenu(false);
    setExporting(true);
    try {
      const sales = await fetchAllFilteredSales();
      const companyName = storeSettings?.company_name || 'Core POS';
      const generatedAt = new Date();

      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 40;

      autoTable(doc, {
        head: [['Reference', 'Date', 'Items', 'Customer', 'Cashier', 'Total', 'Status']],
        body: sales.map(saleExportRow),
        startY: 90,
        margin: { left: margin, right: margin, bottom: 50 },
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 6, lineColor: [225, 228, 232], lineWidth: 0.5 },
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', halign: 'left' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 90, font: 'courier', fontSize: 8 },
          5: { cellWidth: 90, halign: 'right', fontStyle: 'bold' },
          6: { cellWidth: 80 },
        },
        didDrawPage: () => {
          doc.setFillColor(30, 41, 59);
          doc.rect(0, 0, pageWidth, 70, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(18);
          doc.text(companyName, margin, 32);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          doc.setTextColor(203, 213, 225);
          doc.text(`Sales History Report  ·  ${dateRangeLabel}${branchName ? `  ·  ${branchName}` : ''}`, margin, 50);

          doc.setFontSize(9);
          doc.text(`Generated: ${generatedAt.toLocaleDateString()} ${generatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, pageWidth - margin, 32, { align: 'right' });
          doc.text(`${sales.length} sale${sales.length !== 1 ? 's' : ''}`, pageWidth - margin, 46, { align: 'right' });

          const pageCount = doc.getNumberOfPages();
          const pageHeight = doc.internal.pageSize.getHeight();
          doc.setDrawColor(225, 228, 232);
          doc.line(margin, pageHeight - 40, pageWidth - margin, pageHeight - 40);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(148, 163, 184);
          doc.text(`Page ${doc.getCurrentPageInfo().pageNumber} of ${pageCount}`, pageWidth - margin, pageHeight - 24, { align: 'right' });
          doc.text('Generated by Core POS', margin, pageHeight - 24);
        },
      });

      doc.save(`sales-history-${format(generatedAt, 'yyyy-MM-dd')}.pdf`);
      toast.success(`Exported ${sales.length} sale${sales.length !== 1 ? 's' : ''}`);
    } catch {
      toast.error('Could not export sales — check the local server is reachable');
    } finally {
      setExporting(false);
    }
  };

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
          currencyCode: activeCurrency?.code ?? 'USD',
          currencyRate: activeCurrency?.exchange_rate ?? 1,
          storeName: storeSettings?.company_name,
          storeAddress: storeSettings?.company_address,
          storePhone: storeSettings?.company_phone,
          vatNumber: storeSettings?.company_vat_number,
          tinNumber: storeSettings?.company_tin_number,
          deviceId: storeSettings?.fiscal_device_id || undefined,
          fiscalDay: storeSettings?.fiscal_day || undefined,
          recGn: storeSettings?.fiscal_rec_gn || undefined,
          rec68: storeSettings?.fiscal_rec_68 || undefined,
        }),
        resolveReceiptPrintMode(hw.printerMode),
        hw.printerName
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
        <div className="relative" ref={exportMenuRef}>
          <button
            type="button"
            onClick={() => setShowExportMenu((v) => !v)}
            disabled={exporting}
            className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white font-semibold px-4 py-2.5 rounded-md text-sm disabled:opacity-60"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Export
          </button>
          {showExportMenu && (
            <div className="absolute z-20 right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
              <button
                type="button"
                onClick={handleExportPdf}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <FileText size={14} className="text-gray-400" /> Download as PDF
              </button>
              <button
                type="button"
                onClick={handleExportExcel}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <FileSpreadsheet size={14} className="text-gray-400" /> Download as Excel
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-md shadow-sm border border-gray-100 overflow-hidden">
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
          <div className="flex items-center gap-1.5">
            <Calendar size={14} className="text-gray-400" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <span className="text-gray-400 text-sm">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}
                className="text-xs text-gray-400 hover:text-gray-600 px-1"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-amber-500" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="bg-gray-50">
                <tr>
                  {['Item', 'Date', 'Customer', 'Cashier', 'Total', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sales.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-12 text-gray-400"><Receipt size={32} className="mx-auto mb-2" /><p>No sales found</p></td></tr>
                ) : sales.map((s: any) => {
                  const items: any[] = s.items || [];
                  const firstItemName = items[0]?.product?.name;
                  const itemCount = s.items_count || items.length || 0;
                  const extraCount = itemCount - 1;
                  return (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {firstItemName ? (
                        <>
                          {firstItemName}
                          {extraCount > 0 && <span className="text-gray-400"> +{extraCount} more</span>}
                        </>
                      ) : (
                        <span className="text-gray-400">{itemCount} items</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{format(new Date(s.created_at), 'dd MMM yyyy HH:mm')}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.customer?.name || 'Walk-in'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.cashier?.name}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-amber-600">{formatAmount(parseFloat(s.total))}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[s.status] || 'bg-gray-100 text-gray-600'}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RowActionsMenu actions={[
                        { label: 'View Details', icon: <Eye size={14} />, onClick: () => setSelectedSale(s) },
                        {
                          label: 'Reprint Receipt',
                          icon: reprintMutation.isPending && reprintMutation.variables === s.id ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />,
                          onClick: () => reprintMutation.mutate(s.id),
                          disabled: reprintMutation.isPending && reprintMutation.variables === s.id,
                        },
                      ]} />
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} lastPage={meta?.last_page ?? 1} from={meta?.from} to={meta?.to} total={meta?.total} onPageChange={setPage} />
      </div>

      {/* Sale Detail Modal */}
      {selectedSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-lg w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold">Sale Detail - {selectedSale.reference}</h2>
              <button type="button" onClick={() => setSelectedSale(null)} className="text-gray-400 hover:text-gray-600">-</button>
            </div>
            <div className="p-6 space-y-4">
              {saleDetail ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div><span className="text-gray-500">Date:</span> <span className="font-medium">{format(new Date(saleDetail.created_at), 'dd MMM yyyy HH:mm')}</span></div>
                    <div><span className="text-gray-500">Status:</span> <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[saleDetail.status]}`}>{saleDetail.status}</span></div>
                    <div><span className="text-gray-500">Customer:</span> <span className="font-medium">{saleDetail.customer?.name || 'Walk-in'}</span></div>
                    <div><span className="text-gray-500">Cashier:</span> <span className="font-medium">{saleDetail.cashier?.name}</span></div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-700 mb-2">Items</h3>
                    <div className="border rounded-lg overflow-hidden">
                      <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[480px]">
                        <thead className="bg-gray-50"><tr><th className="px-3 py-2 text-left text-xs text-gray-500">Product</th><th className="px-3 py-2 text-right text-xs text-gray-500">Qty</th><th className="px-3 py-2 text-right text-xs text-gray-500">Price</th><th className="px-3 py-2 text-right text-xs text-gray-500">Total</th></tr></thead>
                        <tbody className="divide-y divide-gray-100">
                          {saleDetail.items?.map((item: any) => (
                            <tr key={item.id}><td className="px-3 py-2">{item.product?.name}</td><td className="px-3 py-2 text-right">{item.quantity}</td><td className="px-3 py-2 text-right">{formatAmount(parseFloat(item.unit_price))}</td><td className="px-3 py-2 text-right font-medium">{formatAmount(parseFloat(item.total))}</td></tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatAmount(parseFloat(saleDetail.subtotal))}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Tax</span><span>{formatAmount(parseFloat(saleDetail.tax_amount))}</span></div>
                    <div className="flex justify-between text-base font-bold border-t pt-2"><span>Total</span><span className="text-amber-600">{formatAmount(parseFloat(saleDetail.total))}</span></div>
                  </div>
                  <div className="pt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => reprintMutation.mutate(selectedSale.id)}
                      disabled={reprintMutation.isPending && reprintMutation.variables === selectedSale.id}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50"
                    >
                      {reprintMutation.isPending && reprintMutation.variables === selectedSale.id ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                      Reprint Bill
                    </button>
                    {canRefund && ['completed', 'partially_refunded'].includes(saleDetail.status) && (
                      <button
                        type="button"
                        onClick={() => setRefundSale(saleDetail)}
                        className="inline-flex items-center gap-2 px-4 py-2 border-2 border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50"
                      >
                        <Undo2 size={14} />
                        Refund
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-amber-500" /></div>
              )}
            </div>
          </div>
        </div>
      )}

      {refundSale && (
        <RefundModal sale={refundSale} onClose={() => setRefundSale(null)} formatAmount={formatAmount} />
      )}
    </div>
  );
}
