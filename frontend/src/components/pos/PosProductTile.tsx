import { Plus, ChefHat, Scale as ScaleIcon } from 'lucide-react';

/**
 * Advanced POS (restaurant) product card: white rounded card, product photo,
 * name, bold blue price and a green "+" button. The whole card is the tap
 * target. Colour/stock resolution stays in POSPage; this only renders it.
 */
export default function PosProductTile({
  product, onClick, tint, isOutOfStock, highlighted, priceLabel, innerRef,
}: {
  product: any;
  onClick: () => void;
  /** Background for the photo area when the product has no image. */
  tint?: string;
  isOutOfStock: boolean;
  highlighted: boolean;
  priceLabel: string;
  innerRef?: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      type="button"
      ref={innerRef}
      title={isOutOfStock ? `${product.name} — Out of stock` : `${product.name} — ${priceLabel}`}
      onClick={onClick}
      className={`relative flex flex-col text-left bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-sm transition-all touch-manipulation
        ${isOutOfStock ? 'cursor-not-allowed grayscale opacity-60' : 'hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]'}
        ${highlighted ? 'outline outline-[3px] outline-blue-500 outline-offset-1 z-10' : ''}`}
    >
      <div
        className="relative w-full h-[clamp(90px,13.5vh,136px)] flex items-center justify-center overflow-hidden"
        style={!product.image && tint ? { background: tint } : undefined}
      >
        {product.image ? (
          <img src={product.image} alt="" className="w-full h-full object-contain p-1" />
        ) : (
          <span className="text-4xl font-black select-none text-slate-300">{product.name?.[0]?.toUpperCase() ?? '?'}</span>
        )}
        {product.made_to_order && (
          <span title="Made on Order — prepared fresh from its recipe" className="absolute top-2 right-2 flex items-center justify-center w-6 h-6 rounded-lg bg-orange-500 text-white shadow">
            <ChefHat size={13} />
          </span>
        )}
        {product.sold_by_weight && (
          <span title="Sold by weight — reads from the scale" className="absolute top-2 left-2 flex items-center justify-center w-6 h-6 rounded-lg bg-blue-500 text-white shadow">
            <ScaleIcon size={13} />
          </span>
        )}
        {isOutOfStock && (
          <span className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] font-bold text-center uppercase tracking-wide py-0.5">
            Out of stock
          </span>
        )}
      </div>

      <div className="px-2.5 pt-1 pb-2 pr-11 min-h-[52px] flex flex-col justify-center gap-0.5">
        <span className="text-[12px] font-semibold leading-tight text-slate-800 line-clamp-2">{product.name}</span>
        <span className="text-[15px] font-bold tabular-nums leading-none" style={{ color: '#1f5fe0' }}>{priceLabel}</span>
      </div>

      <span className="absolute bottom-2 right-2 w-8 h-8 rounded-lg text-white flex items-center justify-center shadow pointer-events-none" style={{ background: '#10a37f' }}>
        <Plus size={18} strokeWidth={3} />
      </span>
    </button>
  );
}
