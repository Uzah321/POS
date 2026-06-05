<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use Spatie\Permission\Models\Role;
use Spatie\Permission\Models\Permission;
use Illuminate\Http\Request;

class RolePermissionController extends Controller {
    public function index() {
        $roles = Role::with('permissions')->get();
        $permissions = Permission::all();
        return response()->json(compact('roles','permissions'));
    }
    public function updateRole(Request $request, Role $role) {
        $data = $request->validate(['permissions'=>'required|array','permissions.*'=>'exists:permissions,name']);
        $role->syncPermissions($data['permissions']);
        return response()->json($role->load('permissions'));
    }
}
