import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'http_client.dart';

/// A request that didn't work, with a message fit to show the cashier.
class ApiException implements Exception {
  ApiException(this.message, {this.status});

  final String message;
  final int? status;

  bool get sessionEnded => status == 401;

  @override
  String toString() => message;
}

/// The Core server's JSON API (`<server>/api/...`), signed in with a Bearer token.
class Api {
  Api(this.baseUrl);

  /// e.g. https://msilisi.mycorre.com — no trailing slash.
  String baseUrl;
  String? token;
  http.Client? _client;

  Future<http.Client> get _http async => _client ??= await createHttpClient();

  Uri uri(String path, [Map<String, Object?>? query]) {
    final params = <String, String>{};
    query?.forEach((key, value) {
      if (value != null) params[key] = '$value';
    });
    final url = Uri.parse('$baseUrl/api$path');
    return params.isEmpty ? url : url.replace(queryParameters: params);
  }

  Map<String, String> get _headers => {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      };

  Future<dynamic> get(String path, {Map<String, Object?>? query, Duration timeout = const Duration(seconds: 30)}) async {
    final client = await _http;
    return _send(() => client.get(uri(path, query), headers: _headers), timeout);
  }

  Future<dynamic> post(String path, {Object? body, Duration timeout = const Duration(seconds: 45)}) async {
    final client = await _http;
    return _send(() => client.post(uri(path), headers: _headers, body: jsonEncode(body ?? const <String, Object?>{})), timeout);
  }

  Future<dynamic> _send(Future<http.Response> Function() call, Duration timeout) async {
    final http.Response res;
    try {
      res = await call().timeout(timeout);
    } on TimeoutException {
      throw ApiException('The server took too long to answer. Check the internet connection and try again.');
    } catch (e) {
      throw ApiException(connectionMessage(e));
    }
    dynamic body;
    try {
      body = res.bodyBytes.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      body = null;
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return body;
    throw ApiException(errorMessage(body, res.statusCode), status: res.statusCode);
  }

  static String connectionMessage(Object error) {
    final text = error.toString();
    if (text.contains('CERTIFICATE') || text.contains('Handshake')) {
      return "Couldn't make a secure connection to the server. Check that the device's date and time are right.";
    }
    return "Can't reach the server. Check the internet connection (Wi-Fi or mobile data).";
  }

  static String errorMessage(dynamic body, int status) {
    if (status == 401) return 'Your session has ended. Sign in again.';
    if (body is Map) {
      final errors = body['errors'];
      if (errors is Map && errors.isNotEmpty) {
        final first = errors.values.first;
        if (first is List && first.isNotEmpty) return '${first.first}';
        if (first is String && first.isNotEmpty) return first;
      }
      final message = body['message'];
      if (message is String && message.trim().isNotEmpty) return message.trim();
    }
    switch (status) {
      case 403:
        return "You don't have permission to do that.";
      case 404:
        return "The server doesn't have that. Is the server address right?";
      case 429:
        return 'Too many attempts. Wait a minute and try again.';
      default:
        return status >= 500 ? 'The server had a problem ($status). Try again in a moment.' : 'That didn\'t work ($status).';
    }
  }

  /// The `data` of the API's `{success, data, message}` reply.
  static dynamic data(dynamic body) => body is Map && body.containsKey('data') ? body['data'] : body;

  /// A list out of a plain or paginated `data`.
  static List<Map<String, dynamic>> list(dynamic body) {
    var d = data(body);
    if (d is Map && d['data'] is List) d = d['data'];
    if (d is! List) return const [];
    return d.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
  }
}
