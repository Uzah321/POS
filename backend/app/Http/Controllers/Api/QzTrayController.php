<?php

namespace App\Http\Controllers\Api;

use App\Support\QzTraySigning;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * QZ Tray on a till: the certificate it's shown, the one a till installs so
 * it trusts this site, and signatures for each request (see QzTraySigning).
 * Signed in only — a signature makes QZ Tray act without asking, so a page
 * on another site mustn't be able to get one.
 */
class QzTrayController extends BaseApiController
{
    public function certificate(): Response
    {
        return response(QzTraySigning::siteCertificate(), 200, ['Content-Type' => 'text/plain']);
    }

    public function trustCertificate(): Response
    {
        return response(QzTraySigning::trustCertificate(), 200, [
            'Content-Type' => 'application/x-x509-ca-cert',
            'Content-Disposition' => 'attachment; filename="override.crt"',
        ]);
    }

    public function sign(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate(['request' => 'required|string|max:1024']);
        return $this->success(['signature' => QzTraySigning::sign($data['request'])]);
    }
}
