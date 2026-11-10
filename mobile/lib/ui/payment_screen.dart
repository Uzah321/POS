import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/app_state.dart';
import '../core/cart.dart';
import '../core/catalog.dart';
import '../core/models.dart';
import 'done_screen.dart';
import 'theme.dart';
import 'till_screen.dart' show chooseTill;
import 'widgets.dart';

const _methods = [
  ('cash', 'Cash', Icons.payments_outlined),
  ('card', 'Card', Icons.credit_card),
  ('mobile_money', 'Mobile money', Icons.phone_android),
];

/// How the customer pays, how much cash they handed over, and the sale goes through.
class PaymentScreen extends StatefulWidget {
  const PaymentScreen({super.key});

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  String _method = 'cash';
  String _tendered = '';
  bool _busy = false;

  double get _due => double.parse(AppState.I.toActive(Cart.I.total).toStringAsFixed(2));
  double? get _cash => double.tryParse(_tendered);
  bool get _ready => _method != 'cash' || (_cash != null && _cash! + 0.0001 >= _due);

  /// Exact, then the next round amounts a customer is likely to hand over.
  List<double> _quickAmounts() {
    final due = _due;
    final out = <double>[due];
    for (final step in const [1.0, 5.0, 10.0, 20.0, 50.0, 100.0, 500.0, 1000.0]) {
      final up = (due / step).ceil() * step;
      if (up > due + 0.001 && !out.contains(up)) out.add(up);
      if (out.length == 4) break;
    }
    return out;
  }

  Future<void> _complete() async {
    final s = AppState.I;
    final cart = Cart.I;
    if (cart.isEmpty || !_ready || _busy) return;
    if (s.needsTill) {
      await chooseTill(context);
      if (s.needsTill || !mounted) return;
    }
    setState(() => _busy = true);
    final payload = {
      'branch_id': s.branchId,
      'register_id': s.tillId,
      'customer_id': null,
      'items': [
        for (final l in cart.lines)
          {
            'product_id': l.product.id,
            'quantity': l.qty,
            'unit_price': l.price,
            'discount_type': null,
            'discount_value': 0,
          },
      ],
      // Amounts go to the server in the base currency, whatever the till shows.
      'payments': [
        {'method': _method, 'amount': cart.total},
      ],
      'discount_value': 0,
    };
    try {
      final body = await s.api.post('/sales', body: payload, timeout: const Duration(seconds: 60));
      final sale = asMap(Api.data(body));
      final due = _due;
      final tendered = _method == 'cash' ? _cash : null;
      cart.clear();
      Catalog.I.load(); // stock just changed
      if (!mounted) return;
      await Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => DoneScreen(sale: sale, method: _method, tendered: tendered, change: tendered == null ? null : tendered - due)),
        (route) => route.isFirst,
      );
    } on ApiException catch (e) {
      if (e.sessionEnded) {
        await s.sessionEnded();
        return;
      }
      if (!mounted) return;
      setState(() => _busy = false);
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          icon: const Icon(Icons.error_outline, color: kRed, size: 36),
          title: const Text('The sale did not go through'),
          content: Text('${e.message}\n\nNothing was charged. The sale is still here — try again.', style: const TextStyle(fontSize: 15)),
          actions: [FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(80, 44)), onPressed: () => Navigator.pop(context), child: const Text('OK'))],
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: AppState.I,
      builder: (context, _) {
        final s = AppState.I;
        final due = _due;
        final cash = _cash;
        return Scaffold(
          appBar: AppBar(title: const Text('Payment')),
          body: SafeArea(
            child: Column(children: [
              Container(
                width: double.infinity,
                color: Colors.white,
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    const Text('Total due', style: TextStyle(fontSize: 15, color: kMuted)),
                    const Spacer(),
                    if (s.currencies.length > 1)
                      Wrap(spacing: 6, children: [
                        for (final c in s.currencies)
                          ChoiceChip(
                            label: Text(c.code),
                            selected: c.code == s.currency.code,
                            showCheckmark: false,
                            visualDensity: VisualDensity.compact,
                            onSelected: _busy
                                ? null
                                : (_) => setState(() {
                                      s.currency = c;
                                      _tendered = '';
                                    }),
                          ),
                      ]),
                  ]),
                  Text(s.moneyActive(due), style: const TextStyle(fontSize: 38, fontWeight: FontWeight.w800, color: kInk)),
                ]),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
                child: Row(children: [
                  for (final (value, label, icon) in _methods)
                    Expanded(
                      child: Padding(
                        padding: EdgeInsets.only(right: value == _methods.last.$1 ? 0 : 8),
                        child: _MethodButton(
                          label: label,
                          icon: icon,
                          selected: _method == value,
                          onTap: _busy ? null : () => setState(() => _method = value),
                        ),
                      ),
                    ),
                ]),
              ),
              if (_method == 'cash') ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
                  child: Container(
                    padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: kBlue, width: 2)),
                    child: Row(children: [
                      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        const Text('Cash received', style: TextStyle(fontSize: 13, color: kMuted)),
                        Text(
                          cash == null
                              ? 'Enter the amount'
                              : cash + 0.0001 >= due
                                  ? 'Change ${s.moneyActive(cash - due)}'
                                  : 'Short by ${s.moneyActive(due - cash)}',
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: cash == null ? kMuted : cash + 0.0001 >= due ? kGreen : kAmber,
                          ),
                        ),
                      ]),
                      const Spacer(),
                      Text(_tendered.isEmpty ? '0.00' : _tendered,
                          style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800, color: _tendered.isEmpty ? kLine : kInk)),
                    ]),
                  ),
                ),
                SizedBox(
                  height: 54,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
                    children: [
                      for (final (i, amount) in _quickAmounts().indexed)
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ActionChip(
                            label: Text(i == 0 ? 'Exact' : s.moneyActive(amount)),
                            labelStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: kBlue),
                            backgroundColor: Colors.white,
                            side: const BorderSide(color: kLine),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            onPressed: _busy ? null : () => setState(() => _tendered = amount.toStringAsFixed(2)),
                          ),
                        ),
                    ],
                  ),
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                    child: NumberPad(onKey: (k) {
                      if (!_busy) setState(() => _tendered = applyKey(_tendered, k));
                    }),
                  ),
                ),
              ] else
                Expanded(
                  child: Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        _method == 'card'
                            ? 'Take ${s.moneyActive(due)} on the card machine, then tap Complete sale.'
                            : 'Take ${s.moneyActive(due)} by mobile money (e.g. EcoCash), then tap Complete sale.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 17, color: kMuted, height: 1.4),
                      ),
                    ),
                  ),
                ),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                child: FilledButton(
                  onPressed: _ready && !_busy ? _complete : null,
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(58), backgroundColor: kGreen),
                  child: _busy
                      ? const SizedBox(width: 26, height: 26, child: CircularProgressIndicator(strokeWidth: 2.8, color: Colors.white))
                      : Text(_method == 'cash' && cash == null ? 'Enter cash received' : 'Complete sale', style: const TextStyle(fontSize: 18)),
                ),
              ),
            ]),
          ),
        );
      },
    );
  }
}

class _MethodButton extends StatelessWidget {
  const _MethodButton({required this.label, required this.icon, required this.selected, required this.onTap});

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? kBlue : Colors.white,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          height: 64,
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(14), border: Border.all(color: selected ? kBlue : kLine, width: 1.5)),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Icon(icon, color: selected ? Colors.white : kInk),
            const SizedBox(height: 3),
            Text(label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: selected ? Colors.white : kInk)),
          ]),
        ),
      ),
    );
  }
}
