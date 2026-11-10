import 'dart:io';

import 'package:flutter/services.dart' show rootBundle;
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

/// The Core sites use Let's Encrypt certificates, now issued under its 2026
/// roots (Root YE / Root YR, cross-signed by ISRG Root X1 and X2). Older
/// Android (a Sunmi V2 runs 7.1) doesn't know all of them, so its browser
/// shows the site as not secure; the app carries them itself, on top of the
/// device's own list, and connects anyway.
const _letsEncryptRoots = ['isrgrootx1.pem', 'isrg-root-x2.pem', 'root-ye.pem', 'root-yr.pem'];

Future<http.Client> createHttpClient() async {
  final context = SecurityContext(withTrustedRoots: true);
  for (final name in _letsEncryptRoots) {
    try {
      final pem = await rootBundle.load('assets/certs/$name');
      context.setTrustedCertificatesBytes(pem.buffer.asUint8List());
    } catch (_) {
      // Already trusted by the device, or unreadable: the device's list still applies.
    }
  }
  final client = HttpClient(context: context)
    ..connectionTimeout = const Duration(seconds: 15)
    ..idleTimeout = const Duration(seconds: 30);
  return IOClient(client);
}
