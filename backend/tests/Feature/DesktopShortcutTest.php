<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * "Add Core to this device" downloads a desktop shortcut to this site — one
 * per kind of computer — without signing in (it's offered on the sign-in page).
 */
class DesktopShortcutTest extends TestCase
{
    public function test_windows_gets_an_internet_shortcut(): void
    {
        $this->get('/api/download/core-shortcut.url')
            ->assertOk()
            ->assertHeader('Content-Disposition', 'attachment; filename="Core POS.url"')
            ->assertSee("[InternetShortcut]\r\nURL=" . url('/'), false);
    }

    public function test_mac_gets_a_webloc(): void
    {
        $response = $this->get('/api/download/core-shortcut.webloc')
            ->assertOk()
            ->assertHeader('Content-Disposition', 'attachment; filename="Core POS.webloc"');

        $plist = simplexml_load_string($response->getContent());
        $this->assertSame('URL', (string) $plist->dict->key);
        $this->assertSame(url('/'), (string) $plist->dict->string);
    }

    public function test_linux_gets_a_desktop_link(): void
    {
        $this->get('/api/download/core-shortcut.desktop')
            ->assertOk()
            ->assertHeader('Content-Disposition', 'attachment; filename="Core POS.desktop"')
            ->assertSee("[Desktop Entry]\nVersion=1.0\nType=Link\nName=Core POS\nURL=" . url('/'), false);
    }

    public function test_other_file_types_are_not_offered(): void
    {
        $this->get('/api/download/core-shortcut.exe')->assertNotFound();
    }
}
