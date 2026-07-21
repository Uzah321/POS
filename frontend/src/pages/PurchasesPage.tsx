import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseOrdersApi, suppliersApi, branchesApi, warehousesApi, productsApi, settingsApi } from '../api';
import { Plus, Search, CheckCircle, Loader2, X, Truck, Eye, Printer, PackageCheck, FileText } from 'lucide-react';
import Pagination from '../components/ui/Pagination';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { offlineMutate } from '../lib/offlineMutation';
import { format } from 'date-fns';
import { useCurrencyStore } from '../stores/currencyStore';
import { useAuthStore } from '../stores/authStore';
import { db } from '../lib/db';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending: 'bg-yellow-100 text-yellow-700',
  pending_approval: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700',
  ordered: 'bg-purple-100 text-purple-700',
  received: 'bg-green-100 text-green-700',
  partially_received: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-red-100 text-red-700',
};

const RECEIVABLE_STATUSES = ['approved', 'ordered', 'partially_received'];

const poSchema = z.object({
  supplier_id: z.coerce.number().min(1),
  branch_id: z.coerce.number().min(1),
  warehouse_id: z.coerce.number().min(1),
  order_date: z.string().min(1),
  expected_date: z.string().optional(),
  notes: z.string().optional(),
});

/** Pulls a human-readable message out of a Laravel validation (422) error, or falls back to the generic message. */
function extractErrorMessage(err: any): string {
  const data = err?.response?.data;
  if (data?.errors) {
    const first = Object.values(data.errors)[0];
    if (Array.isArray(first) && first.length) return String(first[0]);
  }
  return data?.message || err?.message || 'Something went wrong';
}

function POModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { format: formatAmount, activeCurrency } = useCurrencyStore();
  const user = useAuthStore((s) => s.user);
  const [items, setItems] = useState([{ product_id: '', quantity: 1, unit_cost: 0 }]);
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      try {
        const r = await suppliersApi.list({ per_page: 500 });
        return r.data?.data?.data || r.data?.data || [];
      } catch {
        return db.suppliers.toArray();
      }
    },
  });
  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      try {
        const r = await branchesApi.list();
        return r.data?.data?.data ?? r.data?.data ?? [];
      } catch {
        return db.branches.toArray();
      }
    },
  });
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<z.infer<typeof poSchema>>({
    resolver: zodResolver(poSchema) as any,
    defaultValues: {
      branch_id: user?.branch?.id ?? undefined,
      order_date: format(new Date(), 'yyyy-MM-dd'),
    },
  });
  const branchId = watch('branch_id');
  // Products belong to the branch a PO is being raised for — each branch owns
  // its own catalog, so the line-item picker must only offer that branch's items.
  const { data: products } = useQuery({
    queryKey: ['products', 'po-select', branchId],
    queryFn: async () => {
      try {
        const r = await productsApi.list({ per_page: 1000, branch_id: branchId });
        return r.data?.data?.data || r.data?.data || [];
      } catch {
        // Local server briefly unreachable — fall back to the IndexedDB cache
        // useDBSync keeps warm, so a purchase order can still be built offline.
        return db.products.toArray();
      }
    },
    enabled: !!branchId,
  });
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses', branchId],
    queryFn: () => warehousesApi.list({ branch_id: branchId }).then(r => r.data?.data || []),
    enabled: !!branchId,
  });

  // Once branches load, fall back to the first one if the user has no assigned branch
  useEffect(() => {
    if (!branchId && branches?.length) setValue('branch_id', branches[0].id as any);
  }, [branches, branchId, setValue]);

  // Once warehouses for the selected branch load, default to the branch's default warehouse (or the first)
  useEffect(() => {
    if (warehouses?.length) {
      const def = warehouses.find((w: any) => w.is_default) ?? warehouses[0];
      setValue('warehouse_id', def.id as any);
    }
  }, [warehouses, setValue]);

  const mutation = useMutation({
    mutationFn: (d: any) => {
      const payload = {
        ...d,
        items: items
          .filter((it) => it.product_id && it.quantity > 0)
          .map((it) => ({ product_id: Number(it.product_id), quantity: it.quantity, unit_cost: it.unit_cost })),
      };
      return offlineMutate(() => purchaseOrdersApi.create(payload), 'purchase_orders', 'create', payload);
    },
    onSuccess: (result) => {
      if (result.offline) toast.success('Purchase order saved offline - will sync when server is back');
      else { toast.success('Purchase order created'); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); }
      onClose();
    },
    onError: (err: any) => toast.error(`Could not create purchase order: ${extractErrorMessage(err)}`),
  });
  const addItem = () => setItems([...items, { product_id: '', quantity: 1, unit_cost: 0 }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: string, val: any) => setItems(items.map((it, idx) => idx === i ? { ...it, [field]: val } : it));
  const selectProduct = (i: number, productId: string) => {
    const p = products?.find((pr: any) => String(pr.id) === productId);
    setItems(items.map((it, idx) => idx === i ? { ...it, product_id: productId, unit_cost: p?.cost_price ? Number(p.cost_price) : it.unit_cost } : it));
  };
  const total = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);
  const onSubmit = (d: any) => {
    if (!items.some((it) => it.product_id && it.quantity > 0)) {
      toast.error('Add at least one item with a product and quantity');
      return;
    }
    mutation.mutate(d);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b"><h2 className="text-lg font-bold">New Purchase Order</h2><button type="button" onClick={onClose}><X size={20} className="text-gray-400" /></button></div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm font-medium text-gray-700">Supplier *</label>
              <select {...register('supplier_id')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
                <option value="">Select supplier...</option>{suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>{errors.supplier_id && <p className="text-red-500 text-xs mt-1">Required</p>}</div>
            <div><label className="text-sm font-medium text-gray-700">Order Date *</label><input type="date" {...register('order_date')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />{errors.order_date && <p className="text-red-500 text-xs mt-1">Required</p>}</div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="text-sm font-medium text-gray-700">Branch *</label>
              <select {...register('branch_id')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
                <option value="">Select branch...</option>{branches?.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>{errors.branch_id && <p className="text-red-500 text-xs mt-1">Required</p>}</div>
            <div><label className="text-sm font-medium text-gray-700">Warehouse *</label>
              <select {...register('warehouse_id')} disabled={!branchId} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:bg-gray-50">
                <option value="">Select warehouse...</option>{warehouses?.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>{errors.warehouse_id && <p className="text-red-500 text-xs mt-1">Required</p>}</div>
            <div><label className="text-sm font-medium text-gray-700">Expected Date</label><input type="date" {...register('expected_date')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" /></div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2"><label className="text-sm font-semibold text-gray-700">Order Items</label><button type="button" onClick={addItem} className="text-xs text-amber-600 hover:text-amber-800 font-medium">+ Add Item</button></div>
            {/* Column headers */}
            <div className="grid grid-cols-12 gap-2 mb-1 px-1">
              <span className="col-span-5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Product</span>
              <span className="col-span-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Qty</span>
              <span className="col-span-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit Cost ({activeCurrency?.symbol ?? '$'})</span>
              <span className="col-span-1"></span>
            </div>
            {items.map((item, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 mb-2">
                <select value={item.product_id} onChange={(e) => selectProduct(i, e.target.value)} className="col-span-5 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
                  <option value="">Select product...</option>{products?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input type="number" min="1" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', +e.target.value)} placeholder="0" className="col-span-3 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                <div className="col-span-3 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">{activeCurrency?.symbol ?? '$'}</span>
                  <input type="number" step="0.01" min="0" value={item.unit_cost} onChange={(e) => updateItem(i, 'unit_cost', +e.target.value)} placeholder="0.00" className="w-full border border-gray-300 rounded-lg pl-6 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <button type="button" onClick={() => removeItem(i)} className="col-span-1 flex items-center justify-center text-red-400 hover:text-red-600" title="Remove item"><X size={14} /></button>
              </div>
            ))}
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
              <span className="text-xs text-gray-400">{items.length} item{items.length !== 1 ? 's' : ''}</span>
              <span className="text-sm font-semibold text-gray-700">Total: <span className="text-amber-600 text-base">{formatAmount(total)}</span></span>
            </div>
          </div>
          <div><label className="text-sm font-medium text-gray-700">Notes</label><textarea {...register('notes')} rows={2} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none" /></div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-md text-sm font-medium hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 bg-amber-500 hover:bg-amber-600 text-gray-900 font-semibold py-2.5 rounded-md text-sm flex items-center justify-center gap-2 disabled:opacity-60">
              {mutation.isPending && <Loader2 size={14} className="animate-spin" />}Create PO
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Builds and downloads a print-ready PDF of a purchase order (letterhead, items table, totals, sign-off block). */
function downloadPurchaseOrderPdf(po: any, companyName: string, currencySymbol: string) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  const items: any[] = po.items ?? [];
  const body = items.map((it: any, i: number) => [
    String(i + 1),
    it.product?.name ?? '',
    it.product?.sku ?? '',
    it.quantity,
    `${currencySymbol}${Number(it.unit_cost).toFixed(2)}`,
    `${currencySymbol}${Number(it.subtotal).toFixed(2)}`,
  ]);

  autoTable(doc, {
    head: [['#', 'Product', 'SKU', 'Qty', 'Unit Cost', 'Subtotal']],
    body,
    startY: 165,
    margin: { left: margin, right: margin, bottom: 50 },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 6, lineColor: [225, 228, 232], lineWidth: 0.5 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', halign: 'left' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 28, halign: 'right', textColor: [148, 163, 184] },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 90, font: 'courier', fontSize: 8 },
      3: { cellWidth: 55, halign: 'right' },
      4: { cellWidth: 80, halign: 'right' },
      5: { cellWidth: 80, halign: 'right', fontStyle: 'bold' },
    },
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
      doc.text('Purchase Order', margin, 50);
      doc.setFontSize(9);
      doc.text(po.reference ?? '', pageWidth - margin, 32, { align: 'right' });
      doc.text(`Status: ${(po.status ?? '').replace('_', ' ')}`, pageWidth - margin, 46, { align: 'right' });

      // Info block
      doc.setTextColor(71, 85, 105);
      doc.setFontSize(9);
      const infoY = 92;
      doc.setFont('helvetica', 'bold');
      doc.text('Supplier', margin, infoY);
      doc.text('Branch / Warehouse', margin + 220, infoY);
      doc.text('Order Date', pageWidth - margin - 150, infoY);
      doc.setFont('helvetica', 'normal');
      doc.text(po.supplier?.name ?? '-', margin, infoY + 14);
      doc.text(`${po.branch?.name ?? '-'} / ${po.warehouse?.name ?? '-'}`, margin + 220, infoY + 14);
      doc.text(po.order_date ? String(po.order_date).slice(0, 10) : '-', pageWidth - margin - 150, infoY + 14);
      if (po.expected_date) {
        doc.setFont('helvetica', 'bold');
        doc.text('Expected', pageWidth - margin - 150, infoY + 30);
        doc.setFont('helvetica', 'normal');
        doc.text(String(po.expected_date).slice(0, 10), pageWidth - margin - 150, infoY + 44);
      }

      // Footer
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

  const finalY = (doc as any).lastAutoTable?.finalY ?? 165;
  let y = finalY + 24;

  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Total: ${currencySymbol}${Number(po.total ?? 0).toFixed(2)}`, pageWidth - margin, y, { align: 'right' });

  if (po.notes) {
    y += 22;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text('Notes', margin, y);
    doc.setFont('helvetica', 'normal');
    const noteLines = doc.splitTextToSize(String(po.notes), pageWidth - margin * 2);
    doc.text(noteLines, margin, y + 14);
    y += 14 + noteLines.length * 12;
  }

  // Sign-off block
  y += 30;
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y > pageHeight - 80) y = pageHeight - 80;
  doc.setDrawColor(100, 116, 139);
  doc.setTextColor(71, 85, 105);
  doc.setFontSize(9);
  doc.line(margin, y, margin + 180, y);
  doc.text('Prepared by', margin, y + 12);
  doc.line(pageWidth - margin - 180, y, pageWidth - margin, y);
  doc.text('Approved by', pageWidth - margin - 180, y + 12);

  doc.save(`purchase-order-${po.reference ?? po.id}.pdf`);
}

function GoodsReceiptModal({ po, onClose }: { po: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { format: formatAmount, activeCurrency } = useCurrencyStore();
  const [receivedDate, setReceivedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');

  const initialLines = (po.items ?? [])
    .map((it: any) => {
      const outstanding = Math.max(0, Number(it.quantity) - Number(it.received_quantity ?? 0));
      return {
        purchase_order_item_id: it.id,
        product_id: it.product_id,
        product_variant_id: it.product_variant_id,
        product_name: it.product?.name ?? '',
        ordered_qty: Number(it.quantity),
        already_received: Number(it.received_quantity ?? 0),
        quantity: outstanding,
        unit_cost: Number(it.unit_cost),
        batch_number: '',
        expiry_date: '',
      };
    });
  const [lines, setLines] = useState<any[]>(initialLines);

  const updateLine = (i: number, field: string, val: any) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [field]: val } : l)));

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        received_date: receivedDate,
        notes: notes || undefined,
        invoice_number: invoiceNumber || undefined,
        invoice_date: invoiceDate || undefined,
        invoice_amount: invoiceAmount ? Number(invoiceAmount) : undefined,
        items: lines
          .filter((l) => l.quantity > 0)
          .map((l) => ({
            purchase_order_item_id: l.purchase_order_item_id,
            product_id: l.product_id,
            product_variant_id: l.product_variant_id || undefined,
            quantity: l.quantity,
            unit_cost: l.unit_cost,
            batch_number: l.batch_number || undefined,
            expiry_date: l.expiry_date || undefined,
          })),
      };
      return offlineMutate(
        () => purchaseOrdersApi.receive(po.id, payload),
        'purchase_orders',
        'receive',
        { _url: `/purchase-orders/${po.id}/receive`, _method: 'POST', ...payload },
        po.id
      );
    },
    onSuccess: (result) => {
      if (result.offline) toast.success('Goods receipt saved offline - will sync when server is back');
      else {
        toast.success('Goods received and stock updated');
        qc.invalidateQueries({ queryKey: ['purchase-orders'] });
        qc.invalidateQueries({ queryKey: ['purchase-order', po.id] });
        qc.invalidateQueries({ queryKey: ['inventory'] });
        qc.invalidateQueries({ queryKey: ['inventory-low-count'] });
        qc.invalidateQueries({ queryKey: ['inventory-out-count'] });
        qc.invalidateQueries({ queryKey: ['pos-products'] });
        qc.invalidateQueries({ queryKey: ['products'] });
      }
      onClose();
    },
    onError: (err: any) => toast.error(`Could not record goods receipt: ${extractErrorMessage(err)}`),
  });

  const onSubmit = () => {
    if (!lines.some((l) => l.quantity > 0)) {
      toast.error('Enter a received quantity for at least one item');
      return;
    }
    mutation.mutate();
  };

  const total = lines.reduce((s, l) => s + l.quantity * l.unit_cost, 0);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-lg w-full max-w-3xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
          <h2 className="text-lg font-bold flex items-center gap-2"><PackageCheck size={18} className="text-emerald-600" /> Goods Received — {po.reference}</h2>
          <button type="button" onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Received Date *</label>
              <input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Optional" />
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
            <p className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><FileText size={14} className="text-gray-500" /> Supplier Invoice (optional)</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600">Invoice Number</label>
                <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="e.g. INV-00231" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Invoice Date</label>
                <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Invoice Amount</label>
                <input type="number" step="0.01" min="0" value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="0.00" />
              </div>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50"><tr>
                <th className="px-3 py-2 text-left text-xs text-gray-500">Product</th>
                <th className="px-3 py-2 text-right text-xs text-gray-500">Ordered</th>
                <th className="px-3 py-2 text-right text-xs text-gray-500">Received</th>
                <th className="px-3 py-2 text-right text-xs text-gray-500 w-24">Receiving</th>
                <th className="px-3 py-2 text-right text-xs text-gray-500 w-28">Unit Cost</th>
                <th className="px-3 py-2 text-left text-xs text-gray-500 w-28">Batch #</th>
                <th className="px-3 py-2 text-left text-xs text-gray-500 w-36">Expiry</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((l, i) => (
                  <tr key={l.purchase_order_item_id} className={l.already_received >= l.ordered_qty ? 'opacity-40' : ''}>
                    <td className="px-3 py-2">{l.product_name}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{l.ordered_qty}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{l.already_received}</td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" value={l.quantity} onChange={(e) => updateLine(i, 'quantity', +e.target.value)} className="w-full text-right border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" step="0.01" min="0" value={l.unit_cost} onChange={(e) => updateLine(i, 'unit_cost', +e.target.value)} className="w-full text-right border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                    </td>
                    <td className="px-3 py-2">
                      <input value={l.batch_number} onChange={(e) => updateLine(i, 'batch_number', e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="date" value={l.expiry_date} onChange={(e) => updateLine(i, 'expiry_date', e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between text-base font-bold border-t pt-3">
            <span>Receiving Total</span><span className="text-emerald-600">{formatAmount(total)}</span>
          </div>
          <p className="text-xs text-gray-400">Currency: {activeCurrency?.symbol ?? '$'}. Stock will be added to {po.warehouse?.name ?? 'the PO warehouse'} on save.</p>
        </div>
        <div className="p-6 border-t flex-shrink-0">
          <button
            type="button"
            onClick={onSubmit}
            disabled={mutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-sm disabled:opacity-50"
          >
            {mutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <PackageCheck size={16} />}
            Confirm Goods Received
          </button>
        </div>
      </div>
    </div>
  );
}

function PODetailModal({ id, onClose, onReceive }: { id: number; onClose: () => void; onReceive: (po: any) => void }) {
  const { format: formatAmount, activeCurrency } = useCurrencyStore();
  const { data: storeSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get().then((r) => r.data?.data || {}),
    staleTime: 5 * 60 * 1000,
  });
  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => purchaseOrdersApi.get(id).then((r) => r.data?.data),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
          <h2 className="text-lg font-bold">{po?.reference ?? 'Purchase Order'}</h2>
          <div className="flex items-center gap-2">
            {po && (
              <button
                type="button"
                onClick={() => downloadPurchaseOrderPdf(po, storeSettings?.company_name || 'Core POS', activeCurrency?.symbol ?? '$')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-md border border-gray-200 transition-colors"
              >
                <Printer size={13} /> Print PDF
              </button>
            )}
            {po && RECEIVABLE_STATUSES.includes(po.status) && (
              <button
                type="button"
                onClick={() => onReceive(po)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md border border-emerald-200 transition-colors"
              >
                <PackageCheck size={13} /> Receive Goods
              </button>
            )}
            <button type="button" onClick={onClose}><X size={20} className="text-gray-400" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading || !po ? (
            <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-amber-500" /></div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">Supplier:</span> <span className="font-medium">{po.supplier?.name ?? '-'}</span></div>
                <div><span className="text-gray-500">Status:</span> <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[po.status] || 'bg-gray-100 text-gray-600'}`}>{po.status?.replace('_', ' ')}</span></div>
                <div><span className="text-gray-500">Branch:</span> <span className="font-medium">{po.branch?.name ?? '-'}</span></div>
                <div><span className="text-gray-500">Warehouse:</span> <span className="font-medium">{po.warehouse?.name ?? '-'}</span></div>
                <div><span className="text-gray-500">Order Date:</span> <span className="font-medium">{po.order_date ? format(new Date(po.order_date), 'dd MMM yyyy') : '-'}</span></div>
                <div><span className="text-gray-500">Expected:</span> <span className="font-medium">{po.expected_date ? format(new Date(po.expected_date), 'dd MMM yyyy') : '-'}</span></div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50"><tr>
                    <th className="px-3 py-2 text-left text-xs text-gray-500">Product</th>
                    <th className="px-3 py-2 text-right text-xs text-gray-500">Qty</th>
                    <th className="px-3 py-2 text-right text-xs text-gray-500">Received</th>
                    <th className="px-3 py-2 text-right text-xs text-gray-500">Unit Cost</th>
                    <th className="px-3 py-2 text-right text-xs text-gray-500">Subtotal</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {(po.items ?? []).map((it: any) => (
                      <tr key={it.id}>
                        <td className="px-3 py-2">{it.product?.name}</td>
                        <td className="px-3 py-2 text-right">{it.quantity}</td>
                        <td className="px-3 py-2 text-right">{it.received_quantity ?? 0}</td>
                        <td className="px-3 py-2 text-right">{formatAmount(parseFloat(it.unit_cost))}</td>
                        <td className="px-3 py-2 text-right">{formatAmount(parseFloat(it.subtotal))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between text-base font-bold border-t pt-3">
                <span>Total</span><span className="text-amber-600">{formatAmount(parseFloat(po.total || 0))}</span>
              </div>

              {po.goods_receipts && po.goods_receipts.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-700 mb-2 text-sm">Goods Receipts (GRV)</h3>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50"><tr>
                        <th className="px-3 py-2 text-left text-xs text-gray-500">Reference</th>
                        <th className="px-3 py-2 text-left text-xs text-gray-500">Date</th>
                        <th className="px-3 py-2 text-left text-xs text-gray-500">Received By</th>
                        <th className="px-3 py-2 text-left text-xs text-gray-500">Invoice #</th>
                        <th className="px-3 py-2 text-right text-xs text-gray-500">Invoice Amount</th>
                        <th className="px-3 py-2 text-right text-xs text-gray-500">Lines</th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {po.goods_receipts.map((gr: any) => (
                          <tr key={gr.id}>
                            <td className="px-3 py-2 font-mono">{gr.reference}</td>
                            <td className="px-3 py-2">{gr.received_date ? format(new Date(gr.received_date), 'dd MMM yyyy') : '-'}</td>
                            <td className="px-3 py-2">{gr.receiver?.name ?? '-'}</td>
                            <td className="px-3 py-2">{gr.invoice_number ?? '-'}</td>
                            <td className="px-3 py-2 text-right">{gr.invoice_amount ? formatAmount(parseFloat(gr.invoice_amount)) : '-'}</td>
                            <td className="px-3 py-2 text-right">{gr.items?.length ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PurchasesPage() {
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [receivingPO, setReceivingPO] = useState<any>(null);
  const qc = useQueryClient();
  const { format: formatAmount } = useCurrencyStore();

  const { data: branchData } = useQuery({ queryKey: ['branches'], queryFn: () => branchesApi.list().then(r => r.data?.data || []), staleTime: 120000 });
  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', search, branchId, page],
    queryFn: () => purchaseOrdersApi.list({ search, page, per_page: 20, ...(branchId ? { branch_id: Number(branchId) } : {}) }).then(r => r.data?.data),
  });
  const approveMutation = useMutation({
    mutationFn: (id: number) => offlineMutate(() => purchaseOrdersApi.approve(id), 'purchase_orders', 'approve', { _url: `/purchase-orders/${id}/approve`, _method: 'POST' }, id),
    onSuccess: (result) => {
      if (result.offline) toast.success('Approval saved offline - will sync when server is back');
      else { toast.success('PO approved'); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); }
    },
  });

  const orders = data?.data || [];
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1><p className="text-gray-500 text-sm">Manage stock replenishment orders</p></div>
        <button type="button" onClick={() => setShowModal(true)} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-gray-900 font-semibold px-4 py-2.5 rounded-md text-sm"><Plus size={16} /> New PO</button>
      </div>
      <div className="bg-white rounded-md shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 max-w-sm"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search orders..." className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" /></div>
          {(branchData as any[] || []).length > 1 && (
            <select value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1); }} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
              <option value="">All Branches</option>
              {(branchData as any[]).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
        {isLoading ? <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-amber-500" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50"><tr>{['Reference', 'Date', 'Supplier', 'Items', 'Total', 'Status', 'Actions'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">
                {orders.length === 0 ? <tr><td colSpan={7} className="text-center py-12 text-gray-400"><Truck size={32} className="mx-auto mb-2" /><p>No purchase orders</p></td></tr>
                  : orders.map((o: any) => (
                    <tr key={o.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-mono font-medium text-gray-900">{o.reference}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{format(new Date(o.created_at), 'dd MMM yyyy')}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{o.supplier?.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{o.items_count || o.items?.length || '-'}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-amber-600">{formatAmount(parseFloat(o.total || 0))}</td>
                      <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[o.status] || 'bg-gray-100 text-gray-600'}`}>{o.status?.replace('_', ' ')}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => setViewingId(o.id)} title="View / Print" className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Eye size={14} /></button>
                          {(o.status === 'draft' || o.status === 'pending' || o.status === 'pending_approval') && (
                            <button type="button" onClick={() => { if (confirm('Approve this PO?')) approveMutation.mutate(o.id); }} title="Approve" className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"><CheckCircle size={14} /></button>
                          )}
                          {RECEIVABLE_STATUSES.includes(o.status) && (
                            <button type="button" onClick={() => setViewingId(o.id)} title="Receive Goods" className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg"><PackageCheck size={14} /></button>
                          )}
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
      {showModal && <POModal onClose={() => setShowModal(false)} />}
      {viewingId != null && (
        <PODetailModal
          id={viewingId}
          onClose={() => setViewingId(null)}
          onReceive={(po) => setReceivingPO(po)}
        />
      )}
      {receivingPO && (
        <GoodsReceiptModal
          po={receivingPO}
          onClose={() => { setReceivingPO(null); setViewingId(null); }}
        />
      )}
    </div>
  );
}
