<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: DejaVu Sans, sans-serif; font-size: 11px; color: #1f2937; margin: 0; padding: 20px; }
  h1 { font-size: 20px; color: #7c3aed; margin-bottom: 4px; }
  .subtitle { color: #6b7280; font-size: 11px; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
  .card { background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 6px; padding: 10px; }
  .card-label { color: #6b7280; font-size: 10px; }
  .card-value { font-size: 15px; font-weight: bold; color: #1f2937; margin-top: 2px; }
  .card-value.profit { color: #059669; }
  .card-value.loss { color: #dc2626; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background: #7c3aed; color: white; padding: 6px 8px; text-align: left; font-size: 10px; }
  td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; font-size: 10px; }
  tr:nth-child(even) { background: #faf5ff; }
  h2 { font-size: 13px; color: #374151; border-bottom: 2px solid #e5e7eb; padding-bottom: 4px; margin: 16px 0 8px; }
  .footer { text-align: center; color: #9ca3af; font-size: 9px; margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 10px; }
  .badge-positive { color: #059669; font-weight: bold; }
  .badge-negative { color: #dc2626; font-weight: bold; }
</style>
</head>
<body>
<h1>Monthly Report — {{ $month }}</h1>
<p class="subtitle">Period: {{ $data['from'] ?? '' }} to {{ $data['to'] ?? '' }} · Generated {{ now()->format('d M Y, H:i') }} · NexaPOS</p>

<div class="grid">
  <div class="card">
    <div class="card-label">Total Revenue</div>
    <div class="card-value">${{ number_format($data['total_revenue'] ?? 0, 2) }}</div>
  </div>
  <div class="card">
    <div class="card-label">Transactions</div>
    <div class="card-value">{{ $data['total_transactions'] ?? 0 }}</div>
  </div>
  <div class="card">
    <div class="card-label">Net Profit</div>
    <div class="card-value {{ ($data['net_profit'] ?? 0) >= 0 ? 'profit' : 'loss' }}">${{ number_format($data['net_profit'] ?? 0, 2) }}</div>
  </div>
  <div class="card">
    <div class="card-label">Net Margin</div>
    <div class="card-value {{ ($data['net_margin'] ?? 0) >= 0 ? 'profit' : 'loss' }}">{{ $data['net_margin'] ?? 0 }}%</div>
  </div>
</div>

<h2>Profit & Loss Summary</h2>
<table>
  <tr><th>Item</th><th>Amount</th></tr>
  <tr><td>Revenue</td><td>${{ number_format($data['total_revenue'] ?? 0, 2) }}</td></tr>
  <tr><td>Cost of Goods Sold (COGS)</td><td>-${{ number_format($data['cogs'] ?? 0, 2) }}</td></tr>
  <tr><td><strong>Gross Profit ({{ $data['gross_margin'] ?? 0 }}%)</strong></td><td><strong class="{{ ($data['gross_profit'] ?? 0) >= 0 ? 'badge-positive' : 'badge-negative' }}">${{ number_format($data['gross_profit'] ?? 0, 2) }}</strong></td></tr>
  <tr><td>Total Expenses</td><td>-${{ number_format($data['total_expenses'] ?? 0, 2) }}</td></tr>
  <tr><td><strong>Net Profit ({{ $data['net_margin'] ?? 0 }}%)</strong></td><td><strong class="{{ ($data['net_profit'] ?? 0) >= 0 ? 'badge-positive' : 'badge-negative' }}">${{ number_format($data['net_profit'] ?? 0, 2) }}</strong></td></tr>
</table>

@if(!empty($data['payment_breakdown']))
<h2>Payment Methods</h2>
<table>
  <tr><th>Method</th><th>Amount</th></tr>
  @foreach($data['payment_breakdown'] as $method => $amount)
  <tr><td>{{ ucfirst(str_replace('_', ' ', $method)) }}</td><td>${{ number_format($amount, 2) }}</td></tr>
  @endforeach
</table>
@endif

@if(!empty($data['cashier_breakdown']))
<h2>Cashier Performance</h2>
<table>
  <tr><th>Cashier</th><th>Username</th><th>Transactions</th><th>Revenue</th></tr>
  @foreach($data['cashier_breakdown'] as $row)
  <tr>
    <td>{{ $row['cashier'] }}</td>
    <td>@{{ $row['username'] }}</td>
    <td>{{ $row['transactions'] }}</td>
    <td>${{ number_format($row['revenue'], 2) }}</td>
  </tr>
  @endforeach
</table>
@endif

@if(!empty($data['daily_breakdown']))
<h2>Daily Sales Breakdown</h2>
<table>
  <tr><th>Date</th><th>Transactions</th><th>Revenue</th></tr>
  @foreach($data['daily_breakdown'] as $row)
  <tr>
    <td>{{ $row['date'] }}</td>
    <td>{{ $row['transactions'] }}</td>
    <td>${{ number_format($row['revenue'], 2) }}</td>
  </tr>
  @endforeach
</table>
@endif

<div class="footer">NexaPOS · Monthly Report · {{ $month }}</div>
</body>
</html>
