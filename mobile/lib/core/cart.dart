import 'package:flutter/foundation.dart';

import 'app_state.dart';
import 'models.dart';

class CartLine {
  CartLine({required this.product, required this.qty, required this.price, required this.taxRate});

  final Product product;
  double qty;

  /// Base currency, VAT included.
  final double price;
  final double taxRate;

  double get total => price * qty;

  /// The VAT inside [total].
  double get tax => taxRate <= 0 ? 0 : total - total / (1 + taxRate / 100);
}

/// The sale being rung up.
class Cart extends ChangeNotifier {
  Cart._();

  static final Cart I = Cart._();

  final List<CartLine> lines = [];

  bool get isEmpty => lines.isEmpty;
  double get total => lines.fold(0, (sum, l) => sum + l.total);
  double get tax => lines.fold(0, (sum, l) => sum + l.tax);

  /// Pieces in the sale; a weighed line counts as one.
  int get count => lines.fold(0, (sum, l) => sum + (l.product.soldByWeight ? 1 : l.qty.round()));

  double qtyOf(int productId) => lines.where((l) => l.product.id == productId).fold(0.0, (sum, l) => sum + l.qty);

  /// Adds [qty] of [product]. Returns why it can't, or null when it was added.
  String? add(Product product, double qty) {
    if (product.price <= 0) return '${product.name} has no price set. Add one in Products before selling it.';
    final problem = _stockProblem(product, qtyOf(product.id) + qty);
    if (problem != null) return problem;
    if (!product.soldByWeight) {
      for (final line in lines) {
        if (line.product.id == product.id) {
          line.qty += qty;
          notifyListeners();
          return null;
        }
      }
    }
    lines.add(CartLine(product: product, qty: qty, price: product.price, taxRate: AppState.I.taxRateFor(product)));
    notifyListeners();
    return null;
  }

  /// Sets a line's quantity (0 removes it). Returns why it can't, or null.
  String? setQty(CartLine line, double qty) {
    if (qty <= 0) {
      remove(line);
      return null;
    }
    final others = qtyOf(line.product.id) - line.qty;
    final problem = _stockProblem(line.product, others + qty);
    if (problem != null) return problem;
    line.qty = qty;
    notifyListeners();
    return null;
  }

  void remove(CartLine line) {
    lines.remove(line);
    notifyListeners();
  }

  void clear() {
    lines.clear();
    notifyListeners();
  }

  String? _stockProblem(Product p, double wanted) {
    if (!AppState.I.blockNegativeStock || !p.trackStock || p.stock == null) return null;
    if (wanted <= p.stock! + 1e-9) return null;
    return p.stock! <= 0 ? '${p.name} is out of stock.' : 'Only ${qtyText(p.stock!)} ${p.name} in stock.';
  }
}
