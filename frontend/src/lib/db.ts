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

export interface SyncMeta {
  key: string;
  synced_at: number;
}

class PosDb extends Dexie {
  products!: Table<LocalProduct, number>;
  customers!: Table<LocalCustomer, number>;
  syncMeta!: Table<SyncMeta, string>;

  constructor() {
    super('Core-db');
    this.version(1).stores({
      products: 'id, name, sku',
      customers: 'id, name, phone, email',
      syncMeta: 'key',
    });
  }
}

export const db = new PosDb();
