import 'package:flutter/foundation.dart';

import 'api.dart';
import 'app_state.dart';
import 'models.dart';

/// This branch's products and categories, as the till sells them.
class Catalog extends ChangeNotifier {
  Catalog._();

  static final Catalog I = Catalog._();

  List<Product> products = const [];
  List<ProductCategory> categories = const [];
  bool loading = false;
  String? error;
  bool get loaded => _loadedOnce;
  bool _loadedOnce = false;

  Future<void> load() async {
    if (loading) return;
    loading = true;
    notifyListeners();
    final s = AppState.I;
    try {
      // Only what's on the shelf at this branch, as the web till does.
      final body = await s.api.get('/products', query: {'per_page': 1000, 'is_active': 1, 'branch_id': s.branchId});
      final list = Api.list(body).map(Product.fromJson).toList()
        ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
      products = list;
      // The categories these products are in — each product carries its own,
      // so the chips never list an empty category or miss one this cashier can't list.
      final byId = <int, Product>{};
      for (final p in list) {
        if (p.categoryId != null && p.categoryName != null) byId.putIfAbsent(p.categoryId!, () => p);
      }
      final firsts = byId.values.toList()
        ..sort((a, b) => (a.categoryOrder ?? 0) != (b.categoryOrder ?? 0)
            ? (a.categoryOrder ?? 0).compareTo(b.categoryOrder ?? 0)
            : a.categoryName!.toLowerCase().compareTo(b.categoryName!.toLowerCase()));
      categories = [for (final p in firsts) ProductCategory(p.categoryId!, p.categoryName!)];
      error = null;
      _loadedOnce = true;
    } on ApiException catch (e) {
      if (e.sessionEnded) {
        loading = false;
        await s.sessionEnded();
        return;
      }
      error = e.message;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Product? byCode(String code) {
    for (final p in products) {
      if (p.hasCode(code)) return p;
    }
    return null;
  }

  Product? byId(int id) {
    for (final p in products) {
      if (p.id == id) return p;
    }
    return null;
  }

  void clear() {
    products = const [];
    categories = const [];
    _loadedOnce = false;
    error = null;
    notifyListeners();
  }
}
