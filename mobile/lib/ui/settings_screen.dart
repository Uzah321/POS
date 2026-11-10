import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/catalog.dart';
import '../printing/printer.dart';
import '../printing/receipt.dart';
import 'done_screen.dart' show showReceiptPreview;
import 'theme.dart';
import 'till_screen.dart' show chooseTill, signOutWithCheck;
import 'widgets.dart';

const appVersion = '1.0.2';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  PrinterStatus? _printer;
  bool _testing = false;

  @override
  void initState() {
    super.initState();
    _checkPrinter();
  }

  Future<void> _checkPrinter() async {
    final st = await Printer.status();
    if (mounted) setState(() => _printer = st);
  }

  Future<void> _testPrint() async {
    setState(() => _testing = true);
    try {
      await Printer.printBytes(Printer.bytesFor(Receipt.test()));
      if (mounted) showNote(context, 'Test receipt sent to the printer');
    } on PrintException catch (e) {
      if (mounted) showProblem(context, e.message);
    }
    await _checkPrinter();
    if (mounted) setState(() => _testing = false);
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: AppState.I,
      builder: (context, _) {
        final s = AppState.I;
        final printer = _printer;
        return Scaffold(
          appBar: AppBar(title: const Text('Settings')),
          body: ListView(padding: const EdgeInsets.fromLTRB(12, 0, 12, 24), children: [
            Section(title: 'Receipt printer', children: [
              ListTile(
                leading: Icon(
                  printer == null ? Icons.print_outlined : printer.canPrint ? Icons.check_circle : Icons.print_disabled_outlined,
                  color: printer == null ? kMuted : printer.canPrint ? kGreen : kRed,
                ),
                title: Text(printer == null ? 'Checking the printer…' : Printer.supported ? printer.label : 'No printer in this browser',
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: printer?.sunmi == true
                    ? const Text('Sunmi built-in printer')
                    : printer?.rawbt == true
                        ? const Text('Receipts go to RawBT, which prints them')
                        : const Text('Sunmi handhelds are found automatically. On other handhelds install RawBT.'),
                trailing: IconButton(tooltip: 'Check again', onPressed: _checkPrinter, icon: const Icon(Icons.refresh)),
              ),
              const Divider(),
              SwitchListTile(
                value: s.autoPrint,
                onChanged: s.setAutoPrint,
                title: const Text('Print a receipt after every sale'),
                secondary: const Icon(Icons.receipt_long_outlined),
              ),
              const Divider(),
              ListTile(
                leading: const Icon(Icons.print_outlined),
                title: const Text('Print a test receipt'),
                trailing: _testing ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4)) : const Icon(Icons.chevron_right),
                onTap: _testing ? null : _testPrint,
              ),
              const Divider(),
              ListTile(
                leading: const Icon(Icons.visibility_outlined),
                title: const Text('See the test receipt on screen'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => showReceiptPreview(context, Printer.bytesFor(Receipt.test())),
              ),
            ]),
            Section(title: 'Till', children: [
              ListTile(
                leading: const Icon(Icons.point_of_sale),
                title: Text(s.tillName ?? (s.activeTills.isEmpty ? 'Branch till' : 'Not chosen yet')),
                subtitle: Text(s.activeTills.length > 1 ? 'This branch has ${s.activeTills.length} tills' : 'Sales go to ${s.branchName.isEmpty ? 'this branch' : s.branchName}'),
                trailing: s.activeTills.length > 1 ? TextButton(onPressed: () => chooseTill(context), child: const Text('Change')) : null,
              ),
              const Divider(),
              ListTile(
                leading: const Icon(Icons.currency_exchange),
                title: Text('${s.currency.code} · ${s.currency.name}'),
                subtitle: const Text('Prices show and cash is taken in this currency'),
                trailing: s.currencies.length > 1
                    ? PopupMenuButton<String>(
                        onSelected: (code) => s.currency = s.currencies.firstWhere((c) => c.code == code),
                        itemBuilder: (context) => [for (final c in s.currencies) PopupMenuItem(value: c.code, child: Text('${c.code} · ${c.name}'))],
                        child: const Padding(padding: EdgeInsets.all(8), child: Text('Change', style: TextStyle(color: kBlue, fontWeight: FontWeight.w600))),
                      )
                    : null,
              ),
              const Divider(),
              ListTile(
                leading: const Icon(Icons.sync),
                title: const Text('Update products and settings'),
                onTap: () async {
                  await Future.wait([Catalog.I.load(), s.refresh().catchError((_) {})]);
                  if (context.mounted) showNote(context, 'Updated');
                },
              ),
            ]),
            Section(title: 'Account', children: [
              ListTile(
                leading: const Icon(Icons.person_outline),
                title: Text(s.userName),
                subtitle: Text([if (s.roles.isNotEmpty) s.roles.join(', '), if (s.branchName.isNotEmpty) s.branchName].join(' · ')),
              ),
              const Divider(),
              ListTile(leading: const Icon(Icons.dns_outlined), title: const Text('Server'), subtitle: Text(s.server)),
              const Divider(),
              ListTile(
                leading: const Icon(Icons.logout, color: kRed),
                title: const Text('Sign out', style: TextStyle(color: kRed, fontWeight: FontWeight.w600)),
                onTap: () => signOutWithCheck(context),
              ),
            ]),
            const Padding(
              padding: EdgeInsets.only(top: 20),
              child: Text('Core POS for Android · version $appVersion', textAlign: TextAlign.center, style: TextStyle(color: kMuted, fontSize: 13)),
            ),
          ]),
        );
      },
    );
  }
}
