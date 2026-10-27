import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { registersApi, fiscalApi, branchesApi, taxRatesApi, goFiscalApi } from '../api';
import { useAuthStore } from '../stores/authStore';
import { Loader2, ShieldCheck, ShieldAlert, RefreshCw, Plus, ChevronDown, ChevronRight, KeyRound, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';

const field = 'w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 focus:bg-white transition-colors';
const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-blue-600 hover:bg-blue-700 text-white`;
const btnGhost = `${btn} bg-gray-100 hover:bg-gray-200 text-gray-700`;

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    registered: 'bg-green-50 text-green-700 border-green-200',
    gofiscal: 'bg-green-50 text-green-700 border-green-200',
    unregistered: 'bg-gray-50 text-gray-600 border-gray-200',
    error: 'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${styles[status] ?? styles.unregistered}`}>
      {status === 'registered' ? 'Registered' : status === 'gofiscal' ? 'GoFiscal' : status === 'error' ? 'Error' : 'Not Registered'}
    </span>
  );
}

// ── GoFiscal ────────────────────────────────────────────────────────────────
// The engine at api.gofiscal.app holds the ZIMRA devices and signs, numbers
// and submits receipts itself; a till linked to one of its devices sends its
// sales there instead of to its own ZIMRA registration.

interface GoFiscalDevice { deviceId: number; label?: string; environment?: string; active?: boolean }

function companyName(company: any): string | undefined {
  return company?.name ?? company?.companyName ?? company?.company?.name ?? company?.data?.name;
}

function deviceLabel(d: GoFiscalDevice): string {
  return `${d.label || 'Device'} · #${d.deviceId}${d.environment ? ` · ${d.environment}` : ''}${d.active === false ? ' · inactive' : ''}`;
}

/** The engine's devices, once a key is saved — shared by the set-up card and every till. */
function useGoFiscalDevices(enabled: boolean) {
  return useQuery({
    queryKey: ['gofiscal-devices'],
    queryFn: () => goFiscalApi.devices().then(r => r.data?.data as { company: any; devices: GoFiscalDevice[] }),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

function GoFiscalSetup() {
  const qc = useQueryClient();
  const { data: setup, isLoading } = useQuery({
    queryKey: ['gofiscal'],
    queryFn: () => goFiscalApi.get().then(r => r.data?.data),
    refetchInterval: 30_000,
  });
  const engine = useGoFiscalDevices(!!setup?.configured);
  const [changingKey, setChangingKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [hsCode, setHsCode] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (data: { api_key?: string; default_hs_code?: string | null }) => goFiscalApi.update(data),
    onSuccess: (r, data) => {
      toast.success(data.api_key ? `GoFiscal connected${companyName(r.data?.data?.company) ? ` — ${companyName(r.data?.data?.company)}` : ''}` : 'Saved');
      setApiKey(''); setChangingKey(false); setHsCode(null);
      qc.invalidateQueries({ queryKey: ['gofiscal'] });
      qc.invalidateQueries({ queryKey: ['gofiscal-devices'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  if (isLoading) return null;
  const showKeyInput = !setup?.configured || changingKey;
  const hsValue = hsCode ?? setup?.default_hs_code ?? '';

  return (
    <div className="border border-gray-100 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-gray-900">GoFiscal</p>
          <p className="text-xs text-gray-500 mt-1 max-w-xl">
            Fiscalise through the GoFiscal engine instead of registering each till with ZIMRA here: it signs, numbers and submits every receipt,
            and each bill prints with its verification code and QR. Link a till to one of its devices below.
          </p>
        </div>
        {setup?.configured && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
            <CheckCircle size={12} />{companyName(engine.data?.company) ?? 'Connected'}
          </span>
        )}
      </div>

      {engine.isError && (
        <p className="text-xs text-red-600">{(engine.error as any)?.response?.data?.message ?? 'Could not reach GoFiscal'}</p>
      )}

      {showKeyInput ? (
        <div className="flex items-center gap-2 flex-wrap">
          <input type="password" autoComplete="off" className={`${field} max-w-sm`} placeholder="API key — gf_live_…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <button type="button" className={btnPrimary} disabled={!apiKey.trim() || save.isPending} onClick={() => save.mutate({ api_key: apiKey.trim() })}>
            {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} Save &amp; Test
          </button>
          {changingKey && <button type="button" className={btnGhost} onClick={() => { setChangingKey(false); setApiKey(''); }}>Cancel</button>}
          <p className="text-[11px] text-gray-400 w-full">The key from your GoFiscal operator. It stays on this server — it's never shown again, not even here.</p>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <KeyRound size={13} className="text-gray-400" /> API key ending <span className="font-mono">…{setup?.key_hint}</span>
          <button type="button" className="text-blue-600 hover:underline" onClick={() => setChangingKey(true)}>Change</button>
        </div>
      )}

      {setup?.configured && (
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">HS code for products without one</label>
            <input className={`${field} w-40`} inputMode="numeric" maxLength={8} placeholder="e.g. 02013000" value={hsValue} onChange={(e) => setHsCode(e.target.value.replace(/\D/g, ''))} />
          </div>
          <button type="button" className={btnGhost} disabled={hsCode === null || save.isPending} onClick={() => save.mutate({ default_hs_code: hsValue || null })}>Save</button>
          <p className="text-[11px] text-gray-400 w-full">Every receipt line needs an HS code. A product's own (Products › edit) wins; this covers the rest.</p>
        </div>
      )}
      {setup?.configured && !setup?.default_hs_code && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
          No default HS code yet — sales of products without their own HS code will be refused until one is set.
        </p>
      )}

      {(setup?.pending > 0 || setup?.failed > 0) && (
        <div className="text-xs space-y-1.5">
          <p className="font-semibold text-gray-700">
            {setup.pending > 0 && `${setup.pending} waiting to go through`}{setup.pending > 0 && setup.failed > 0 && ' · '}
            {setup.failed > 0 && <span className="text-red-600">{setup.failed} refused — fix and Sync Now</span>}
          </p>
          {(setup.problems ?? []).map((p: any) => (
            <div key={p.id} className={`rounded px-2.5 py-1.5 border ${p.status === 'failed' ? 'bg-red-50 border-red-100 text-red-800' : 'bg-gray-50 border-gray-100 text-gray-600'}`}>
              <span className="font-mono">{p.invoice_no}</span>{p.receipt_type === 'CreditNote' && ' (credit note)'} — {p.last_error ?? 'not sent yet'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A till's GoFiscal device: which one, its fiscal day, and closing it. */
function GoFiscalTill({ register, onChange }: { register: any; onChange: () => void }) {
  const qc = useQueryClient();
  const { data: setup } = useQuery({ queryKey: ['gofiscal'], queryFn: () => goFiscalApi.get().then(r => r.data?.data) });
  const engine = useGoFiscalDevices(!!setup?.configured);
  const deviceId: number | null = register.gofiscal_device_id ?? null;

  const { data: status, isFetching, refetch } = useQuery({
    queryKey: ['gofiscal-status', deviceId],
    queryFn: () => goFiscalApi.status(deviceId!).then(r => r.data?.data),
    enabled: !!deviceId,
    retry: false,
  });

  const link = useMutation({
    mutationFn: (id: number | null) => goFiscalApi.linkRegister(register.id, id),
    onSuccess: (r) => { toast.success(r.data?.message ?? 'Saved'); onChange(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });
  const openDay = useMutation({
    mutationFn: () => goFiscalApi.openDay(deviceId!),
    onSuccess: () => { toast.success('Fiscal day opened'); qc.invalidateQueries({ queryKey: ['gofiscal-status', deviceId] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not open the fiscal day'),
  });
  const closeDay = useMutation({
    mutationFn: () => goFiscalApi.closeDay(deviceId!),
    onSuccess: () => { toast.success('Fiscal day closed'); qc.invalidateQueries({ queryKey: ['gofiscal-status', deviceId] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not close the fiscal day'),
  });

  if (!setup?.configured) return null;
  const devices = engine.data?.devices ?? [];

  return (
    <div className="pt-3 space-y-2">
      <label className="block text-xs font-semibold text-gray-600">Fiscalise this till through</label>
      <select className={`${field} max-w-md`} value={deviceId ?? ''} disabled={link.isPending}
        onChange={(e) => link.mutate(e.target.value ? Number(e.target.value) : null)}>
        <option value="">{register.fiscal_device?.status === 'registered' ? 'Its own ZIMRA registration (below)' : 'Not GoFiscal'}</option>
        {devices.map((d) => <option key={d.deviceId} value={d.deviceId} disabled={d.active === false}>GoFiscal — {deviceLabel(d)}</option>)}
        {deviceId && !devices.some((d) => d.deviceId === deviceId) && <option value={deviceId}>GoFiscal device #{deviceId}</option>}
      </select>

      {deviceId && (
        <>
          <div className="text-xs bg-gray-50 border border-gray-100 rounded px-3 py-2">
            {isFetching && !status ? <span className="flex items-center gap-1.5 text-gray-500"><Loader2 size={12} className="animate-spin" />Asking GoFiscal…</span>
              : status && typeof status === 'object' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                  {Object.entries(status).flatMap(([k, v]) => v && typeof v === 'object' && !Array.isArray(v)
                    ? Object.entries(v as object).map(([k2, v2]) => [`${k} ${k2}`, v2] as const)
                    : [[k, v] as const])
                    .filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
                    .map(([k, v]) => (
                      <div key={k}><span className="text-gray-400">{k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}</span> <b className="text-gray-800">{v === null ? '—' : String(v)}</b></div>
                    ))}
                </div>
              ) : <span className="text-gray-500">No status from GoFiscal.</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnGhost} disabled={isFetching} onClick={() => void refetch()}>
              {isFetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh Status
            </button>
            <button type="button" className={btnGhost} disabled={openDay.isPending} onClick={() => openDay.mutate()}>
              {openDay.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Open Fiscal Day
            </button>
            <button type="button" className={btnGhost} disabled={closeDay.isPending}
              onClick={() => { if (confirm('Close this device\'s fiscal day now? The next sale opens a new one.')) closeDay.mutate(); }}>
              {closeDay.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Close Fiscal Day
            </button>
          </div>
          <p className="text-[11px] text-gray-400">A sale opens the fiscal day by itself if it isn't open. Day End closes it too.</p>
        </>
      )}
    </div>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        <StatusPill status={register.gofiscal_device_id ? 'gofiscal' : device?.status ?? 'unregistered'} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-50">
          <GoFiscalTill register={register} onChange={invalidate} />
          {register.gofiscal_device_id ? null : !device || device.status !== 'registered' ? (
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
    // Sync Now resends even receipts GoFiscal refused, in case what was wrong has been fixed.
    mutationFn: () => fiscalApi.sync(branchId, true),
    onSuccess: (r) => {
      const { submitted, still_pending } = r.data?.data ?? {};
      toast.success(`Synced with ZIMRA — ${submitted ?? 0} submitted, ${still_pending ?? 0} still pending`);
      qc.invalidateQueries({ queryKey: ['registers'] });
      qc.invalidateQueries({ queryKey: ['gofiscal'] });
    },
  });

  return (
    <div className="space-y-4">
      <GoFiscalSetup />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-gray-400 max-w-xl">
          Each till (register) fiscalises through GoFiscal, or is registered with ZIMRA as its own fiscal device — either way receipts submit live, and QR codes print on receipts automatically.
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
