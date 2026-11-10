import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api.dart';
import '../core/app_state.dart';
import '../core/cart.dart';
import '../core/catalog.dart';
import '../core/models.dart';
import 'cart_screen.dart';
import 'sales_screen.dart';
import 'scan_screen.dart';
import 'settings_screen.dart';
import 'theme.dart';
import 'widgets.dart';

/// The selling screen: find products, tap to add, then Charge.
class TillScreen extends StatefulWidget {
  const TillScreen({super.key});

  @override
  State<TillScreen> createState() => _TillScreenState();
}

class _TillScreenState extends State<TillScreen> {
  final _search = TextEditingController();
  final _searchFocus = FocusNode();
  int? _categoryId;
  Timer? _refresh;

  @override
  void initState() {
    super.initState();
    Catalog.I.load();
    AppState.I.refresh().catchError((Object e) {
      if (e is ApiException && e.sessionEnded) AppState.I.sessionEnded();
    });
    // Stock and prices change from other tills and the back office: keep them current.
    _refresh = Timer.periodic(const Duration(seconds: 60), (_) => Catalog.I.load());
    WidgetsBinding.instance.addPostFrameCallback((_) => _askForTillIfNeeded());
  }

  @override
  void dispose() {
    _refresh?.cancel();
    _search.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  Future<void> _askForTillIfNeeded() async {
    if (!mounted || !AppState.I.needsTill) return;
    await chooseTill(context);
  }

  void _add(Product p, [double qty = 1]) {
    final problem = Cart.I.add(p, qty);
    if (problem != null) {
      showProblem(context, problem);
      return;
    }
    HapticFeedback.lightImpact();
    showNote(context, 'Added ${p.soldByWeight ? '${qtyText(qty)} kg ' : ''}${p.name}', duration: const Duration(milliseconds: 900));
  }

  Future<void> _tap(Product p) async {
    if (!p.soldByWeight) return _add(p);
    final kg = await askWeight(context, p);
    if (kg != null && kg > 0 && mounted) _add(p, kg);
  }

  /// A scanned or typed code: the product with that barcode, SKU or PLU goes straight in.
  void _code(String code) {
    final product = Catalog.I.byCode(code);
    if (product != null) {
      _search.clear();
      setState(() {});
      _tap(product);
      return;
    }
    final matches = _visible();
    if (matches.length == 1 && _search.text.trim().isNotEmpty) {
      _search.clear();
      setState(() {});
      _tap(matches.first);
      return;
    }
    showProblem(context, 'No product with code "$code".');
  }

  Future<void> _scan() async {
    final code = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => const ScanScreen()));
    if (code != null && mounted) _code(code);
  }

  List<Product> _visible() {
    final q = _search.text.trim();
    return Catalog.I.products.where((p) {
      if (_categoryId != null && p.categoryId != _categoryId) return false;
      return q.isEmpty || p.matches(q);
    }).toList();
  }

  Future<void> _menu(String choice) async {
    switch (choice) {
      case 'sales':
        await Navigator.push(context, MaterialPageRoute(builder: (_) => const SalesScreen()));
      case 'settings':
        await Navigator.push(context, MaterialPageRoute(builder: (_) => const SettingsScreen()));
      case 'refresh':
        await Catalog.I.load();
        if (mounted && Catalog.I.error == null) showNote(context, 'Products updated');
      case 'signout':
        await signOutWithCheck(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppState.I;
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 12,
        title: Row(children: [
          const CoreLogo(size: 30),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(s.storeName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
              Text([s.userName, if (s.branchName.isNotEmpty) s.branchName].join(' · '),
                  maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: Colors.white70, fontWeight: FontWeight.w400)),
            ]),
          ),
        ]),
        actions: [
          const CurrencyButton(),
          PopupMenuButton<String>(
            tooltip: 'Menu',
            icon: const Icon(Icons.more_vert),
            onSelected: _menu,
            itemBuilder: (context) => const [
              PopupMenuItem(value: 'sales', child: ListTile(leading: Icon(Icons.receipt_long_outlined), title: Text('Recent sales'))),
              PopupMenuItem(value: 'refresh', child: ListTile(leading: Icon(Icons.refresh), title: Text('Update products'))),
              PopupMenuItem(value: 'settings', child: ListTile(leading: Icon(Icons.settings_outlined), title: Text('Settings & printer'))),
              PopupMenuItem(value: 'signout', child: ListTile(leading: Icon(Icons.logout, color: kRed), title: Text('Sign out'))),
            ],
          ),
        ],
      ),
      body: Column(children: [
        if (s.needsTill)
          MaterialBanner(
            backgroundColor: const Color(0xFFFFF7E6),
            content: const Text('Choose which till this device is before selling.'),
            actions: [TextButton(onPressed: () => chooseTill(context), child: const Text('Choose till'))],
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
          child: Row(children: [
            Expanded(
              child: ListenableBuilder(
                listenable: _search,
                builder: (context, _) => TextField(
                  controller: _search,
                  focusNode: _searchFocus,
                  textInputAction: TextInputAction.search,
                  style: const TextStyle(fontSize: 16),
                  decoration: InputDecoration(
                    hintText: 'Search name, SKU or barcode',
                    prefixIcon: const Icon(Icons.search),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                    suffixIcon: _search.text.isEmpty
                        ? null
                        : IconButton(
                            tooltip: 'Clear search',
                            icon: const Icon(Icons.close),
                            onPressed: () {
                              _search.clear();
                              setState(() {});
                            },
                          ),
                  ),
                  onChanged: (_) => setState(() {}),
                  // A barcode scanner wedge types the code then Enter.
                  onSubmitted: (v) {
                    if (v.trim().isNotEmpty) _code(v.trim());
                  },
                ),
              ),
            ),
            if (!kIsWeb) ...[
              const SizedBox(width: 8),
              SizedBox(
                height: 52,
                width: 52,
                child: IconButton.filled(
                  tooltip: 'Scan a barcode',
                  style: IconButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
                  onPressed: _scan,
                  icon: const Icon(Icons.qr_code_scanner),
                ),
              ),
            ],
          ]),
        ),
        ListenableBuilder(
          listenable: Catalog.I,
          builder: (context, _) => _CategoryChips(
            categories: Catalog.I.categories,
            selected: _categoryId,
            onSelect: (id) => setState(() => _categoryId = id),
          ),
        ),
        Expanded(
          child: ListenableBuilder(
            listenable: Listenable.merge([Catalog.I, Cart.I]),
            builder: (context, _) => _grid(),
          ),
        ),
      ]),
      bottomNavigationBar: const _CartBar(),
    );
  }

  Widget _grid() {
    final catalog = Catalog.I;
    if (!catalog.loaded) {
      if (catalog.error != null) return _Message(icon: Icons.cloud_off, text: catalog.error!, action: 'Try again', onAction: catalog.load);
      return const Center(child: CircularProgressIndicator());
    }
    final products = _visible();
    if (products.isEmpty) {
      return RefreshIndicator(
        onRefresh: catalog.load,
        child: ListView(children: [
          const SizedBox(height: 80),
          _Message(
            icon: Icons.search_off,
            text: catalog.products.isEmpty ? 'No products for sale at this branch yet.' : 'Nothing matches that.',
          ),
        ]),
      );
    }
    return RefreshIndicator(
      onRefresh: catalog.load,
      child: GridView.builder(
        padding: const EdgeInsets.fromLTRB(12, 4, 12, 16),
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 220,
          mainAxisExtent: 142,
          crossAxisSpacing: 10,
          mainAxisSpacing: 10,
        ),
        itemCount: products.length,
        itemBuilder: (context, i) => _ProductCard(product: products[i], inCart: Cart.I.qtyOf(products[i].id), onTap: () => _tap(products[i])),
      ),
    );
  }
}

class _CategoryChips extends StatelessWidget {
  const _CategoryChips({required this.categories, required this.selected, required this.onSelect});

  final List<ProductCategory> categories;
  final int? selected;
  final ValueChanged<int?> onSelect;

  @override
  Widget build(BuildContext context) {
    if (categories.isEmpty) return const SizedBox(height: 4);
    final all = [const ProductCategory(-1, 'All'), ...categories];
    return SizedBox(
      height: 48,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
        itemCount: all.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final c = all[i];
          final id = c.id == -1 ? null : c.id;
          final on = id == selected;
          return ChoiceChip(
            label: Text(c.name),
            selected: on,
            showCheckmark: false,
            onSelected: (_) => onSelect(id),
            labelStyle: TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: on ? Colors.white : kInk),
            selectedColor: kBlue,
            backgroundColor: Colors.white,
            side: BorderSide(color: on ? kBlue : kLine),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            padding: const EdgeInsets.symmetric(horizontal: 6),
          );
        },
      ),
    );
  }
}

const _tileColors = [
  Color(0xFF2563EB),
  Color(0xFF0E9F6E),
  Color(0xFFD97706),
  Color(0xFF7C3AED),
  Color(0xFFDB2777),
  Color(0xFF0891B2),
  Color(0xFF4F46E5),
  Color(0xFF65A30D),
];

class _ProductCard extends StatelessWidget {
  const _ProductCard({required this.product, required this.inCart, required this.onTap});

  final Product product;
  final double inCart;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final s = AppState.I;
    final p = product;
    final colour = _tileColors[(p.categoryId ?? p.id) % _tileColors.length];
    final stockText = !p.trackStock || p.stock == null
        ? null
        : p.outOfStock
            ? 'Out of stock'
            : '${qtyText(p.stock!)} ${p.soldByWeight ? 'kg ' : ''}in stock';
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(color: colour.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                alignment: Alignment.center,
                child: Text(p.name.isEmpty ? '?' : p.name.characters.first.toUpperCase(),
                    style: TextStyle(color: colour, fontWeight: FontWeight.w800, fontSize: 17)),
              ),
              const Spacer(),
              if (inCart > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(color: kBlue, borderRadius: BorderRadius.circular(20)),
                  child: Text('${qtyText(inCart)}${p.soldByWeight ? ' kg' : ''} in sale',
                      style: const TextStyle(color: Colors.white, fontSize: 11.5, fontWeight: FontWeight.w700)),
                ),
            ]),
            const SizedBox(height: 8),
            Expanded(
              child: Text(p.name, maxLines: 2, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: kInk, height: 1.2)),
            ),
            Text('${s.money(p.price)}${p.soldByWeight ? ' /kg' : ''}',
                style: const TextStyle(fontSize: 16.5, fontWeight: FontWeight.w800, color: kBlue)),
            if (stockText != null)
              Text(stockText, style: TextStyle(fontSize: 12, color: p.outOfStock ? kRed : kMuted, fontWeight: p.outOfStock ? FontWeight.w700 : FontWeight.w400)),
          ]),
        ),
      ),
    );
  }
}

/// The bar across the bottom: what's in the sale and the way to pay for it.
class _CartBar extends StatelessWidget {
  const _CartBar();

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([Cart.I, AppState.I]),
      builder: (context, _) {
        final cart = Cart.I;
        final s = AppState.I;
        return Container(
          decoration: const BoxDecoration(color: Colors.white, boxShadow: [BoxShadow(color: Color(0x1A0F172A), blurRadius: 12, offset: Offset(0, -2))]),
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 12, 10),
              child: Row(children: [
                Expanded(
                  child: InkWell(
                    onTap: cart.isEmpty ? null : () => openCart(context),
                    child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(cart.isEmpty ? 'No items yet' : '${cart.count} item${cart.count == 1 ? '' : 's'} in this sale',
                          style: const TextStyle(fontSize: 13, color: kMuted)),
                      Text(cart.isEmpty ? 'Tap a product to add it' : s.money(cart.total),
                          style: TextStyle(fontSize: cart.isEmpty ? 15 : 24, fontWeight: FontWeight.w800, color: kInk)),
                    ]),
                  ),
                ),
                FilledButton.icon(
                  onPressed: cart.isEmpty ? null : () => openCart(context),
                  style: FilledButton.styleFrom(minimumSize: const Size(132, 54), backgroundColor: kGreen),
                  icon: const Icon(Icons.shopping_cart_checkout),
                  label: const Text('Charge'),
                ),
              ]),
            ),
          ),
        );
      },
    );
  }
}

void openCart(BuildContext context) => Navigator.push(context, MaterialPageRoute(builder: (_) => const CartScreen()));

class _Message extends StatelessWidget {
  const _Message({required this.icon, required this.text, this.action, this.onAction});

  final IconData icon;
  final String text;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 48, color: kMuted),
          const SizedBox(height: 12),
          Text(text, textAlign: TextAlign.center, style: const TextStyle(fontSize: 16, color: kMuted)),
          if (action != null) ...[
            const SizedBox(height: 16),
            OutlinedButton(onPressed: onAction, child: Text(action!)),
          ],
        ]),
      ),
    );
  }
}

/// The till's currency: every price shows in it, and cash is taken in it.
class CurrencyButton extends StatelessWidget {
  const CurrencyButton({super.key});

  @override
  Widget build(BuildContext context) {
    final s = AppState.I;
    if (s.currencies.length < 2) return const SizedBox.shrink();
    return PopupMenuButton<String>(
      tooltip: 'Currency',
      onSelected: (code) => s.currency = s.currencies.firstWhere((c) => c.code == code),
      itemBuilder: (context) => [
        for (final c in s.currencies)
          CheckedPopupMenuItem(value: c.code, checked: c.code == s.currency.code, child: Text('${c.code}  ·  ${c.name}')),
      ],
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 10),
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
        child: Row(children: [
          Text(s.currency.code, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
          const Icon(Icons.arrow_drop_down, size: 20),
        ]),
      ),
    );
  }
}

/// Weight for a product sold by the kg.
Future<double?> askWeight(BuildContext context, Product p) {
  var value = '';
  return showModalBottomSheet<double>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => StatefulBuilder(
      builder: (context, setState) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(p.name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            Text('${AppState.I.money(p.price)} per kg — enter the weight', style: const TextStyle(color: kMuted)),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(color: kBg, borderRadius: BorderRadius.circular(14)),
              child: Row(children: [
                Text(value.isEmpty ? '0' : value, style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800)),
                const Text(' kg', style: TextStyle(fontSize: 20, color: kMuted)),
                const Spacer(),
                if (value.isNotEmpty)
                  Text(AppState.I.money(p.price * (double.tryParse(value) ?? 0)), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: kBlue)),
              ]),
            ),
            const SizedBox(height: 12),
            SizedBox(height: 260, child: NumberPad(onKey: (k) => setState(() => value = applyKey(value, k, decimals: 3)))),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: (double.tryParse(value) ?? 0) > 0 ? () => Navigator.pop(context, double.parse(value)) : null,
              child: const Text('Add to sale'),
            ),
          ]),
        ),
      ),
    ),
  );
}

/// Which till (register) this device rings sales up on, when the branch has several.
Future<void> chooseTill(BuildContext context) async {
  final s = AppState.I;
  final tills = s.activeTills;
  if (tills.isEmpty) return;
  final id = await showDialog<int>(
    context: context,
    builder: (context) => SimpleDialog(
      title: const Text('Which till is this?'),
      children: [
        for (final t in tills)
          SimpleDialogOption(
            onPressed: () => Navigator.pop(context, toInt(t['id'])),
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
            child: Text(text(t['name']) ?? 'Till ${t['id']}', style: const TextStyle(fontSize: 17)),
          ),
      ],
    ),
  );
  if (id != null) s.chooseTill(id);
}

Future<void> signOutWithCheck(BuildContext context) async {
  final ok = await confirm(
    context,
    title: 'Sign out?',
    message: Cart.I.isEmpty ? 'The next person signs in with their own username.' : 'The sale on screen has not been paid and will be cleared.',
    yes: 'Sign out',
    danger: !Cart.I.isEmpty,
  );
  if (ok) await AppState.I.signOut();
}
