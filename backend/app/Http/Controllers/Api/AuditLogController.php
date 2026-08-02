<?php namespace App\Http\Controllers\Api;
use App\Models\AuditLog;
use Illuminate\Http\Request;
use Barryvdh\DomPDF\Facade\Pdf;

class AuditLogController extends BaseApiController
{
    /** Shared by index() and exportPdf() so the on-screen list and the downloaded PDF always match. */
    private function filtered(Request $request)
    {
        return AuditLog::with('user:id,name')
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
    }

    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        return $this->paginated($this->filtered($request)->latest()->paginate(50));
    }

    /** GET /audit-logs/users — distinct users who have at least one audit log entry, for the filter dropdown. */
    public function filterUsers(): \Illuminate\Http\JsonResponse
    {
        $users = \App\Models\User::query()
            ->whereHas('auditLogs')
            ->orderBy('name')
            ->get(['id', 'name']);
        return $this->success($users);
    }

    /** GET /audit-logs/pdf — same filters as index(), rendered as a downloadable report. Capped so a huge unfiltered export doesn't hang the request. */
    public function exportPdf(Request $request)
    {
        $logs = $this->filtered($request)->latest()->limit(2000)->get();

        $filters = [
            'date_from' => $request->date_from,
            'date_to'   => $request->date_to,
            'user'      => $request->user_id ? optional(\App\Models\User::find($request->user_id))->name : null,
            'search'    => $request->search,
        ];

        $pdf = Pdf::loadView('reports.audit-log', ['logs' => $logs, 'filters' => $filters])->setPaper('a4', 'landscape');
        return $pdf->download('audit-log-' . now()->format('Y-m-d-His') . '.pdf');
    }
}
