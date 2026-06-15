<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

// Catch-all: serve the React SPA for any non-API route.
// When running locally (php artisan serve), copy frontend/dist/* to backend/public/
// then every URL like /pos, /cashier, /login etc. will load the React app.
Route::get('{any}', function () {
    $spa = public_path('index.html');
    if (file_exists($spa)) {
        return response()->file($spa);
    }
    return view('welcome');
})->where('any', '^(?!api\/).*$');
