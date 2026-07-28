<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use App\Observers\AuditObserver;
use App\Models\{
    Sale, Product, User, Customer, Supplier, Branch, Expense,
    PurchaseOrder, GoodsReceipt, StockAdjustment, StockTransfer, StockCount, Stocktake,
    Refund, Category, Brand, Unit, Warehouse, TaxRate, Ingredient, ProductCaseUnit,
    Promotion, Quotation, Layby, Rental, Salary, Commission, Attendance, Department,
    Currency, ExpenseCategory, SupplierPayment, ShiftEnd, EndOfDay, Webhook,
    ScheduledReport, Setting, CashflowEntry, CustomerCreditTransaction, LoyaltyTransaction,
    EcocashTransaction, IngredientVendor, IngredientBranchSetting, IngredientStockAdjustment,
};

class AppServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void
    {
        // Every model here gets created/updated/deleted rows in the audit log
        // automatically via AuditObserver — no per-controller instrumentation
        // needed, Eloquent's own save/delete lifecycle drives it. Deliberately
        // excluded: pure line-item children of an already-audited parent
        // (SaleItem, PurchaseOrderItem, RefundItem, StockAdjustmentItem, etc.
        // — logging those separately would just duplicate the parent's own
        // "created" entry with no extra signal) and raw on-hand quantity rows
        // (Stock, IngredientStock — every sale/adjustment/transfer touches
        // these, but the action that caused the change is already logged via
        // its own model, e.g. Sale/StockAdjustment/StockTransfer).
        $models = [
            Sale::class, Product::class, User::class, Customer::class, Supplier::class,
            Branch::class, Expense::class,
            PurchaseOrder::class, GoodsReceipt::class, StockAdjustment::class,
            StockTransfer::class, StockCount::class, Stocktake::class, Refund::class,
            Category::class, Brand::class, Unit::class, Warehouse::class, TaxRate::class,
            Ingredient::class, ProductCaseUnit::class, Promotion::class, Quotation::class,
            Layby::class, Rental::class, Salary::class, Commission::class, Attendance::class,
            Department::class, Currency::class, ExpenseCategory::class, SupplierPayment::class,
            ShiftEnd::class, EndOfDay::class, Webhook::class, ScheduledReport::class,
            Setting::class, CashflowEntry::class, CustomerCreditTransaction::class,
            LoyaltyTransaction::class, EcocashTransaction::class, IngredientVendor::class,
            IngredientBranchSetting::class, IngredientStockAdjustment::class,
        ];
        foreach ($models as $model) {
            $model::observe(AuditObserver::class);
        }
    }
}
