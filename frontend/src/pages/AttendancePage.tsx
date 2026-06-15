import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/axios';
import { useAuthStore } from '../stores/authStore';
import { Clock, LogIn, LogOut, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AttendancePage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [pinModal, setPinModal] = useState(false);
  const [pin, setPin] = useState('');
  const [pinAction, setPinAction] = useState<'clock_in' | 'clock_out'>('clock_in');
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading } = useQuery({
    queryKey: ['attendance', dateFrom, dateTo],
    queryFn: () => api.get('/attendance', { params: { date_from: dateFrom, date_to: dateTo } }).then(r => r.data?.data),
  });

  const clockMutation = useMutation({
    mutationFn: (action: 'clock_in' | 'clock_out') => api.post(`/attendance/${action}`),
    onSuccess: (_, action) => { toast.success(action === 'clock_in' ? 'Clocked in!' : 'Clocked out!'); qc.invalidateQueries({ queryKey: ['attendance'] }); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const pinLoginMutation = useMutation({
    mutationFn: (p: string) => api.post('/auth/pin-login', { pin: p }),
    onSuccess: () => { toast.success('PIN verified - clocking in!'); clockMutation.mutate(pinAction); setPinModal(false); setPin(''); },
    onError: () => toast.error('Invalid PIN'),
  });

  const records: any[] = data?.data ?? data ?? [];

  const todayRecord = records.find((r: any) => r.user_id === user?.id && r.date === dateFrom);
  const isClockedIn = todayRecord && !todayRecord.clock_out;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Attendance</h1>
        <p className="text-sm text-gray-500 mt-1">Clock in/out and view attendance history</p>
      </div>

      {/* Clock In/Out Card */}
      <div className="bg-white rounded-lg border border-gray-100 p-6 flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Current Status</p>
          <p className="text-lg font-bold text-gray-900 mt-1 flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${isClockedIn ? 'bg-emerald-500' : 'bg-gray-300'}`} />
            {isClockedIn ? 'Clocked In' : 'Not Clocked In'}
          </p>
          {isClockedIn && todayRecord?.clock_in && (
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1"><Clock size={12} /> Since {new Date(todayRecord.clock_in).toLocaleTimeString()}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setPinAction('clock_in'); setPinModal(true); }}
            disabled={!!isClockedIn || clockMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40"
          >
            <LogIn size={16} /> Clock In
          </button>
          <button
            onClick={() => { setPinAction('clock_out'); setPinModal(true); }}
            disabled={!isClockedIn || clockMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-md text-sm font-semibold hover:bg-amber-600 disabled:opacity-40"
          >
            <LogOut size={16} /> Clock Out
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Calendar size={16} className="text-gray-400" />
        <div className="flex items-center gap-2">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className="text-gray-400 text-sm">to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {/* Attendance Table */}
      <div className="bg-white rounded-lg border border-gray-100 overflow-hidden">
        {isLoading ? <div className="p-8 text-center text-gray-400">Loading...</div> : records.length === 0 ? (
          <div className="p-8 text-center text-gray-400"><Clock size={32} className="mx-auto mb-2" /><p>No attendance records</p></div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-xs font-semibold text-gray-500 uppercase">
                <th className="text-left px-4 py-3">Staff</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Clock In</th>
                <th className="text-left px-4 py-3">Clock Out</th>
                <th className="text-right px-4 py-3">Hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {records.map((r: any) => {
                const hours = r.clock_in && r.clock_out
                  ? ((new Date(r.clock_out).getTime() - new Date(r.clock_in).getTime()) / 3600000).toFixed(1)
                  : null;
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">{r.user?.name ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{r.date ?? new Date(r.clock_in).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-sm text-emerald-600">{r.clock_in ? new Date(r.clock_in).toLocaleTimeString() : '-'}</td>
                    <td className="px-4 py-3 text-sm text-amber-600">{r.clock_out ? new Date(r.clock_out).toLocaleTimeString() : <span className="text-blue-500 text-xs font-medium">Active</span>}</td>
                    <td className="px-4 py-3 text-sm text-right font-bold">{hours ? `${hours}h` : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* PIN Login Modal */}
      {pinModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-xs p-6 space-y-4">
            <h2 className="font-bold text-gray-900 text-center">Enter PIN to {pinAction === 'clock_in' ? 'Clock In' : 'Clock Out'}</h2>
            <input
              type="password"
              value={pin}
              onChange={e => setPin(e.target.value)}
              maxLength={6}
              placeholder="-¢â‚¬Â¢-¢â‚¬Â¢-¢â‚¬Â¢"
              autoFocus
              className="w-full text-center text-2xl tracking-widest border border-gray-200 rounded-md px-3 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={e => { if (e.key === 'Enter' && pin.length >= 4) pinLoginMutation.mutate(pin); }}
            />
            <div className="flex gap-2">
              <button onClick={() => { setPinModal(false); setPin(''); }} className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-md text-sm font-semibold hover:bg-gray-50">Cancel</button>
              <button onClick={() => pinLoginMutation.mutate(pin)} disabled={pin.length < 4 || pinLoginMutation.isPending} className="flex-1 py-2.5 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
