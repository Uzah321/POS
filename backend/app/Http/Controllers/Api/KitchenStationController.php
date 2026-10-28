<?php namespace App\Http\Controllers\Api;
use App\Models\KitchenStation;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Kitchen stations — Grill, Bar, Pizza, Main Kitchen — that products send
 * their order tickets to (products.kitchen_station_id). Every till reads the
 * list to route tickets; changing it is a manager's job, like the rest of
 * Hardware setup.
 */
class KitchenStationController extends BaseApiController
{
    public function index(): \Illuminate\Http\JsonResponse
    {
        return $this->success(KitchenStation::withCount('products')->orderBy('name')->get());
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $station = $this->save(new KitchenStation, $this->validated($request));
        return $this->success($station, 'Station created', 201);
    }

    public function update(Request $request, KitchenStation $kitchenStation): \Illuminate\Http\JsonResponse
    {
        $station = $this->save($kitchenStation, $this->validated($request, $kitchenStation));
        return $this->success($station, 'Station updated');
    }

    public function destroy(KitchenStation $kitchenStation): \Illuminate\Http\JsonResponse
    {
        // Its products' kitchen_station_id goes null (nullOnDelete): they print at the default station.
        $kitchenStation->delete();
        return $this->success(null, 'Station deleted');
    }

    /** Only one station is the default: making this one it takes it from the other. */
    private function save(KitchenStation $station, array $data): KitchenStation
    {
        DB::transaction(function () use ($station, $data) {
            $station->fill($data)->save();
            if ($station->is_default) {
                KitchenStation::where('is_default', true)->whereKeyNot($station->id)->update(['is_default' => false]);
            }
        });
        return $station->loadCount('products');
    }

    private function validated(Request $request, ?KitchenStation $station = null): array
    {
        return $request->validate([
            'name'       => [$station ? 'sometimes' : 'required', 'string', 'max:100', Rule::unique('kitchen_stations')->ignore($station?->id)],
            'is_default' => 'boolean',
        ]);
    }
}
