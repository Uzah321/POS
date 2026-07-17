<?php namespace App\Http\Controllers\Api;
use App\Models\Unit;
use Illuminate\Http\Request;

class UnitController extends BaseApiController
{
    public function index(): \Illuminate\Http\JsonResponse { return $this->success(Unit::orderBy('name')->get()); }
    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate(['name'=>'required|string|unique:units', 'abbreviation'=>'required|string|max:20|unique:units']);
        return $this->success(Unit::create($data), 'Unit created', 201);
    }
    public function show(Unit $unit): \Illuminate\Http\JsonResponse { return $this->success($unit); }
    public function update(Request $request, Unit $unit): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name' => 'sometimes|string|unique:units,name,' . $unit->id,
            'abbreviation' => 'sometimes|string|max:20|unique:units,abbreviation,' . $unit->id,
        ]);
        $unit->update($data);
        return $this->success($unit, 'Unit updated');
    }
    public function destroy(Unit $unit): \Illuminate\Http\JsonResponse { $unit->delete(); return $this->success(null, 'Unit deleted'); }
}
