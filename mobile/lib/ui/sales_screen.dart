import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/app_state.dart';
import '../core/models.dart';
import '../printing/printer.dart';
import '../printing/receipt.dart';
import 'done_screen.dart' show showReceiptPreview;
import 'theme.dart';
import 'widgets.dart';

/// Today's sales at this branch (since the last Day End), to look up or reprint.
class SalesScreen extends StatefulWidget {
  const SalesScreen({super.key});

  @override
  State<SalesScreen> createState() => _SalesScreenState();
}

class _SalesScreenState extends State<SalesScreen> {
  List<Map<String, dynamic>> _sales = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final body = await AppState.I.api.get('/sales', query: {'per_page': 50, 'since_day_end': 1});
      _sales = Api.list(body);
    } on ApiException catch (e) {
      if (e.sessionEnded) {
        await AppState.I.sessionEnded();
        return;
      }
      _error = e.message;
    }
    if (mounted) setState(() => _loading = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Recent sales'), actions: [IconButton(tooltip: 'Refresh', onPressed: _load, icon: const Icon(Icons.refresh))]),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: kMuted, fontSize: 16))))
              : _sales.isEmpty
                  ? const Center(child: Text('No sales since the last Day End.', style: TextStyle(color: kMuted, fontSize: 16)))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(12),
                        itemCount: _sales.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 8),
                        itemBuilder: (context, i) => _SaleTile(sale: _sales[i]),
                      ),
                    ),
    );
  }
}

String _time(Object? iso) {
  final dt = DateTime.tryParse('${iso ?? ''}')?.toLocal();
  if (dt == null) return '';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(dt.hour)}:${two(dt.minute)}';
}

class _SaleTile extends StatelessWidget {
  const _SaleTile({required this.sale});

  final Map<String, dynamic> sale;

  @override
  Widget build(BuildContext context) {
    final s = AppState.I;
    final status = text(sale['status']) ?? 'completed';
    final voided = status == 'voided' || status == 'cancelled';
    final order = text(sale['order_number']) ?? text(sale['id']);
    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        leading: CircleAvatar(
          backgroundColor: voided ? const Color(0xFFFDECEC) : const Color(0xFFE8F0FF),
          child: Icon(voided ? Icons.block : Icons.receipt_long_outlined, color: voided ? kRed : kBlue),
        ),
        title: Text('Order #$order', style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text([_time(sale['completed_at'] ?? sale['created_at']), if (status != 'completed') status].join('  ·  ')),
        trailing: Text(s.money(toDouble(sale['total'])),
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: voided ? kMuted : kInk, decoration: voided ? TextDecoration.lineThrough : null)),
        onTap: () => _open(context),
      ),
    );
  }

  void _open(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => _SaleSheet(saleId: toInt(sale['id']) ?? 0),
    );
  }
}

class _SaleSheet extends StatefulWidget {
  const _SaleSheet({required this.saleId});

  final int saleId;

  @override
  State<_SaleSheet> createState() => _SaleSheetState();
}

class _SaleSheetState extends State<_SaleSheet> {
  Map<String, dynamic>? _sale;
  String? _error;
  bool _printing = false;

  @override
  void initState() {
    super.initState();
    AppState.I.api.get('/sales/${widget.saleId}/receipt').then((body) {
      if (mounted) setState(() => _sale = asMap(Api.data(body)));
    }, onError: (Object e) {
      if (mounted) setState(() => _error = '$e');
    });
  }

  Future<void> _reprint() async {
    setState(() => _printing = true);
    try {
      await Printer.printReceipt(Receipt.fromSale(_sale!));
      if (mounted) showNote(context, 'Receipt printed');
    } on PrintException catch (e) {
      if (mounted) showProblem(context, e.message);
    }
    if (mounted) setState(() => _printing = false);
  }

  @override
  Widget build(BuildContext context) {
    final s = AppState.I;
    final sale = _sale;
    if (sale == null) {
      return SizedBox(
        height: 220,
        child: Center(child: _error != null ? Text(_error!, style: const TextStyle(color: kRed)) : const CircularProgressIndicator()),
      );
    }
    final items = (sale['items'] is List ? sale['items'] as List : const []).map(asMap).toList();
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Order #${text(sale['order_number']) ?? sale['id']}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          Text('${text(sale['reference']) ?? ''}  ·  ${text(asMap(sale['cashier'])['name']) ?? ''}', style: const TextStyle(color: kMuted)),
          const SizedBox(height: 12),
          ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.4),
            child: ListView(shrinkWrap: true, children: [
              for (final item in items)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(children: [
                    Expanded(child: Text('${qtyText(toDouble(item['quantity']))} × ${text(asMap(item['product'])['name']) ?? text(item['name']) ?? 'Item'}', style: const TextStyle(fontSize: 15))),
                    Text(s.money(toDoubleOrNull(item['total']) ?? toDouble(item['quantity']) * toDouble(item['unit_price'])), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                  ]),
                ),
            ]),
          ),
          const Divider(height: 20),
          Row(children: [
            const Text('Total', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const Spacer(),
            Text(s.money(toDouble(sale['total'])), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: kBlue)),
          ]),
          const SizedBox(height: 16),
          Row(children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => showReceiptPreview(context, Printer.bytesFor(Receipt.fromSale(sale))),
                icon: const Icon(Icons.visibility_outlined),
                label: const Text('View'),
              ),
            ),
            if (Printer.supported) ...[
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: _printing ? null : _reprint,
                  icon: _printing
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white))
                      : const Icon(Icons.print_outlined),
                  label: const Text('Reprint'),
                ),
              ),
            ],
          ]),
        ]),
      ),
    );
  }
}
