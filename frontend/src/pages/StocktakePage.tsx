import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/axios';
import { useAuthStore } from '../stores/authStore';
import { Plus, X, ClipboardCheck, Check, AlertCircle, Download, CheckCircle2, Circle } from 'lucide-react';
import toast from 'react-hot-toast';
import { offlineMutate } from '../lib/offlineMutation';
import { settingsApi } from '../api';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useCurrencyStore } from '../stores/currencyStore';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
};

export default function StocktakePage() {
  const { user } = useAuthStore();
  const { activeCurrency } = useCurrencyStore();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<any>(null);
  const [countSheet, setCountSheet] = useState<Record<number, string>>({});
  const [filterStatus, setFilterStatus] = useState('');
  const [stockSheetModalOpen, setStockSheetModalOpen] = useState(false);
  const [includeQtyInSheet, setIncludeQtyInSheet] = useState(true);
  const [downloadingSheet, setDownloadingSheet] = useState(false);
  const [downloadingRowId, setDownloadingRowId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['stocktakes', filterStatus],
    queryFn: () => api.get('/stocktakes', { params: { status: filterStatus || undefined } }).then(r => r.data?.data),
  });

  const { data: storeSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get().then(r => r.data?.data || {}),
    staleTime: 5 * 60 * 1000,
  });

  const { data: stocktakeDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['stocktake', selected?.id],
    queryFn: async () => {
      const res = await api.get(`/stocktakes/${selected.id}`);
      const d = res.data?.data;
      const counts: Record<number, string> = {};
      d?.items?.forEach((it: any) => { counts[it.id] = it.counted_qty ?? ''; });
      setCountSheet(counts);
      return d;
    },
    enabled: !!selected?.id,
  });

  const createMutation = useMutation({
    mutationFn: () => offlineMutate(() => api.post('/stocktakes', { branch_id: user?.branch?.id }), 'stocktakes', 'create', { branch_id: user?.branch?.id }),
    onSuccess: (result) => {
      if (result.offline) toast.success('Stocktake queued offline — will sync when server is back');
      else { toast.success('Stocktake created!'); qc.invalidateQueries({ queryKey: ['stocktakes'] }); const d = (result as any).data?.data?.data; if (d) setSelected(d); }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, items }: any) => offlineMutate(() => api.put(`/stocktakes/${id}`, { items }), 'stocktakes', 'update', { items }, id),
    onSuccess: (result) => {
      if (result.offline) toast.success('Counts saved offline — will sync when server is back');
      else { toast.success('Counts saved!'); qc.invalidateQueries({ queryKey: ['stocktake', selected?.id] }); }
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id: number) => offlineMutate(() => api.post(`/stocktakes/${id}/complete`), 'stocktakes', 'complete', { _url: `/stocktakes/${id}/complete`, _method: 'POST' }, id),
    onSuccess: (result) => {
      if (result.offline) toast.success('Completion queued offline — will sync when server is back');
      else { toast.success('Stocktake completed - stock levels updated!'); qc.invalidateQueries({ queryKey: ['stocktakes'] }); qc.invalidateQueries({ queryKey: ['stocktake', selected?.id] }); }
    },
  });

  const stocktakes: any[] = data?.data ?? data ?? [];

  // A line counts as "entered" either from an unsaved keystroke in the sheet
  // or from a previously-saved counted_qty on the record itself.
  const isEntered = (it: any) => String(countSheet[it.id] ?? '').trim() !== '' || it.counted_qty !== null;

  // Computed client-side from whatever is currently typed so the cashier sees
  // the variance the instant they type a quantity, instead of only after a
  // round-trip to "Save Counts" (which used to be the only place it appeared).
  const getVariance = (it: any): number | null => {
    const raw = countSheet[it.id];
    if (raw !== undefined && String(raw).trim() !== '') {
      const n = parseFloat(raw);
      return Number.isNaN(n) ? null : n - parseFloat(it.expected_qty);
    }
    return it.variance ?? null;
  };

  const pendingUnsavedItems = () =>
    (stocktakeDetail?.items ?? [])
      .filter((it: any) => String(countSheet[it.id] ?? '').trim() !== '')
      .map((it: any) => ({ id: it.id, counted_qty: parseFloat(countSheet[it.id]) }));

  const handleSaveCounts = () => {
    if (!stocktakeDetail) return;
    // Only send lines the user actually entered a count for — staff count the
    // floor in batches, not all products in one sitting, so untouched rows
    // (still blank) must stay uncounted rather than being coerced to 0.
    const items = pendingUnsavedItems();
    if (items.length === 0) { toast.error('Enter at least one counted quantity first'); return; }
    updateMutation.mutate({ id: stocktakeDetail.id, items });
  };

  const handleComplete = async () => {
    if (!stocktakeDetail) return;
    // Auto-save any quantities still sitting unsaved in the sheet so
    // "Complete" always reflects what's on screen — previously, clicking
    // Complete without first clicking "Save Counts" silently skipped those
    // lines (no variance was ever computed for them).
    const items = pendingUnsavedItems();
    if (items.length > 0) {
      await updateMutation.mutateAsync({ id: stocktakeDetail.id, items });
    }
    completeMutation.mutate(stocktakeDetail.id);
  };

  // Stable ordering: only reshuffles on save/refetch (persisted data), never
  // mid-keystroke — biggest discrepancies surface first so it's obvious what
  // needs a re-check, already-counted-clean lines come next, and anything
  // still untouched sinks to the bottom.
  const sortedItems = useMemo(() => {
    const items: any[] = stocktakeDetail?.items ?? [];
    return [...items].sort((a, b) => {
      const aCounted = a.counted_qty !== null ? 1 : 0;
      const bCounted = b.counted_qty !== null ? 1 : 0;
      if (aCounted !== bCounted) return bCounted - aCounted;
      const aVar = Math.abs(a.variance ?? 0);
      const bVar = Math.abs(b.variance ?? 0);
      return bVar - aVar;
    });
  }, [stocktakeDetail]);

  const totalItems = stocktakeDetail?.items?.length ?? 0;
  const countedCount = stocktakeDetail?.items?.filter((it: any) => isEntered(it)).length ?? 0;
  const variances = stocktakeDetail?.items?.filter((it: any) => isEntered(it) && (getVariance(it) ?? 0) !== 0) ?? [];

  const downloadCsvForStocktake = (st: any) => {
    const ref = st.reference ?? 'stocktake';
    const date = new Date().toLocaleDateString();
    const rows = st.items ?? [];

    const csvLines = [
      `Stocktake Count Sheet`,
      `Reference: ${ref}`,
      `Date: ${date}`,
      `Branch: ${st.branch?.name ?? '-'}`,
      `Status: ${(st.status ?? '').replace('_', ' ')}`,
      ``,
      `Product,SKU,Category,Expected Qty,Counted Qty,Variance,Notes`,
      ...rows.map((it: any) =>
        [
          `"${it.product?.name ?? ''}"`,
          `"${it.product?.sku ?? ''}"`,
          `"${it.product?.category?.name ?? ''}"`,
          it.expected_qty ?? '',
          it.counted_qty ?? '',
          it.variance ?? '',
          '',   // Notes
        ].join(',')
      ),
    ];
    const csvContent = csvLines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `count-sheet-${ref}-${date.replace(/\//g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Count sheet downloaded');
  };

  const downloadCountSheet = () => {
    if (!stocktakeDetail) return;
    downloadCsvForStocktake(stocktakeDetail);
  };

  const downloadPdfForStocktake = (st: any) => {
    const ref = st.reference ?? 'stocktake';
    const rows: any[] = st.items ?? [];
    const companyName = storeSettings?.company_name || 'Core POS';
    const generatedAt = new Date();
    const dateStr = generatedAt.toLocaleDateString();
    const timeStr = generatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;

    autoTable(doc, {
      head: [['Product', 'SKU', 'Expected', 'Counted', 'Variance']],
      body: rows.map((it: any) => [
        it.product?.name ?? '',
        it.product?.sku ?? '',
        it.expected_qty ?? '',
        it.counted_qty ?? '-',
        it.variance !== null && it.variance !== undefined ? (it.variance > 0 ? '+' : '') + it.variance : '-',
      ]),
      startY: 108,
      margin: { left: margin, right: margin, bottom: 50 },
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 6, lineColor: [225, 228, 232], lineWidth: 0.5 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', halign: 'left' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 90, font: 'courier', fontSize: 8 },
        2: { cellWidth: 70, halign: 'right' },
        3: { cellWidth: 70, halign: 'right' },
        4: { cellWidth: 70, halign: 'right', fontStyle: 'bold' },
      },
      didParseCell: (data) => {
        // Highlight rows with a non-zero variance so discrepancies stand out on paper too.
        if (data.section === 'body' && data.column.index === 4) {
          const raw = rows[data.row.index]?.variance;
          if (raw !== null && raw !== undefined && parseFloat(raw) !== 0) {
            data.cell.styles.textColor = parseFloat(raw) < 0 ? [220, 38, 38] : [5, 150, 105];
          }
        }
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
        doc.text(`Stocktake Count Sheet  ·  ${ref}  ·  ${(st.status ?? '').replace('_', ' ')}${st.branch?.name ? `  ·  ${st.branch.name}` : ''}`, margin, 50);

        doc.setFontSize(9);
        doc.text(`Generated: ${dateStr} ${timeStr}`, pageWidth - margin, 32, { align: 'right' });
        doc.text(`${rows.length} product${rows.length !== 1 ? 's' : ''}`, pageWidth - margin, 46, { align: 'right' });

        const pageCount = doc.getNumberOfPages();
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setDrawColor(225, 228, 232);
        doc.line(margin, pageHeight - 40, pageWidth - margin, pageHeight - 40);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(`Page ${doc.getCurrentPageInfo().pageNumber} of ${pageCount}`, pageWidth - margin, pageHeight - 24, { align: 'right' });
        doc.text('Generated by Core POS — for internal stock-count use', margin, pageHeight - 24);
      },
    });

    doc.save(`count-sheet-${ref}-${generatedAt.toISOString().slice(0, 10)}.pdf`);
    toast.success('Count sheet downloaded');
  };

  const downloadCountSheetById = async (st: any) => {
    setDownloadingRowId(st.id);
    try {
      const res = await api.get(`/stocktakes/${st.id}`);
      const d = res.data?.data;
      if (!d) throw new Error('not found');
      downloadPdfForStocktake(d);
    } catch {
      toast.error('Failed to download count sheet');
    } finally {
      setDownloadingRowId(null);
    }
  };

  const downloadFullStockSheet = async () => {
    setDownloadingSheet(true);
    try {
      const res = await api.get('/products', { params: { per_page: 1000 } });
      const products: any[] = res.data?.data?.data ?? res.data?.data ?? [];
      products.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

      const companyName = storeSettings?.company_name || 'Core POS';
      const branchName = user?.branch?.name ?? '';
      const generatedAt = new Date();
      const dateStr = generatedAt.toLocaleDateString();
      const timeStr = generatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 40;

      const head = includeQtyInSheet
        ? [['#', 'Product', 'SKU', 'Category', 'Current Qty', 'Counted']]
        : [['#', 'Product', 'SKU', 'Category', 'Counted Qty', 'Counted']];
      const body = products.map((p: any, i: number) => [
        String(i + 1),
        p.name ?? '',
        p.sku ?? '',
        p.category?.name ?? '-',
        includeQtyInSheet ? String(p.total_stock ?? 0) : '',
        '', // Counted checkbox — drawn manually in didDrawCell below, ticked by hand once physically counted
      ]);
      const CHECKBOX_COL = 5;

      autoTable(doc, {
        head,
        body,
        startY: 108,
        margin: { left: margin, right: margin, bottom: 50 },
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 6, lineColor: [225, 228, 232], lineWidth: 0.5 },
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', halign: 'left' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 28, halign: 'right', textColor: [148, 163, 184] },
          1: { cellWidth: 'auto' },
          2: { cellWidth: 90, font: 'courier', fontSize: 8 },
          3: { cellWidth: 100 },
          4: { cellWidth: 80, halign: 'right', fontStyle: includeQtyInSheet ? 'bold' : 'normal' },
          5: { cellWidth: 50, halign: 'center' },
        },
        // Draw an empty tick-box square in the "Counted" column for the
        // physical counter to mark by hand once they've counted that line.
        didDrawCell: (data) => {
          if (data.section === 'body' && data.column.index === CHECKBOX_COL) {
            const size = 11;
            const x = data.cell.x + (data.cell.width - size) / 2;
            const y = data.cell.y + (data.cell.height - size) / 2;
            doc.setDrawColor(100, 116, 139);
            doc.setLineWidth(0.75);
            doc.rect(x, y, size, size);
          }
        },
        // Professional letterhead + footer, redrawn on every page
        didDrawPage: () => {
          // Header band
          doc.setFillColor(30, 41, 59);
          doc.rect(0, 0, pageWidth, 70, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(18);
          doc.text(companyName, margin, 32);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          doc.setTextColor(203, 213, 225);
          doc.text('Stock Sheet' + (branchName ? `  ·  ${branchName}` : ''), margin, 50);

          doc.setFontSize(9);
          doc.text(`Generated: ${dateStr} ${timeStr}`, pageWidth - margin, 32, { align: 'right' });
          doc.text(`${products.length} product${products.length !== 1 ? 's' : ''}`, pageWidth - margin, 46, { align: 'right' });

          // Footer
          const pageCount = doc.getNumberOfPages();
          const pageHeight = doc.internal.pageSize.getHeight();
          doc.setDrawColor(225, 228, 232);
          doc.line(margin, pageHeight - 40, pageWidth - margin, pageHeight - 40);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(148, 163, 184);
          doc.text(`Page ${doc.getCurrentPageInfo().pageNumber} of ${pageCount}`, pageWidth - margin, pageHeight - 24, { align: 'right' });
          doc.text('Generated by Core POS — for internal stock-count use', margin, pageHeight - 24);
        },
      });

      // Sign-off block on the final page: opening float, counter + checker
      // signatures (each with a date), and a comments box for the checker.
      const finalY = (doc as any).lastAutoTable?.finalY ?? 108;
      const pageHeight = doc.internal.pageSize.getHeight();
      const rowGap = 30;
      const commentsLabelGap = 18;
      const commentsBoxHeight = 54;
      const blockHeight = rowGap * 3 + commentsLabelGap + commentsBoxHeight;
      let y = Math.min(finalY + 30, pageHeight - 30 - blockHeight);

      doc.setDrawColor(100, 116, 139);
      doc.setTextColor(71, 85, 105);
      doc.setFontSize(9);

      // Row 0: Opening float — cash float the cashier starts the day with
      doc.line(margin, y, margin + 180, y);
      doc.text(`Opening Float (${activeCurrency?.symbol ?? '$'})`, margin, y + 12);
      doc.line(pageWidth - margin - 120, y, pageWidth - margin, y);
      doc.text('Date', pageWidth - margin - 120, y + 12);

      // Row 1: Counted by
      y += rowGap;
      doc.line(margin, y, margin + 180, y);
      doc.text('Counted by', margin, y + 12);
      doc.line(pageWidth - margin - 120, y, pageWidth - margin, y);
      doc.text('Date', pageWidth - margin - 120, y + 12);

      // Row 2: Checked by
      y += rowGap;
      doc.line(margin, y, margin + 180, y);
      doc.text('Checked by', margin, y + 12);
      doc.line(pageWidth - margin - 120, y, pageWidth - margin, y);
      doc.text('Date', pageWidth - margin - 120, y + 12);

      // Comments box — for the checker to note any discrepancies found
      y += rowGap + commentsLabelGap;
      doc.setFont('helvetica', 'bold');
      doc.text('Comments (Checker)', margin, y - 6);
      doc.setFont('helvetica', 'normal');
      doc.setDrawColor(203, 213, 225);
      doc.rect(margin, y, pageWidth - margin * 2, commentsBoxHeight);

      const filenameTag = includeQtyInSheet ? 'with-qty' : 'products-only';
      doc.save(`stock-sheet-${filenameTag}-${generatedAt.toISOString().slice(0, 10)}.pdf`);
      toast.success('Stock sheet downloaded');
      setStockSheetModalOpen(false);
    } catch {
      toast.error('Failed to generate stock sheet');
    } finally {
      setDownloadingSheet(false);
    }
  };

  const printCountSheet = () => {
    if (!stocktakeDetail) return;
    const ref = stocktakeDetail.reference ?? selected?.reference ?? 'stocktake';
    const date = new Date().toLocaleDateString();
    const rows: any[] = stocktakeDetail.items ?? [];
    const rowsHtml = rows.map((it: any, idx: number) => `
      <tr style="border-bottom:1px solid #e5e7eb">
        <td style="padding:6px 8px">${idx + 1}</td>
        <td style="padding:6px 8px">${it.product?.name ?? ''}</td>
        <td style="padding:6px 8px">${it.product?.sku ?? ''}</td>
        <td style="padding:6px 8px">${it.product?.category?.name ?? ''}</td>
        <td style="padding:6px 8px;text-align:center">${it.expected_qty ?? ''}</td>
        <td style="padding:6px 8px;min-width:60px">&nbsp;</td>
        <td style="padding:6px 8px;min-width:60px">&nbsp;</td>
        <td style="padding:6px 8px;min-width:80px">&nbsp;</td>
      </tr>`).join('');
    const html = `<!DOCTYPE html><html><head><title>Count Sheet - ${ref}</title>
      <style>body{font-family:Arial,sans-serif;font-size:12px}table{width:100%;border-collapse:collapse}th{background:#f3f4f6;padding:6px 8px;text-align:left;border-bottom:2px solid #d1d5db}@media print{button{display:none}}</style>
      </head><body>
      <h2 style="margin:0 0 4px">Stocktake Count Sheet</h2>
      <p style="margin:0 0 12px;color:#6b7280">Ref: ${ref} &nbsp;|&nbsp; Date: ${date} &nbsp;|&nbsp; Branch: ${stocktakeDetail.branch?.name ?? '-'}</p>
      <table>
        <thead><tr><th>#</th><th>Product</th><th>SKU</th><th>Category</th><th>Expected</th><th>Counted</th><th>Variance</th><th>Notes</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p style="margin-top:24px;font-size:11px;color:#9ca3af">Cashier signature: _________________________ &nbsp;&nbsp; Date: _____________</p>
      </body></html>`;
    const win = window.open('', '_blank');
    if (!win) { toast.error('Pop-up blocked. Allow pop-ups and try again.'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stocktake / Cycle Count</h1>
          <p className="text-sm text-gray-500 mt-1">Count stock and reconcile variances</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setStockSheetModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-md text-sm font-semibold hover:bg-gray-50">
            <Download size={16} /> Stock Sheet
          </button>
          <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            <Plus size={16} /> Start New Count
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        {['', 'draft', 'in_progress', 'completed'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border capitalize ${filterStatus === s ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>{s || 'All'}</button>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-gray-100 overflow-hidden">
        {isLoading ? <div className="p-8 text-center text-gray-400">Loading...</div> : stocktakes.length === 0 ? (
          <div className="p-8 text-center text-gray-400"><ClipboardCheck size={32} className="mx-auto mb-2" /><p>No stocktakes</p></div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-xs font-semibold text-gray-500 uppercase">
                <th className="text-left px-4 py-3">Reference</th>
                <th className="text-left px-4 py-3">Branch</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {stocktakes.map((st: any) => (
                <tr key={st.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelected(st)}>
                  <td className="px-4 py-3 font-mono text-sm">{st.reference}</td>
                  <td className="px-4 py-3 text-sm">{st.branch?.name ?? '-'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[st.status]}`}>{st.status.replace('_',' ')}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-400">{new Date(st.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); downloadCountSheetById(st); }}
                      disabled={downloadingRowId === st.id}
                      title="Download count sheet as PDF"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md border border-blue-200 transition-colors disabled:opacity-50"
                    >
                      <Download size={12} /> {downloadingRowId === st.id ? '...' : 'PDF'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Full Stock Sheet download modal */}
      {stockSheetModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-gray-900">Download Stock Sheet</h2>
              <button onClick={() => setStockSheetModalOpen(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-500">Export all products to a sheet for physical stocktaking.</p>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={includeQtyInSheet}
                onChange={e => setIncludeQtyInSheet(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <span className="text-sm text-gray-700">Include current quantities</span>
            </label>
            <p className="text-xs text-gray-400">
              {includeQtyInSheet
                ? 'The sheet will include the current system quantity next to each product.'
                : 'The sheet will list products only, with a blank column for the physical count.'}
            </p>
            <button
              onClick={downloadFullStockSheet}
              disabled={downloadingSheet}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              <Download size={14} /> {downloadingSheet ? 'Preparing...' : 'Download PDF'}
            </button>
          </div>
        </div>
      )}

      {/* Stocktake Detail */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <div>
                <h2 className="font-bold text-gray-900">{stocktakeDetail?.reference ?? selected.reference}</h2>
                {stocktakeDetail && <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLORS[stocktakeDetail.status]}`}>{stocktakeDetail.status.replace('_',' ')}</span>}
              </div>
              <div className="flex items-center gap-2">
                {stocktakeDetail && (
                  <>
                    <button
                      onClick={downloadCountSheet}
                      title="Download count sheet as CSV"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md border border-blue-200 transition-colors"
                    >
                      <Download size={13} /> CSV
                    </button>
                    <button
                      onClick={printCountSheet}
                      title="Print count sheet"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-md border border-gray-200 transition-colors"
                    >
                      <Download size={13} /> Print
                    </button>
                  </>
                )}
                <button onClick={() => setSelected(null)}><X size={20} className="text-gray-400" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {detailLoading ? <div className="text-center text-gray-400 py-8">Loading...</div> : (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 bg-gray-50 border border-gray-100 rounded-md px-4 py-2.5">
                    <div className="flex items-center gap-1.5 text-sm">
                      <CheckCircle2 size={15} className="text-blue-600" />
                      <span className="font-semibold text-gray-900">{countedCount}</span>
                      <span className="text-gray-500">of {totalItems} counted</span>
                    </div>
                    <div className="w-px h-4 bg-gray-200" />
                    <div className="flex items-center gap-1.5 text-sm">
                      <AlertCircle size={15} className={variances.length > 0 ? 'text-amber-600' : 'text-gray-300'} />
                      <span className={`font-semibold ${variances.length > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{variances.length}</span>
                      <span className="text-gray-500">variance{variances.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="flex-1" />
                    <div className="h-1.5 w-28 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${totalItems ? (countedCount / totalItems) * 100 : 0}%` }} />
                    </div>
                  </div>
                  {variances.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-md p-3 flex items-start gap-2">
                      <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700"><strong>{variances.length} variance{variances.length > 1 ? 's' : ''} found.</strong> Review before completing.</p>
                    </div>
                  )}
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-gray-400 uppercase border-b">
                      <th className="text-left pb-2 w-6"></th>
                      <th className="text-left pb-2">Product</th>
                      <th className="text-right pb-2">Expected</th>
                      <th className="text-right pb-2">Counted</th>
                      <th className="text-right pb-2">Variance</th>
                    </tr></thead>
                    <tbody>
                      {sortedItems.map((it: any) => {
                        const entered = isEntered(it);
                        const variance = getVariance(it);
                        const hasVariance = entered && (variance ?? 0) !== 0;
                        return (
                        <tr key={it.id} className={`border-b border-gray-50 ${hasVariance ? 'bg-amber-50/50' : entered ? 'bg-emerald-50/30' : ''}`}>
                          <td className="py-2">
                            {entered
                              ? <CheckCircle2 size={14} className="text-emerald-600" />
                              : <Circle size={14} className="text-gray-200" />}
                          </td>
                          <td className={`py-2 ${entered ? 'text-gray-900' : 'text-gray-400'}`}>{it.product?.name}</td>
                          <td className="py-2 text-right text-gray-500">{it.expected_qty}</td>
                          <td className="py-2 text-right">
                            {stocktakeDetail.status === 'completed' ? (
                              <span className="font-semibold">{it.counted_qty ?? '-'}</span>
                            ) : (
                              <input
                                type="number"
                                value={countSheet[it.id] ?? ''}
                                onChange={e => setCountSheet(cs => ({...cs, [it.id]: e.target.value}))}
                                className="w-20 text-right border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="0"
                              />
                            )}
                          </td>
                          <td className={`py-2 text-right font-semibold ${!entered ? 'text-gray-300' : (variance ?? 0) < 0 ? 'text-red-600' : (variance ?? 0) > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
                            {entered && variance !== null ? (variance > 0 ? '+' : '') + variance : '-'}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {stocktakeDetail?.status !== 'completed' && (
              <div className="flex gap-3 px-6 py-4 border-t flex-shrink-0">
                <button onClick={handleSaveCounts} disabled={updateMutation.isPending} className="flex-1 flex items-center justify-center gap-2 py-2.5 border-2 border-blue-200 text-blue-600 rounded-md text-sm font-semibold hover:bg-blue-50 disabled:opacity-50">
                  Save Counts
                </button>
                <button onClick={handleComplete} disabled={completeMutation.isPending || updateMutation.isPending} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 text-white rounded-md text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                  <Check size={14} /> Complete & Update Stock
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
