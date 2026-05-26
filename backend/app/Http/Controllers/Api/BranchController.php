<?php namespace App\Http\Controllers\Api;
use App\Models\Branch;
use Illuminate\Http\Request;
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
        return $this->success(Branch::create($data), 'Branch created', 201);
    }
    public function show(Branch $branch): \Illuminate\Http\JsonResponse { return $this->success($branch); }
    public function update(Request $request, Branch $branch): \Illuminate\Http\JsonResponse
    {
        $branch->update($request->only('name','address','city','phone','email','currency','is_active'));
        return $this->success($branch, 'Branch updated');
    }
    public function destroy(Branch $branch): \Illuminate\Http\JsonResponse { $branch->delete(); return $this->success(null,'Branch deleted'); }
}
