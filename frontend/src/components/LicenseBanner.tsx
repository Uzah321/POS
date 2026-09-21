import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, Lock } from 'lucide-react';
import { licenseApi } from '../api';
import { useAuthStore } from '../stores/authStore';

/** Shown across the app when the license is about to lapse, or already has (the app is then read-only). */
export default function LicenseBanner() {
  const canManage = useAuthStore((s) => s.hasPermission('manage_settings') || s.hasRole('admin'));
  const { data } = useQuery({
    queryKey: ['license-status'],
    queryFn: () => licenseApi.status().then(r => r.data?.data),
    refetchInterval: 10 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  if (!data?.enforced || !['expiring', 'expired', 'revoked', 'invalid', 'unlicensed'].includes(data.state)) return null;

  const locked = data.state !== 'expiring';
  const message =
    data.state === 'expiring' ? `Your license expires in ${Math.max(data.days_left, 0)} day${data.days_left === 1 ? '' : 's'}. Renew to avoid interruption.`
    : data.state === 'unlicensed' ? 'This system has no license. It is read-only until one is activated.'
    : data.state === 'revoked' ? 'Your license has been revoked. The system is read-only — contact support.'
    : data.state === 'invalid' ? 'The stored license is invalid. The system is read-only until it is re-activated.'
    : 'Your license has expired. The system is read-only — sales and changes are blocked until it is renewed.';

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 text-sm font-medium ${locked ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-900 border-b border-amber-200'}`}>
      {locked ? <Lock size={16} /> : <AlertTriangle size={16} />}
      <span className="flex-1">{message}</span>
      {canManage && (
        <Link to="/license" className={`underline font-semibold whitespace-nowrap ${locked ? 'text-white' : 'text-amber-900'}`}>
          Manage license
        </Link>
      )}
    </div>
  );
}
