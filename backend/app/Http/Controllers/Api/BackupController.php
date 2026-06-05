<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Storage;

class BackupController extends Controller {
    public function index() {
        $files = Storage::disk('local')->files('backups');
        $result = [];
        foreach($files as $f) {
            $result[] = ['name'=>basename($f),'size'=>Storage::disk('local')->size($f),'created_at'=>date('Y-m-d H:i:s',Storage::disk('local')->lastModified($f))];
        }
        return response()->json(array_reverse($result));
    }
    public function create() {
        $dbPath = database_path('bottlestore.sqlite');
        $name = 'backup_'.date('Ymd_His').'.sqlite';
        Storage::disk('local')->makeDirectory('backups');
        Storage::disk('local')->put('backups/'.$name, file_get_contents($dbPath));
        return response()->json(['message'=>'Backup created','file'=>$name], 201);
    }
    public function download(string $file) {
        $path = storage_path('app/backups/'.$file);
        if (!file_exists($path)) return response()->json(['message'=>'File not found'],404);
        return response()->download($path);
    }
}
