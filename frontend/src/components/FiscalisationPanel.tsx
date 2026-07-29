import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { registersApi, fiscalApi, branchesApi, taxRatesApi } from '../api';
import { useAuthStore } from '../stores/authStore';
import { Loader2, ShieldCheck, ShieldAlert, RefreshCw, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';

const field = 'w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 focus:bg-white transition-colors';
const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-blue-600 hover:bg-blue-700 text-white`;
const btnGhost = `${btn} bg-gray-100 hover:bg-gray-200 text-gray-700`;

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    registered: 'bg-green-50 text-green-700 border-green-200',
    unregistered: 'bg-gray-50 text-gray-600 border-gray-200',
    error: 'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${styles[status] ?? styles.unregistered}`}>
      {status === 'registered' ? 'Registered' : status === 'error' ? 'Error' : 'Not Registered'}
    </span>
  );
}

function RegisterDeviceForm({ registerId, onDone }: { registerId: number; onDone: () => void }) {
  const [form, setForm] = useState({ device_id: '', activation_key: '', device_serial_no: '', environment: 'test' as 'test' | 'live' });
  const [verifying, setVerifying] = useState<string | null>(null);

  const verify = useMutation({
    mutationFn: () => fiscalApi.verifyTaxpayer(registerId, { ...form, device_id: Number(form.device_id) }),
    onSuccess: (r) => setVerifying(`Taxpayer: ${r.data?.data?.taxPayerName ?? '—'} (TIN ${r.data?.data?.taxPayerTIN ?? '—'})`),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not verify — check the Device ID/Activation Key'),
  });

  const register = useMutation({
    mutationFn: () => fiscalApi.registerDevice(registerId, { ...form, device_id: Number(form.device_id) }),
    onSuccess: () => { toast.success('Device registered with ZIMRA'); onDone(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Registration failed'),
  });

  return (
    <div className="mt-3 border border-dashed border-gray-300 rounded-md p-4 bg-gray-50/60 space-y-3">
      <p className="text-xs text-gray-500">
        Enter the Device ID and Activation Key issued for this till on ZIMRA's registration portal. Use the <b>Test</b> environment until ZIMRA issues live credentials.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Environment</label>
          <select className={field} value={form.environment} onChange={(e) => setForm(f => ({ ...f, environment: e.target.value as 'test' | 'live' }))}>
            <option value="test">Test</option>
            <option value="live">Live</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Device ID</label>
          <input className={field} value={form.device_id} onChange={(e) => setForm(f => ({ ...f, device_id: e.target.value }))} placeholder="22449" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Activation Key</label>
          <input className={field} value={form.activation_key} onChange={(e) => setForm(f => ({ ...f, activation_key: e.target.value }))} placeholder="8-char key" maxLength={8} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Device Serial No</label>
          <input className={field} value={form.device_serial_no} onChange={(e) => setForm(f => ({ ...f, device_serial_no: e.target.value }))} placeholder="SN0001" />
        </div>
      </div>
      {verifying && <p className="text-xs text-green-700 bg-green-50 border border-green-100 rounded px-2 py-1.5">{verifying}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnGhost} disabled={!form.device_id || !form.activation_key || !form.device_serial_no || verify.isPending}
          onClick={() => verify.mutate()}>
          {verify.isPending ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Verify Taxpayer
        </button>
        <button type="button" className={btnPrimary} disabled={!form.device_id || !form.activation_key || !form.device_serial_no || register.isPending}
          onClick={() => register.mutate()}>
          {register.isPending ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Register Device
        </button>
      </div>
    </div>
  );
}

function TaxMappingTable({ fiscalDeviceId, mappings, taxRates }: { fiscalDeviceId: number; mappings: any[]; taxRates: any[] }) {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: ({ id, local_tax_rate_id }: { id: number; local_tax_rate_id: number | null }) =>
      fiscalApi.updateTaxMapping(id, { local_tax_rate_id }),
    onSuccess: () => { toast.success('Tax mapping updated'); qc.invalidateQueries({ queryKey: ['registers'] }); },
  });

  if (mappings.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-gray-700 mb-1.5">ZIMRA Tax Mapping</p>
      <p className="text-[11px] text-gray-400 mb-2">
        Left on "Auto-detect", a ZIMRA tax is matched to sales by percentage automatically — override only if this branch uses more than one Core tax rate.
      </p>
      <div className="space-y-1.5">
        {mappings.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-3 text-xs bg-gray-50 border border-gray-100 rounded px-2.5 py-1.5">
            <span className="font-medium text-gray-700">
              {m.tax_name} {m.tax_percent != null ? `(${Number(m.tax_percent).toFixed(2)}%)` : '(Exempt)'}
            </span>
            <select
              className="border border-gray-200 rounded px-2 py-1 text-xs bg-white"
              value={m.local_tax_rate_id ?? ''}
              onChange={(e) => update.mutate({ id: m.id, local_tax_rate_id: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Auto-detect by %</option>
              {taxRates.map((tr: any) => <option key={tr.id} value={tr.id}>{tr.name} ({Number(tr.rate).toFixed(2)}%)</option>)}
            </select>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 mt-1">Fiscal device #{fiscalDeviceId}</p>
    </div>
  );
}

function RegisterCard({ register, taxRates }: { register: any; taxRates: any[] }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const device = register.fiscal_device;

  const { data: detail } = useQuery({
    queryKey: ['registers', register.id],
    queryFn: () => registersApi.get(register.id).then(r => r.data.data),
    enabled: expanded && !!device,
  });

  const { data: status } = useQuery({
    queryKey: ['fiscal-status', device?.id],
    queryFn: () => fiscalApi.status(device.id).then(r => r.data.data),
    enabled: expanded && !!device && device.status === 'registered',
    refetchInterval: 20_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['registers'] });
    qc.invalidateQueries({ queryKey: ['fiscal-status', device?.id] });
  };

  const refreshConfig = useMutation({
    mutationFn: () => fiscalApi.refreshConfig(device.id),
    onSuccess: () => { toast.success('Configuration refreshed'); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Refresh failed'),
  });
  const renewCert = useMutation({
    mutationFn: () => fiscalApi.renewCertificate(device.id),
    onSuccess: () => { toast.success('Certificate renewed'); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Renewal failed'),
  });
  const openDay = useMutation({
    mutationFn: () => fiscalApi.openDay(device.id),
    onSuccess: (r) => { toast.success(r.data?.message ?? 'Fiscal day opened'); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not open fiscal day'),
  });
  const closeDay = useMutation({
    mutationFn: () => fiscalApi.closeDay(device.id),
    onSuccess: (r) => { toast.success(r.data?.message ?? 'Fiscal day closed'); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not close fiscal day'),
  });

  const certExpiry = device?.certificate_valid_till ? new Date(device.certificate_valid_till) : null;
  const certExpiringSoon = certExpiry && certExpiry.getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;

  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <button type="button" onClick={() => setExpanded(v => !v)} className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50">
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
          <span className="text-sm font-semibold text-gray-900">{register.name}</span>
          {register.code && <span className="text-xs text-gray-400">({register.code})</span>}
        </div>
        <StatusPill status={device?.status ?? 'unregistered'} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-50">
          {!device || device.status !== 'registered' ? (
            <RegisterDeviceForm registerId={register.id} onDone={invalidate} />
          ) : (
            <div className="pt-3 space-y-3">
              {certExpiringSoon && (
                <div className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded px-2.5 py-1.5">
                  <ShieldAlert size={13} /> Certificate expires {certExpiry!.toLocaleDateString()} — renew soon.
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div><p className="text-gray-400">Device ID</p><p className="font-semibold text-gray-800">{device.device_id}</p></div>
                <div><p className="text-gray-400">Environment</p><p className="font-semibold text-gray-800 capitalize">{device.environment}</p></div>
                <div><p className="text-gray-400">Mode</p><p className="font-semibold text-gray-800 capitalize">{device.operating_mode ?? '—'}</p></div>
                <div><p className="text-gray-400">Cert valid till</p><p className="font-semibold text-gray-800">{certExpiry ? certExpiry.toLocaleDateString() : '—'}</p></div>
              </div>

              <div className="text-xs bg-gray-50 border border-gray-100 rounded px-3 py-2">
                {status?.current_fiscal_day ? (
                  <>Fiscal day <b>#{status.current_fiscal_day.fiscal_day_no}</b> — status <b>{status.current_fiscal_day.status}</b></>
                ) : 'No fiscal day currently open — one opens automatically on the next sale.'}
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnGhost} disabled={refreshConfig.isPending} onClick={() => refreshConfig.mutate()}>
                  {refreshConfig.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh Config
                </button>
                <button type="button" className={btnGhost} disabled={renewCert.isPending} onClick={() => renewCert.mutate()}>
                  {renewCert.isPending ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Renew Certificate
                </button>
                <button type="button" className={btnGhost} disabled={openDay.isPending} onClick={() => openDay.mutate()}>
                  {openDay.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Open Day
                </button>
                <button type="button" className={btnGhost} disabled={closeDay.isPending} onClick={() => closeDay.mutate()}>
                  {closeDay.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Close Day
                </button>
              </div>

              <TaxMappingTable fiscalDeviceId={device.id} mappings={detail?.fiscal_device?.tax_mappings ?? []} taxRates={taxRates} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FiscalisationPanel() {
  const user = useAuthStore(s => s.user);
  const isAdmin = useAuthStore(s => s.hasRole('admin'));
  const [branchId, setBranchId] = useState<number | undefined>(user?.branch?.id);
  const [newRegisterName, setNewRegisterName] = useState('');
  const qc = useQueryClient();

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.list().then(r => r.data?.data ?? []),
    enabled: isAdmin,
  });

  const { data: taxRates } = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => taxRatesApi.list().then(r => r.data?.data ?? []),
  });

  const { data: registers, isLoading } = useQuery({
    queryKey: ['registers', branchId],
    queryFn: () => registersApi.list({ branch_id: branchId }).then(r => r.data?.data ?? []),
    enabled: !!branchId,
  });

  const createRegister = useMutation({
    mutationFn: () => registersApi.create({ name: newRegisterName, branch_id: branchId }),
    onSuccess: () => { toast.success('Till added'); setNewRegisterName(''); qc.invalidateQueries({ queryKey: ['registers'] }); },
  });

  const syncNow = useMutation({
    mutationFn: () => fiscalApi.sync(branchId),
    onSuccess: (r) => {
      const { submitted, still_pending } = r.data?.data ?? {};
      toast.success(`Synced with ZIMRA — ${submitted ?? 0} submitted, ${still_pending ?? 0} still pending`);
      qc.invalidateQueries({ queryKey: ['registers'] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-gray-400 max-w-xl">
          Each till (register) is registered with ZIMRA as its own fiscal device — receipts submit live, and QR codes print on receipts automatically once registered.
        </p>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <select className={`${field} w-40`} value={branchId ?? ''} onChange={(e) => setBranchId(Number(e.target.value))}>
              {(branches ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button type="button" className={btnGhost} disabled={syncNow.isPending || !branchId} onClick={() => syncNow.mutate()}>
            {syncNow.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync Now
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 size={22} className="animate-spin text-blue-500" /></div>
      ) : (
        <div className="space-y-2">
          {(registers ?? []).map((r: any) => <RegisterCard key={r.id} register={r} taxRates={taxRates ?? []} />)}
          {(registers ?? []).length === 0 && (
            <p className="text-xs text-gray-400 py-2">No tills set up yet for this branch — add one below to start fiscalising.</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
        <input className={`${field} max-w-[220px]`} placeholder="Till name, e.g. Till 1" value={newRegisterName} onChange={(e) => setNewRegisterName(e.target.value)} />
        <button type="button" className={btnPrimary} disabled={!newRegisterName || !branchId || createRegister.isPending} onClick={() => createRegister.mutate()}>
          {createRegister.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add Till
        </button>
      </div>
    </div>
  );
}
