
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'receipt.dart';

class PrintException implements Exception {
  PrintException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// What the device has to print on.
class PrinterStatus {
  const PrinterStatus({this.sunmi = false, this.state = 0, this.rawbt = false});

  static const none = PrinterStatus();

  /// A Sunmi built-in printer is connected.
  final bool sunmi;

  /// Sunmi's printer state code (1 = ready).
  final int state;

  /// The RawBT app is installed (prints on other handhelds' printers).
  final bool rawbt;

  bool get canPrint => (sunmi && problem == null) || (!sunmi && rawbt);

  /// What's stopping the Sunmi printer, in words; null when it can print.
  String? get problem {
    if (!sunmi) return null;
    switch (state) {
      case 3:
        return "The printer isn't answering. Restart the device.";
      case 4:
        return 'The printer is out of paper. Load a new roll.';
      case 5:
        return 'The printer is too hot. Give it a minute.';
      case 6:
        return 'The printer cover is open. Close it.';
      case 505:
        return 'No printer found inside this device.';
      default:
        return null; // 1 ready, 2 starting up — and anything else is worth a try
    }
  }

  String get label {
    if (sunmi) return problem ?? 'Built-in printer ready';
    if (rawbt) return 'Printing through the RawBT app';
    return 'No printer found';
  }
}

class Printer {
  static const _channel = MethodChannel('core_pos/printer');

  static bool get supported => !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  static Future<PrinterStatus> status() async {
    if (!supported) return PrinterStatus.none;
    // Right after the app starts, Sunmi's printer service may still be connecting.
    for (var attempt = 0; attempt < 10; attempt++) {
      try {
        final m = await _channel.invokeMapMethod<String, dynamic>('status') ?? const {};
        if (m['binding'] == true && attempt < 9) {
          await Future<void>.delayed(const Duration(milliseconds: 300));
          continue;
        }
        return PrinterStatus(sunmi: m['sunmi'] == true, state: (m['state'] as num?)?.toInt() ?? 0, rawbt: m['rawbt'] == true);
      } catch (_) {
        return PrinterStatus.none;
      }
    }
    return PrinterStatus.none;
  }

  /// Sends ESC/POS bytes to the built-in printer (or RawBT). Throws [PrintException] with what to do.
  static Future<void> printBytes(Uint8List bytes) async {
    if (!supported) throw PrintException('There is no printer here. Use View receipt instead.');
    final st = await status();
    try {
      if (st.sunmi) {
        if (st.problem != null) throw PrintException(st.problem!);
        await _channel.invokeMethod<bool>('print', {'data': bytes});
      } else if (st.rawbt) {
        await _channel.invokeMethod<bool>('rawbt', {'data': bytes});
      } else {
        throw PrintException("No printer found. On a Sunmi handheld it's found by itself; on other handhelds install the RawBT app.");
      }
    } on PlatformException catch (e) {
      throw PrintException(e.message ?? 'The receipt did not print.');
    }
  }

  /// The receipt's printer bytes, logo included.
  static Uint8List bytesFor(Receipt r) => buildEscPos(r, logo: logoRaster(r.logo));

  /// Finishes the fiscal receipt if it was still pending, then prints. Returns the bytes printed.
  static Future<Uint8List> printReceipt(Receipt r) async {
    await completeFiscal(r);
    final bytes = bytesFor(r);
    await printBytes(bytes);
    return bytes;
  }
}
