import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tablesApi, usersApi } from '../api';
import { useAuthStore } from '../stores/authStore';
import { useCartStore } from '../stores/cartStore';
import { useCurrencyStore } from '../stores/currencyStore';
import { Users, Plus, Pencil, Trash2, X, ShoppingCart, LayoutGrid, CircleDot, CircleCheck, Settings2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';

interface TableRow {
  id: number;
  name: string;
  seats: number;
  open_sale: {
    id: number;
    reference: string;
    total: number;
    waiter_name: string | null;
    opened_at: string;
  } | null;
}

// Same palette as the Advanced POS so the two front-of-house screens match.
const NAVY = '#0d2350';
const NAVY_TILE = '#173463';
const BLUE = '#2f6df6';

function RailTile({ icon: Icon, label, count, active, onClick }: {
  icon: React.ElementType; label: string; count?: number; active?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-shrink-0 flex flex-col items-center justify-center gap-2 rounded-2xl min-h-[92px] px-2 py-3 text-white text-[15px] font-semibold leading-tight text-center transition-colors touch-manipulation hover:brightness-125"
      style={{ background: active ? BLUE : NAVY_TILE, boxShadow: active ? '0 6px 16px rgba(47,109,246,.35)' : undefined }}
    >
      <Icon size={30} strokeWidth={1.6} />
      <span className="line-clamp-2">{label}{count !== undefined && <span className="block text-xs font-medium opacity-80 mt-0.5">{count}</span>}</span>
    </button>
  );
}

type TableFilter = 'all' | 'occupied' | 'free';

export default function TablesPage() {
  const { user, hasPermission, hasRole } = useAuthStore();
  const cart = useCartStore();
  const { format } = useCurrencyStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canManage = hasPermission('manage_tables') || hasRole('admin');
  const branchId = user?.branch?.id;

  const [manageMode, setManageMode] = useState(false);
  const [filter, setFilter] = useState<TableFilter>('all');
  const [waiterPickerFor, setWaiterPickerFor] = useState<TableRow | null>(null);
  const [selectedWaiterId, setSelectedWaiterId] = useState('');
  const [editingTable, setEditingTable] = useState<TableRow | 'new' | null>(null);
  const [formName, setFormName] = useState('');
  const [formSeats, setFormSeats] = useState('2');

  const { data, isLoading } = useQuery({
    queryKey: ['tables', branchId],
    queryFn: () => tablesApi.list({ branch_id: branchId }).then((r) => r.data?.data ?? []) as Promise<TableRow[]>,
    refetchInterval: 8000,
  });
  const tables = data ?? [];
  const occupiedCount = tables.filter((t) => t.open_sale).length;
  // Manage mode always shows every table so any of them can be edited.
  const shownTables = manageMode || filter === 'all' ? tables : tables.filter((t) => (filter === 'occupied') === !!t.open_sale);

  const { data: waiters } = useQuery({
    queryKey: ['users', 'role-waiter'],
    queryFn: () => usersApi.list({ role: 'waiter', per_page: 200 }).then((r) => r.data?.data?.data ?? r.data?.data ?? []),
    enabled: !!waiterPickerFor,
  });

  const saveMutation = useMutation({
    mutationFn: (payload: { id?: number; name: string; seats: number }) =>
      payload.id
        ? tablesApi.update(payload.id, { name: payload.name, seats: payload.seats })
        : tablesApi.create({ branch_id: branchId, name: payload.name, seats: payload.seats }),
    onSuccess: () => {
      toast.success('Table saved');
      qc.invalidateQueries({ queryKey: ['tables'] });
      setEditingTable(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save table'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => tablesApi.remove(id),
    onSuccess: () => {
      toast.success('Table removed');
      qc.invalidateQueries({ queryKey: ['tables'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not remove table'),
  });

  const openEdit = (t: TableRow | 'new') => {
    setEditingTable(t);
    setFormName(t === 'new' ? '' : t.name);
    setFormSeats(t === 'new' ? '2' : String(t.seats));
  };

  const submitEdit = () => {
    if (!formName.trim()) { toast.error('Table name is required'); return; }
    saveMutation.mutate({
      id: editingTable !== 'new' ? editingTable?.id : undefined,
      name: formName.trim(),
      seats: parseInt(formSeats, 10) || 2,
    });
  };

  const handleFreeTileClick = (table: TableRow) => {
    if (manageMode) { openEdit(table); return; }
    setWaiterPickerFor(table);
    setSelectedWaiterId('');
  };

  const startTab = () => {
    if (!waiterPickerFor) return;
    if (!selectedWaiterId) { toast.error('Select a waiter first'); return; }
    const waiter = (waiters ?? []).find((w: any) => String(w.id) === selectedWaiterId);
    cart.newTicket();
    cart.setOrderType('sit_in');
    cart.setTableTab({
      tableId: waiterPickerFor.id,
      waiterId: waiter?.id ?? null,
      waiterName: waiter?.name ?? '',
      openSaleId: null,
    });
    // The table's name travels with the order (header, kitchen ticket, sales-by-table report).
    cart.setTableNumber(waiterPickerFor.name);
    setWaiterPickerFor(null);
    navigate('/pos');
  };

  const resumeTab = (table: TableRow) => {
    if (manageMode) return;
    if (!table.open_sale) return;
    navigate(`/pos?sale_id=${table.open_sale.id}`);
  };

  const railFilters: Array<{ key: TableFilter; label: string; icon: React.ElementType; count: number }> = [
    { key: 'all', label: 'All Tables', icon: LayoutGrid, count: tables.length },
    { key: 'occupied', label: 'Occupied', icon: CircleDot, count: occupiedCount },
    { key: 'free', label: 'Free', icon: CircleCheck, count: tables.length - occupiedCount },
  ];

  return (
    <div className="pos-screen -m-3 sm:-m-5 lg:-m-6 flex overflow-hidden" style={{ height: 'calc(100vh - 64px)', background: '#eef2f8' }}>
      {/* Navy side rail — same as the Advanced POS category column */}
      <aside className="hidden lg:flex flex-col gap-2.5 w-[156px] flex-shrink-0 overflow-y-auto p-2.5" style={{ background: NAVY }}>
        <RailTile icon={ShoppingCart} label="Advanced POS" onClick={() => navigate('/pos')} />
        {railFilters.map((f) => (
          <RailTile key={f.key} icon={f.icon} label={f.label} count={f.count}
            active={!manageMode && filter === f.key} onClick={() => { setManageMode(false); setFilter(f.key); }} />
        ))}
        {canManage && (
          <RailTile icon={Settings2} label={manageMode ? 'Done' : 'Manage Tables'} active={manageMode} onClick={() => setManageMode((m) => !m)} />
        )}
      </aside>

      <div className="flex-1 min-w-0 overflow-y-auto p-3 sm:p-4">
        {/* Small screens: the rail becomes a row of pills */}
        <div className="flex lg:hidden items-center gap-2 overflow-x-auto mb-3">
          <button type="button" onClick={() => navigate('/pos')} className="flex-shrink-0 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white text-slate-600 border border-slate-200">Advanced POS</button>
          {railFilters.map((f) => (
            <button key={f.key} type="button" onClick={() => { setManageMode(false); setFilter(f.key); }}
              className={`flex-shrink-0 px-3.5 py-2 rounded-xl text-xs font-semibold ${!manageMode && filter === f.key ? 'text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
              style={!manageMode && filter === f.key ? { background: BLUE } : undefined}>
              {f.label} ({f.count})
            </button>
          ))}
          {canManage && (
            <button type="button" onClick={() => setManageMode((m) => !m)}
              className={`flex-shrink-0 px-3.5 py-2 rounded-xl text-xs font-semibold ${manageMode ? 'text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
              style={manageMode ? { background: BLUE } : undefined}>
              {manageMode ? 'Done' : 'Manage Tables'}
            </button>
          )}
        </div>
        <p className="text-sm text-slate-500 mb-3">
          {manageMode ? 'Tap a table to edit it, or add a new one.' : 'Tap a free table to open a tab, or an occupied one to continue the order.'}
        </p>

        {isLoading ? (
          <div className="text-center text-gray-400 py-20">Loading tables…</div>
        ) : shownTables.length === 0 && !manageMode ? (
          <div className="bg-white rounded-lg border border-gray-100 p-12 text-center text-gray-400">
            {tables.length === 0
              ? <>No tables set up yet. {canManage && 'Tap "Manage Tables" to add some.'}</>
              : filter === 'occupied' ? 'No occupied tables right now.' : 'No free tables right now.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {shownTables.map((table) => {
              const occupied = !!table.open_sale;
              return (
                <div key={table.id} className="relative">
                  <button
                    onClick={() => (occupied ? resumeTab(table) : handleFreeTileClick(table))}
                    className={`w-full aspect-square rounded-xl border-2 p-3 flex flex-col items-center justify-center text-center transition-colors ${
                      occupied
                        ? 'bg-amber-50 border-amber-300 hover:bg-amber-100'
                        : 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                    }`}
                  >
                    <p className="font-bold text-gray-900 text-sm">{table.name}</p>
                    <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Users size={11} /> {table.seats}</p>
                    {occupied && table.open_sale && (
                      <div className="mt-2 space-y-0.5">
                        <p className="text-xs font-semibold text-amber-700">{table.open_sale.waiter_name ?? 'No waiter'}</p>
                        <p className="text-xs text-amber-600">{format(Number(table.open_sale.total))}</p>
                        <p className="text-[10px] text-amber-500">{formatDistanceToNow(new Date(table.open_sale.opened_at), { addSuffix: true })}</p>
                      </div>
                    )}
                    {!occupied && <p className="text-[10px] text-emerald-600 mt-1">Free</p>}
                  </button>
                  {manageMode && (
                    <div className="absolute top-1 right-1 flex gap-1">
                      <button onClick={() => openEdit(table)} className="p-1.5 bg-white rounded-md shadow border border-gray-200 text-gray-500 hover:text-blue-600">
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => { if (confirm(`Remove ${table.name}?`)) deleteMutation.mutate(table.id); }}
                        className="p-1.5 bg-white rounded-md shadow border border-gray-200 text-gray-500 hover:text-red-600"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {manageMode && (
              <button
                onClick={() => openEdit('new')}
                className="aspect-square rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
              >
                <Plus size={22} />
                <p className="text-xs mt-1">Add Table</p>
              </button>
            )}
          </div>
        )}

      </div>

      {/* Select waiter to open a tab */}
      {waiterPickerFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900">Open {waiterPickerFor.name}</h2>
              <button onClick={() => setWaiterPickerFor(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Waiter</label>
            <select
              value={selectedWaiterId}
              onChange={(e) => setSelectedWaiterId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm mb-4"
              autoFocus
            >
              <option value="">Select a waiter…</option>
              {(waiters ?? []).map((w: any) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
            {(waiters ?? []).length === 0 && (
              <p className="text-xs text-amber-600 mb-4">No staff have the "waiter" role yet — assign it in Users.</p>
            )}
            <button
              onClick={startTab}
              disabled={!selectedWaiterId}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm"
            >
              Start Order
            </button>
          </div>
        </div>
      )}

      {/* Add/edit table */}
      {editingTable && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900">{editingTable === 'new' ? 'Add Table' : 'Edit Table'}</h2>
              <button onClick={() => setEditingTable(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Name</label>
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. Table 4"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm mb-4"
              autoFocus
            />
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Seats</label>
            <input
              type="number"
              min={1}
              value={formSeats}
              onChange={(e) => setFormSeats(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm mb-4"
            />
            <button
              onClick={submitEdit}
              disabled={saveMutation.isPending}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
