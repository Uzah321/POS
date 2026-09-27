<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: DejaVu Sans, sans-serif; font-size: 10px; color: #1f2937; margin: 0; padding: 18px; }
  h1 { font-size: 18px; color: #1e40af; margin: 0 0 4px; }
  .subtitle { color: #6b7280; font-size: 10px; margin-bottom: 4px; }
  .filters { color: #6b7280; font-size: 9px; margin-bottom: 16px; }
  .filters span { display: inline-block; background: #f1f5f9; border-radius: 4px; padding: 2px 6px; margin-right: 6px; }
  .entry { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; page-break-inside: avoid; }
  .entry-head { width: 100%; margin-bottom: 4px; }
  .entry-head td { padding: 0; vertical-align: top; }
  .time { color: #6b7280; font-size: 9px; white-space: nowrap; }
  .user { font-weight: bold; color: #1f2937; }
  .badge { display: inline-block; border-radius: 10px; padding: 1px 8px; font-size: 8px; font-weight: bold; text-transform: uppercase; color: #fff; }
  .badge-created { background: #059669; }
  .badge-updated { background: #2563eb; }
  .badge-deleted { background: #dc2626; }
  .badge-login,.badge-logout { background: #7c3aed; }
  .description { margin-top: 4px; color: #374151; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.items th { background: #f1f5f9; color: #374151; text-align: left; padding: 3px 6px; font-size: 8.5px; border-bottom: 1px solid #e5e7eb; }
  table.items td { padding: 3px 6px; font-size: 8.5px; border-bottom: 1px solid #f1f5f9; }
  .pos { color: #059669; font-weight: bold; }
  .neg { color: #dc2626; font-weight: bold; }
  .footer { text-align: center; color: #9ca3af; font-size: 8px; margin-top: 20px; border-top: 1px solid #e5e7eb; padding-top: 8px; }
</style>
</head>
<body>
<h1>Audit Log Report</h1>
<p class="subtitle">Generated on {{ now()->setTimezone($tz ?? config('app.timezone'))->format('d M Y, H:i') }} &middot; {{ $logs->count() }} {{ $logs->count() === 1 ? 'entry' : 'entries' }}</p>

@if(array_filter($filters))
<p class="filters">
  @if($filters['date_from']) <span>From: {{ $filters['date_from'] }}</span> @endif
  @if($filters['date_to']) <span>To: {{ $filters['date_to'] }}</span> @endif
  @if($filters['user']) <span>User: {{ $filters['user'] }}</span> @endif
  @if($filters['search']) <span>Search: "{{ $filters['search'] }}"</span> @endif
  @if(!empty($filters['event'])) <span>Action: {{ ucfirst($filters['event']) }}</span> @endif
</p>
@endif

@php
  $itemColumns = [
    'quantity' => 'Qty', 'quantity_before' => 'Before', 'quantity_adjusted' => 'Change', 'quantity_after' => 'After',
    'expected' => 'Expected', 'counted' => 'Counted', 'variance' => 'Variance',
    'received_quantity' => 'Received', 'destination_before' => 'Dest. Before', 'destination_after' => 'Dest. After',
    'unit' => 'Unit', 'unit_price' => 'Unit Price', 'cost_price' => 'Cost', 'discount' => 'Discount', 'total' => 'Total',
    'restocked' => 'Restocked', 'batch' => 'Batch',
  ];
  $signed = ['quantity_adjusted', 'variance'];
@endphp
@forelse($logs as $log)
@php
  $items = $log->new_values['items'] ?? $log->old_values['items'] ?? null;
  $items = is_array($items) ? $items : null;
  $skip  = \App\Models\AuditLog::SKIP_FIELDS;
  $changes = $log->changes();
  $fields = [];
  if (in_array($log->event, ['created', 'deleted'])) {
    foreach (array_merge($log->old_values ?? [], $log->new_values ?? []) as $field => $v) {
      if (in_array($field, $skip) || $v === null || $v === '' || is_array($v)) continue;
      $fields[] = ['field' => $field, 'value' => $log->refName($field, $v)];
    }
  }
  $cols = $items ? array_filter($itemColumns, fn ($label, $key) => collect($items)->contains(fn ($i) => isset($i[$key])), ARRAY_FILTER_USE_BOTH) : [];
@endphp
<div class="entry">
  <table class="entry-head">
    <tr>
      <td style="width: 130px;" class="time">{{ $log->created_at->copy()->setTimezone($tz ?? config('app.timezone'))->format('d M Y H:i:s') }}</td>
      <td style="width: 140px;" class="user">{{ $log->user->name ?? 'System' }}</td>
      <td style="width: 80px;"><span class="badge badge-{{ $log->event }}">{{ $log->event }}</span></td>
      <td>{{ $log->subject }}</td>
    </tr>
  </table>
  <div class="description">{{ $log->description }}</div>

  @if(!empty($items))
    <table class="items">
      <thead>
        <tr>
          <th>Product</th><th>SKU</th>
          @foreach($cols as $label) <th>{{ $label }}</th> @endforeach
        </tr>
      </thead>
      <tbody>
        @foreach($items as $it)
        <tr>
          <td>{{ $it['product_name'] ?? $it['name'] ?? '-' }}</td>
          <td>{{ $it['product_sku'] ?? '-' }}</td>
          @foreach($cols as $key => $label)
            @php $v = $it[$key] ?? null; @endphp
            @if(in_array($key, $signed) && $v !== null)
              <td class="{{ $v < 0 ? 'neg' : 'pos' }}">{{ $v > 0 ? '+' : '' }}{{ \App\Models\AuditLog::fmt($v) }}</td>
            @else
              <td>{{ $v === null ? '-' : \App\Models\AuditLog::fmt($v) }}</td>
            @endif
          @endforeach
        </tr>
        @endforeach
      </tbody>
    </table>
  @endif
  @if(!empty($changes))
    <table class="items">
      <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
      <tbody>
        @foreach($changes as $c)
        <tr>
          <td>{{ \App\Models\AuditLog::fieldLabel($c['field']) }}</td>
          <td>{{ \App\Models\AuditLog::fmt($c['old']) }}</td>
          <td>{{ \App\Models\AuditLog::fmt($c['new']) }}</td>
        </tr>
        @endforeach
        @if(isset($log->new_values['stock_on_hand']))
        <tr>
          <td><strong>Stock on hand</strong></td>
          <td colspan="2"><strong>{{ \App\Models\AuditLog::fmt($log->new_values['stock_on_hand']) }}</strong></td>
        </tr>
        @endif
      </tbody>
    </table>
  @endif
  @if(!empty($fields))
    <table class="items">
      <thead><tr><th style="width: 160px;">Field</th><th>Value</th></tr></thead>
      <tbody>
        @foreach($fields as $f)
        <tr>
          <td>{{ \App\Models\AuditLog::fieldLabel($f['field']) }}</td>
          <td>{{ \App\Models\AuditLog::fmt($f['value']) }}</td>
        </tr>
        @endforeach
      </tbody>
    </table>
  @endif
</div>
@empty
<p>No audit log entries match the selected filters.</p>
@endforelse

<div class="footer">Core POS &middot; Audit Log Report &middot; {{ now()->format('d M Y H:i') }}</div>
</body>
</html>
