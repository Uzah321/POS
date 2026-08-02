<?php namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AuditLog extends Model
{
    protected $fillable = [
        'user_id', 'event', 'auditable_type', 'auditable_id',
        'old_values', 'new_values', 'url', 'ip_address', 'user_agent',
    ];
    protected $casts = ['old_values' => 'array', 'new_values' => 'array'];
    protected $appends = ['action', 'description'];

    public function user(): BelongsTo { return $this->belongsTo(User::class); }

    public function getActionAttribute(): string
    {
        return $this->event ?? '';
    }

    /**
     * Finds the most recently written log row for a given auditable model and
     * merges extra detail (e.g. line items with quantities) into its
     * new_values. Needed because parent/child rows are usually created in two
     * steps — the observer already logged the parent by the time its child
     * items (which hold the actual quantities) exist — so there's nothing to
     * append to until after both are done.
     */
    public static function attachExtra(Model $auditable, array $extra): void
    {
        try {
            $log = static::where('auditable_type', get_class($auditable))
                ->where('auditable_id', $auditable->getKey())
                ->latest('id')
                ->first();
            if (!$log) return;
            $log->new_values = array_merge($log->new_values ?? [], $extra);
            $log->save();
        } catch (\Throwable) {
            // never let audit logging break the main request
        }
    }

    public function getDescriptionAttribute(): string
    {
        $model = $this->auditable_type ? class_basename($this->auditable_type) : '';
        $id    = $this->auditable_id ?? '';
        $name  = ($this->new_values['name'] ?? null) ?? ($this->old_values['name'] ?? null);
        // With a name field (Product, Customer, ...): "Product 'Coke 500ml'".
        // Without one (StockAdjustment, StockTransfer, ...) the model+id is
        // already the whole subject, so it must not be prefixed with the
        // model name again — that previously read "Stockadjustment
        // StockAdjustment #5 created".
        $label = $name ? (ucfirst($model) . " '{$name}'") : ($id ? "{$model} #{$id}" : ucfirst($model));
        $items = $this->new_values['items'] ?? $this->old_values['items'] ?? null;

        switch ($this->event) {
            case 'login':   return 'User logged in';
            case 'logout':  return 'User logged out';
            case 'created': return "{$label} created" . $this->summarizeItems($items);
            case 'deleted': return "{$label} deleted";
            case 'updated':
                $skip    = ['updated_at', 'created_at', 'slug', 'password', 'remember_token', 'items'];
                $changes = [];
                if (!empty($this->old_values)) {
                    foreach ($this->old_values as $field => $oldVal) {
                        if (in_array($field, $skip)) continue;
                        $newVal    = $this->new_values[$field] ?? null;
                        $changes[] = "{$field}: {$oldVal} -> {$newVal}";
                    }
                }
                if (!empty($changes)) {
                    $detail = implode(', ', array_slice($changes, 0, 3));
                    if (count($changes) > 3) $detail .= ' (+' . (count($changes) - 3) . ' more)';
                    return "{$label} updated: {$detail}" . $this->summarizeItems($items);
                }
                return "{$label} updated" . $this->summarizeItems($items);
            default:
                return trim(ucfirst($this->event ?? '') . ($model ? " {$model}" : '') . ($id ? " #{$id}" : ''));
        }
    }

    /** Turns an attached items[] detail array (see attachExtra()) into a short " — 2x Coke +100, 1x Sprite -5" style suffix. */
    private function summarizeItems(?array $items): string
    {
        if (empty($items)) return '';
        $parts = [];
        foreach (array_slice($items, 0, 4) as $item) {
            $label = $item['product_name'] ?? $item['name'] ?? ('#' . ($item['product_id'] ?? '?'));
            $qty   = $item['quantity_adjusted'] ?? $item['quantity'] ?? $item['received_quantity'] ?? null;
            $parts[] = $qty !== null ? "{$label} ({$qty})" : $label;
        }
        $suffix = ' — ' . implode(', ', $parts);
        if (count($items) > 4) $suffix .= ' +' . (count($items) - 4) . ' more';
        return $suffix;
    }
}
