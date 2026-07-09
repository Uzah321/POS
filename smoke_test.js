/**
 * Core POS — API Smoke Test
 * Runs against the local Laravel server on port 8080.
 * Usage: node smoke_test.js
 */

const http = require('http');

const HOST = process.env.POS_HOST || '127.0.0.1';
const PORT = Number(process.env.POS_PORT || 8080);
let token = null;
const results = [];

function req(method, path, body, auth) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (auth && token) headers['Authorization'] = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const opts = { hostname: HOST, port: PORT, path: '/api' + path, method, headers };
    const r = http.request(opts, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    r.on('error', e => resolve({ status: 0, body: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

function pass(name)       { results.push({ ok: true,  name }); process.stdout.write(`  \x1b[32m+\x1b[0m ${name}\n`); }
function fail(name, info) { results.push({ ok: false, name, info }); process.stdout.write(`  \x1b[31mx\x1b[0m ${name}  (${info})\n`); }
function skip(name, why)  { results.push({ ok: null,  name }); process.stdout.write(`  \x1b[33m-\x1b[0m ${name}  [skip: ${why}]\n`); }
function section(name)    { process.stdout.write(`\n\x1b[1m\x1b[34m${name}\x1b[0m\n`); }
function check(name, r, expectedStatus = 200) {
  if (r.status === expectedStatus) pass(name);
  else fail(name, `HTTP ${r.status}`);
  return r.status === expectedStatus;
}

async function run() {
  console.log(`\n  Core POS Smoke Test  ->  http://${HOST}:${PORT}/api\n`);

  // ── AUTH ─────────────────────────────────────────────────────────────────
  section('AUTH');
  const login = await req('POST', '/auth/login', { email: 'admin@nexapos.com', password: 'Admin@123' });
  if (login.status === 200 && login.body?.data?.token) {
    token = login.body.data.token;
    pass('POST /auth/login');
  } else {
    // try username field fallback
    const login2 = await req('POST', '/auth/login', { username: 'admin', password: 'Admin@123' });
    if (login2.status === 200 && login2.body?.data?.token) {
      token = login2.body.data.token;
      pass('POST /auth/login (username field)');
    } else {
      fail('POST /auth/login', `HTTP ${login.status} — ${JSON.stringify(login.body?.message ?? login.body)}`);
      console.log('\n  Cannot continue without auth token.\n');
      process.exit(1);
    }
  }

  check('GET /auth/me', await req('GET', '/auth/me', null, true));

  // ── DASHBOARD & REPORTS ──────────────────────────────────────────────────
  section('DASHBOARD & REPORTS');
  check('GET /reports/dashboard',         await req('GET', '/reports/dashboard', null, true));
  check('GET /reports/sales',             await req('GET', '/reports/sales?date_from=2026-01-01&date_to=2026-12-31', null, true));
  check('GET /reports/inventory',         await req('GET', '/reports/inventory', null, true));
  check('GET /reports/profit-loss',       await req('GET', '/reports/profit-loss?date_from=2026-01-01&date_to=2026-12-31', null, true));
  check('GET /reports/daily',             await req('GET', '/reports/daily', null, true));
  check('GET /reports/monthly',           await req('GET', '/reports/monthly', null, true));
  check('GET /reports/cashier-performance', await req('GET', '/reports/cashier-performance?date_from=2026-01-01&date_to=2026-12-31', null, true));
  check('GET /reports/low-stock',         await req('GET', '/reports/low-stock', null, true));
  check('GET /reports/vat',               await req('GET', '/reports/vat', null, true));
  check('GET /reports/financial-summary', await req('GET', '/reports/financial-summary', null, true));
  check('GET /reports/branch-consolidation', await req('GET', '/reports/branch-consolidation', null, true));
  check('GET /reports/stock-variances',   await req('GET', '/reports/stock-variances', null, true));

  // ── PRODUCTS ─────────────────────────────────────────────────────────────
  section('PRODUCTS');
  const products = await req('GET', '/products', null, true);
  check('GET /products', products);
  let productId = products.body?.data?.data?.[0]?.id;

  check('GET /products/search?q=a',  await req('GET', '/products/search?q=a', null, true));
  check('GET /categories',           await req('GET', '/categories', null, true));
  check('GET /brands',               await req('GET', '/brands', null, true));
  check('GET /product-batches',      await req('GET', '/product-batches', null, true));

  const productSmokeSku = `SMOKE-${Date.now()}`;
  const addProduct = await req('POST', '/products', {
    name: 'Smoke Test Product',
    sku: productSmokeSku,
    cost_price: 1,
    selling_price: 2,
    initial_quantity: 0,
  }, true);
  if (addProduct.status === 201) {
    pass('POST /products (no brand, default reorder)');
    const createdProduct = addProduct.body?.data;
    if (createdProduct?.reorder_level === 5) pass('POST /products default reorder_level=5');
    else fail('POST /products default reorder_level=5', `got ${createdProduct?.reorder_level}`);
    if (createdProduct?.brand_id == null) pass('POST /products brand optional');
    else fail('POST /products brand optional', `got brand_id=${createdProduct?.brand_id}`);
    if (createdProduct?.id) check(`DELETE /products/${createdProduct.id} (cleanup)`, await req('DELETE', `/products/${createdProduct.id}`, null, true));
  } else {
    fail('POST /products (no brand, default reorder)', `HTTP ${addProduct.status} — ${JSON.stringify(addProduct.body?.errors ?? addProduct.body?.message)}`);
  }

  if (productId) check(`GET /products/${productId}`, await req('GET', `/products/${productId}`, null, true));
  else skip('GET /products/:id', 'no products found');

  // ── INVENTORY ────────────────────────────────────────────────────────────
  section('INVENTORY');
  check('GET /inventory/stock-levels', await req('GET', '/inventory/stock-levels', null, true));
  check('GET /inventory/transfers',    await req('GET', '/inventory/transfers', null, true));
  check('GET /stock-transfers',        await req('GET', '/stock-transfers', null, true));
  check('GET /stocktakes',             await req('GET', '/stocktakes', null, true));
  check('GET /stock-reconciliation',   await req('GET', '/stock-reconciliation', null, true));
  check('GET /warehouses',             await req('GET', '/warehouses', null, true));

  // ── SALES ────────────────────────────────────────────────────────────────
  section('SALES');
  check('GET /sales',       await req('GET', '/sales', null, true));
  check('GET /sales/held',  await req('GET', '/sales/held', null, true));
  check('GET /refunds',     await req('GET', '/refunds', null, true));
  check('GET /laybys',      await req('GET', '/laybys', null, true));
  check('GET /quotations',  await req('GET', '/quotations', null, true));

  // ── CUSTOMERS & SUPPLIERS ────────────────────────────────────────────────
  section('CUSTOMERS & SUPPLIERS');
  check('GET /customers',  await req('GET', '/customers', null, true));
  check('GET /suppliers',  await req('GET', '/suppliers', null, true));

  // ── PURCHASE ORDERS ──────────────────────────────────────────────────────
  section('PURCHASE ORDERS');
  check('GET /purchase-orders', await req('GET', '/purchase-orders', null, true));

  // ── FINANCE ──────────────────────────────────────────────────────────────
  section('FINANCE');
  check('GET /expenses',          await req('GET', '/expenses', null, true));
  check('GET /expense-categories', await req('GET', '/expense-categories', null, true));
  check('GET /cashflow',          await req('GET', '/cashflow', null, true));
  check('GET /ecocash',           await req('GET', '/ecocash', null, true));
  check('GET /ecocash/summary',   await req('GET', '/ecocash/summary', null, true));
  check('GET /salaries',          await req('GET', '/salaries', null, true));
  check('GET /commissions',       await req('GET', '/commissions', null, true));
  check('GET /commissions/report', await req('GET', '/commissions/report', null, true));
  check('GET /rentals',           await req('GET', '/rentals', null, true));

  // ── SHIFT & END OF DAY ───────────────────────────────────────────────────
  section('SHIFT & END OF DAY');
  check('GET /shift-end',         await req('GET', '/shift-end', null, true));
  check('GET /shift-end/summary', await req('GET', '/shift-end/summary', null, true));
  check('GET /end-of-day',        await req('GET', '/end-of-day', null, true));
  check('GET /end-of-day/summary', await req('GET', '/end-of-day/summary', null, true));

  // ── USERS & ACCESS ───────────────────────────────────────────────────────
  section('USERS & ACCESS');
  check('GET /users',    await req('GET', '/users', null, true));
  check('GET /branches', await req('GET', '/branches', null, true));
  check('GET /roles',    await req('GET', '/roles', null, true));

  const ts = Date.now();
  const addUser = await req('POST', '/users', {
    name: 'Smoke Test', username: `smoke${ts}`, password: 'Test@1234',
    roles: ['cashier'], is_active: true,
  }, true);
  if (addUser.status === 201) {
    pass('POST /users (create)');
    const newId = addUser.body?.data?.id;
    if (newId) {
      const del = await req('DELETE', `/users/${newId}`, null, true);
      check(`DELETE /users/${newId} (cleanup)`, del);
    }
  } else {
    fail('POST /users', `HTTP ${addUser.status} — ${JSON.stringify(addUser.body?.errors ?? addUser.body?.message)}`);
  }

  // ── SETTINGS & ADMIN ─────────────────────────────────────────────────────
  section('SETTINGS & ADMIN');
  check('GET /settings',           await req('GET', '/settings', null, true));
  check('GET /currencies (public)', await req('GET', '/currencies', null, false));
  check('GET /currencies/all',     await req('GET', '/currencies/all', null, true));
  check('GET /audit-logs',         await req('GET', '/audit-logs', null, true));
  check('GET /notifications',      await req('GET', '/notifications', null, true));
  check('GET /scheduled-reports',  await req('GET', '/scheduled-reports', null, true));
  check('GET /webhooks',           await req('GET', '/webhooks', null, true));

  // ── BACKUP ───────────────────────────────────────────────────────────────
  section('BACKUP');
  check('GET /backups', await req('GET', '/backups', null, true));

  // ── SUMMARY ──────────────────────────────────────────────────────────────
  const passed  = results.filter(r => r.ok === true).length;
  const failed  = results.filter(r => r.ok === false).length;
  const skipped = results.filter(r => r.ok === null).length;
  const total   = results.filter(r => r.ok !== null).length;

  console.log(`\n  ${'─'.repeat(50)}`);
  console.log(`  Total: ${total}   \x1b[32mPassed: ${passed}\x1b[0m   \x1b[31mFailed: ${failed}\x1b[0m   \x1b[33mSkipped: ${skipped}\x1b[0m`);

  if (failed > 0) {
    console.log('\n  \x1b[31mFailed endpoints:\x1b[0m');
    results.filter(r => r.ok === false).forEach(r => console.log(`    x ${r.name}  (${r.info})`));
    console.log('');
    process.exit(1);
  } else {
    console.log('\n  \x1b[32mAll endpoints OK.\x1b[0m\n');
    process.exit(0);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
