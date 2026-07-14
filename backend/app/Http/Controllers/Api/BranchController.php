<?php namespace App\Http\Controllers\Api;
use App\Models\Branch;
use App\Models\Warehouse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class BranchController extends BaseApiController
{
    public function index(): \Illuminate\Http\JsonResponse
    {
        return $this->success(Branch::orderBy('name')->get());
    }
    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate(['name'=>'required|string','address'=>'nullable|string','city'=>'nullable|string','phone'=>'nullable|string','email'=>'nullable|email','currency'=>'nullable|string|size:3']);
        $data['code'] = strtoupper(Str::random(6));

        $branch = DB::transaction(function () use ($data) {
            $branch = Branch::create($data);

            // Every branch needs its own warehouse to hold stock — without one,
            // it can never receive a stock transfer, a goods receipt, or a sale.
            Warehouse::create([
                'name'       => $branch->name . ' Warehouse',
                'code'       => 'WH-' . strtoupper(Str::random(6)),
                'branch_id'  => $branch->id,
                'is_active'  => true,
                'is_default' => true,
            ]);

            return $branch;
        });

        return $this->success($branch, 'Branch created', 201);
    }
    public function show(Branch $branch): \Illuminate\Http\JsonResponse { return $this->success($branch); }
    public function update(Request $request, Branch $branch): \Illuminate\Http\JsonResponse
    {
        $branch->update($request->only('name','address','city','phone','email','currency','is_active'));
        return $this->success($branch, 'Branch updated');
    }
    public function destroy(Branch $branch): \Illuminate\Http\JsonResponse { $branch->delete(); return $this->success(null,'Branch deleted'); }
}
