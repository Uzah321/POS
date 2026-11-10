import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/models.dart';
import '../printing/printer.dart';
import '../printing/receipt.dart';
import 'theme.dart';

/// After the sale: the change to hand back, and the receipt printing.
class DoneScreen extends StatefulWidget {
  const DoneScreen({super.key, required this.sale, required this.method, this.tendered, this.change});

  final Map<String, dynamic> sale;
  final String method;

  /// In the till's currency.
  final double? tendered, change;

  @override
  State<DoneScreen> createState() => _DoneScreenState();
}

enum _Print { idle, printing, done, failed }

class _DoneScreenState extends State<DoneScreen> {
  late final Receipt _receipt = Receipt.fromSale(widget.sale, tendered: widget.tendered, change: widget.change, paymentMethod: widget.method);
  _Print _state = _Print.idle;
  String? _problem;
  Uint8List? _bytes;

  @override
  void initState() {
    super.initState();
    if (AppState.I.autoPrint && Printer.supported) _print();
  }

  Future<void> _print() async {
    setState(() {
      _state = _Print.printing;
      _problem = null;
    });
    try {
      _bytes = await Printer.printReceipt(_receipt);
      if (mounted) setState(() => _state = _Print.done);
    } on PrintException catch (e) {
      if (mounted) {
        setState(() {
          _state = _Print.failed;
          _problem = e.message;
        });
      }
    }
  }

  void _view() {
    final bytes = _bytes ?? Printer.bytesFor(_receipt);
    showReceiptPreview(context, bytes);
  }

  @override
  Widget build(BuildContext context) {
    final s = AppState.I;
    final total = toDouble(widget.sale['total']);
    final order = text(widget.sale['order_number']) ?? text(widget.sale['id']);
    final change = widget.change;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Spacer(),
            const Center(
              child: CircleAvatar(radius: 44, backgroundColor: Color(0xFFDDF5EC), child: Icon(Icons.check_rounded, size: 56, color: kGreen)),
            ),
            const SizedBox(height: 16),
            const Text('Sale complete', textAlign: TextAlign.center, style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: kInk)),
            const SizedBox(height: 4),
            Text([if (order != null) 'Order #$order', text(widget.sale['reference'])].whereType<String>().join('  ·  '),
                textAlign: TextAlign.center, style: const TextStyle(fontSize: 14.5, color: kMuted)),
            const SizedBox(height: 24),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: change != null && change > 0.004
                    ? Column(children: [
                        const Text('Change to give', style: TextStyle(fontSize: 16, color: kMuted)),
                        Text(s.moneyActive(change), style: const TextStyle(fontSize: 46, fontWeight: FontWeight.w800, color: kGreen)),
                        Text('Paid ${s.moneyActive(widget.tendered ?? 0)} for ${s.money(total)}', style: const TextStyle(fontSize: 14, color: kMuted)),
                      ])
                    : Column(children: [
                        Text(widget.method == 'cash' ? 'Paid in cash' : widget.method == 'card' ? 'Paid by card' : 'Paid by mobile money',
                            style: const TextStyle(fontSize: 16, color: kMuted)),
                        Text(s.money(total), style: const TextStyle(fontSize: 40, fontWeight: FontWeight.w800, color: kInk)),
                        if (change != null) const Text('No change', style: TextStyle(fontSize: 14, color: kMuted)),
                      ]),
              ),
            ),
            const SizedBox(height: 16),
            _printRow(),
            const Spacer(),
            FilledButton.icon(
              onPressed: () => Navigator.of(context).popUntil((route) => route.isFirst),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(58)),
              icon: const Icon(Icons.add_shopping_cart),
              label: const Text('New sale', style: TextStyle(fontSize: 18)),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _printRow() {
    final (IconData icon, Color colour, String label) = switch (_state) {
      _Print.printing => (Icons.print_outlined, kBlue, _receipt.fiscalPendingId != null ? 'Fiscalising and printing the receipt…' : 'Printing the receipt…'),
      _Print.done => (Icons.check_circle_outline, kGreen, 'Receipt printed'),
      _Print.failed => (Icons.print_disabled_outlined, kRed, _problem ?? 'The receipt did not print.'),
      _Print.idle => (Icons.receipt_long_outlined, kMuted, Printer.supported ? 'Receipt not printed' : 'No printer on this device'),
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            if (_state == _Print.printing)
              const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4))
            else
              Icon(icon, color: colour),
            const SizedBox(width: 12),
            Expanded(child: Text(label, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: colour))),
          ]),
          const SizedBox(height: 8),
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            TextButton.icon(onPressed: _view, icon: const Icon(Icons.visibility_outlined), label: const Text('View receipt')),
            if (Printer.supported && _state != _Print.printing)
              TextButton.icon(
                onPressed: _print,
                icon: const Icon(Icons.print_outlined),
                label: Text(_state == _Print.done ? 'Print again' : 'Print'),
              ),
          ]),
        ]),
      ),
    );
  }
}

/// The receipt on screen, line for line as the printer prints it.
void showReceiptPreview(BuildContext context, Uint8List bytes) {
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      builder: (context, scroll) => SingleChildScrollView(
        controller: scroll,
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        child: Center(
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: const Color(0xFFFFFDF7), border: Border.all(color: kLine), borderRadius: BorderRadius.circular(6)),
            child: SelectableText(
              escPosToText(bytes),
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5, height: 1.35, color: kInk),
            ),
          ),
        ),
      ),
    ),
  );
}
