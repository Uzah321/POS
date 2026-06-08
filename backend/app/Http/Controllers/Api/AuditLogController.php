<?php namespace App\Http\Controllers\Api;
use App\Models\AuditLog;
use Illuminate\Http\Request;

class AuditLogController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $query = AuditLog::with('user:id,name')
            ->when($request->search, function ($q) use ($request) {
                $s = '%' . mb_strtolower($request->search) . '%';
                $q->where(fn($sq) => $sq
                    ->whereRaw('LOWER(event) LIKE ?', [$s])
                    ->orWhereRaw('LOWER(auditable_type) LIKE ?', [$s])
                    ->orWhereHas('user', fn($u) => $u->whereRaw('LOWER(name) LIKE ?', [$s]))
                );
            })
            ->when($request->user_id, fn($q) => $q->where('user_id', $request->user_id))
            ->when($request->event, fn($q) => $q->where('event', $request->event))
            ->when($request->model, fn($q) => $q->where('auditable_type', 'like', "%{$request->model}%"))
            ->when($request->date_from, fn($q) => $q->whereDate('created_at', '>=', $request->date_from))
            ->when($request->date_to, fn($q) => $q->whereDate('created_at', '<=', $request->date_to));
        return $this->paginated($query->latest()->paginate(50));
    }
}
