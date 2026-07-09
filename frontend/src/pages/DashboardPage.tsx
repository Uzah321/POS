import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../api';
import BusinessTypeModal from '../components/BusinessTypeModal';
import RestaurantDashboard from './RestaurantDashboard';
import SupermarketDashboard from './SupermarketDashboard';
import { Loader2 } from 'lucide-react';

type BizType = 'restaurant' | 'supermarket';

export default function DashboardPage() {
  const [overrideType, setOverrideType] = useState<BizType | null>(null);
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get().then(r => r.data?.data || {}),
  });

  const changeMutation = useMutation({
    mutationFn: (type: BizType) => settingsApi.update({ business_type: type }),
    onSuccess: (_, type) => {
      // Instantly update nav without waiting for a round-trip refetch
      qc.setQueryData(['settings'], (old: any) => old ? { ...old, business_type: type } : { business_type: type });
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const businessType: BizType | null = (overrideType ?? settings?.business_type ?? null) as BizType | null;

  const handleModalSelect = (type: BizType) => {
    setOverrideType(type);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 gap-2 text-gray-400">
        <Loader2 size={20} className="animate-spin" /> Loading dashboard...
      </div>
    );
  }

  return (
    <div>
      {/* Business type not set — show first-run modal */}
      {!businessType && (
        <BusinessTypeModal onSelect={handleModalSelect} />
      )}

      {/* Switch business type link — always visible in top-right corner */}
      {businessType && (
        <div className="flex justify-end mb-1">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="capitalize">{businessType} mode</span>
            <span className="text-gray-300">·</span>
            <button
              type="button"
              onClick={() => {
                const next: BizType = businessType === 'restaurant' ? 'supermarket' : 'restaurant';
                setOverrideType(next);
                changeMutation.mutate(next);
              }}
              className="text-blue-500 hover:text-blue-600 font-medium transition-colors"
            >
              Switch to {businessType === 'restaurant' ? 'Supermarket' : 'Restaurant'}
            </button>
          </div>
        </div>
      )}

      {/* Render the correct dashboard */}
      {businessType === 'restaurant'  && <RestaurantDashboard />}
      {businessType === 'supermarket' && <SupermarketDashboard />}

      {/* If type selected in modal but API hasn't updated yet */}
      {!businessType && <div className="h-64" />}
    </div>
  );
}
