import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { branchesApi } from '../api';
import { useAuthStore } from '../stores/authStore';

/**
 * Admin-only branch picker. Every other role is locked to their own branch by
 * the backend (BaseApiController::effectiveBranchId), so nothing is rendered
 * for them. An empty value means "all branches combined".
 */
export default function BranchFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isAdmin = useAuthStore((s) => s.hasRole('admin'));

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.list().then(r => r.data?.data || []),
    staleTime: 120000,
    enabled: isAdmin,
  });

  if (!isAdmin) return null;

  return (
    <label className="inline-flex items-center gap-2 border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm">
      <Building2 size={14} className="text-gray-400" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent focus:outline-none"
        aria-label="Branch"
      >
        <option value="">All Branches</option>
        {(branches as any[]).map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
    </label>
  );
}
