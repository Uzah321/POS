<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\IngredientStockAdjustment;
use App\Models\Layby;
use App\Support\AuditDetails;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Adds the detail that AuditObserver now captures (line items with product
 * names/quantities, names for *_id fields, the record's name/reference) to
 * audit log rows written before it did. Line items are read from the
 * sale/adjustment/transfer rows still in the database; a record that has
 * since been hard-deleted can't be recovered and is left as it was.
 * Safe to run more than once — rows that already have the detail are skipped.
 */
class BackfillAuditDetails extends Command
{
    protected $signature = 'audit:backfill-details {--dry-run : Show what would change without saving}';
    protected $description = 'Fill in product names, quantities and names for audit log entries written before detailed logging';

    public function handle(): int
    {
        $updated = 0;

        AuditLog::whereNotIn('event', ['login', 'logout'])
            ->whereNotNull('auditable_type')
            ->chunkById(500, function ($logs) use (&$updated) {
                foreach ($logs as $log) {
                    try {
                        if ($this->enrich($log)) $updated++;
                    } catch (\Throwable) {
                        // one unreadable row mustn't stop the rest
                    }
                }
            });

        $this->info(($this->option('dry-run') ? 'Would enrich' : 'Audit log entries enriched') . ": {$updated}");
        return self::SUCCESS;
    }

    private function enrich(AuditLog $log): bool
    {
        $class = $log->auditable_type;
        if (!class_exists($class)) return false;

        $old = $log->old_values ?? [];
        $new = $log->new_values ?? [];
        $changed = false;

        if (!isset($new['_refs']) && ($refs = AuditDetails::refs($old, $new))) {
            $new['_refs'] = $refs;
            $changed = true;
        }

        $hasItems = is_array($new['items'] ?? null) || is_array($old['items'] ?? null);
        if (!$hasItems) {
            $items = [];
            if ($class === IngredientStockAdjustment::class || $class === Layby::class) {
                // Everything needed is in the logged values themselves.
                $model = (new $class)->setRawAttributes(array_merge($old, array_diff_key($new, ['_refs' => 1])));
                $items = AuditDetails::immediate($model, 'created')['items'] ?? [];
            } elseif (($model = $this->find($class, $log->auditable_id)) && AuditDetails::hasLineItems($model)) {
                $items = AuditDetails::lineItems($model);
            }
            if ($items) {
                $new['items'] = $items;
                $changed = true;
            }
        }

        // Updates only stored the changed fields, so name the record ("Sale SALE-…" not "Sale #66").
        if ($log->event === 'updated') {
            $model ??= $this->find($class, $log->auditable_id);
            foreach (['name', 'reference'] as $key) {
                if (!isset($new[$key]) && !array_key_exists($key, $old) && $model && $model->getAttribute($key) !== null) {
                    $new[$key] = $model->getAttribute($key);
                    $changed = true;
                }
            }
        }

        if ($log->event === 'created' && $class === \App\Models\Product::class && !array_key_exists('opening_stock', $new)) {
            if (($opening = $this->openingStock($log)) !== null) {
                $new = array_merge($new, $opening);
                $changed = true;
            }
        }

        if (!$changed) return false;

        $log->timestamps = false;
        $log->new_values = $new;
        if ($this->option('dry-run')) {
            $this->line("#{$log->id} {$log->event}: {$log->description}");
            return true;
        }
        $log->saveQuietly();
        return true;
    }

    /**
     * ProductController::store (and the Excel import) write the opening-stock
     * row in the same request as the product, so a stock row created within
     * a minute of the product is that row. No such row means it started at 0.
     *
     * If that row was never touched since, its quantity is the opening
     * amount. Otherwise the opening amount is worked back from today's stock
     * and every recorded movement since — but only when all movements are of
     * a kind whose exact effect is known (completed/voided sales, stock
     * adjustments). Anything else (deliveries, transfers, stocktakes,
     * refunds, variants, a stock write after the last recorded movement)
     * means the figure can't be proven, and nothing is written.
     */
    private function openingStock(AuditLog $log): ?array
    {
        $pid  = $log->auditable_id;
        $all  = \App\Models\Stock::where('product_id', $pid)->get();
        $rows = $all->filter(fn ($r) => $r->created_at
            && $r->created_at->between($log->created_at->copy()->subMinute(), $log->created_at->copy()->addMinute()));

        if ($rows->isEmpty()) {
            // A row without timestamps (raw insert) could be the opening row — don't claim 0 then.
            if ($all->contains(fn ($r) => !$r->created_at)) return null;
            return \App\Models\Product::withoutGlobalScopes()->whereKey($pid)->exists()
                ? ['opening_stock' => 0]
                : null;
        }

        $warehouse = \App\Models\Warehouse::withoutGlobalScopes()->whereKey($rows->first()->warehouse_id)->value('name');
        $result = fn (float $qty) => array_filter([
            'opening_stock'           => $qty,
            'opening_stock_warehouse' => $warehouse,
        ], fn ($v) => $v !== null);

        if (!$rows->contains(fn ($r) => !$r->updated_at || !$r->updated_at->equalTo($r->created_at))) {
            return $result((float) $rows->sum('quantity'));
        }

        $opening = $this->reconstructOpening($pid, $all);
        return $opening === null ? null : $result($opening);
    }

    private function reconstructOpening(int $pid, $stockRows): ?float
    {
        $product = \App\Models\Product::withoutGlobalScopes()->find($pid);
        if (!$product || $product->made_to_order || !$product->track_stock) return null;
        if ($stockRows->contains(fn ($r) => $r->product_variant_id !== null || !$r->updated_at)) return null;

        // Movement kinds whose effect on stock isn't provable from here.
        $saleItemIds = DB::table('sale_items')->where('product_id', $pid)->pluck('id');
        if (DB::table('goods_receipt_items')->where('product_id', $pid)->exists()
            || DB::table('stock_transfer_items')->where('product_id', $pid)->exists()
            || DB::table('stocktake_items')->where('product_id', $pid)->exists()
            || DB::table('stock_count_items')->where('product_id', $pid)->exists()
            || ($saleItemIds->isNotEmpty() && DB::table('refund_items')->whereIn('sale_item_id', $saleItemIds)->exists())) {
            return null;
        }

        $sales = DB::table('sale_items as i')->join('sales as s', 's.id', '=', 'i.sale_id')
            ->where('i.product_id', $pid)
            ->get(['s.status', 's.warehouse_id', 's.created_at', 's.completed_at', 's.voided_at', 'i.quantity', 'i.product_variant_id']);
        $warehouses = $stockRows->pluck('warehouse_id')->all();
        $sold = 0.0;
        $lastMovement = null;
        foreach ($sales as $sale) {
            // Completed sales deduct exactly; voided ones deduct then restore (net 0). Open tabs etc. are unclear.
            if (!in_array($sale->status, ['completed', 'voided'], true)) return null;
            if ($sale->product_variant_id !== null || !in_array($sale->warehouse_id, $warehouses)) return null;
            if ($sale->status === 'completed') $sold += (float) $sale->quantity;
            $lastMovement = max($lastMovement, $sale->voided_at ?? $sale->completed_at ?? $sale->created_at, $sale->created_at);
        }

        $adjustments = DB::table('stock_adjustment_items as i')->join('stock_adjustments as a', 'a.id', '=', 'i.stock_adjustment_id')
            ->where('i.product_id', $pid)
            ->get(['a.created_at', 'i.quantity_before', 'i.quantity_after', 'i.product_variant_id']);
        $adjusted = 0.0;
        foreach ($adjustments as $a) {
            if ($a->product_variant_id !== null) return null;
            // after - before is what really happened (a removal is clamped at 0).
            $adjusted += (float) $a->quantity_after - (float) $a->quantity_before;
            $lastMovement = max($lastMovement, $a->created_at);
        }
        if ($lastMovement === null) return null;

        // A stock write later than every recorded movement (e.g. an Excel
        // import overwriting the quantity) would make the sum wrong.
        $lastWrite = $stockRows->max('updated_at');
        if ($lastWrite->gt(\Illuminate\Support\Carbon::parse($lastMovement)->addSeconds(5))) return null;

        $opening = round((float) $stockRows->sum('quantity') - $adjusted + $sold, 3);
        return $opening >= 0 ? $opening : null;
    }

    private function find(string $class, $id)
    {
        static $cache = [];
        if (!$id) return null;
        // withoutGlobalScopes also lifts SoftDeletes, so soft-deleted records still count.
        return $cache["{$class}:{$id}"] ??= $class::query()->withoutGlobalScopes()->find($id);
    }
}
