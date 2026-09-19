<?php

use Illuminate\Support\Facades\Route;

// Serve the React SPA for all non-API routes, including /.
Route::get('{any}', function () {
    $spa = public_path('index.html');
    if (file_exists($spa)) {
        return response()->file($spa);
    }
    return view('welcome');
})->where('any', '^(?!api\/).*$');
