<?php

namespace App\Observers;

use App\Models\AuditLog;
use App\Support\AuditDetails;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Request;

class AuditObserver
{
    /** Line items snapshotted in deleting(), keyed by spl_object_id — by deleted() a cascade may already have removed them. */
    private static array $pendingDeletes = [];

    private function log(string $event, Model $model, array $old = [], array $new = []): ?AuditLog
    {
        try {
            $refs = AuditDetails::refs($old, $new);
            $new  = array_merge($new, AuditDetails::immediate($model, $event));
            if ($refs) $new['_refs'] = $refs;

            return AuditLog::create([
                'user_id'        => Auth::id(),
                'event'          => $event,
                'auditable_type' => get_class($model),
                'auditable_id'   => $model->getKey(),
                'old_values'     => $old ?: null,
                'new_values'     => $new ?: null,
                'url'            => Request::url(),
                'ip_address'     => Request::ip(),
                'user_agent'     => Request::userAgent(),
            ]);
        } catch (\Throwable) {
            // never let audit logging break the main request
            return null;
        }
    }

    public function created(Model $model): void
    {
        $log = $this->log('created', $model, [], $model->getAttributes());
        if (!$log || !AuditDetails::hasLineItems($model)) return;

        // A sale/PO/adjustment's line items are inserted *after* the parent
        // row, so they don't exist yet. Collect them once the surrounding
        // transaction commits (or at the end of the request if there is none).
        $attach = function () use ($log, $model) {
            try {
                $items = AuditDetails::lineItems($model);
                if (!$items) return;
                $fresh = AuditLog::find($log->id);
                if (!$fresh) return;
                $values = $fresh->new_values ?? [];
                // A controller may already have attached richer items (e.g. with before/after stock) — keep those.
                if (empty($values['items'])) {
                    $values['items'] = $items;
                    $fresh->new_values = $values;
                    $fresh->save();
                }
            } catch (\Throwable) {
                // never let audit logging break the main request
            }
        };

        if (DB::transactionLevel() > 0) {
            DB::afterCommit($attach);
        } else {
            app()->terminating($attach);
        }
    }

    public function updated(Model $model): void
    {
        $dirty = $model->getDirty();
        unset($dirty['updated_at']);
        if (empty($dirty)) return;
        $old = array_intersect_key($model->getOriginal(), $dirty);
        // Only changed fields are stored, so keep what identifies the record
        // ("Sale SALE-66…" rather than "Sale #66"). Not in $old, so it isn't shown as a change.
        foreach (['name', 'reference'] as $key) {
            if (!array_key_exists($key, $dirty) && $model->getAttribute($key) !== null) $dirty[$key] = $model->getAttribute($key);
        }
        // e.g. a sale being voided or a PO being approved — show what it contained.
        if (AuditDetails::hasLineItems($model) && ($items = AuditDetails::lineItems($model))) {
            $dirty['items'] = $items;
        }
        $this->log('updated', $model, $old, $dirty);
    }

    public function deleting(Model $model): void
    {
        if (AuditDetails::hasLineItems($model)) {
            self::$pendingDeletes[spl_object_id($model)] = AuditDetails::lineItems($model);
        }
    }

    public function deleted(Model $model): void
    {
        $old = $model->getAttributes();
        $items = self::$pendingDeletes[spl_object_id($model)] ?? [];
        unset(self::$pendingDeletes[spl_object_id($model)]);
        if ($items) $old['items'] = $items;
        $this->log('deleted', $model, $old);
    }
}
