// The customer's receipt: read from a sale the way the web till reads it
// (frontend/src/lib/hardware/printer.ts — buildReceiptDataFromSale and
// buildEscPosReceipt), laid out as ESC/POS for a 58 mm roll, so the app's
// receipts match the ones the shop's other printers produce.
import 'dart:convert';
import 'dart:typed_data';

import 'package:image/image.dart' as img;
import 'package:qr/qr.dart';

import '../core/api.dart';
import '../core/app_state.dart';
import '../core/models.dart';

class ReceiptItem {
  const ReceiptItem({required this.name, required this.qty, required this.price, required this.total, this.code});

  final String name;
  final double qty;
  final double price;
  final double total;
  final String? code;
}

class Receipt {
  Receipt({
    required this.storeName,
    required this.reference,
    required this.cashier,
    required this.date,
    required this.items,
    required this.subtotal,
    required this.tax,
    required this.discount,
    required this.total,
    required this.paymentMethod,
    required this.currencySymbol,
    required this.currencyCode,
    required this.rate,
    this.address,
    this.phone,
    this.email,
    this.vatNumber,
    this.tinNumber,
    this.logo,
    this.footer,
    this.branchName,
    this.orderNum,
    this.restaurant = false,
    this.customerName,
    this.tableNumber,
    this.tendered,
    this.change,
    this.deviceId,
    this.fiscalDay,
    this.recGn,
    this.rec68,
    this.verificationCode,
    this.qrUrl,
    this.receiptGlobalNo,
    this.fiscalDeviceId,
    this.fiscalDayNo,
    this.fiscalPendingId,
    this.fiscalTitle = true,
  });

  final String storeName;

  /// false: "FISCAL TAX INVOICE" is left off the top and bottom (Settings, for a
  /// shop that isn't fiscalised). A receipt ZIMRA has fiscalised keeps it anyway.
  final bool fiscalTitle;
  bool get showsFiscalTitle => fiscalTitle || fiscalised;
  final String? address, phone, email, vatNumber, tinNumber, logo, footer;
  final String reference, cashier;
  final DateTime? date;
  final String? branchName, orderNum, customerName, tableNumber;
  final bool restaurant;
  final List<ReceiptItem> items;

  /// Base currency.
  final double subtotal, tax, discount, total;
  final String paymentMethod;

  /// In the till's currency, as the cashier entered it.
  final double? tendered, change;
  final String currencySymbol, currencyCode;
  final double rate;

  // Fiscal identifiers typed into Settings (printed until a real fiscal result exists).
  final String? deviceId, fiscalDay, recGn, rec68;

  // The real ZIMRA result for this sale.
  String? verificationCode, qrUrl;
  int? receiptGlobalNo, fiscalDeviceId, fiscalDayNo;
  int? fiscalPendingId;

  bool get fiscalised => receiptGlobalNo != null || verificationCode != null;

  void applyFiscal(Map<String, dynamic> fr) {
    final qrData = text(fr['qr_data']);
    verificationCode = qrData == null ? null : RegExp(r'.{1,4}').allMatches(qrData).map((m) => m.group(0)).join('-');
    qrUrl = text(fr['qr_code_url']);
    receiptGlobalNo = toInt(fr['receipt_global_no']);
    fiscalDeviceId = toInt(fr['device_id']);
    fiscalDayNo = toInt(fr['fiscal_day_no']);
    fiscalPendingId = fr['provider'] == 'gofiscal' && fr['status'] == 'pending' ? toInt(fr['id']) : null;
  }

  /// A sale's receipt, as the server returned it (after the sale, or from /sales/{id}/receipt).
  factory Receipt.fromSale(Map<String, dynamic> sale, {double? tendered, double? change, String? paymentMethod}) {
    final s = AppState.I;
    final settings = s.settings;
    final branch = asMap(sale['branch']);
    final items = (sale['items'] is List ? sale['items'] as List : const []).map((raw) {
      final item = asMap(raw);
      final product = asMap(item['product']);
      final qty = toDouble(item['quantity'] ?? item['qty']);
      final price = toDouble(item['unit_price'] ?? item['price']);
      return ReceiptItem(
        name: text(product['name']) ?? text(item['name']) ?? 'Item',
        qty: qty,
        price: price,
        total: toDoubleOrNull(item['total']) ?? toDoubleOrNull(item['subtotal']) ?? qty * price,
        code: text(product['barcode']) ?? text(item['barcode']) ?? text(product['sku']) ?? text(item['sku']),
      );
    }).toList();
    final payments = sale['payments'] is List ? sale['payments'] as List : const [];
    final cur = s.currency;
    final receipt = Receipt(
      storeName: text(settings['company_name']) ?? s.storeName,
      address: text(settings['company_address']) ?? text(branch['address']),
      phone: text(settings['company_phone']) ?? text(branch['phone']),
      email: text(settings['company_email']),
      vatNumber: text(settings['company_vat_number']),
      tinNumber: text(settings['company_tin_number']),
      logo: (text(settings['company_logo']) ?? '').startsWith('data:image') ? text(settings['company_logo']) : null,
      footer: text(settings['receipt_footer']),
      fiscalTitle: _fiscalTitleOn(settings),
      reference: text(sale['reference']) ?? '#${sale['id'] ?? 'SALE'}',
      cashier: text(asMap(sale['cashier'])['name']) ?? s.userName,
      date: DateTime.tryParse('${sale['completed_at'] ?? sale['created_at'] ?? ''}')?.toLocal() ?? DateTime.now(),
      items: items,
      subtotal: toDoubleOrNull(sale['subtotal']) ?? items.fold<double>(0, (sum, i) => sum + i.total),
      tax: toDouble(sale['tax_total'] ?? sale['tax_amount']),
      discount: toDouble(sale['discount_total'] ?? sale['discount_amount'] ?? sale['discount_value']),
      total: toDouble(sale['total']),
      paymentMethod: text(payments.isNotEmpty ? asMap(payments.first)['method'] : null) ?? paymentMethod ?? 'cash',
      tendered: tendered,
      change: change ?? toDoubleOrNull(sale['change_due']),
      currencySymbol: cur.symbol,
      currencyCode: cur.code,
      rate: cur.rate,
      branchName: text(branch['name']) ?? s.branchName,
      orderNum: text(sale['order_number']) ?? text(sale['id']),
      restaurant: sale['business_type'] == 'restaurant',
      customerName: text(asMap(sale['customer'])['name']),
      tableNumber: text(sale['table_number']),
      deviceId: text(settings['fiscal_device_id']),
      fiscalDay: text(settings['fiscal_day']),
      recGn: text(settings['fiscal_rec_gn']),
      rec68: text(settings['fiscal_rec_68']),
    );
    receipt.applyFiscal(asMap(sale['fiscal_receipt']));
    return receipt;
  }

  /// The test receipt from Settings: the shop's details, two made-up lines.
  factory Receipt.test() {
    final s = AppState.I;
    final settings = s.settings;
    final cur = s.currency;
    return Receipt(
      storeName: s.storeName,
      address: text(settings['company_address']),
      phone: text(settings['company_phone']),
      email: text(settings['company_email']),
      vatNumber: text(settings['company_vat_number']),
      tinNumber: text(settings['company_tin_number']),
      logo: (text(settings['company_logo']) ?? '').startsWith('data:image') ? text(settings['company_logo']) : null,
      footer: '*** TEST RECEIPT - NOT A VALID RECEIPT ***',
      fiscalTitle: _fiscalTitleOn(settings),
      reference: 'TEST-001',
      cashier: s.userName,
      date: DateTime.now(),
      items: const [
        ReceiptItem(name: 'Test Item A', qty: 2, price: 10, total: 20),
        ReceiptItem(name: 'Test Item B', qty: 1, price: 15.5, total: 15.5),
      ],
      subtotal: 35.5,
      tax: 0,
      discount: 0,
      total: 35.5,
      paymentMethod: 'cash',
      tendered: 50 * cur.rate,
      change: 14.5 * cur.rate,
      currencySymbol: cur.symbol,
      currencyCode: cur.code,
      rate: cur.rate,
      branchName: s.branchName,
      orderNum: '1',
    );
  }
}

/// A GoFiscal receipt that wasn't through when the sale saved is finished
/// here, just before printing, so the customer's copy carries its
/// verification code and QR. If it still isn't through, the receipt prints
/// without them and the server sends it on later.
Future<void> completeFiscal(Receipt r) async {
  final id = r.fiscalPendingId;
  if (id == null) return;
  try {
    final body = await AppState.I.api.post('/fiscal/gofiscal/receipts/$id/submit', timeout: const Duration(seconds: 55));
    final fr = asMap(Api.data(body));
    if (fr['status'] == 'submitted') r.applyFiscal(fr);
  } catch (_) {
    // Print without it.
  }
  r.fiscalPendingId = null;
}

// ---------------------------------------------------------------------------
// ESC/POS
// ---------------------------------------------------------------------------

const _esc = 0x1b, _gs = 0x1d, _lf = 0x0a;
const _init = [_esc, 0x40];
const _left = [_esc, 0x61, 0x00];
const _center = [_esc, 0x61, 0x01];
const _boldOn = [_esc, 0x45, 0x01];
const _boldOff = [_esc, 0x45, 0x00];
const _doubleOn = [_gs, 0x21, 0x11];
const _sizeOff = [_gs, 0x21, 0x00];
const _tripleOn = [_gs, 0x21, 0x22];
const _cut = [_gs, 0x56, 0x42, 0x00];

/// Receipt printers print single-byte text; anything else becomes its nearest plain-letter form.
List<int> _ascii(String s) {
  const swaps = {'—': '-', '–': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '×': 'x', '…': '...', '•': '*', ' ': ' '};
  final out = <int>[];
  for (final rune in s.runes) {
    final ch = String.fromCharCode(rune);
    if (rune >= 0x20 && rune < 0x7f) {
      out.add(rune);
    } else if (swaps.containsKey(ch)) {
      out.addAll(swaps[ch]!.codeUnits);
    } else {
      const accents = 'àáâãäåèéêëìíîïòóôõöùúûüçñÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇÑ';
      const plain = 'aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN';
      final i = accents.indexOf(ch);
      out.add(i >= 0 ? plain.codeUnitAt(i) : 0x3f);
    }
  }
  return out;
}

String _two(int n) => n.toString().padLeft(2, '0');

/// Settings' "Print FISCAL TAX INVOICE on Receipts" switch: on unless turned off.
bool _fiscalTitleOn(Map<String, dynamic> settings) {
  final v = settings['receipt_fiscal_title'];
  return v != false && v != 'false';
}

/// The receipt as ESC/POS bytes for a [width]-column roll (32 on 58 mm).
Uint8List buildEscPos(Receipt d, {Uint8List? logo, int width = 32}) {
  final w = width;
  final out = BytesBuilder();
  void add(List<int> b) => out.add(b);
  void line([String s = '']) {
    out.add(_ascii(s));
    out.addByte(_lf);
  }

  void divider([String ch = '-']) => line(ch * w);
  String fmt2(double n) => n.toStringAsFixed(2);
  String pad(String l, String r) => l + ' ' * (w - l.length - r.length).clamp(1, w).toInt() + r;
  String cut(String s, int max) => s.length > max ? '${s.substring(0, max - 1)}.' : s;

  final rate = d.rate == 0 ? 1.0 : d.rate;
  final gross = d.total * rate;
  final vat = d.tax * rate;
  final net = d.subtotal > 0 ? d.subtotal * rate : gross - vat;
  final pct = net > 0 && vat > 0 ? (vat / net * 100).toStringAsFixed(1) : '0.0';
  final dt = d.date ?? DateTime.now();
  final dateStr = '${_two(dt.day)}/${_two(dt.month)}/${dt.year}';
  final timeStr = '${_two(dt.hour)}:${_two(dt.minute)}:${_two(dt.second)}';
  final itemCount = d.items.fold<double>(0, (s, i) => s + i.qty);

  add(_init);
  add(_center);
  if (logo != null) {
    add(logo);
    out.addByte(_lf);
  }
  if (d.showsFiscalTitle) {
    add(_boldOn);
    line('***FISCAL TAX INVOICE***');
    add(_boldOff);
    out.addByte(_lf);
  }
  add(_doubleOn);
  line(cut(d.storeName, w ~/ 2));
  add(_sizeOff);
  if (d.branchName != null && d.branchName!.isNotEmpty && d.branchName != d.storeName) {
    add(_boldOn);
    line(cut(d.branchName!, w));
    add(_boldOff);
  }
  for (final seg in (d.address ?? '').split(RegExp(r'[,\n]')).map((s) => s.trim()).where((s) => s.isNotEmpty)) {
    line(cut(seg, w));
  }
  divider();

  // A restaurant calls its orders by number: it goes big, where the customer sees it first.
  if (d.restaurant && d.orderNum != null) {
    add(_boldOn);
    line('ORDER NO.');
    add(_tripleOn);
    line('#${d.orderNum}');
    add(_sizeOff);
    add(_boldOff);
    divider();
  }

  add(_left);
  if (d.orderNum != null && !d.restaurant) {
    add(_boldOn);
    line('Order Num : ${d.orderNum}');
    add(_boldOff);
  }
  line('Tax Inv No : ${d.reference}');
  if (d.customerName != null) line('Customer : ${d.customerName}');
  line('Cashier : ${d.cashier}');
  if (d.tableNumber != null) line('Table : ${d.tableNumber}');
  add(_center);
  line(pad(dateStr, timeStr));
  line('All Prices VAT Inclusive');
  add(_left);
  divider();

  add(_boldOn);
  line('DESCRIPTION');
  add(_boldOff);
  line(pad('QTY', 'PRICE  TOTAL COST'));
  divider();
  for (final item in d.items) {
    if (item.code != null) line(cut(item.code!, w));
    line(cut(item.name, w));
    line(pad('  ${qtyText(item.qty)} X  ${fmt2(item.price * rate)}', fmt2(item.total * rate)));
  }
  divider();

  line(pad('Total Excl', fmt2(net)));
  line(pad('Output Tax ($pct%)', fmt2(vat)));
  add(_boldOn);
  line(pad('Total Incl', fmt2(gross)));
  add(_boldOff);
  divider();
  add(_boldOn);
  line(pad('TOTAL', fmt2(gross)));
  add(_boldOff);
  if (d.tendered != null) line(pad('TENDERED', fmt2(d.tendered!)));
  if (d.change != null && d.change! >= 0) line(pad('CHANGE', fmt2(d.change!)));
  line(pad('ITEM#', qtyText(itemCount)));

  add(_boldOn);
  line('Payment Summary');
  add(_boldOff);
  divider();
  line('${d.paymentMethod.replaceAll('_', ' ').toUpperCase()} ${d.currencyCode}');
  if (d.tendered != null) line('${d.currencySymbol}${fmt2(d.tendered!)} @ Rate ${d.currencySymbol}${rate.toStringAsFixed(6)}');

  divider();
  if (d.phone != null) line('Tel : ${d.phone}');
  if (d.email != null) line('Email : ${d.email}');
  if (d.vatNumber != null) line('VAT No : ${d.vatNumber}');
  if (d.tinNumber != null) line('TIN No : ${d.tinNumber}');
  if (!d.fiscalised) {
    if (d.deviceId != null) line('Device Id : ${d.deviceId}');
    if (d.recGn != null) line('REC GN : ${d.recGn}');
    if (d.rec68 != null) line('REC 68 : ${d.rec68}');
    if (d.fiscalDay != null) line('Fiscal Day : ${d.fiscalDay}');
  } else {
    if (d.fiscalDeviceId != null) line('Device Id : ${d.fiscalDeviceId}');
    if (d.fiscalDayNo != null) line('Fiscal Day : ${d.fiscalDayNo}');
    if (d.receiptGlobalNo != null) line('Rec No : ${d.receiptGlobalNo}');
  }

  out.addByte(_lf);
  add(_center);
  if (d.showsFiscalTitle) {
    add(_boldOn);
    line('FISCAL TAX INVOICE');
    add(_boldOff);
  }
  if (d.fiscalised) {
    final qr = qrRaster(d.qrUrl);
    if (qr != null) {
      add(qr);
      out.addByte(_lf);
    }
    if (d.verificationCode != null) {
      line('Verification code:');
      add(_boldOn);
      line(d.verificationCode!);
      add(_boldOff);
    }
    final host = d.qrUrl == null ? null : Uri.tryParse(d.qrUrl!)?.host;
    if (host != null && host.isNotEmpty) line(cut('Verify at $host', w));
  }
  divider('=');
  line(d.footer ?? 'Core POS');
  add([_lf, _lf, _lf]);
  add(_cut);
  return out.toBytes();
}

/// An image as ESC/POS raster bits (GS v 0): one bit per dot, black where [dark].
Uint8List _raster(int w, int h, bool Function(int x, int y) dark) {
  final rowBytes = (w + 7) ~/ 8;
  final out = Uint8List(8 + rowBytes * h);
  out.setAll(0, [_gs, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, h & 0xff, h >> 8]);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      if (dark(x, y)) out[8 + y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

/// The fiscal QR code as a raster image (more printers take it than the GS ( k QR command): ~25 mm across.
Uint8List? qrRaster(String? url) {
  if (url == null || url.isEmpty) return null;
  try {
    final qr = QrImage(QrCode.fromData(data: url, errorCorrectLevel: QrErrorCorrectLevel.M));
    final n = qr.moduleCount;
    const quiet = 4;
    final scale = (200 ~/ (n + 2 * quiet)).clamp(3, 6).toInt();
    final size = (n + 2 * quiet) * scale;
    return _raster(size, size, (x, y) {
      final row = y ~/ scale - quiet, col = x ~/ scale - quiet;
      return row >= 0 && col >= 0 && row < n && col < n && qr.isDark(row, col);
    });
  } catch (_) {
    return null;
  }
}

final _logoCache = <String, Uint8List?>{};

/// The company logo (Settings → Business Profile) with its blank margins cut
/// off, fitted to the roll's printable width (384 dots on 58 mm) and up to
/// 40 mm tall, enlarged at most 3×. Null when there's no logo or it won't
/// read: a receipt never waits on its logo.
Uint8List? logoRaster(String? dataUrl, {int maxWidth = 384, int maxHeight = 320}) {
  if (dataUrl == null) return null;
  final key = '$maxWidth:${dataUrl.hashCode}:${dataUrl.length}';
  if (_logoCache.containsKey(key)) return _logoCache[key];
  Uint8List? result;
  try {
    final comma = dataUrl.indexOf(',');
    final decoded = img.decodeImage(base64Decode(dataUrl.substring(comma + 1)));
    if (decoded != null) {
      bool dark(img.Pixel p) {
        final a = p.aNormalized.toDouble();
        final lum = 0.299 * p.rNormalized + 0.587 * p.gNormalized + 0.114 * p.bNormalized;
        return a * lum + (1 - a) < 0.5; // on white paper
      }

      var left = decoded.width, right = -1, top = decoded.height, bottom = -1;
      for (var y = 0; y < decoded.height; y++) {
        for (var x = 0; x < decoded.width; x++) {
          if (!dark(decoded.getPixel(x, y))) continue;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          bottom = y;
        }
      }
      if (right >= 0) {
        final crop = img.copyCrop(decoded, x: left, y: top, width: right - left + 1, height: bottom - top + 1);
        final scale = [3.0, maxWidth / crop.width, maxHeight / crop.height].reduce((a, b) => a < b ? a : b);
        final w = (crop.width * scale).round().clamp(1, maxWidth).toInt();
        final h = (crop.height * scale).round().clamp(1, maxHeight).toInt();
        final sized = img.copyResize(crop, width: w, height: h, interpolation: scale < 1 ? img.Interpolation.average : img.Interpolation.linear);
        result = _raster(w, h, (x, y) => dark(sized.getPixel(x, y)));
      }
    }
  } catch (_) {
    result = null;
  }
  if (_logoCache.length > 4) _logoCache.clear();
  _logoCache[key] = result;
  return result;
}

/// The receipt's text, as it will come out of the printer (for the on-screen preview).
String escPosToText(Uint8List b) {
  final out = StringBuffer();
  for (var i = 0; i < b.length; i++) {
    final c = b[i];
    if (c == _gs && i + 2 < b.length && b[i + 1] == 0x76 && b[i + 2] == 0x30) {
      final rowBytes = b[i + 4] + 256 * b[i + 5];
      final h = b[i + 6] + 256 * b[i + 7];
      // The logo comes before any text; the only other picture is the fiscal QR code.
      out.writeln(out.isEmpty ? '[logo]' : '[QR code]');
      i += 7 + rowBytes * h;
    } else if (c == _esc && i + 1 < b.length && b[i + 1] == 0x40) {
      i += 1;
    } else if (c == _esc && i + 1 < b.length && (b[i + 1] == 0x61 || b[i + 1] == 0x45)) {
      i += 2;
    } else if (c == _gs && i + 1 < b.length && b[i + 1] == 0x21) {
      i += 2;
    } else if (c == _gs && i + 1 < b.length && b[i + 1] == 0x56) {
      i += 3;
    } else if (c == _lf) {
      out.write('\n');
    } else if (c >= 0x20 && c < 0x7f) {
      out.writeCharCode(c);
    }
  }
  return out.toString().trimRight();
}
