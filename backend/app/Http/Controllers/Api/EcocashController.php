<?php

namespace App\Http\Controllers\Api;

use App\Models\EcocashTransaction;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class EcocashController extends BaseApiController
{
    public function index(Request $request)
    {
        $query = EcocashTransaction::with('user:id,name', 'branch:id,name')
            ->when($request->branch_id, fn($q) => $q->where('branch_id', $request->branch_id))
            ->when($request->type, fn($q) => $q->where('type', $request->type))
            ->when($request->status, fn($q) => $q->where('status', $request->status))
            ->when($request->date_from, fn($q) => $q->whereDate('transaction_date', '>=', $request->date_from))
            ->when($request->date_to, fn($q) => $q->whereDate('transaction_date', '<=', $request->date_to))
            ->when($request->search, fn($q) => $q->where(function ($sq) use ($request) {
                $sq->where('reference', 'like', '%' . $request->search . '%')
                   ->orWhere('customer_phone', 'like', '%' . $request->search . '%')
                   ->orWhere('ecocash_reference', 'like', '%' . $request->search . '%');
            }))
            ->latest('transaction_date')->latest('id');

        if ($request->export === 'csv') {
            return $this->exportCsv($query->get());
        }

        return $this->success($query->paginate($request->per_page ?? 20));
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'branch_id'         => 'required|exists:branches,id',
            'type'              => 'required|in:deposit,withdrawal,float_top_up,float_withdrawal,commission',
            'ecocash_reference' => 'nullable|string|max:100',
            'customer_phone'    => 'nullable|string|max:20',
            'amount'            => 'required|numeric|min:0.01',
            'commission_rate'   => 'nullable|numeric|min:0|max:100',
            'commission_amount' => 'nullable|numeric|min:0',
            'transaction_date'  => 'required|date',
            'notes'             => 'nullable|string',
        ]);

        // Get last float for this branch to maintain running balance
        $lastTx = EcocashTransaction::where('branch_id', $data['branch_id'])
            ->where('status', 'completed')
            ->orderByDesc('transaction_date')
            ->orderByDesc('id')
            ->first();

        $floatBefore = $lastTx ? $lastTx->float_after : 0;

        $floatChange = match ($data['type']) {
            'deposit'          => -$data['amount'],  // gave out EcoCash, float decreases
            'withdrawal'       => $data['amount'],   // received EcoCash, float increases
            'float_top_up'     => $data['amount'],
            'float_withdrawal' => -$data['amount'],
            'commission'       => $data['amount'],
        };

        $commissionRate = $data['commission_rate'] ?? 0;
        if (isset($data['commission_amount']) && $data['commission_amount'] > 0 && in_array($data['type'], ['deposit', 'withdrawal'])) {
            $commissionAmount = (float) $data['commission_amount'];
            $commissionRate = $data['amount'] > 0 ? round(($commissionAmount / $data['amount']) * 100, 2) : 0;
        } else {
            $commissionAmount = in_array($data['type'], ['deposit', 'withdrawal'])
                ? round($data['amount'] * ($commissionRate / 100), 2)
                : 0;
        }

        $tx = EcocashTransaction::create([
            'reference'         => 'ECO-' . strtoupper(Str::random(8)),
            'branch_id'         => $data['branch_id'],
            'user_id'           => auth()->id(),
            'type'              => $data['type'],
            'ecocash_reference' => $data['ecocash_reference'] ?? null,
            'customer_phone'    => $data['customer_phone'] ?? null,
            'amount'            => $data['amount'],
            'commission_rate'   => $commissionRate,
            'commission_amount' => $commissionAmount,
            'float_before'      => $floatBefore,
            'float_after'       => $floatBefore + $floatChange,
            'transaction_date'  => $data['transaction_date'],
            'notes'             => $data['notes'] ?? null,
            'status'            => 'completed',
        ]);

        return $this->success($tx->load('user:id,name', 'branch:id,name'), 'Transaction recorded', 201);
    }

    public function reverse(Request $request, EcocashTransaction $ecocashTransaction)
    {
        if ($ecocashTransaction->status === 'reversed') {
            return $this->error('Transaction already reversed', 422);
        }

        $ecocashTransaction->update(['status' => 'reversed']);
        return $this->success($ecocashTransaction, 'Transaction reversed');
    }

    public function summary(Request $request)
    {
        $date     = $request->date ?? now()->toDateString();
        $branchId = $request->branch_id;

        $txs = EcocashTransaction::where('status', 'completed')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereDate('transaction_date', $date)
            ->get();

        $closingFloat = EcocashTransaction::where('status', 'completed')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereDate('transaction_date', '<=', $date)
            ->orderByDesc('transaction_date')
            ->orderByDesc('id')
            ->value('float_after') ?? 0;

        return $this->success([
            'date'              => $date,
            'total_deposits'    => $txs->where('type', 'deposit')->sum('amount'),
            'total_withdrawals' => $txs->where('type', 'withdrawal')->sum('amount'),
            'total_commission'  => $txs->sum('commission_amount'),
            'transaction_count' => $txs->count(),
            'closing_float'     => $closingFloat,
            'by_type'           => $txs->groupBy('type')->map(fn($g) => [
                'count'  => $g->count(),
                'amount' => $g->sum('amount'),
            ]),
            'transactions'      => $txs->sortByDesc('id')->values(),
        ]);
    }

    private function exportCsv($transactions)
    {
        $headers = [
            'Content-Type'        => 'text/csv',
            'Content-Disposition' => 'attachment; filename="ecocash_transactions.csv"',
            'Cache-Control'       => 'no-cache',
        ];

        $callback = function () use ($transactions) {
            $f = fopen('php://output', 'w');
            fputcsv($f, [
                'Reference', 'Date', 'Type', 'Customer Phone', 'EcoCash Reference',
                'Amount', 'Commission Rate %', 'Commission Amount',
                'Float Before', 'Float After', 'Status', 'Notes',
            ]);
            foreach ($transactions as $tx) {
                fputcsv($f, [
                    $tx->reference,
                    $tx->transaction_date->format('Y-m-d'),
                    $tx->type,
                    $tx->customer_phone ?? '',
                    $tx->ecocash_reference ?? '',
                    $tx->amount,
                    $tx->commission_rate,
                    $tx->commission_amount,
                    $tx->float_before,
                    $tx->float_after,
                    $tx->status,
                    $tx->notes ?? '',
                ]);
            }
            fclose($f);
        };

        return response()->stream($callback, 200, $headers);
    }
}
