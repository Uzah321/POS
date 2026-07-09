/**
 * SearchModal — touch-friendly text-search overlay for touchscreen POS.
 *
 * Opens a full-screen modal with a large auto-focused text input.
 * On Windows touchscreen, auto-focusing an input inside a modal reliably
 * triggers the Windows touch keyboard even when desktop-mode auto-invoke
 * is disabled via registry.
 */
import { useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

interface SearchModalProps {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  placeholder?: string;
  label?: string;
}

export default function SearchModal({
  value,
  onChange,
  onClose,
  placeholder = 'Search...',
  label = 'Search',
}: SearchModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus triggers Windows touch keyboard
  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 80);
    return () => clearTimeout(t);
  }, []);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter') onClose();
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-start justify-center bg-black/60 pt-16 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
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

        {/* Input */}
        <div className="p-4">
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={e => onChange(e.target.value)}
              onKeyDown={handleKey}
              placeholder={placeholder}
              className="w-full pl-11 pr-4 py-4 text-lg border-2 border-blue-400 focus:border-blue-600 rounded-xl bg-blue-50 focus:bg-white focus:outline-none transition-colors"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        </div>

        {/* Hint */}
        <div className="px-5 pb-4 text-xs text-gray-400 text-center">
          Type to search · Press Enter or tap ✕ when done
        </div>
      </div>
    </div>
  );
}
