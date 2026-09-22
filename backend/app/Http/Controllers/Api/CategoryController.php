<?php namespace App\Http\Controllers\Api;
use App\Models\Category;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class CategoryController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $branchId = $this->effectiveBranchId($request);
        $businessType = $this->effectiveBusinessType($request);
        $categories = Category::with('parent', 'children')
            ->withCount('products')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->when($businessType, fn($q) => $q->whereIn('business_type', [$businessType, 'both']))
            ->orderBy('name')
            ->get();
        return $this->success($categories);
    }
    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name'          => 'required|string',
            'parent_id'     => 'nullable|exists:categories,id',
            'description'   => 'nullable|string',
            'color'         => 'nullable|string|max:9',
            'image'         => 'nullable|string|max:4000000',
            'business_type' => 'nullable|in:restaurant,supermarket,both',
        ]);
        $data['slug'] = Str::slug($data['name']) . '-' . uniqid();
        // A category created while a mode is active belongs to that mode by
        // default — this is what keeps a newly-added "Pizza" category out of
        // the supermarket catalog without the user having to remember to tag it.
        $data['business_type'] = $data['business_type'] ?? ($this->effectiveBusinessType($request) ?? 'both');
        // Every category belongs to exactly one branch's own catalog, same as
        // products — only an admin may plant one in a branch other than their own.
        $user = $request->user();
        $data['branch_id'] = ($user->hasRole('admin') && $request->filled('branch_id'))
            ? (int) $request->branch_id
            : $user->branch_id;
        return $this->success(Category::create($data), 'Category created', 201);
    }
    public function show(Category $category): \Illuminate\Http\JsonResponse { return $this->success($category->load('children')); }
    public function update(Request $request, Category $category): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name'          => 'sometimes|string',
            'parent_id'     => 'nullable|exists:categories,id',
            'description'   => 'nullable|string',
            'is_active'     => 'boolean',
            'sort_order'    => 'integer',
            'color'         => 'nullable|string|max:9',
            'image'         => 'nullable|string|max:4000000',
            'business_type' => 'sometimes|in:restaurant,supermarket,both',
        ]);
        $category->update($data);
        return $this->success($category, 'Category updated');
    }
    public function destroy(Category $category): \Illuminate\Http\JsonResponse { $category->delete(); return $this->success(null,'Category deleted'); }
}
