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
<p class="subtitle">Generated on {{ now()->format('d M Y, H:i') }} &middot; {{ $logs->count() }} {{ $logs->count() === 1 ? 'entry' : 'entries' }}</p>

@if(array_filter($filters))
<p class="filters">
  @if($filters['date_from']) <span>From: {{ $filters['date_from'] }}</span> @endif
  @if($filters['date_to']) <span>To: {{ $filters['date_to'] }}</span> @endif
  @if($filters['user']) <span>User: {{ $filters['user'] }}</span> @endif
  @if($filters['search']) <span>Search: "{{ $filters['search'] }}"</span> @endif
</p>
@endif

@forelse($logs as $log)
@php
  $items = $log->new_values['items'] ?? $log->old_values['items'] ?? null;
  $skip  = ['updated_at', 'created_at', 'slug', 'password', 'remember_token', 'items'];
  $changes = [];
  if ($log->event === 'updated' && !empty($log->old_values)) {
    foreach ($log->old_values as $field => $oldVal) {
      if (in_array($field, $skip)) continue;
      $changes[] = ['field' => $field, 'old' => $oldVal, 'new' => $log->new_values[$field] ?? null];
    }
  }
@endphp
<div class="entry">
  <table class="entry-head">
    <tr>
      <td style="width: 130px;" class="time">{{ $log->created_at->format('d M Y H:i:s') }}</td>
      <td style="width: 140px;" class="user">{{ $log->user->name ?? 'System' }}</td>
      <td style="width: 80px;"><span class="badge badge-{{ $log->event }}">{{ $log->event }}</span></td>
      <td>{{ class_basename($log->auditable_type ?? '') }}{{ $log->auditable_id ? ' #' . $log->auditable_id : '' }}</td>
    </tr>
  </table>
  <div class="description">{{ $log->description }}</div>

  @if(!empty($items))
    <table class="items">
      <thead>
        <tr>
          <th>Product</th><th>SKU</th>
          @if(array_key_exists('quantity_before', $items[0] ?? [])) <th>Before</th><th>Change</th><th>After</th><th>Cost Price</th> @endif
          @if(array_key_exists('quantity', $items[0] ?? [])) <th>Quantity</th> @endif
          @if(array_key_exists('received_quantity', $items[0] ?? [])) <th>Received</th><th>Dest. Before</th><th>Dest. After</th> @endif
        </tr>
      </thead>
      <tbody>
        @foreach($items as $it)
        <tr>
          <td>{{ $it['product_name'] ?? '-' }}</td>
          <td>{{ $it['product_sku'] ?? '-' }}</td>
          @if(array_key_exists('quantity_before', $it))
            <td>{{ $it['quantity_before'] }}</td>
            <td class="{{ ($it['quantity_adjusted'] ?? 0) < 0 ? 'neg' : 'pos' }}">{{ ($it['quantity_adjusted'] ?? 0) > 0 ? '+' : '' }}{{ $it['quantity_adjusted'] }}</td>
            <td>{{ $it['quantity_after'] }}</td>
            <td>{{ number_format($it['cost_price'] ?? 0, 2) }}</td>
          @endif
          @if(array_key_exists('quantity', $it) && !array_key_exists('quantity_before', $it) && !array_key_exists('received_quantity', $it))
            <td>{{ $it['quantity'] }}</td>
          @endif
          @if(array_key_exists('received_quantity', $it))
            <td>{{ $it['received_quantity'] }}</td>
            <td>{{ $it['destination_before'] ?? '-' }}</td>
            <td>{{ $it['destination_after'] ?? '-' }}</td>
          @endif
        </tr>
        @endforeach
      </tbody>
    </table>
  @elseif(!empty($changes))
    <table class="items">
      <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
      <tbody>
        @foreach($changes as $c)
        <tr>
          <td>{{ $c['field'] }}</td>
          <td>{{ is_scalar($c['old']) ? $c['old'] : json_encode($c['old']) }}</td>
          <td>{{ is_scalar($c['new']) ? $c['new'] : json_encode($c['new']) }}</td>
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
