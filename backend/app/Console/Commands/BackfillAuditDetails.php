<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\IngredientStockAdjustment;
use App\Models\Layby;
use App\Support\AuditDetails;
use Illuminate\Console\Command;

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

    private function find(string $class, $id)
    {
        static $cache = [];
        if (!$id) return null;
        // withoutGlobalScopes also lifts SoftDeletes, so soft-deleted records still count.
        return $cache["{$class}:{$id}"] ??= $class::query()->withoutGlobalScopes()->find($id);
    }
}
