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
                // Search inside the captured values too, so typing a product
                // name finds every sale/adjustment/transfer that touched it.
                $text = $q->getConnection()->getDriverName() === 'mysql' ? 'CHAR' : 'TEXT';
                $q->where(fn($sq) => $sq
                    ->whereRaw('LOWER(event) LIKE ?', [$s])
                    ->orWhereRaw('LOWER(auditable_type) LIKE ?', [$s])
                    ->orWhereRaw("LOWER(CAST(new_values AS {$text})) LIKE ?", [$s])
                    ->orWhereRaw("LOWER(CAST(old_values AS {$text})) LIKE ?", [$s])
                    ->orWhereHas('user', fn($u) => $u->whereRaw('LOWER(name) LIKE ?', [$s]))
                );
            })
            ->when($request->user_id, fn($q) => $q->where('user_id', $request->user_id))
            ->when($request->event, fn($q) => $q->where('event', $request->event))
            ->when($request->model, fn($q) => $q->where('auditable_type', 'like', "%{$request->model}%"))
            // Dates are the viewer's calendar days, not UTC ones — otherwise
            // anything after 22:00 in Harare lands on the next day.
            ->when($request->date_from, fn($q) => $q->where('created_at', '>=', \Illuminate\Support\Carbon::parse($request->date_from, $this->tz($request))->startOfDay()->utc()))
            ->when($request->date_to, fn($q) => $q->where('created_at', '<=', \Illuminate\Support\Carbon::parse($request->date_to, $this->tz($request))->endOfDay()->utc()));
    }

    /** The browser's timezone (sent as ?tz=Africa/Harare); falls back to the app's. */
    private function tz(Request $request): string
    {
        $tz = (string) $request->query('tz', '');
        return in_array($tz, \DateTimeZone::listIdentifiers(), true) ? $tz : config('app.timezone');
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
        // Big exports of detailed entries outgrow PHP's default 128M in dompdf.
        @ini_set('memory_limit', '512M');
        @set_time_limit(120);
        $logs = $this->filtered($request)->latest()->limit(2000)->get();

        $filters = [
            'date_from' => $request->date_from,
            'date_to'   => $request->date_to,
            'user'      => $request->user_id ? optional(\App\Models\User::find($request->user_id))->name : null,
            'search'    => $request->search,
            'event'     => $request->event,
        ];

        $pdf = Pdf::loadView('reports.audit-log', ['logs' => $logs, 'filters' => $filters, 'tz' => $this->tz($request)])->setPaper('a4', 'landscape');
        return $pdf->download('audit-log-' . now()->format('Y-m-d-His') . '.pdf');
    }
}
