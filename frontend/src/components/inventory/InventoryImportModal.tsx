import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, warehousesApi } from '../../api';
import { parseExcelFile, exportToExcel } from '../../utils/excel';
import { X, Upload, FileSpreadsheet, Download, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface ImportRow {
  name: string;
  sku?: string;
  barcode?: string;
  category?: string;
  cost_price?: number | string;
  selling_price?: number | string;
  quantity?: number | string;
  reorder_level?: number | string;
  unit?: string;
}

export default function InventoryImportModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows]           = useState<ImportRow[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [preview, setPreview]     = useState(false);
  const [result, setResult]       = useState<any>(null);

  const { data: wData } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehousesApi.list().then(r => r.data?.data || []) });
  const warehouses = wData || [];

  const importMutation = useMutation({
    mutationFn: (data: object) => inventoryApi.importStock(data),
    onSuccess: (res) => {
      setResult(res.data?.data);
      qc.invalidateQueries({ queryKey: ['stock-levels'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Import complete!');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Import failed'),
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseExcelFile(file);
      if (parsed.length === 0) { toast.error('No data rows found in file'); return; }
      setRows(parsed as unknown as ImportRow[]);
      setPreview(true);
      setResult(null);
    } catch { toast.error('Could not read file - ensure it is .xlsx or .csv'); }
  };

  const downloadTemplate = () => {
    exportToExcel(
      [
        ['name', 'sku', 'barcode', 'category', 'cost_price', 'selling_price', 'quantity', 'reorder_level', 'unit'],
        ['Pampers Size 3', 'PAM-S3', '6001101234567', 'Diapers', '12.50', '18.00', '100', '10', 'Pack'],
        ['Huggies Newborn', 'HUG-NB', '', 'Diapers', '10.00', '15.00', '50', '5', 'Pack'],
        ['Baby Wipes 80ct', 'WIP-80', '', 'Baby Wipes', '4.00', '6.50', '200', '20', 'Pack'],
      ],
      'stock-import-template'
    );
  };

  const handleImport = () => {
    if (!warehouseId) { toast.error('Select a warehouse first'); return; }
    if (rows.length === 0) { toast.error('No rows to import'); return; }
    importMutation.mutate({ rows, warehouse_id: Number(warehouseId) });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-lg w-full max-w-3xl shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Import Products from Excel</h2>
            <p className="text-sm text-gray-500">Upload an .xlsx or .csv file to bulk-add or update products and stock levels</p>
          </div>
          <button type="button" onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Result */}
          {result && (
            <div className={`rounded-md p-4 border ${result.errors?.length ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle size={18} className="text-green-600" />
                <span className="font-semibold text-green-800">Import Complete</span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="text-center bg-white rounded-lg p-3 border border-green-100">
                  <p className="text-2xl font-bold text-green-600">{result.created}</p>
                  <p className="text-gray-500">Created</p>
                </div>
                <div className="text-center bg-white rounded-lg p-3 border border-blue-100">
                  <p className="text-2xl font-bold text-blue-600">{result.updated}</p>
                  <p className="text-gray-500">Updated</p>
                </div>
                <div className="text-center bg-white rounded-lg p-3 border border-gray-100">
                  <p className="text-2xl font-bold text-gray-500">{result.skipped}</p>
                  <p className="text-gray-500">Skipped</p>
                </div>
              </div>
              {result.errors?.length > 0 && (
                <div className="mt-3 space-y-1">
                  {result.errors.map((err: string, i: number) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-red-700"><AlertCircle size={12} className="mt-0.5 flex-shrink-0" />{err}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 1: Template */}
          <div className="bg-blue-50 rounded-md p-4 border border-blue-100">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-blue-900 text-sm">Step 1 - Download template</p>
                <p className="text-xs text-blue-700 mt-0.5">Fill in the template with your product data, then upload it below</p>
                <p className="text-xs text-blue-600 mt-1">Required column: <strong>name</strong> &nbsp;|&nbsp; Optional: sku, barcode, category, cost_price, selling_price, quantity, reorder_level, unit</p>
                <p className="text-xs text-blue-600 mt-1">Also accepts supplier-style sheets with columns like <strong>product_name</strong>, <strong>unit_cost</strong>, <strong>unit_selling_price</strong>, and <strong>in_stock</strong>.</p>
              </div>
              <button type="button" onClick={downloadTemplate}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-lg flex-shrink-0 ml-4">
                <Download size={14} /> Template
              </button>
            </div>
          </div>

          {/* Step 2: Warehouse */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Step 2 - Select warehouse for stock quantities *</label>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Select warehouse...</option>
              {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>

          {/* Step 3: Upload */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Step 3 - Upload your filled file</p>
            <button type="button" onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-300 hover:border-blue-400 rounded-md p-8 flex flex-col items-center gap-3 text-gray-500 hover:text-blue-600 transition-colors">
              <FileSpreadsheet size={36} />
              <div className="text-center">
                <p className="font-medium">{rows.length > 0 ? `${rows.length} rows loaded - click to replace` : 'Click to select .xlsx or .csv'}</p>
                <p className="text-xs text-gray-400 mt-0.5">Accepts Excel (.xlsx) and CSV (.csv) files</p>
              </div>
              {rows.length > 0 && <span className="bg-green-100 text-green-700 text-xs font-medium px-3 py-1 rounded-full">{rows.length} rows ready</span>}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
          </div>

          {/* Preview table */}
          {preview && rows.length > 0 && (
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Preview ({rows.length} rows)</span>
                <span className="text-xs text-gray-400">Showing first 10</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>{Object.keys(rows[0]).map(k => <th key={k} className="px-3 py-2 text-left text-gray-500 font-semibold uppercase">{k}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.slice(0, 10).map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        {Object.values(row).map((v, j) => <td key={j} className="px-3 py-2 text-gray-700 max-w-[140px] truncate">{String(v ?? '')}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 10 && <div className="px-4 py-2 text-xs text-gray-400 border-t bg-gray-50">...and {rows.length - 10} more rows</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t flex-shrink-0">
          <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-md text-sm font-medium hover:bg-gray-50">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button type="button" onClick={handleImport}
              disabled={importMutation.isPending || rows.length === 0 || !warehouseId}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-md text-sm flex items-center justify-center gap-2 disabled:opacity-50">
              {importMutation.isPending ? <><Loader2 size={14} className="animate-spin" /> Importing...</> : <><Upload size={14} /> Import {rows.length > 0 ? `${rows.length} Rows` : ''}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
