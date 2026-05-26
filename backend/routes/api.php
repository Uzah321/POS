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
});
