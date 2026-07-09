import Dexie, { type Table } from 'dexie';

export interface LocalProduct {
  id: number;
  name: string;
  sku: string;
  selling_price: string;
  cost_price: string;
  tax_rate?: { rate: number };
  category?: { id: number; name: string };
  total_stock?: number;
  is_active: number;
  [key: string]: unknown;
}

export interface LocalCustomer {
  id: number;
  name: string;
  phone?: string;
  email?: string;
}

export interface LocalUser {
  id: number;
  name: string;
  username: string;
  email?: string;
  roles?: Array<{ name: string } | string>;
  branch?: { id: number; name: string } | null;
  branch_id?: number | null;
  is_active: number | boolean;
  [key: string]: unknown;
}

export interface PendingMutation {
  id: string;
  resource: string;
  action: string;
  resourceId?: number;
  payload: Record<string, unknown>;
  queuedAt: number;
  attempts: number;
  lastError?: string;
}

export interface SyncMeta {
  key: string;
  synced_at: number;
}

export interface LocalSale {
  id: number;
  reference: string;
  status: string;
  total: number;
  subtotal?: number;
  tax?: number;
  discount?: number;
  items: Array<{ name: string; qty: number; price: number; total: number }>;
  items_count: number;
  payments: Array<{ method: string; amount: number }>;
  cashier_id: number;
  cashier_name?: string;
  branch_id: number;
  created_at: string;
  completed_at?: string;
  is_offline?: boolean;
}

class PosDb extends Dexie {
  products!: Table<LocalProduct, number>;
  customers!: Table<LocalCustomer, number>;
  users!: Table<LocalUser, number>;
  pendingMutations!: Table<PendingMutation, string>;
  syncMeta!: Table<SyncMeta, string>;
  sales!: Table<LocalSale, number>;

  constructor() {
    super('Core-db');
    this.version(1).stores({
      products: 'id, name, sku',
      customers: 'id, name, phone, email',
      syncMeta: 'key',
    });
    this.version(2).stores({
      products: 'id, name, sku',
      customers: 'id, name, phone, email',
      users: 'id, name, username',
      pendingMutations: 'id, resource',
      syncMeta: 'key',
    });
    this.version(3).stores({
      products: 'id, name, sku',
      customers: 'id, name, phone, email',
      users: 'id, name, username',
      pendingMutations: 'id, resource',
      syncMeta: 'key',
      sales: 'id, reference, cashier_id, created_at, status',
    });
  }
}

export const db = new PosDb();
