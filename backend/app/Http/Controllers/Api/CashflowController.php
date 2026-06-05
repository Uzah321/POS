<?php

namespace App\Http\Controllers\Api;

use App\Models\CashflowEntry;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class CashflowController extends BaseApiController
{
    public function index(Request $request)
    {
        $query = CashflowEntry::with('user:id,name', 'branch:id,name')
            ->when($request->branch_id, fn($q) => $q->where('branch_id', $request->branch_id))
            ->when($request->category, fn($q) => $q->where('category', $request->category))
            ->when($request->flow_type, fn($q) => $q->where('flow_type', $request->flow_type))
            ->when($request->date_from, fn($q) => $q->whereDate('entry_date', '>=', $request->date_from))
            ->when($request->date_to, fn($q) => $q->whereDate('entry_date', '<=', $request->date_to))
            ->when($request->search, fn($q) => $q->where(function ($sq) use ($request) {
                $sq->where('reference', 'like', '%' . $request->search . '%')
                   ->orWhere('description', 'like', '%' . $request->search . '%');
            }))
            ->latest('entry_date')->latest('id');

        if ($request->export === 'csv') {
            return $this->exportCsv($query->get());
        }

        $allFiltered = (clone $query)->get();
        $summary = [
            'total_inflow'  => $allFiltered->where('flow_type', 'inflow')->sum('amount'),
            'total_outflow' => $allFiltered->where('flow_type', 'outflow')->sum('amount'),
            'net_cashflow'  => $allFiltered->where('flow_type', 'inflow')->sum('amount')
                             - $allFiltered->where('flow_type', 'outflow')->sum('amount'),
            'by_category'   => $allFiltered->groupBy('category')->map(fn($g) => [
                'inflow'  => $g->where('flow_type', 'inflow')->sum('amount'),
                'outflow' => $g->where('flow_type', 'outflow')->sum('amount'),
            ]),
        ];

        $entries = $query->paginate($request->per_page ?? 20);

        return $this->success(compact('entries', 'summary'));
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'branch_id'      => 'required|exists:branches,id',
            'flow_type'      => 'required|in:inflow,outflow',
            'category'       => 'required|string|max:100',
            'description'    => 'required|string|max:255',
            'amount'         => 'required|numeric|min:0.01',
            'currency'       => 'nullable|string|max:10',
            'entry_date'     => 'required|date',
            'payment_method' => 'nullable|string|max:50',
            'notes'          => 'nullable|string',
        ]);

        $entry = CashflowEntry::create([
            'reference'      => 'CF-' . strtoupper(Str::random(8)),
            'branch_id'      => $data['branch_id'],
            'user_id'        => auth()->id(),
            'flow_type'      => $data['flow_type'],
            'category'       => $data['category'],
            'description'    => $data['description'],
            'amount'         => $data['amount'],
            'currency'       => $data['currency'] ?? 'USD',
            'entry_date'     => $data['entry_date'],
            'payment_method' => $data['payment_method'] ?? 'cash',
            'notes'          => $data['notes'] ?? null,
        ]);

        return $this->success($entry->load('user:id,name', 'branch:id,name'), 'Entry recorded', 201);
    }

    public function update(Request $request, CashflowEntry $cashflowEntry)
    {
        $data = $request->validate([
            'flow_type'      => 'sometimes|in:inflow,outflow',
            'category'       => 'sometimes|string|max:100',
            'description'    => 'sometimes|string|max:255',
            'amount'         => 'sometimes|numeric|min:0.01',
            'currency'       => 'nullable|string|max:10',
            'entry_date'     => 'sometimes|date',
            'payment_method' => 'nullable|string|max:50',
            'notes'          => 'nullable|string',
        ]);

        $cashflowEntry->update($data);
        return $this->success($cashflowEntry->load('user:id,name', 'branch:id,name'), 'Entry updated');
    }

    public function destroy(CashflowEntry $cashflowEntry)
    {
        $cashflowEntry->delete();
        return $this->success(null, 'Entry deleted');
    }

    private function exportCsv($entries)
    {
        $headers = [
            'Content-Type'        => 'text/csv',
            'Content-Disposition' => 'attachment; filename="cashflow_entries.csv"',
            'Cache-Control'       => 'no-cache',
        ];

        $callback = function () use ($entries) {
            $f = fopen('php://output', 'w');
            fputcsv($f, [
                'Reference', 'Date', 'Flow Type', 'Category', 'Description',
                'Amount', 'Currency', 'Payment Method', 'Branch', 'Recorded By', 'Notes',
            ]);
            foreach ($entries as $e) {
                fputcsv($f, [
                    $e->reference,
                    $e->entry_date->format('Y-m-d'),
                    $e->flow_type,
                    $e->category,
                    $e->description,
                    $e->amount,
                    $e->currency,
                    $e->payment_method,
                    $e->branch?->name ?? '',
                    $e->user?->name ?? '',
                    $e->notes ?? '',
                ]);
            }
            fclose($f);
        };

        return response()->stream($callback, 200, $headers);
    }
}
