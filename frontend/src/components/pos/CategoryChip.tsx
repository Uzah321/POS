import { contrastText } from '../../lib/tileColors';
import { iconForCategory } from '../../lib/categoryIcons';

// Bigger, colorful, icon-led category button for the POS/Cashier screens —
// shared so the restaurant and supermarket tills feel like one visual system.
export default function CategoryChip({
  label, displayLabel, active, color, onClick, title,
}: {
  label: string;
  displayLabel?: string;
  active: boolean;
  color?: string;
  onClick: () => void;
  title?: string;
}) {
  const Icon = iconForCategory(label);
  const textColor = color ? contrastText(color) : undefined;

  // Same reasoning as the product tiles: some browsers/extensions (Chromium's
  // "force dark mode for web content", confirmed on a Brave till) repaint a
  // plain background-color after the fact even with !important, while
  // box-shadow survives — see POSPage's applyTileStyle for the original.
  const applyStyle = (el: HTMLButtonElement | null) => {
    if (!el) return;
    if (color) {
      el.style.setProperty('box-shadow', `inset 0 0 0 100px ${active ? color : `${color}1f`}`, 'important');
      el.style.setProperty('border-color', active ? 'transparent' : color, 'important');
    } else {
      el.style.removeProperty('box-shadow');
      el.style.removeProperty('border-color');
    }
  };

  return (
    <button
      type="button"
      ref={applyStyle}
      title={title ?? label}
      onClick={onClick}
      style={textColor ? { color: textColor } : undefined}
      className={`flex-shrink-0 flex flex-col items-center justify-center gap-1 min-w-[92px] min-h-[76px] px-3 py-2 rounded-xl border-2 font-bold text-xs text-center leading-tight transition-all touch-manipulation
        ${!color && active ? 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-200' : ''}
        ${!color && !active ? 'bg-white border-gray-100 text-gray-600 shadow-sm hover:border-blue-200 hover:text-blue-700' : ''}
        ${color ? 'shadow-sm hover:-translate-y-0.5' : ''}`}
    >
      <Icon size={22} strokeWidth={2.25} />
      <span className="line-clamp-2">{displayLabel ?? label}</span>
    </button>
  );
}
