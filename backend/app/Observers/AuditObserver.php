<?php

namespace App\Observers;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Request;

class AuditObserver
{
    private function log(string $event, Model $model, array $old = [], array $new = []): void
    {
        try {
            AuditLog::create([
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
        }
    }

    public function created(Model $model): void
    {
        $this->log('created', $model, [], $model->toArray());
    }

    public function updated(Model $model): void
    {
        $dirty = $model->getDirty();
        unset($dirty['updated_at']);
        if (empty($dirty)) return;
        $old = array_intersect_key($model->getOriginal(), $dirty);
        $this->log('updated', $model, $old, $dirty);
    }

    public function deleted(Model $model): void
    {
        $this->log('deleted', $model, $model->toArray());
    }
}
