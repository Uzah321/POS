// What the app reads from the API. Numbers come back as numbers or as strings
// ("22.990000") depending on the column, so everything is read leniently.

double toDouble(Object? value, [double fallback = 0]) => toDoubleOrNull(value) ?? fallback;

double? toDoubleOrNull(Object? value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value.trim());
  return null;
}

int? toInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value.trim());
  return null;
}

bool toBool(Object? value, [bool fallback = false]) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  if (value is String) {
    final v = value.trim().toLowerCase();
    if (v == 'true' || v == '1' || v == 'yes') return true;
    if (v == 'false' || v == '0' || v == 'no') return false;
  }
  return fallback;
}

String? text(Object? value) {
  if (value is String && value.trim().isNotEmpty) return value.trim();
  if (value is num) return '$value';
  return null;
}

Map<String, dynamic> asMap(Object? value) => value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

/// 1234.5 → "1,234.50".
String grouped(double value, {int decimals = 2}) {
  final negative = value < 0;
  final fixed = value.abs().toStringAsFixed(decimals);
  final parts = fixed.split('.');
  final digits = parts[0];
  final out = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) out.write(',');
    out.write(digits[i]);
  }
  final number = parts.length > 1 ? '$out.${parts[1]}' : '$out';
  return negative ? '-$number' : number;
}

/// A quantity as people write it: 2, 1.5, 0.375.
String qtyText(double qty) {
  if (qty == qty.roundToDouble()) return qty.toInt().toString();
  return qty.toStringAsFixed(3).replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
}

class Currency {
  const Currency({required this.id, required this.code, required this.name, required this.symbol, required this.rate, this.isDefault = false});

  factory Currency.fromJson(Map<String, dynamic> m) => Currency(
        id: toInt(m['id']) ?? 0,
        code: text(m['code']) ?? 'USD',
        name: text(m['name']) ?? text(m['code']) ?? 'Currency',
        symbol: text(m['symbol']) ?? text(m['code']) ?? r'$',
        rate: toDouble(m['exchange_rate'], 1),
        isDefault: toBool(m['is_default']),
      );

  static const usd = Currency(id: 0, code: 'USD', name: 'US Dollar', symbol: r'$', rate: 1, isDefault: true);

  final int id;
  final String code;
  final String name;
  final String symbol;

  /// Units of this currency per one of the base currency (the store keeps every amount in base).
  final double rate;
  final bool isDefault;

  Map<String, dynamic> toJson() => {'id': id, 'code': code, 'name': name, 'symbol': symbol, 'exchange_rate': rate, 'is_default': isDefault};
}

class ProductCategory {
  const ProductCategory(this.id, this.name);

  factory ProductCategory.fromJson(Map<String, dynamic> m) => ProductCategory(toInt(m['id']) ?? 0, text(m['name']) ?? 'Other');

  final int id;
  final String name;
}

class Product {
  Product({
    required this.id,
    required this.name,
    required this.price,
    required this.raw,
    this.sku,
    this.barcode,
    this.plu,
    this.categoryId,
    this.categoryName,
    this.categoryOrder,
    this.stock,
    this.trackStock = true,
    this.soldByWeight = false,
  });

  factory Product.fromJson(Map<String, dynamic> m) => Product(
        id: toInt(m['id']) ?? 0,
        name: text(m['name']) ?? 'Item',
        price: toDouble(m['selling_price']),
        sku: text(m['sku']),
        barcode: text(m['barcode']),
        plu: text(m['plu_code']),
        categoryId: toInt(m['category_id']) ?? toInt(asMap(m['category'])['id']),
        categoryName: text(asMap(m['category'])['name']),
        categoryOrder: toInt(asMap(m['category'])['sort_order']),
        stock: toDoubleOrNull(m['total_stock'] ?? m['stock_quantity'] ?? m['quantity_in_stock']),
        trackStock: toBool(m['track_stock'], true),
        soldByWeight: toBool(m['sold_by_weight']),
        raw: m,
      );

  final int id;
  final String name;

  /// Selling price in the base currency, VAT included.
  final double price;
  final String? sku;
  final String? barcode;
  final String? plu;
  final int? categoryId;
  final String? categoryName;
  final int? categoryOrder;

  /// Units on hand at this branch; null when the server doesn't say.
  final double? stock;
  final bool trackStock;

  /// Priced per kg: the quantity is a weight.
  final bool soldByWeight;
  final Map<String, dynamic> raw;

  bool get outOfStock => trackStock && stock != null && stock! <= 0;

  bool matches(String query) {
    final q = query.toLowerCase();
    return name.toLowerCase().contains(q) ||
        (sku?.toLowerCase().contains(q) ?? false) ||
        (barcode?.toLowerCase() == q) ||
        (plu?.toLowerCase() == q);
  }

  bool hasCode(String code) {
    final c = code.trim().toLowerCase();
    if (c.isEmpty) return false;
    return barcode?.toLowerCase() == c || sku?.toLowerCase() == c || plu?.toLowerCase() == c;
  }
}
