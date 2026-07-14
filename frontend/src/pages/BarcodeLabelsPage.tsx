import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { productsApi } from '../api';
import { useCurrencyStore } from '../stores/currencyStore';
import { Search, Printer, Plus, Minus, X, Package, Tag } from 'lucide-react';
import JsBarcode from 'jsbarcode';

const LABEL_SIZES = {
  small:  { label: 'Small',  w: 38,  h: 22, barcodeH: 10, fontSize: 6,  priceSize: 7  },
  medium: { label: 'Medium', w: 57,  h: 32, barcodeH: 16, fontSize: 7,  priceSize: 9  },
  large:  { label: 'Large',  w: 75,  h: 40, barcodeH: 22, fontSize: 8,  priceSize: 11 },
};
type LabelSize = keyof typeof LABEL_SIZES;

interface PrintItem { product: any; qty: number }

function BarcodeLabel({
  product, size, showPrice, showName, currencySymbol,
}: {
  product: any; size: LabelSize; showPrice: boolean; showName: boolean; currencySymbol: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const cfg = LABEL_SIZES[size];
  const barcode = (product.barcode || product.sku || '').trim();

  useEffect(() => {
    if (!svgRef.current || !barcode) return;
    const attempts = [
      barcode.length === 13 ? 'EAN13' : barcode.length === 8 ? 'EAN8' : 'CODE128',
      'CODE128',
    ];
    for (const fmt of attempts) {
      try {
        JsBarcode(svgRef.current, barcode, {
          format: fmt,
          width: size === 'small' ? 1 : size === 'medium' ? 1.2 : 1.5,
          height: cfg.barcodeH,
          displayValue: true,
          fontSize: cfg.fontSize,
          margin: 1,
          background: '#ffffff',
          lineColor: '#000000',
          textMargin: 1,
        });
        return;
      } catch { /* try next */ }
    }
  }, [barcode, size, cfg.barcodeH, cfg.fontSize]);

  return (
    <div style={{
      width: `${cfg.w}mm`,
      height: `${cfg.h}mm`,
      border: '0.3mm solid #777',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0.5mm 1mm',
      background: '#fff',
      overflow: 'hidden',
      boxSizing: 'border-box',
      pageBreakInside: 'avoid',
      breakInside: 'avoid',
    }}>
      {showName && (
        <div style={{
          fontSize: `${cfg.fontSize}pt`,
          fontWeight: 700,
          textAlign: 'center',
          lineHeight: 1.1,
          width: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginBottom: '0.2mm',
        }}>
          {product.name}
        </div>
      )}
      {barcode
        ? <svg ref={svgRef} style={{ maxWidth: '100%', overflow: 'visible', display: 'block' }} />
        : <div style={{ fontSize: `${cfg.fontSize}pt`, color: '#888' }}>No barcode</div>
      }
      {showPrice && (
        <div style={{
          fontSize: `${cfg.priceSize}pt`,
          fontWeight: 800,
          textAlign: 'center',
          marginTop: '0.2mm',
        }}>
          {currencySymbol}{parseFloat(product.selling_price || 0).toFixed(2)}
        </div>
      )}
    </div>
  );
}

export default function BarcodeLabelsPage() {
  const [search, setSearch] = useState('');
  const [printItems, setPrintItems] = useState<PrintItem[]>([]);
  const [labelSize, setLabelSize] = useState<LabelSize>('medium');
  const [showPrice, setShowPrice] = useState(true);
  const [showName, setShowName] = useState(true);
  const { activeCurrency } = useCurrencyStore();

  const { data: searchResults, isFetching } = useQuery({
    queryKey: ['products-barcode-search', search],
    // No search term → show the product list (newest first) so newly-added products
    // are immediately available to assign barcodes to, without typing anything.
    queryFn: () => productsApi.list({ search, per_page: search ? 20 : 50 }).then(r => r.data?.data?.data ?? r.data?.data ?? []),
  });

  const addProduct = (product: any) => {
    setPrintItems(prev => {
      const ex = prev.find(i => i.product.id === product.id);
      if (ex) return prev.map(i => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { product, qty: 1 }];
    });
    setSearch('');
  };

  const removeItem = (id: number) => setPrintItems(prev => prev.filter(i => i.product.id !== id));
  const updateQty = (id: number, delta: number) =>
    setPrintItems(prev => prev.map(i => i.product.id === id ? { ...i, qty: Math.max(1, i.qty + delta) } : i));
  const setQty = (id: number, val: number) =>
    setPrintItems(prev => prev.map(i => i.product.id === id ? { ...i, qty: Math.max(1, val || 1) } : i));

  const totalLabels = printItems.reduce((s, i) => s + i.qty, 0);
  const currencySymbol = activeCurrency?.symbol ?? '$';

  const labelNodes = printItems.flatMap(item =>
    Array.from({ length: item.qty }, (_, idx) => (
      <BarcodeLabel
        key={`${item.product.id}-${idx}`}
        product={item.product}
        size={labelSize}
        showPrice={showPrice}
        showName={showName}
        currencySymbol={currencySymbol}
      />
    ))
  );

  // Inject global print styles once
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'barcode-print-style';
    style.textContent = `
      @media print {
        body > * { visibility: hidden !important; }
        #barcode-print-portal { visibility: visible !important; position: fixed !important; inset: 0 !important; padding: 5mm !important; background: white !important; z-index: 99999 !important; }
        #barcode-print-portal * { visibility: visible !important; }
      }
    `;
    if (!document.getElementById('barcode-print-style')) {
      document.head.appendChild(style);
    }
    return () => { document.getElementById('barcode-print-style')?.remove(); };
  }, []);

  // Print portal rendered directly in body — bypasses all overflow/clip containers
  const printPortal = createPortal(
    <div
      id="barcode-print-portal"
      style={{ display: 'none', flexWrap: 'wrap', gap: '2mm', alignContent: 'flex-start' }}
    >
      {labelNodes}
    </div>,
    document.body
  );

  return (
    <>
      {printPortal}

      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Barcode Labels</h1>
            <p className="text-sm text-gray-500 mt-0.5">Generate printable product barcode stickers</p>
          </div>
          <button
            onClick={() => window.print()}
            disabled={printItems.length === 0}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold px-5 py-2.5 rounded-lg transition-colors"
          >
            <Printer size={16} />
            Print {totalLabels > 0 ? `${totalLabels} Label${totalLabels !== 1 ? 's' : ''}` : 'Labels'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: settings + search + queue */}
          <div className="lg:col-span-1 space-y-4">
            {/* Label settings */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
              <h2 className="font-semibold text-gray-800 text-sm">Label Settings</h2>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Size</p>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.entries(LABEL_SIZES) as [LabelSize, typeof LABEL_SIZES.small][]).map(([key, cfg]) => (
                    <button
                      key={key}
                      onClick={() => setLabelSize(key)}
                      className={`py-2 px-1 rounded-lg border text-xs font-semibold transition-all ${
                        labelSize === key
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      {cfg.label}
                      <span className="block text-[10px] font-normal opacity-75 mt-0.5">
                        {cfg.w}×{cfg.h}mm
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Show on label</p>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={showName} onChange={e => setShowName(e.target.checked)} className="w-4 h-4 accent-blue-600" />
                  <span className="text-sm text-gray-700">Product name</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={showPrice} onChange={e => setShowPrice(e.target.checked)} className="w-4 h-4 accent-blue-600" />
                  <span className="text-sm text-gray-700">Price</span>
                </label>
              </div>
            </div>

            {/* Product search */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <h2 className="font-semibold text-gray-800 text-sm">Add Products</h2>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name or barcode…"
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {!search && (
                <p className="text-xs text-gray-400">Showing all products — search to narrow down</p>
              )}
              <div className="border border-gray-100 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                  {isFetching ? (
                    <div className="py-6 text-center text-xs text-gray-400">{search ? 'Searching…' : 'Loading products…'}</div>
                  ) : !searchResults?.length ? (
                    <div className="py-6 text-center text-xs text-gray-400">No products found</div>
                  ) : (
                    searchResults.map((p: any) => (
                      <button
                        key={p.id}
                        onClick={() => addProduct(p)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-blue-50 text-left transition-colors border-b border-gray-50 last:border-0"
                      >
                        <Package size={14} className="text-gray-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                          <p className="text-xs text-gray-400 font-mono">{p.barcode || p.sku}</p>
                        </div>
                        <Plus size={14} className="text-blue-500 flex-shrink-0" />
                      </button>
                    ))
                  )}
              </div>
            </div>

            {/* Print queue */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-800 text-sm">Print Queue</h2>
                {totalLabels > 0 && (
                  <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                    {totalLabels} label{totalLabels !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {printItems.length === 0 ? (
                <div className="py-6 text-center">
                  <Tag size={28} className="mx-auto text-gray-200 mb-2" />
                  <p className="text-xs text-gray-400">Search and add products above</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {printItems.map(item => (
                    <div key={item.product.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-900 truncate">{item.product.name}</p>
                        <p className="text-[10px] text-gray-400 font-mono">{item.product.barcode || item.product.sku}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => updateQty(item.product.id, -1)}
                          className="w-6 h-6 flex items-center justify-center rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-100"
                        >
                          <Minus size={10} />
                        </button>
                        <input
                          type="number"
                          min={1}
                          value={item.qty}
                          onChange={e => setQty(item.product.id, parseInt(e.target.value))}
                          className="w-10 text-center text-xs font-semibold border border-gray-200 rounded py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          onClick={() => updateQty(item.product.id, 1)}
                          className="w-6 h-6 flex items-center justify-center rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-100"
                        >
                          <Plus size={10} />
                        </button>
                      </div>
                      <button onClick={() => removeItem(item.product.id)} className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setPrintItems([])}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors w-full text-center pt-1"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Preview */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-800 text-sm">Preview</h2>
                {totalLabels > 0 && (
                  <span className="text-xs text-gray-400">Labels print at physical size</span>
                )}
              </div>
              {printItems.length === 0 ? (
                <div className="py-20 text-center">
                  <div className="w-16 h-16 mx-auto bg-gray-100 rounded-xl flex items-center justify-center mb-3">
                    <Tag size={28} className="text-gray-300" />
                  </div>
                  <p className="text-gray-400 font-medium">No labels added yet</p>
                  <p className="text-sm text-gray-300 mt-1">Search and add products from the left panel</p>
                </div>
              ) : (
                <div className="bg-gray-50 rounded-lg p-3 overflow-auto">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignContent: 'flex-start' }}>
                    {labelNodes}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
