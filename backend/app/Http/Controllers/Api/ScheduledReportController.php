<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Models\ScheduledReport;
use Illuminate\Http\Request;

class ScheduledReportController extends Controller {
    public function index() { return response()->json(ScheduledReport::all()); }
    public function store(Request $request) {
        $data = $request->validate(['type'=>'required|string','frequency'=>'required|in:daily,weekly,monthly','email'=>'required|email','active'=>'boolean']);
        return response()->json(ScheduledReport::create($data), 201);
    }
    public function show(ScheduledReport $scheduledReport) { return response()->json($scheduledReport); }
    public function update(Request $request, ScheduledReport $scheduledReport) {
        $scheduledReport->update($request->only(['type','frequency','email','active']));
        return response()->json($scheduledReport);
    }
    public function destroy(ScheduledReport $scheduledReport) { $scheduledReport->delete(); return response()->json(null,204); }
}
