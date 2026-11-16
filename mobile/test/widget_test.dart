import 'dart:typed_data';

import 'package:core_pos/core/app_state.dart';
import 'package:core_pos/core/models.dart';
import 'package:core_pos/printing/receipt.dart';
import 'package:core_pos/ui/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

Receipt _receipt({String? qrUrl, int? globalNo, String symbol = r'$', String code = 'USD', double rate = 1}) => Receipt(
      storeName: 'Msilisi Stationers',
      address: '12 Main Street, Bulawayo',
      reference: 'SALE-ABC123',
      cashier: 'Jane',
      date: DateTime(2026, 11, 10, 18, 3, 5),
      items: const [
        ReceiptItem(name: '72 Page Exercise Book Big', qty: 2, price: 0.5, total: 1.0, code: '6001234567890'),
        ReceiptItem(name: 'Ruler 30cm — clear', qty: 1, price: 0.75, total: 0.75),
      ],
      subtotal: 1.75,
      tax: 0,
      discount: 0,
      total: 1.75,
      paymentMethod: 'cash',
      tendered: 2,
      change: 0.25,
      currencySymbol: symbol,
      currencyCode: code,
      rate: rate,
      orderNum: '42',
      qrUrl: qrUrl,
      receiptGlobalNo: globalNo,
      verificationCode: globalNo == null ? null : 'ABCD-EF12',
    );

void main() {
  test('money and quantities read the way people write them', () {
    expect(grouped(1234.5), '1,234.50');
    expect(grouped(0.4), '0.40');
    expect(grouped(-1234567.891), '-1,234,567.89');
    expect(qtyText(2), '2');
    expect(qtyText(1.25), '1.25');
    expect(qtyText(0.375), '0.375');
  });

  test('keypad entry keeps one point and two decimals', () {
    var v = '';
    for (final k in ['1', '2', '.', '5', '0', '7']) {
      v = applyKey(v, k);
    }
    expect(v, '12.50');
    expect(applyKey('12.5', '.'), '12.5');
    expect(applyKey('', '.'), '0.');
    expect(applyKey('0', '5'), '5');
    expect(applyKey('12', 'back'), '1');
    expect(applyKey('3', '.', decimals: 0), '3');
  });

  test('server addresses are tidied up', () {
    expect(AppState.normaliseServer('msilisi.mycorre.com'), 'https://msilisi.mycorre.com');
    expect(AppState.normaliseServer('https://msilisi.mycorre.com/api/'), 'https://msilisi.mycorre.com');
    expect(AppState.normaliseServer('192.168.1.10:8080'), 'http://192.168.1.10:8080');
    expect(AppState.normaliseServer('  '), defaultServer);
  });

  test('a receipt prints as 58 mm ESC/POS with the sale on it', () {
    final bytes = buildEscPos(_receipt());
    expect(bytes.sublist(0, 2), [0x1b, 0x40], reason: 'starts by resetting the printer');
    expect(bytes.sublist(bytes.length - 4), [0x1d, 0x56, 0x42, 0x00], reason: 'ends with the paper cut');
    final text = escPosToText(bytes);
    expect(text, contains('Msilisi Stationers'.substring(0, 15)));
    expect(text, contains('Order Num : 42'));
    expect(text, contains('Tax Inv No : SALE-ABC123'));
    expect(text, contains('10/11/2026'));
    expect(text, contains('72 Page Exercise Book Big'));
    expect(text, contains(r'  2 X  $0.50'));
    expect(text, contains('Ruler 30cm - clear'), reason: 'non-ASCII dashes become plain ones');
    expect(text, contains('CHANGE'));
    for (final line in text.split('\n')) {
      expect(line.length, lessThanOrEqualTo(32), reason: 'every line fits a 58 mm roll: "$line"');
    }
  });

  test('every amount on a receipt carries its currency symbol', () {
    final rand = escPosToText(buildEscPos(_receipt(symbol: 'R', code: 'ZAR', rate: 18)));
    expect(rand, contains('  2 X  R9.00'));
    expect(rand, matches(RegExp(r'TOTAL +R31\.50')));
    expect(rand, matches(RegExp(r'TENDERED +R2\.00')));
    expect(rand, matches(RegExp(r'CHANGE +R0\.25')));

    // Amounts in the millions: a line too long for the roll puts its total on the next line.
    final zig = escPosToText(buildEscPos(_receipt(symbol: 'ZiG', code: 'ZWG', rate: 2680000)));
    expect(zig, contains('  2 X  ZiG1340000.00\n'));
    expect(zig, contains('${' ' * 19}ZiG2680000.00'));
    for (final line in zig.split('\n')) {
      expect(line.length, lessThanOrEqualTo(32), reason: 'every line fits a 58 mm roll: "$line"');
    }

    // A symbol the printer can't print goes as the currency's code.
    final euro = escPosToText(buildEscPos(_receipt(symbol: '€', code: 'EUR')));
    expect(euro, contains('  2 X  EUR 0.50'));
    expect(euro, isNot(contains('?')));
  });

  test('a fiscalised receipt carries its QR code and verification code', () {
    final bytes = buildEscPos(_receipt(qrUrl: 'https://fdms.zimra.co.zw/receipt?x=1', globalNo: 77));
    final text = escPosToText(bytes);
    expect(text, contains('[QR code]'));
    expect(text, contains('ABCD-EF12'));
    expect(text, contains('Rec No : 77'));
    expect(qrRaster('https://fdms.zimra.co.zw/receipt?x=1'), isA<Uint8List>());
  });
}
