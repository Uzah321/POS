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
        $model = $this->auditable_type ? class_basename($this->auditable_type) : null;
        $id    = $this->auditable_id ? " #{$this->auditable_id}" : '';
        return match ($this->event) {
            'login'  => 'User logged in',
            'logout' => 'User logged out',
            default  => trim(ucfirst($this->event ?? '') . ($model ? " {$model}" : '') . $id),
        };
    }
}
