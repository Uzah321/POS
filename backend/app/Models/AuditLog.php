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

    public function getDescriptionAttribute(): string
    {
        $model   = $this->auditable_type ? class_basename($this->auditable_type) : '';
        $id      = $this->auditable_id ?? '';
        $name    = ($this->new_values['name'] ?? null) ?? ($this->old_values['name'] ?? null);
        $subject = $name ? "'{$name}'" : ($id ? "{$model} #{$id}" : $model);

        switch ($this->event) {
            case 'login':   return 'User logged in';
            case 'logout':  return 'User logged out';
            case 'created': return ucfirst($model) . " {$subject} created";
            case 'deleted': return ucfirst($model) . " {$subject} deleted";
            case 'updated':
                $skip    = ['updated_at', 'created_at', 'slug', 'password', 'remember_token'];
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
                    return ucfirst($model) . " {$subject} updated: {$detail}";
                }
                return ucfirst($model) . " {$subject} updated";
            default:
                return trim(ucfirst($this->event ?? '') . ($model ? " {$model}" : '') . ($id ? " #{$id}" : ''));
        }
    }
}
