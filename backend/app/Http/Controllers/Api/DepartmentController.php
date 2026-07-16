<?php namespace App\Http\Controllers\Api;
use App\Models\Department;
use Illuminate\Http\Request;

class DepartmentController extends BaseApiController
{
    public function index(): \Illuminate\Http\JsonResponse { return $this->success(Department::orderBy('name')->get()); }
    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate(['name'=>'required|string|unique:departments']);
        return $this->success(Department::create($data),'Department created',201);
    }
    public function show(Department $department): \Illuminate\Http\JsonResponse { return $this->success($department); }
    public function update(Request $request, Department $department): \Illuminate\Http\JsonResponse { $department->update($request->only('name','is_active')); return $this->success($department,'Department updated'); }
    public function destroy(Department $department): \Illuminate\Http\JsonResponse { $department->delete(); return $this->success(null,'Department deleted'); }
}
