<?php namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class AuditLog extends Model
{
    protected $fillable = [
        'user_id', 'event', 'auditable_type', 'auditable_id',
        'old_values', 'new_values', 'url', 'ip_address', 'user_agent',
    ];
    protected $casts = ['old_values' => 'array', 'new_values' => 'array'];
    protected $appends = ['action', 'description', 'subject'];

    /** Fields that are noise in a change list (or are rendered separately, like items). */
    public const SKIP_FIELDS = ['updated_at', 'created_at', 'slug', 'password', 'remember_token', 'items', '_refs', 'id'];

    private const ADJUSTMENT_TYPES = [
        'in' => 'Stock added', 'out' => 'Stock removed', 'damage' => 'Stock written off (damage/wastage)',
        'correction' => 'Stock corrected', 'opening' => 'Opening stock set', 'return' => 'Stock returned',
    ];

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

    /** Reads a value from whichever side of the log has it (new first, since that's the current state). */
    private function val(string $field)
    {
        return $this->new_values[$field] ?? $this->old_values[$field] ?? null;
    }

    /** "warehouse_id" + 2 -> "Main Warehouse", using the names captured when the log was written. */
    public function refName(string $field, $id)
    {
        if ($id === null || $id === '' || !is_scalar($id)) return $id;
        return $this->new_values['_refs'][$field][(string) $id] ?? $id;
    }

    public static function fieldLabel(string $field): string
    {
        return Str::headline(preg_replace('/_id$/', '', $field));
    }

    public static function fmt($value): string
    {
        if ($value === null || $value === '') return 'empty';
        if (is_bool($value)) return $value ? 'Yes' : 'No';
        if (is_array($value)) return json_encode($value);
        // Product photos are stored inline as base64 — printing one is pages of noise (and exhausts dompdf's memory).
        if (is_string($value) && str_starts_with($value, 'data:')) return '[image]';
        if (is_string($value) && mb_strlen($value) > 300) return mb_substr($value, 0, 300) . '…';
        // Decimals only — a numeric SKU/barcode has no '.' and must stay as typed.
        if (is_numeric($value) && preg_match('/[.eE]/', (string) $value)) {
            return rtrim(rtrim(number_format((float) $value, 4, '.', ''), '0'), '.');
        }
        return (string) $value;
    }

    /** True when a "change" didn't change anything, e.g. "5" resubmitted over a stored 5.000. */
    public static function sameValue($a, $b): bool
    {
        if (is_numeric($a) && is_numeric($b)) return (float) $a === (float) $b;
        return $a === $b || (string) (is_scalar($a) ? $a : json_encode($a)) === (string) (is_scalar($b) ? $b : json_encode($b));
    }

    /**
     * Field-level changes of an "updated" entry with ids resolved to names —
     * shared by the description, the page and the PDF so all three agree.
     * @return array<int, array{field: string, old: mixed, new: mixed}>
     */
    public function changes(): array
    {
        if ($this->event !== 'updated') return [];
        $changes = [];
        foreach ($this->old_values ?? [] as $field => $oldVal) {
            if (in_array($field, self::SKIP_FIELDS)) continue;
            $newVal = $this->new_values[$field] ?? null;
            if (self::sameValue($oldVal, $newVal)) continue;
            $changes[] = ['field' => $field, 'old' => $this->refName($field, $oldVal), 'new' => $this->refName($field, $newVal)];
        }
        return $changes;
    }

    /** What the entry is about: "Stock Adjustment", "Product 'Coke 500ml'", "Sale SALE-66A1…". */
    public function getSubjectAttribute(): string
    {
        $model = $this->auditable_type ? Str::headline(class_basename($this->auditable_type)) : '';
        $name  = $this->val('name');
        $ref   = $this->val('reference');
        $id    = $this->auditable_id;
        return $name ? "{$model} '{$name}'" : ($ref ? "{$model} {$ref}" : ($id ? "{$model} #{$id}" : $model));
    }

    public function getDescriptionAttribute(): string
    {
        $class = $this->auditable_type ? class_basename($this->auditable_type) : '';
        $label = $this->subject;
        $items = $this->val('items');
        $items = is_array($items) ? $items : null;

        switch ($this->event) {
            case 'login':   return 'User logged in';
            case 'logout':  return 'User logged out';
            case 'created': return $this->describeCreated($class, $label, $items);
            case 'deleted':
                $stock = $this->val('stock_on_hand');
                return "{$label} deleted" . ($stock !== null ? ' (stock on hand: ' . self::fmt($stock) . ')' : '') . $this->summarizeItems($items);
            case 'updated':
                $changes = array_map(
                    fn ($c) => self::fieldLabel($c['field']) . ': ' . self::fmt($c['old']) . ' → ' . self::fmt($c['new']),
                    $this->changes(),
                );
                $detail = $changes
                    ? ': ' . implode(', ', array_slice($changes, 0, 5)) . (count($changes) > 5 ? ' (+' . (count($changes) - 5) . ' more)' : '')
                    : '';
                $stock = $this->val('stock_on_hand');
                return "{$label} updated{$detail}" . ($stock !== null ? ' · Stock on hand: ' . self::fmt($stock) : '') . $this->summarizeItems($items);
            default:
                return trim(ucfirst($this->event ?? '') . ' ' . $label);
        }
    }

    private function describeCreated(string $class, string $label, ?array $items): string
    {
        $ref   = fn (string $f) => $this->refName($f, $this->val($f));
        $money = fn (string $f) => number_format((float) $this->val($f), 2);
        $parts = [];

        switch ($class) {
            case 'StockAdjustment':
            case 'IngredientStockAdjustment':
                $type = self::ADJUSTMENT_TYPES[$this->val('type')] ?? 'Stock adjusted';
                if ($class === 'IngredientStockAdjustment') $type = 'Ingredient ' . lcfirst($type);
                $where  = $this->val('warehouse_id') ? ' at ' . $ref('warehouse_id') : '';
                $reason = $this->val('reason') ? ' · Reason: ' . $this->val('reason') : '';
                return $type . $where . $this->summarizeItems($items) . $reason;

            case 'StockTransfer':
                return "{$label} created from " . $ref('from_warehouse_id') . ' to ' . $ref('to_warehouse_id') . $this->summarizeItems($items);

            case 'Sale':
                if ($this->val('customer_id')) $parts[] = 'Customer: ' . $ref('customer_id');
                if ($this->val('status')) $parts[] = 'Status: ' . $this->val('status');
                if ($this->val('total') !== null) $parts[] = 'Total: ' . $money('total');
                break;

            case 'Refund':
                if ($this->val('sale_id')) $parts[] = 'Sale: ' . $ref('sale_id');
                if ($this->val('amount') !== null) $parts[] = 'Amount: ' . $money('amount');
                if ($this->val('reason')) $parts[] = 'Reason: ' . $this->val('reason');
                break;

            case 'PurchaseOrder':
                if ($this->val('supplier_id')) $parts[] = 'Supplier: ' . $ref('supplier_id');
                if ($this->val('total') !== null) $parts[] = 'Total: ' . $money('total');
                break;

            case 'Product':
                if ($this->val('sku')) $parts[] = 'SKU: ' . $this->val('sku');
                if ($this->val('selling_price') !== null) $parts[] = 'Price: ' . $money('selling_price');
                if ($this->val('cost_price') !== null) $parts[] = 'Cost: ' . $money('cost_price');
                if ($this->val('opening_stock') !== null) {
                    $parts[] = 'Opening stock: ' . self::fmt($this->val('opening_stock'))
                        . ($this->val('opening_stock_warehouse') ? ' at ' . $this->val('opening_stock_warehouse') : '');
                }
                break;

            case 'Expense':
            case 'CashflowEntry':
            case 'SupplierPayment':
                if ($this->val('amount') !== null) $parts[] = 'Amount: ' . $money('amount');
                break;
        }

        return "{$label} created" . ($parts ? ' (' . implode(', ', $parts) . ')' : '') . $this->summarizeItems($items);
    }

    /**
     * Turns an items[] detail array into a readable suffix, e.g.
     * " — Coke 500ml +10 (5 → 15), Bread -2 (8 → 6)" or " — 2 × Coke 500ml, 1 × Bread".
     */
    private function summarizeItems(?array $items): string
    {
        if (empty($items)) return '';
        $parts = [];
        foreach (array_slice($items, 0, 5) as $item) {
            $name = $item['product_name'] ?? $item['name'] ?? ('#' . ($item['product_id'] ?? '?'));
            $unit = !empty($item['unit']) ? ' ' . $item['unit'] : '';
            if (array_key_exists('quantity_adjusted', $item)) {
                $adj = (float) $item['quantity_adjusted'];
                $parts[] = $name . ' ' . ($adj > 0 ? '+' : '') . self::fmt($item['quantity_adjusted']) . $unit
                    . (isset($item['quantity_before'], $item['quantity_after'])
                        ? ' (' . self::fmt($item['quantity_before']) . ' → ' . self::fmt($item['quantity_after']) . ')' : '');
            } elseif (array_key_exists('counted', $item)) {
                $parts[] = "{$name} counted " . self::fmt($item['counted']) . ' (expected ' . self::fmt($item['expected'] ?? null)
                    . ', variance ' . self::fmt($item['variance'] ?? null) . ')';
            } elseif (array_key_exists('destination_after', $item)) {
                $parts[] = self::fmt($item['received_quantity'] ?? null) . " × {$name} received";
            } elseif (array_key_exists('quantity', $item)) {
                $parts[] = self::fmt($item['quantity']) . "{$unit} × {$name}";
            } else {
                $parts[] = $name;
            }
        }
        $suffix = ' — ' . implode(', ', $parts);
        if (count($items) > 5) $suffix .= ' +' . (count($items) - 5) . ' more';
        return $suffix;
    }
}
