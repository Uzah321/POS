<?php

return [
    // Enforcement is off unless an install opts in, so dev, tests and the
    // license-server host itself are never locked out by accident.
    'enforce' => env('LICENSE_ENFORCE', false),

    // Where clients check in, and the public key that verifies its answers.
    'server_url' => rtrim(env('LICENSE_SERVER_URL', 'https://mycorre.com'), '/'),
    'public_key_path' => env('LICENSE_PUBLIC_KEY_PATH', config_path('license_public.pem')),

    // Set on the vendor's server only: lets it issue licenses and answer check-ins.
    'server_enabled' => env('LICENSE_SERVER', false),
    'private_key_path' => env('LICENSE_PRIVATE_KEY_PATH', storage_path('app/license/private.pem')),

    'warn_days' => 7,
    // How often a client re-checks with the server while online.
    'refresh_hours' => 6,
];
