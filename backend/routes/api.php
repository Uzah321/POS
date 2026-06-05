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

// Public routes
Route::get('/currencies', [CurrencyController::class, 'index']); // public — needed for POS currency selector

// Protected routes
Route::post('/auth/login', [AuthController::class, 'login']);

// Protected routes
Route::middleware('auth:sanctum')->group(function () {
    // Auth
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::put('/auth/profile', [AuthController::class, 'updateProfile']);

    // Users
    Route::apiResource('users', UserController::class);

    // Products
    Route::get('/products/search', [ProductController::class, 'search']);
    Route::apiResource('products', ProductController::class);

    // Sales
    Route::get('/sales/held', [SaleController::class, 'heldSales']);
    Route::post('/sales/hold', [SaleController::class, 'hold']);
    Route::delete('/sales/held/{id}', [SaleController::class, 'deleteHeld']);
    Route::patch('/sales/held/{id}/status', [SaleController::class, 'updateHeldStatus']);
    Route::get('/sales/{sale}/receipt', [SaleController::class, 'receipt']);
    Route::patch('/sales/{sale}/cancel', [SaleController::class, 'cancel']);
    Route::apiResource('sales', SaleController::class)->only(['index', 'store', 'show']);

    // Refunds
    Route::apiResource('refunds', RefundController::class)->only(['index', 'store', 'show']);

    // Customers
    Route::get('/customers/{customer}/purchase-history', [CustomerController::class, 'purchaseHistory']);
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
    Route::get('/inventory/transfers', [InventoryController::class, 'transferIndex']);
    Route::post('/inventory/transfers', [InventoryController::class, 'createTransfer']);
    Route::post('/inventory/transfers/{stockTransfer}/receive', [InventoryController::class, 'receiveTransfer']);
    Route::post('/inventory/import', [InventoryController::class, 'importStock']);
    Route::get('/inventory/import-template', [InventoryController::class, 'importTemplate']);

    // Expenses
    Route::get('/expense-categories', [ExpenseController::class, 'categories']);
    Route::apiResource('expenses', ExpenseController::class)->except(['show']);

    // Reports & Dashboard
    Route::get('/reports/dashboard', [ReportController::class, 'dashboard']);
    Route::get('/reports/sales', [ReportController::class, 'salesReport']);
    Route::get('/reports/inventory', [ReportController::class, 'inventoryReport']);
    Route::get('/reports/profit-loss', [ReportController::class, 'profitLoss']);
    Route::get('/reports/cashier-performance', [ReportController::class, 'cashierPerformance']);
    Route::get('/reports/daily', [ReportController::class, 'dailyReport']);
    Route::get('/reports/monthly', [ReportController::class, 'monthlyReport']);
    Route::get('/reports/stock-variances', [ReportController::class, 'stockVariances']);
    Route::get('/reports/daily/pdf', [ReportController::class, 'dailyPdf']);
    Route::get('/reports/monthly/pdf', [ReportController::class, 'monthlyPdf']);

    // Shift End
    Route::get('/shift-end/summary', [\App\Http\Controllers\Api\ShiftEndController::class, 'summary']);
    Route::get('/shift-end', [\App\Http\Controllers\Api\ShiftEndController::class, 'index']);
    Route::post('/shift-end', [\App\Http\Controllers\Api\ShiftEndController::class, 'store']);
    Route::patch('/shift-end/{shiftEnd}/approve', [\App\Http\Controllers\Api\ShiftEndController::class, 'approve']);

    // End of Day
    Route::get('/end-of-day/summary', [\App\Http\Controllers\Api\EndOfDayController::class, 'summary']);
    Route::get('/end-of-day', [\App\Http\Controllers\Api\EndOfDayController::class, 'index']);
    Route::post('/end-of-day', [\App\Http\Controllers\Api\EndOfDayController::class, 'store']);

    // Branches (simple CRUD via model binding)
    Route::apiResource('branches', \App\Http\Controllers\Api\BranchController::class);

    // Categories, Brands, etc.
    Route::apiResource('categories', \App\Http\Controllers\Api\CategoryController::class);
    Route::apiResource('brands', \App\Http\Controllers\Api\BrandController::class);
    Route::apiResource('warehouses', \App\Http\Controllers\Api\WarehouseController::class);

    // Settings
    Route::get('/settings', [\App\Http\Controllers\Api\SettingController::class, 'index']);
    Route::post('/settings', [\App\Http\Controllers\Api\SettingController::class, 'update']);

    // Audit log
    Route::get('/audit-logs', [\App\Http\Controllers\Api\AuditLogController::class, 'index']);

    // Currencies
    Route::get('/currencies/all', [CurrencyController::class, 'all']);
    Route::post('/currencies', [CurrencyController::class, 'store']);
    Route::put('/currencies/{currency}', [CurrencyController::class, 'update']);
    Route::delete('/currencies/{currency}', [CurrencyController::class, 'destroy']);

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

    // Commissions
    Route::get('/commissions/report', [CommissionController::class, 'report']);
    Route::post('/commissions/mark-paid', [CommissionController::class, 'markPaid']);
    Route::get('/commissions', [CommissionController::class, 'index']);

    // Webhooks
    Route::post('/webhooks/{webhook}/test', [WebhookController::class, 'test']);
    Route::apiResource('webhooks', WebhookController::class);

    // Role & Permissions
    Route::get('/roles', [RolePermissionController::class, 'index']);
    Route::put('/roles/{role}', [RolePermissionController::class, 'updateRole']);

    // Backup
    Route::get('/backups', [BackupController::class, 'index']);
    Route::post('/backups', [BackupController::class, 'create']);
    Route::get('/backups/{file}/download', [BackupController::class, 'download']);

    // Scheduled Reports
    Route::apiResource('scheduled-reports', ScheduledReportController::class);

    // Low-stock alerts
    Route::get('/reports/low-stock', [ReportController::class, 'lowStock']);
    Route::get('/reports/vat', [ReportController::class, 'vatReport']);

    // Financial summary, consolidation & CSV exports
    Route::get('/reports/financial-summary', [ReportController::class, 'financialSummary']);
    Route::get('/reports/branch-consolidation', [ReportController::class, 'branchConsolidation']);
    Route::get('/reports/daily/csv', [ReportController::class, 'dailyCsv']);
    Route::get('/reports/monthly/csv', [ReportController::class, 'monthlyCsv']);

    // EcoCash agent banking
    Route::get('/ecocash/summary', [EcocashController::class, 'summary']);
    Route::post('/ecocash/{ecocashTransaction}/reverse', [EcocashController::class, 'reverse']);
    Route::apiResource('ecocash', EcocashController::class)->only(['index', 'store']);

    // Cashflow
    Route::apiResource('cashflow', CashflowController::class)->only(['index', 'store', 'update', 'destroy']);

    // Salaries
    Route::post('/salaries/{salary}/mark-paid', [SalaryController::class, 'markPaid']);
    Route::apiResource('salaries', SalaryController::class)->only(['index', 'store', 'update', 'destroy']);

    // Rentals
    Route::get('/rentals/{rental}/payments', [RentalController::class, 'payments']);
    Route::post('/rentals/{rental}/payments', [RentalController::class, 'addPayment']);
    Route::apiResource('rentals', RentalController::class);

    // Stock Reconciliation
    Route::get('/stock-reconciliation', [StockReconciliationController::class, 'reconcile']);

    // PIN auth
    Route::post('/auth/pin-login', [AuthController::class, 'pinLogin']);
    Route::put('/auth/set-pin', [AuthController::class, 'setPin']);
});
