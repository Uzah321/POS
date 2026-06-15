import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../api';

type BizType = 'restaurant' | 'supermarket';

const OPTIONS: { type: BizType; label: string; desc: string; icon: React.ReactNode; accent: string }[] = [
  {
    type: 'restaurant',
    label: 'Restaurant',
    desc: 'Food service, kitchen orders, table management, covers tracking and order queue display.',
    accent: 'border-orange-400 bg-orange-50 text-orange-600',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" className="w-16 h-16" stroke="currentColor" strokeWidth="1.5">
        <path d="M16 4v16c0 4.418 3.582 8 8 8s8-3.582 8-8V4" strokeLinecap="round"/>
        <line x1="24" y1="28" x2="24" y2="44" strokeLinecap="round"/>
        <line x1="16" y1="44" x2="32" y2="44" strokeLinecap="round"/>
        <path d="M8 4c0 0 0 8 4 12" strokeLinecap="round"/>
        <path d="M8 4v8" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    type: 'supermarket',
    label: 'Supermarket / Retail',
    desc: 'Product scanning, inventory management, stock levels, payment methods and sales reports.',
    accent: 'border-blue-500 bg-blue-50 text-blue-600',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" className="w-16 h-16" stroke="currentColor" strokeWidth="1.5">
        <path d="M6 8h4l5 24h18l4-16H14" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="20" cy="38" r="2.5" fill="currentColor" stroke="none"/>
        <circle cx="32" cy="38" r="2.5" fill="currentColor" stroke="none"/>
        <path d="M18 20h12M18 25h8" strokeLinecap="round"/>
      </svg>
    ),
  },
];

interface Props {
  onSelect: (type: BizType) => void;
}

export default function BusinessTypeModal({ onSelect }: Props) {
  const [selected, setSelected]   = useState<BizType | null>(null);
  const [saving, setSaving]       = useState(false);
  const qc                        = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (type: BizType) => settingsApi.update({ business_type: type }),
    onSuccess: (_, type) => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      onSelect(type);
    },
  });

  const confirm = async () => {
    if (!selected) return;
    setSaving(true);
    await saveMutation.mutateAsync(selected);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/90 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 overflow-hidden">

        {/* Header */}
        <div className="bg-gray-950 px-8 py-7 text-center">
          <div className="flex justify-center mb-3">
            <svg viewBox="0 0 36 36" fill="none" width="40" height="40">
              <path d="M18 2L32.5 10.25V26.75L18 35L3.5 26.75V10.25Z" fill="#2563eb"/>
              <circle cx="18" cy="18" r="8" stroke="white" strokeWidth="2" fill="none" opacity="0.5"/>
              <circle cx="18" cy="18" r="4" fill="white"/>
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white">Welcome to Core</h2>
          <p className="text-gray-400 text-sm mt-2">Select your business type to get a tailored dashboard</p>
        </div>

        {/* Options */}
        <div className="p-8 grid grid-cols-2 gap-4">
          {OPTIONS.map(opt => (
            <button
              key={opt.type}
              type="button"
              onClick={() => setSelected(opt.type)}
              className={`flex flex-col items-center gap-4 p-6 rounded-xl border-2 transition-all text-left
                ${selected === opt.type
                  ? opt.accent + ' shadow-md scale-[1.02]'
                  : 'border-gray-200 hover:border-gray-300 bg-white text-gray-400 hover:bg-gray-50'
                }`}
            >
              <div className={selected === opt.type ? '' : 'text-gray-300'}>
                {opt.icon}
              </div>
              <div className="text-center">
                <p className={`font-bold text-lg mb-1 ${selected === opt.type ? 'text-gray-900' : 'text-gray-700'}`}>
                  {opt.label}
                </p>
                <p className="text-xs text-gray-500 leading-relaxed">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-8 pb-8 flex justify-center">
          <button
            onClick={confirm}
            disabled={!selected || saving}
            className="px-10 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg
              disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm"
          >
            {saving ? 'Setting up...' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
