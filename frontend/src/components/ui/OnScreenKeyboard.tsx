/**
 * OnScreenKeyboard — touch-friendly virtual QWERTY keyboard for touchscreen POS.
 *
 * Renders an actual tappable keyboard (not another text input) so cashiers on
 * touchscreens without a reliable native OS keyboard can type without a
 * physical keyboard.
 */
import { useEffect, useRef, useState } from 'react';
import { Delete, X, CornerDownLeft, ArrowBigUp } from 'lucide-react';

interface OnScreenKeyboardProps {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  placeholder?: string;
  label?: string;
}

const ROW_1 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const ROW_2 = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'];
const ROW_3 = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'];
const ROW_4 = ['z', 'x', 'c', 'v', 'b', 'n', 'm', '-', '_'];

function KeyButton({
  label,
  onPress,
  className = '',
  children,
}: {
  label?: string;
  onPress: () => void;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={`h-11 flex items-center justify-center rounded-lg bg-white border border-gray-200 text-gray-800 font-medium shadow-sm hover:bg-blue-50 active:bg-blue-100 active:scale-95 transition-all touch-manipulation select-none ${className}`}
    >
      {children ?? label}
    </button>
  );
}

export default function OnScreenKeyboard({
  value,
  onChange,
  onClose,
  placeholder = 'Search...',
  label = 'Search',
}: OnScreenKeyboardProps) {
  const [shift, setShift] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const press = (ch: string) => onChange(value + (shift ? ch.toUpperCase() : ch));
  const backspace = () => onChange(value.slice(0, -1));
  const clear = () => onChange('');
  const space = () => onChange(value + ' ');

  // This modal is the only input surface on screen while it's open, so it
  // should accept typing from a physical/external keyboard too, not just
  // taps — focus it on open and forward real keystrokes the same way the
  // on-screen keys do.
  useEffect(() => { ref.current?.focus(); }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Backspace') { e.preventDefault(); backspace(); return; }
    if (e.key === 'Enter') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === ' ') { e.preventDefault(); space(); return; }
    if (e.key === 'Shift') { return; }
    if (e.key.length === 1) { e.preventDefault(); onChange(value + e.key); }
  };

  return (
    <div
      ref={ref}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/60 p-4 outline-none"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 touch-manipulation"
          >
            <X size={18} />
          </button>
        </div>

        {/* Display */}
        <div className="p-4 pb-2">
          <div className="w-full px-4 py-3 text-lg border-2 border-blue-400 rounded-xl bg-blue-50 min-h-[52px] flex items-center overflow-x-auto whitespace-nowrap">
            {value ? <span>{value}</span> : <span className="text-gray-400">{placeholder}</span>}
          </div>
        </div>

        {/* Keyboard */}
        <div className="px-4 pb-4 space-y-1.5">
          <div className="grid grid-cols-10 gap-1.5">
            {ROW_1.map((k) => (
              <KeyButton key={k} label={k} onPress={() => press(k)} />
            ))}
          </div>
          <div className="grid grid-cols-10 gap-1.5">
            {ROW_2.map((k) => (
              <KeyButton key={k} label={shift ? k.toUpperCase() : k} onPress={() => press(k)} />
            ))}
          </div>
          <div className="grid grid-cols-9 gap-1.5 px-4">
            {ROW_3.map((k) => (
              <KeyButton key={k} label={shift ? k.toUpperCase() : k} onPress={() => press(k)} />
            ))}
          </div>
          <div className="grid grid-cols-11 gap-1.5">
            <KeyButton
              label="Shift"
              onPress={() => setShift((s) => !s)}
              className={`col-span-2 ${shift ? 'bg-blue-500 text-white border-blue-600' : ''}`}
            >
              <ArrowBigUp size={16} />
            </KeyButton>
            {ROW_4.map((k) => (
              <KeyButton key={k} label={shift && /[a-z]/.test(k) ? k.toUpperCase() : k} onPress={() => press(k)} className="col-span-1" />
            ))}
            <KeyButton label="Backspace" onPress={backspace} className="col-span-2">
              <Delete size={16} />
            </KeyButton>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            <KeyButton label="Clear" onPress={clear} className="col-span-1 text-red-600" />
            <KeyButton label="Space" onPress={space} className="col-span-3" />
            <KeyButton
              label="Done"
              onPress={onClose}
              className="col-span-2 bg-blue-600 text-white border-blue-700 hover:bg-blue-700"
            >
              <span className="flex items-center gap-1.5"><CornerDownLeft size={16} /> Done</span>
            </KeyButton>
          </div>
        </div>
      </div>
    </div>
  );
}
