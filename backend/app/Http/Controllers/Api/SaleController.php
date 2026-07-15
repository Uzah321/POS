<?php

namespace App\Http\Controllers\Api;

use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SalePayment;
use App\Models\Stock;
use App\Models\Customer;
use App\Models\LoyaltyTransaction;
use App\Models\CustomerCreditTransaction;
use App\Models\HeldSale;
use App\Models\ShiftEnd;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SaleController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $branchId = $this->effectiveBranchId($request);
        $query = Sale::with('customer', 'cashier', 'branch')
            ->withCount('items')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->when($request->status, fn($q) => $q->where('status', $request->status))
            ->when($request->cashier_id, fn($q) => $q->where('user_id', $request->cashier_id))
            ->when($request->customer_id, fn($q) => $q->where('customer_id', $request->customer_id))
            ->when($request->date_from, fn($q) => $q->whereDate('created_at', '>=', $request->date_from))
            ->when($request->date_to, fn($q) => $q->whereDate('created_at', '<=', $request->date_to))
            ->when($request->search, fn($q) => $q->where('reference', 'like', "%{$request->search}%"))
            ->when($request->current_shift, function ($q) use ($request) {
                $user       = $request->user();
                $lastShift  = ShiftEnd::where('user_id', $user->id)->latest()->first();
                $shiftStart = $lastShift ? $lastShift->shift_end : now()->startOfDay();
                return $q->where('created_at', '>=', $shiftStart);
            });

        return $this->paginated($query->latest()->paginate($request->per_page ?? 20));
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'branch_id'      => 'required|exists:branches,id',
            'warehouse_id'   => 'required|exists:warehouses,id',
            'customer_id'    => 'nullable|exists:customers,id',
            'items'          => 'required|array|min:1',
            'items.*.product_id'         => 'required|exists:products,id',
            'items.*.product_variant_id' => 'nullable|exists:product_variants,id',
            'items.*.quantity'           => 'required|numeric|min:0.001',
            'items.*.unit_price'         => 'required|numeric|min:0',
            'items.*.discount_type'      => 'nullable|in:fixed,percent',
            'items.*.discount_value'     => 'nullable|numeric|min:0',
            'items.*.note'               => 'nullable|string',
            'payments'       => 'required|array|min:1',
            'payments.*.method'  => 'required|in:cash,card,mobile_money,bank_transfer,loyalty_points,credit,other',
            'payments.*.amount'  => 'required|numeric|min:0',
            'payments.*.reference' => 'nullable|string',
            'discount_type'  => 'nullable|in:fixed,percent',
            'discount_value' => 'nullable|numeric|min:0',
            'coupon_code'    => 'nullable|string',
            'notes'          => 'nullable|string',
            'table_number'   => 'nullable|string|max:20',
            'order_type'     => 'nullable|string|max:20',
            'is_offline'     => 'boolean',
        ]);

        // Each branch owns its own catalog — a cashier can only ring up
        // products that actually belong to their own branch's catalog.
        $productIds = collect($data['items'])->pluck('product_id')->unique();
        $ownedCount = \App\Models\Product::whereIn('id', $productIds)->where('branch_id', $data['branch_id'])->count();
        if ($ownedCount !== $productIds->count()) {
            return $this->error('One or more items do not belong to this branch.', 422);
        }

        return DB::transaction(function () use ($data, $request) {
            // Products keyed by id, with each one's tax rate preloaded — used both for
            // per-item tax calculation below and cost price lookup further down.
            $productIds  = collect($data['items'])->pluck('product_id')->unique();
            $productsById = \App\Models\Product::with('taxRate')->whereIn('id', $productIds)->get()->keyBy('id');

            // A product's own tax rate (if assigned) overrides the store-wide rate;
            // otherwise fall back to the global Settings tax rate, when tax is enabled.
            $taxEnabled    = filter_var(\App\Models\Setting::get('tax_enabled', false), FILTER_VALIDATE_BOOLEAN);
            $globalTaxRate = (float) \App\Models\Setting::get('tax_rate', 0);

            // Calculate totals
            $subtotal       = 0;
            $totalDiscount  = 0;
            $totalTax       = 0;
            $lineItems      = [];

            foreach ($data['items'] as $item) {
                $unitPrice  = (float) $item['unit_price'];
                $qty        = (float) $item['quantity'];
                $lineSubtotal = $unitPrice * $qty;

                $discAmt = 0;
                if (! empty($item['discount_type']) && ! empty($item['discount_value'])) {
                    $discAmt = $item['discount_type'] === 'percent'
                        ? $lineSubtotal * ($item['discount_value'] / 100)
                        : min((float) $item['discount_value'], $lineSubtotal);
                }

                $taxable = $lineSubtotal - $discAmt;
                $product = $productsById->get($item['product_id']);
                $rate    = $taxEnabled ? (float) ($product?->taxRate?->rate ?? $globalTaxRate) : 0.0;
                $taxAmt  = round($taxable * ($rate / 100), 2);

                $lineItems[] = array_merge($item, [
                    'subtotal'        => $lineSubtotal,
                    'discount_amount' => $discAmt,
                    'tax_amount'      => $taxAmt,
                    'total'           => $taxable + $taxAmt,
                ]);

                $subtotal      += $lineSubtotal;
                $totalDiscount += $discAmt;
                $totalTax      += $taxAmt;
            }

            // Cart-level discount
            $cartDiscount = 0;
            if (! empty($data['discount_type']) && ! empty($data['discount_value'])) {
                $cartDiscount = $data['discount_type'] === 'percent'
                    ? ($subtotal - $totalDiscount) * ($data['discount_value'] / 100)
                    : min((float) $data['discount_value'], $subtotal - $totalDiscount);
            }
            $totalDiscount += $cartDiscount;

            $total      = $subtotal - $totalDiscount + $totalTax;
            $amountPaid = collect($data['payments'])->sum('amount');
            $changeDue  = max(0, $amountPaid - $total);

            $sale = Sale::create([
                'branch_id'       => $data['branch_id'],
                'warehouse_id'    => $data['warehouse_id'],
                'customer_id'     => $data['customer_id'] ?? null,
                'user_id'         => $request->user()->id,
                'status'          => 'completed',
                'subtotal'        => $subtotal,
                'discount_amount' => $totalDiscount,
                'tax_amount'      => $totalTax,
                'total'           => $total,
                'amount_paid'     => $amountPaid,
                'change_due'      => $changeDue,
                'discount_type'   => $data['discount_type'] ?? null,
                'discount_value'  => $data['discount_value'] ?? 0,
                'coupon_code'     => $data['coupon_code'] ?? null,
                'notes'           => $data['notes'] ?? null,
                'table_number'    => $data['table_number'] ?? null,
                'order_type'      => $data['order_type'] ?? null,
                'is_offline'      => $data['is_offline'] ?? false,
                'completed_at'    => now(),
                'kds_status'      => 'new',
            ]);

            $costPrices = $productsById->pluck('cost_price', 'id');

            // Create line items & deduct stock
            foreach ($lineItems as $item) {
                SaleItem::create([
                    'sale_id'            => $sale->id,
                    'product_id'         => $item['product_id'],
                    'product_variant_id' => $item['product_variant_id'] ?? null,
                    'quantity'           => $item['quantity'],
                    'unit_price'         => $item['unit_price'],
                    'cost_price'         => (float) ($costPrices[$item['product_id']] ?? 0),
                    'discount_amount'    => $item['discount_amount'],
                    'tax_amount'         => $item['tax_amount'],
                    'subtotal'           => $item['subtotal'],
                    'total'              => $item['total'],
                    'discount_type'      => $item['discount_type'] ?? null,
                    'discount_value'     => $item['discount_value'] ?? 0,
                    'note'               => $item['note'] ?? null,
                ]);

                // Deduct from stock
                $this->deductStock($data['warehouse_id'], $item['product_id'], $item['product_variant_id'] ?? null, $item['quantity']);
            }

            // Record payments
            foreach ($data['payments'] as $payment) {
                SalePayment::create([
                    'sale_id'   => $sale->id,
                    'method'    => $payment['method'],
                    'amount'    => $payment['amount'],
                    'reference' => $payment['reference'] ?? null,
                ]);
            }

            // Handle loyalty points
            if ($sale->customer_id) {
                $customer = Customer::find($sale->customer_id);
                $points   = (int) ($total / 10); // 1 point per R10 spent
                if ($points > 0) {
                    $customer->increment('loyalty_points', $points);
                    LoyaltyTransaction::create([
                        'customer_id'  => $customer->id,
                        'sale_id'      => $sale->id,
                        'type'         => 'earned',
                        'points'       => $points,
                        'balance_after'=> $customer->fresh()->loyalty_points,
                    ]);
                }
            }

            return $this->success($sale->load('items.product', 'payments', 'customer', 'cashier', 'branch'), 'Sale completed', 201);
        });
    }

    public function show(Sale $sale): \Illuminate\Http\JsonResponse
    {
        return $this->success($sale->load('items.product', 'items.variant', 'payments', 'customer', 'cashier', 'branch', 'refunds'));
    }

    public function cancel(Sale $sale): \Illuminate\Http\JsonResponse
    {
        if (! auth()->user()->can('void_sales')) {
            return $this->error('You do not have permission to cancel orders', 403);
        }
        if ($sale->status === 'voided') {
            return $this->error('Sale is already cancelled', 422);
        }

        $sale->load('items');

        return DB::transaction(function () use ($sale) {
            // Restore stock for each item
            foreach ($sale->items as $item) {
                $stock = Stock::where('warehouse_id', $sale->warehouse_id)
                    ->where('product_id', $item->product_id)
                    ->where('product_variant_id', $item->product_variant_id)
                    ->first();
                if ($stock) {
                    $stock->increment('quantity', $item->quantity);
                }
            }

            $sale->update(['status' => 'voided']);

            return $this->success($sale->fresh(), 'Sale cancelled successfully');
        });
    }

    public function receipt(Sale $sale): \Illuminate\Http\JsonResponse
    {
        return $this->success($sale->load('items.product', 'payments', 'customer', 'cashier', 'branch'));
    }

    // Hold/Park a sale
    public function hold(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'branch_id'    => 'required|exists:branches,id',
            'customer_id'  => 'nullable|exists:customers,id',
            'cart_data'    => 'required|array',
            'note'         => 'nullable|string',
            'table_number' => 'nullable|string|max:20',
        ]);

        $held = HeldSale::create([
            'branch_id'    => $data['branch_id'],
            'user_id'      => $request->user()->id,
            'customer_id'  => $data['customer_id'] ?? null,
            'cart_data'    => $data['cart_data'],
            'note'         => $data['note'] ?? null,
            'order_status' => 'open',
            'table_number' => $data['table_number'] ?? null,
        ]);

        return $this->success($held, 'Sale held successfully', 201);
    }

    public function updateHeldStatus(Request $request, int $id): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate(['order_status' => 'required|in:open,preparing,ready']);
        $held = HeldSale::findOrFail($id);
        $held->update(['order_status' => $data['order_status']]);
        return $this->success($held, 'Status updated');
    }

    public function heldSales(Request $request): \Illuminate\Http\JsonResponse
    {
        $held = HeldSale::with('customer')
            ->where('branch_id', $request->branch_id)
            ->latest()
            ->get();
        return $this->success($held);
    }

    public function deleteHeld(int $id): \Illuminate\Http\JsonResponse
    {
        HeldSale::findOrFail($id)->delete();
        return $this->success(null, 'Held sale removed');
    }

    private function deductStock(int $warehouseId, int $productId, ?int $variantId, float $qty): void
    {
        $stock = Stock::where('warehouse_id', $warehouseId)
            ->where('product_id', $productId)
            ->where('product_variant_id', $variantId)
            ->first();

        if ($stock) {
            $stock->decrement('quantity', $qty);
        }
    }
}
