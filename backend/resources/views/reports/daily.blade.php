<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: DejaVu Sans, sans-serif; font-size: 11px; color: #1f2937; margin: 0; padding: 20px; }
  h1 { font-size: 20px; color: #1e40af; margin-bottom: 4px; }
  .subtitle { color: #6b7280; font-size: 11px; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
  .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; }
  .card-label { color: #6b7280; font-size: 10px; }
  .card-value { font-size: 15px; font-weight: bold; color: #1f2937; margin-top: 2px; }
  .card-value.profit { color: #059669; }
  .card-value.loss { color: #dc2626; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background: #1e40af; color: white; padding: 6px 8px; text-align: left; font-size: 10px; }
  td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; font-size: 10px; }
  tr:nth-child(even) { background: #f8fafc; }
  h2 { font-size: 13px; color: #374151; border-bottom: 2px solid #e5e7eb; padding-bottom: 4px; margin: 16px 0 8px; }
  .footer { text-align: center; color: #9ca3af; font-size: 9px; margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 10px; }
  .badge-positive { color: #059669; font-weight: bold; }
  .badge-negative { color: #dc2626; font-weight: bold; }
</style>
</head>
<body>
<h1>Daily Report — {{ $date }}</h1>
<p class="subtitle">Generated on {{ now()->format('d M Y, H:i') }} · NexaPOS</p>

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
    <div class="card-label">Gross Profit</div>
    <div class="card-value {{ ($data['gross_profit'] ?? 0) >= 0 ? 'profit' : 'loss' }}">${{ number_format($data['gross_profit'] ?? 0, 2) }}</div>
  </div>
  <div class="card">
    <div class="card-label">Net Profit</div>
    <div class="card-value {{ ($data['net_profit'] ?? 0) >= 0 ? 'profit' : 'loss' }}">${{ number_format($data['net_profit'] ?? 0, 2) }}</div>
  </div>
</div>

<h2>Payment Breakdown</h2>
<table>
  <tr><th>Method</th><th>Amount</th></tr>
  <tr><td>Cash</td><td>${{ number_format($data['cash_sales'] ?? 0, 2) }}</td></tr>
  <tr><td>Card</td><td>${{ number_format($data['card_sales'] ?? 0, 2) }}</td></tr>
  <tr><td>Mobile Money</td><td>${{ number_format($data['mobile_money_sales'] ?? 0, 2) }}</td></tr>
  <tr><td>Other</td><td>${{ number_format($data['other_sales'] ?? 0, 2) }}</td></tr>
  <tr><td><strong>Total Expenses</strong></td><td><strong>${{ number_format($data['total_expenses'] ?? 0, 2) }}</strong></td></tr>
</table>

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

@if(!empty($data['top_products']))
<h2>Top Products</h2>
<table>
  <tr><th>#</th><th>Product</th><th>SKU</th><th>Qty Sold</th><th>Revenue</th></tr>
  @foreach($data['top_products'] as $i => $p)
  <tr>
    <td>{{ $i + 1 }}</td>
    <td>{{ $p['product']['name'] ?? 'N/A' }}</td>
    <td>{{ $p['product']['sku'] ?? '-' }}</td>
    <td>{{ $p['qty_sold'] }}</td>
    <td>${{ number_format($p['revenue'], 2) }}</td>
  </tr>
  @endforeach
</table>
@endif

@if(!empty($data['shift_ends']))
<h2>Shift Summaries</h2>
<table>
  <tr><th>Cashier</th><th>Shift End</th><th>Sales</th><th>Declared Cash</th><th>Expected Cash</th><th>Variance</th><th>Status</th></tr>
  @foreach($data['shift_ends'] as $s)
  <tr>
    <td>{{ $s['user']['name'] ?? '-' }}</td>
    <td>{{ $s['shift_end'] }}</td>
    <td>${{ number_format($s['total_sales'], 2) }}</td>
    <td>${{ number_format($s['declared_cash'], 2) }}</td>
    <td>${{ number_format($s['expected_cash'], 2) }}</td>
    <td class="{{ $s['variance'] >= 0 ? 'badge-positive' : 'badge-negative' }}">${{ number_format($s['variance'], 2) }}</td>
    <td>{{ ucfirst($s['status']) }}</td>
  </tr>
  @endforeach
</table>
@endif

<div class="footer">NexaPOS · Daily Report · {{ $date }}</div>
</body>
</html>
