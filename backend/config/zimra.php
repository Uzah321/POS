<?php

return [
    // ZIMRA Fiscal Device Gateway API environment base URLs (§7.2).
    'urls' => [
        'test' => env('ZIMRA_TEST_URL', 'https://fdmsapitest.zimra.co.zw'),
        'live' => env('ZIMRA_LIVE_URL', 'https://fdmsapi.zimra.co.zw'),
    ],

    // Sent as DeviceModelName/DeviceModelVersionNo headers on every request (§4),
    // as registered with ZIMRA for this POS software.
    'device_model_name'    => env('ZIMRA_DEVICE_MODEL_NAME', 'Core POS'),
    'device_model_version' => env('ZIMRA_DEVICE_MODEL_VERSION', '1.0'),

    // Fiscal Device Gateway API response timeout for any synchronous operation
    // is specified as 30 seconds (§7.4).
    'timeout' => env('ZIMRA_TIMEOUT', 30),
];
