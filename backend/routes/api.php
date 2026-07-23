<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\SaleController;
use App\Http\Controllers\Api\RefundController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\SupplierController;
use App\Http\Controllers\Api\PurchaseOrderController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\ExpenseController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\CurrencyController;
use App\Http\Controllers\Api\LaybyController;
use App\Http\Controllers\Api\QuotationController;
use App\Http\Controllers\Api\StockTransferController;
use App\Http\Controllers\Api\StocktakeController;
use App\Http\Controllers\Api\ProductBatchController;
use App\Http\Controllers\Api\CommissionController;
use App\Http\Controllers\Api\WebhookController;
use App\Http\Controllers\Api\RolePermissionController;
use App\Http\Controllers\Api\BackupController;
use App\Http\Controllers\Api\ScheduledReportController;
use App\Http\Controllers\Api\EcocashController;
use App\Http\Controllers\Api\CashflowController;
use App\Http\Controllers\Api\SalaryController;
use App\Http\Controllers\Api\RentalController;
use App\Http\Controllers\Api\StockReconciliationController;
use App\Http\Controllers\Api\ProductIngredientController;
use App\Http\Controllers\Api\IngredientController;
use App\Http\Controllers\Api\ProductCaseUnitController;

// Public routes
Route::get('/currencies', [CurrencyController::class, 'index']); // public — needed for POS currency selector

// KDS — public so kitchen/queue screens don't need to log in
Route::get('/kds/orders', [\App\Http\Controllers\Api\KdsController::class, 'orders']);
Route::patch('/kds/orders/{sale}/status', [\App\Http\Controllers\Api\KdsController::class, 'updateStatus']);
Route::get('/network-info', [\App\Http\Controllers\Api\KdsController::class, 'networkInfo']);

// Protected routes
Route::post('/auth/login', [AuthController::class, 'login']);

// Protected routes
Route::middleware('auth:sanctum')->group(function () {
    // Auth
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::put('/auth/profile', [AuthController::class, 'updateProfile']);

    // Users
    Route::middleware('permission:manage_users')->group(function () {
        Route::apiResource('users', UserController::class);
        Route::apiResource('departments', \App\Http\Controllers\Api\DepartmentController::class);
    });

    // Products
    Route::get('/products/search', [ProductController::class, 'search']);
    Route::get('/products/{product}/ingredients', [ProductIngredientController::class, 'index']);
    Route::put('/products/{product}/ingredients', [ProductIngredientController::class, 'sync']);
    Route::get('/products/{product}/case-unit', [ProductCaseUnitController::class, 'show']);
    Route::put('/products/{product}/case-unit', [ProductCaseUnitController::class, 'set']);
    Route::apiResource('products', ProductController::class);

    // Ingredients — raw materials consumed by recipes, a separate entity from Products
    Route::get('/ingredients/{ingredient}/vendors', [IngredientController::class, 'vendors']);
    Route::put('/ingredients/{ingredient}/vendors', [IngredientController::class, 'syncVendors']);
    Route::get('/ingredients/{ingredient}/ordering', [IngredientController::class, 'ordering']);
    Route::put('/ingredients/{ingredient}/ordering', [IngredientController::class, 'syncOrdering']);
    Route::post('/ingredients/{ingredient}/add-stock', [IngredientController::class, 'addStock']);
    Route::post('/ingredients/{ingredient}/subtract-stock', [IngredientController::class, 'subtractStock']);
    Route::get('/ingredients/{ingredient}/stock-history', [IngredientController::class, 'stockHistory']);
    Route::apiResource('ingredients', IngredientController::class);

    // Sales
    Route::get('/sales/held', [SaleController::class, 'heldSales']);
    Route::post('/sales/hold', [SaleController::class, 'hold']);
    Route::delete('/sales/held/{id}', [SaleController::class, 'deleteHeld']);
    Route::patch('/sales/held/{id}/status', [SaleController::class, 'updateHeldStatus']);
    Route::get('/sales/{sale}/receipt', [SaleController::class, 'receipt']);
    Route::patch('/sales/{sale}/cancel', [SaleController::class, 'cancel']);
    Route::apiResource('sales', SaleController::class)->only(['index', 'store', 'show']);

    // Refunds
    Route::middleware('permission:process_refunds')->group(function () {
        Route::apiResource('refunds', RefundController::class)->only(['store']);
    });
    Route::apiResource('refunds', RefundController::class)->only(['index', 'show']);

    // Customers
    Route::get('/customers/{customer}/purchase-history', [CustomerController::class, 'purchaseHistory']);
    Route::get('/customers/{customer}/loyalty', [CustomerController::class, 'loyalty']);
    Route::post('/customers/{customer}/loyalty/redeem', [CustomerController::class, 'redeemLoyalty']);
    Route::apiResource('customers', CustomerController::class);

    // Suppliers
    Route::apiResource('suppliers', SupplierController::class);

    // Purchase Orders
    Route::post('/purchase-orders/{purchaseOrder}/approve', [PurchaseOrderController::class, 'approve']);
    Route::post('/purchase-orders/{purchaseOrder}/receive', [PurchaseOrderController::class, 'receive']);
    Route::apiResource('purchase-orders', PurchaseOrderController::class)->except(['update', 'destroy']);

    // Inventory
    Route::get('/inventory/stock-levels', [InventoryController::class, 'stockLevels']);
    Route::post('/inventory/adjust', [InventoryController::class, 'adjust']);
    Route::get('/inventory/adjustments', [InventoryController::class, 'adjustments']);
    Route::get('/inventory/transfers', [InventoryController::class, 'transferIndex']);
    Route::post('/inventory/transfers', [InventoryController::class, 'createTransfer']);
    Route::post('/inventory/transfers/{stockTransfer}/receive', [InventoryController::class, 'receiveTransfer']);
    Route::post('/inventory/import', [InventoryController::class, 'importStock']);
    Route::get('/inventory/import-template', [InventoryController::class, 'importTemplate']);

    // Expenses
    Route::get('/expense-categories', [ExpenseController::class, 'categories']);
    Route::apiResource('expenses', ExpenseController::class)->except(['show']);

    // Reports & Dashboard — dashboard uses its own permission (matches the "/" frontend
    // route's view_dashboard gate; storekeeper has view_dashboard but not view_reports,
    // so it must stay separate or their dashboard breaks). Everything else under
    // view_reports, matching every other /reports/* frontend route's gate.
    Route::middleware('permission:view_dashboard')->group(function () {
        Route::get('/reports/dashboard', [ReportController::class, 'dashboard']);
    });
    Route::middleware('permission:view_reports')->group(function () {
        Route::get('/reports/sales', [ReportController::class, 'salesReport']);
        Route::get('/reports/inventory', [ReportController::class, 'inventoryReport']);
        Route::get('/reports/profit-loss', [ReportController::class, 'profitLoss']);
        Route::get('/reports/cashier-performance', [ReportController::class, 'cashierPerformance']);
        Route::get('/reports/daily', [ReportController::class, 'dailyReport']);
        Route::get('/reports/monthly', [ReportController::class, 'monthlyReport']);
        Route::get('/reports/stock-variances', [ReportController::class, 'stockVariances']);
        Route::get('/reports/daily/pdf', [ReportController::class, 'dailyPdf']);
        Route::get('/reports/monthly/pdf', [ReportController::class, 'monthlyPdf']);
    });

    // Shift End (Cashup)
    Route::get('/shift-end/summary', [\App\Http\Controllers\Api\ShiftEndController::class, 'summary']);
    Route::get('/shift-end', [\App\Http\Controllers\Api\ShiftEndController::class, 'index']);
    Route::post('/shift-end', [\App\Http\Controllers\Api\ShiftEndController::class, 'store']);
    Route::patch('/shift-end/{shiftEnd}/approve', [\App\Http\Controllers\Api\ShiftEndController::class, 'approve']);
    Route::patch('/shift-end/{shiftEnd}/reject', [\App\Http\Controllers\Api\ShiftEndController::class, 'reject']);
    Route::get('/shift-end/{shiftEnd}', [\App\Http\Controllers\Api\ShiftEndController::class, 'show']);
    Route::put('/shift-end/{shiftEnd}', [\App\Http\Controllers\Api\ShiftEndController::class, 'update']);
    Route::delete('/shift-end/{shiftEnd}', [\App\Http\Controllers\Api\ShiftEndController::class, 'destroy']);

    // End of Day — matches /day-end frontend route's view_reports gate
    Route::middleware('permission:view_reports')->group(function () {
        Route::get('/end-of-day/summary', [\App\Http\Controllers\Api\EndOfDayController::class, 'summary']);
        Route::get('/end-of-day', [\App\Http\Controllers\Api\EndOfDayController::class, 'index']);
        Route::post('/end-of-day', [\App\Http\Controllers\Api\EndOfDayController::class, 'store']);
    });

    // Branches — matches /branches frontend route's manage_settings gate
    Route::middleware('permission:manage_settings')->group(function () {
        Route::apiResource('branches', \App\Http\Controllers\Api\BranchController::class);
    });

    // Categories, Brands, Units, etc.
    Route::apiResource('categories', \App\Http\Controllers\Api\CategoryController::class);
    Route::apiResource('brands', \App\Http\Controllers\Api\BrandController::class);
    Route::apiResource('units', \App\Http\Controllers\Api\UnitController::class);
    Route::apiResource('warehouses', \App\Http\Controllers\Api\WarehouseController::class);

    // Settings — matches /settings frontend route's manage_settings gate
    Route::middleware('permission:manage_settings')->group(function () {
        Route::get('/settings', [\App\Http\Controllers\Api\SettingController::class, 'index']);
        Route::post('/settings', [\App\Http\Controllers\Api\SettingController::class, 'update']);
    });

    // Audit log — matches /audit-logs frontend route's manage_settings gate
    Route::middleware('permission:manage_settings')->group(function () {
        Route::get('/audit-logs', [\App\Http\Controllers\Api\AuditLogController::class, 'index']);
    });

    // Currencies — read stays open (needed broadly, e.g. POS currency selector);
    // mutations match /currencies frontend route's manage_settings gate
    Route::get('/currencies/all', [CurrencyController::class, 'all']);
    Route::middleware('permission:manage_settings')->group(function () {
        Route::post('/currencies', [CurrencyController::class, 'store']);
        Route::put('/currencies/{currency}', [CurrencyController::class, 'update']);
        Route::delete('/currencies/{currency}', [CurrencyController::class, 'destroy']);
    });

    // Notifications
    Route::get('/notifications', fn() => response()->json(auth()->user()->notifications()->paginate(20)));
    Route::post('/notifications/mark-all-read', fn() => auth()->user()->unreadNotifications()->update(['read_at' => now()]));

    // Laybys
    Route::post('/laybys/{layby}/payment', [LaybyController::class, 'addPayment']);
    Route::post('/laybys/{layby}/cancel', [LaybyController::class, 'cancel']);
    Route::apiResource('laybys', LaybyController::class)->only(['index','store','show']);

    // Quotations
    Route::apiResource('quotations', QuotationController::class)->only(['index','store','show','update','destroy']);

    // Stock Transfers
    Route::post('/stock-transfers/{stockTransfer}/dispatch', [StockTransferController::class, 'dispatch']);
    Route::post('/stock-transfers/{stockTransfer}/receive', [StockTransferController::class, 'receive']);
    Route::post('/stock-transfers/{stockTransfer}/cancel', [StockTransferController::class, 'cancel']);
    Route::apiResource('stock-transfers', StockTransferController::class)->only(['index','store','show']);

    // Stocktakes
    Route::post('/stocktakes/{stocktake}/complete', [StocktakeController::class, 'complete']);
    Route::apiResource('stocktakes', StocktakeController::class)->only(['index','store','show','update']);

    // Product Batches / Expiry tracking
    Route::apiResource('product-batches', ProductBatchController::class);

    // Commissions — matches /commissions frontend route's view_reports gate
    Route::middleware('permission:view_reports')->group(function () {
        Route::get('/commissions/report', [CommissionController::class, 'report']);
        Route::post('/commissions/mark-paid', [CommissionController::class, 'markPaid']);
        Route::get('/commissions', [CommissionController::class, 'index']);
    });

    // Webhooks — matches /webhooks frontend route's manage_settings gate
    Route::middleware('permission:manage_settings')->group(function () {
        Route::post('/webhooks/{webhook}/test', [WebhookController::class, 'test']);
        Route::apiResource('webhooks', WebhookController::class);
    });

    // Role & Permissions — matches /roles-permissions frontend route's manage_settings
    // gate. This previously had NO gate at all: any authenticated user (e.g. a cashier)
    // could grant any role — including their own — arbitrary permissions via
    // PUT /roles/{role}. That's a live privilege-escalation hole, not just a UX gap.
    Route::middleware('permission:manage_settings')->group(function () {
        Route::get('/roles', [RolePermissionController::class, 'index']);
        Route::put('/roles/{role}', [RolePermissionController::class, 'updateRole']);
    });

    // Backup — matches /backups frontend route's manage_settings gate
    Route::middleware('permission:manage_settings')->group(function () {
        Route::get('/backups', [BackupController::class, 'index']);
        Route::post('/backups', [BackupController::class, 'create']);
        Route::get('/backups/{file}/download', [BackupController::class, 'download']);
    });

    // Scheduled Reports — no frontend consumer yet; gated the same as other
    // backend-admin config resources so it isn't left open by default.
    Route::middleware('permission:manage_settings')->group(function () {
        Route::apiResource('scheduled-reports', ScheduledReportController::class);
    });

    // Low-stock alerts
    Route::middleware('permission:view_reports')->group(function () {
        Route::get('/reports/low-stock', [ReportController::class, 'lowStock']);
        Route::get('/reports/vat', [ReportController::class, 'vatReport']);

        // Financial summary, consolidation & CSV exports
        Route::get('/reports/financial-summary', [ReportController::class, 'financialSummary']);
        Route::get('/reports/branch-consolidation', [ReportController::class, 'branchConsolidation']);
        Route::get('/reports/daily/csv', [ReportController::class, 'dailyCsv']);
        Route::get('/reports/monthly/csv', [ReportController::class, 'monthlyCsv']);
    });

    // EcoCash agent banking
    Route::get('/ecocash/summary', [EcocashController::class, 'summary']);
    Route::post('/ecocash/{ecocashTransaction}/reverse', [EcocashController::class, 'reverse']);
    Route::apiResource('ecocash', EcocashController::class)->only(['index', 'store']);

    // Cashflow, Salaries, Rentals — all match their frontend routes' view_reports gate
    Route::middleware('permission:view_reports')->group(function () {
        Route::apiResource('cashflow', CashflowController::class)->only(['index', 'store', 'update', 'destroy']);

        Route::post('/salaries/{salary}/mark-paid', [SalaryController::class, 'markPaid']);
        Route::apiResource('salaries', SalaryController::class)->only(['index', 'store', 'update', 'destroy']);

        Route::get('/rentals/{rental}/payments', [RentalController::class, 'payments']);
        Route::post('/rentals/{rental}/payments', [RentalController::class, 'addPayment']);
        Route::apiResource('rentals', RentalController::class);
    });

    // Stock Reconciliation
    Route::get('/stock-reconciliation', [StockReconciliationController::class, 'reconcile']);

    // PIN auth
    Route::post('/auth/pin-login', [AuthController::class, 'pinLogin']);
    Route::put('/auth/set-pin', [AuthController::class, 'setPin']);
});
