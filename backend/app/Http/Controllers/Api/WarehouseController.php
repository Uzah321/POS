<?php namespace App\Http\Controllers\Api;
use App\Models\Warehouse;
use Illuminate\Http\Request;

class WarehouseController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        return $this->success(Warehouse::with('branch')->when($request->branch_id, fn($q)=>$q->where('branch_id',$request->branch_id))->get());
    }
    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate(['name'=>'required|string','code'=>'required|string|unique:warehouses','branch_id'=>'required|exists:branches,id','address'=>'nullable|string','is_default'=>'boolean']);
        return $this->success(Warehouse::create($data),'Warehouse created',201);
    }
    public function show(Warehouse $warehouse): \Illuminate\Http\JsonResponse { return $this->success($warehouse->load('branch')); }
    public function update(Request $request, Warehouse $warehouse): \Illuminate\Http\JsonResponse { $warehouse->update($request->only('name','address','is_active','is_default')); return $this->success($warehouse,'Warehouse updated'); }
    public function destroy(Warehouse $warehouse): \Illuminate\Http\JsonResponse { $warehouse->delete(); return $this->success(null,'Warehouse deleted'); }
}
