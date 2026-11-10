import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/cart.dart';
import '../core/models.dart';
import 'payment_screen.dart';
import 'theme.dart';
import 'widgets.dart';

/// The sale so far: change quantities, take lines off, then take payment.
class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  Future<void> _clear(BuildContext context) async {
    final ok = await confirm(context, title: 'Clear this sale?', message: 'Every item comes off the sale.', yes: 'Clear', danger: true);
    if (ok && context.mounted) {
      Cart.I.clear();
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([Cart.I, AppState.I]),
      builder: (context, _) {
        final cart = Cart.I;
        final s = AppState.I;
        return Scaffold(
          appBar: AppBar(
            title: const Text('Current sale'),
            actions: [
              if (!cart.isEmpty)
                TextButton.icon(
                  onPressed: () => _clear(context),
                  style: TextButton.styleFrom(foregroundColor: Colors.white),
                  icon: const Icon(Icons.delete_sweep_outlined),
                  label: const Text('Clear'),
                ),
            ],
          ),
          body: cart.isEmpty
              ? const Center(child: Text('No items in this sale.', style: TextStyle(fontSize: 16, color: kMuted)))
              : ListView.separated(
                  padding: const EdgeInsets.all(12),
                  itemCount: cart.lines.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (context, i) => _LineCard(line: cart.lines[i]),
                ),
          bottomNavigationBar: cart.isEmpty
              ? null
              : Container(
                  decoration: const BoxDecoration(color: Colors.white, boxShadow: [BoxShadow(color: Color(0x1A0F172A), blurRadius: 12, offset: Offset(0, -2))]),
                  child: SafeArea(
                    top: false,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        _row('Items', '${cart.count}'),
                        if (cart.tax > 0) _row('VAT (included)', s.money(cart.tax)),
                        const SizedBox(height: 6),
                        Row(children: [
                          const Text('Total', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: kInk)),
                          const Spacer(),
                          Text(s.money(cart.total), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: kBlue)),
                        ]),
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PaymentScreen())),
                          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56), backgroundColor: kGreen),
                          icon: const Icon(Icons.payments_outlined),
                          label: const Text('Take payment'),
                        ),
                      ]),
                    ),
                  ),
                ),
        );
      },
    );
  }

  static Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(children: [
          Text(label, style: const TextStyle(fontSize: 15, color: kMuted)),
          const Spacer(),
          Text(value, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: kInk)),
        ]),
      );
}

class _LineCard extends StatelessWidget {
  const _LineCard({required this.line});

  final CartLine line;

  void _set(BuildContext context, double qty) {
    final problem = Cart.I.setQty(line, qty);
    if (problem != null) showProblem(context, problem);
  }

  Future<void> _typeQty(BuildContext context) async {
    final weighed = line.product.soldByWeight;
    var value = '';
    final qty = await showModalBottomSheet<double>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(line.product.name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              Text(weighed ? 'Weight in kg' : 'Quantity', style: const TextStyle(color: kMuted)),
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(color: kBg, borderRadius: BorderRadius.circular(14)),
                child: Text(value.isEmpty ? qtyText(line.qty) : value,
                    style: TextStyle(fontSize: 32, fontWeight: FontWeight.w800, color: value.isEmpty ? kMuted : kInk)),
              ),
              const SizedBox(height: 12),
              SizedBox(height: 260, child: NumberPad(allowDecimal: weighed, onKey: (k) => setState(() => value = applyKey(value, k, decimals: weighed ? 3 : 0)))),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: value.isEmpty ? null : () => Navigator.pop(context, double.tryParse(value) ?? 0),
                child: const Text('Set'),
              ),
            ]),
          ),
        ),
      ),
    );
    if (qty != null && context.mounted) _set(context, qty);
  }

  @override
  Widget build(BuildContext context) {
    final s = AppState.I;
    final weighed = line.product.soldByWeight;
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 6, 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          // Name and unit price on top; quantity and the line's total below.
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(line.product.name, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: kInk)),
                  const SizedBox(height: 2),
                  Text('${s.money(line.price)}${weighed ? ' per kg' : ' each'}', style: const TextStyle(fontSize: 13.5, color: kMuted)),
                ]),
              ),
            ),
            IconButton(
              tooltip: 'Remove ${line.product.name}',
              onPressed: () => Cart.I.remove(line),
              icon: const Icon(Icons.delete_outline, color: kRed),
            ),
          ]),
          const SizedBox(height: 8),
          Row(children: [
            if (weighed)
              OutlinedButton(onPressed: () => _typeQty(context), child: Text('${qtyText(line.qty)} kg'))
            else
              _Stepper(
                qty: line.qty,
                onMinus: () => _set(context, line.qty - 1),
                onPlus: () => _set(context, line.qty + 1),
                onTapQty: () => _typeQty(context),
              ),
            const Spacer(),
            Text(s.money(line.total), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: kInk)),
            const SizedBox(width: 10),
          ]),
        ]),
      ),
    );
  }
}

class _Stepper extends StatelessWidget {
  const _Stepper({required this.qty, required this.onMinus, required this.onPlus, required this.onTapQty});

  final double qty;
  final VoidCallback onMinus, onPlus, onTapQty;

  @override
  Widget build(BuildContext context) {
    Widget button(IconData icon, String label, VoidCallback onTap) => Material(
          color: kBg,
          borderRadius: BorderRadius.circular(12),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: onTap,
            child: SizedBox(width: 42, height: 42, child: Icon(icon, size: 22, color: kInk, semanticLabel: label)),
          ),
        );
    return Row(mainAxisSize: MainAxisSize.min, children: [
      button(Icons.remove, 'One less', onMinus),
      InkWell(
        onTap: onTapQty,
        child: SizedBox(
          width: 44,
          child: Text(qtyText(qty), textAlign: TextAlign.center, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
        ),
      ),
      button(Icons.add, 'One more', onPlus),
    ]);
  }
}
