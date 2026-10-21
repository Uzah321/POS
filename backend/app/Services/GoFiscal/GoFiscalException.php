<?php

namespace App\Services\GoFiscal;

use RuntimeException;

/**
 * A GoFiscal call that didn't go through: the engine's own error code
 * (`error`, e.g. invalid_receipt, zimra_unavailable) and a message fit to
 * show people — its `errors` list, else its `detail`. status is 0 when the
 * engine couldn't be reached at all.
 */
class GoFiscalException extends RuntimeException
{
    /** @param list<string> $errors */
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly array $errors = [],
    ) {
        parent::__construct($message);
    }

    public static function fromResponse(int $status, array $body): self
    {
        $errors = array_values(array_filter(array_map(
            fn ($e) => is_string($e) ? $e : (string) ($e['message'] ?? $e['detail'] ?? json_encode($e)),
            (array) ($body['errors'] ?? []),
        )));
        $code = (string) ($body['error'] ?? "http_{$status}");
        $detail = trim((string) ($body['detail'] ?? $body['message'] ?? ''));

        return new self($status, $code, $errors ? implode(' ', $errors) : ($detail ?: "GoFiscal answered HTTP {$status} ({$code})."), $errors);
    }

    /** The device's fiscal day has to be closed before it takes another receipt. */
    public function dayNeedsClosing(): bool
    {
        return in_array($this->errorCode, ['fiscal_day_not_open', 'fiscal_day_expired'], true);
    }
}
