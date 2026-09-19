<?php

use Illuminate\Support\Facades\Route;

// Downloadable desktop shortcut (.url) that cashiers can save to their
// Desktop to open this Core POS site directly in their browser.
Route::get('/download/core-shortcut.url', function () {
    $content = "[InternetShortcut]\r\nURL=" . url('/') . "\r\n";
    return response($content)
        ->header('Content-Type', 'application/internet-shortcut')
        ->header('Content-Disposition', 'attachment; filename="Core POS.url"');
});

// Serve the React SPA for all non-API routes, including /.
Route::get('{any}', function () {
    $spa = public_path('index.html');
    if (file_exists($spa)) {
        return response()->file($spa);
    }
    return view('welcome');
})->where('any', '^(?!api\/).*$');
