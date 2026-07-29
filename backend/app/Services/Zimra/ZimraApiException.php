<?php

namespace App\Services\Zimra;

/**
 * Thrown for any non-2xx response from the Fiscal Device Gateway API.
 * Carries the parsed ProblemDetails (§8) so callers can branch on ZIMRA's
 * own errorCode (e.g. "DEV01") rather than just the HTTP status.
 */
class ZimraApiException extends \RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $httpStatus,
        public readonly ?string $errorCode = null,
        public readonly array $responseBody = [],
    ) {
        parent::__construct($message);
    }

    public static function fromResponse(\Illuminate\Http\Client\Response $response): self
    {
        $body = $response->json() ?? [];
        $errorCode = $body['errorCode'] ?? null;
        $title = $body['title'] ?? $response->body();

        return new self(
            "ZIMRA API error ({$response->status()}".($errorCode ? " {$errorCode}" : '')."): {$title}",
            $response->status(),
            $errorCode,
            $body,
        );
    }
}
