import { Plus, ChefHat, Scale as ScaleIcon } from 'lucide-react';

// Large, image-led, touch-sized product card shared by POSPage (restaurant)
// and CashierPage (supermarket) — replaces the old ~64px flex-wrap tiles.
// Color/stock resolution stays in each page (it depends on page-level
// category maps / tile-theme settings); this component only renders the
// already-resolved values, so both screens visually stay one system.
export default function ProductCard({
  product, onClick, solidColor, categoryColor, textColor, isOutOfStock,
  highlighted, priceLabel, innerRef,
}: {
  product: any;
  onClick: () => void;
  solidColor?: string;
  categoryColor?: string;
  textColor?: string;
  isOutOfStock: boolean;
  highlighted: boolean;
  priceLabel: string;
  innerRef?: (el: HTMLButtonElement | null) => void;
}) {
  const borderColor = solidColor || categoryColor;
  const accentText = solidColor ? textColor : undefined;
  const priceColor = solidColor ? textColor : (categoryColor || '#1d4ed8');

  // Same Chromium "force dark mode" repaint workaround as the category chips
  // and the original tile grid — a plain background-color can silently fail
  // to paint on some browsers/extensions, but box-shadow (inset, !important)
  // survives it.
  const applyCardStyle = (el: HTMLButtonElement | null) => {
    innerRef?.(el);
    if (!el) return;
    if (borderColor) el.style.setProperty('border-color', borderColor, 'important');
    else el.style.removeProperty('border-color');
    if (isOutOfStock) {
      el.style.setProperty('filter', 'grayscale(1)', 'important');
      el.style.setProperty('opacity', '0.55', 'important');
    } else {
      el.style.removeProperty('filter');
      el.style.removeProperty('opacity');
    }
  };
  const applyImageAreaStyle = (el: HTMLDivElement | null) => {
    if (!el) return;
    if (!product.image && solidColor) {
      el.style.setProperty('box-shadow', `inset 0 0 0 200px ${solidColor}`, 'important');
    } else if (!product.image && categoryColor) {
      el.style.setProperty('box-shadow', `inset 0 0 0 200px ${categoryColor}33`, 'important');
    } else {
      el.style.removeProperty('box-shadow');
    }
  };

  return (
    <button
      type="button"
      ref={applyCardStyle}
      title={isOutOfStock ? `${product.name} — Out of stock` : `${product.name} — ${priceLabel}`}
      onClick={onClick}
      className={`relative flex flex-col text-left rounded-xl border-2 bg-white overflow-hidden transition-all touch-manipulation shadow-sm hover:shadow-md
        ${isOutOfStock ? 'cursor-not-allowed' : 'hover:-translate-y-0.5'}
        ${borderColor ? '' : 'border-gray-100'}
        ${highlighted ? 'outline outline-[3px] outline-blue-500 outline-offset-1 z-10' : ''}`}
    >
      {/* Image / color-fallback area */}
      <div ref={applyImageAreaStyle} className={`relative w-full h-[86px] flex items-center justify-center overflow-hidden ${product.image || solidColor || categoryColor ? '' : 'bg-gray-50'}`}>
        {product.image ? (
          <img src={product.image} alt="" className="w-full h-full object-cover" />
        ) : (
          <span
            className="text-4xl font-black select-none"
            style={{ color: accentText ?? (categoryColor ?? '#94a3b8'), opacity: solidColor ? 0.35 : 0.5 }}
          >
            {product.name?.[0]?.toUpperCase() ?? '?'}
          </span>
        )}

        {product.made_to_order && (
          <span title="Made on Order — prepared fresh from its recipe" className="absolute top-1 right-1 flex items-center justify-center w-6 h-6 rounded-full bg-orange-500 text-white shadow">
            <ChefHat size={13} />
          </span>
        )}
        {product.sold_by_weight && (
          <span title="Sold by weight — reads from the scale" className="absolute top-1 left-1 flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white shadow">
            <ScaleIcon size={13} />
          </span>
        )}
        {isOutOfStock && (
          <span className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] font-bold text-center uppercase tracking-wide py-0.5">
            Out of stock
          </span>
        )}
      </div>

      {/* Label strip */}
      <div className="flex-1 flex flex-col gap-0.5 px-2.5 py-1.5 pr-8 min-h-[46px] justify-center">
        <span className="text-[12.5px] font-bold leading-tight text-gray-800 line-clamp-2">{product.name}</span>
        <span className="text-[13px] font-black tabular-nums leading-none" style={{ color: priceColor }}>{priceLabel}</span>
      </div>

      {/* Floating add badge — whole card is the tap target already */}
      <span className="absolute bottom-1.5 right-1.5 w-7 h-7 rounded-lg bg-emerald-500 text-white flex items-center justify-center shadow-md pointer-events-none">
        <Plus size={16} strokeWidth={3} />
      </span>
    </button>
  );
}
