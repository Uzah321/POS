<?php

namespace Tests\Feature;

use Tests\TestCase;

class AndroidAppDownloadTest extends TestCase
{
    public function test_the_android_app_downloads_without_signing_in(): void
    {
        $response = $this->get('/api/download/core-pos.apk');

        $response->assertOk();
        $response->assertHeader('Content-Type', 'application/vnd.android.package-archive');
        $this->assertStringContainsString('Core POS.apk', (string) $response->headers->get('Content-Disposition'));
        $this->assertSame(filesize(resource_path('downloads/core-pos.apk')), (int) $response->headers->get('Content-Length'));
    }
}
