import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/axios';
import { Database, Download, Plus, HardDrive } from 'lucide-react';
import toast from 'react-hot-toast';

export default function BackupPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get('/backups').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/backups'),
    onSuccess: () => { toast.success('Backup created!'); qc.invalidateQueries({ queryKey: ['backups'] }); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Backup failed'),
  });

  const backups: any[] = data?.data ?? [];
  const isPostgres = data?.db_connection === 'pgsql';

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownload = (filename: string) => {
    const a = document.createElement('a');
    a.href = `/api/backups/${filename}/download`;
    a.download = filename;
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Backup & Restore</h1>
          <p className="text-sm text-gray-500 mt-1">Create and download database backups</p>
        </div>
        <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
          <Plus size={16} /> {createMutation.isPending ? 'Creating...' : 'Create Backup'}
        </button>
      </div>

      {/* Info card */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-start gap-3">
        <HardDrive size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-800">{isPostgres ? 'PostgreSQL' : 'MariaDB'} Database Backups</p>
          <p className="text-xs text-blue-600 mt-0.5">
            Full database exports (.sql). Download and store them securely. To restore on any machine:{' '}
            <span className="font-mono bg-blue-100 px-1 rounded">
              {isPostgres ? 'psql -U core_pos -d core_pos -f backup.sql' : 'mysql -u core_pos -p core_pos < backup.sql'}
            </span>
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-100 overflow-hidden">
        {isLoading ? <div className="p-8 text-center text-gray-400">Loading...</div> : backups.length === 0 ? (
          <div className="p-8 text-center text-gray-400"><Database size={32} className="mx-auto mb-2" /><p>No backups yet - create one above</p></div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-xs font-semibold text-gray-500 uppercase">
                <th className="text-left px-4 py-3">File</th>
                <th className="text-right px-4 py-3">Size</th>
                <th className="text-left px-4 py-3">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {backups.map((b: any) => (
                <tr key={b.name} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-sm text-gray-700">{b.name}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-500">{formatSize(b.size ?? 0)}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{b.created_at ? new Date(b.created_at * 1000).toLocaleString() : '-'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleDownload(b.name)} className="flex items-center gap-1 px-3 py-1.5 border border-blue-200 text-blue-600 rounded-md text-xs font-semibold hover:bg-blue-50">
                      <Download size={12} /> Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
