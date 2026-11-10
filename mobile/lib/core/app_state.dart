import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'api.dart';
import 'models.dart';
import 'store.dart';

/// The Core site this app signs in to unless it's changed on the sign-in screen.
const defaultServer = 'https://msilisi.mycorre.com';

/// Who is signed in, to which server, and the shop's settings, currencies and tills.
class AppState extends ChangeNotifier {
  AppState._();

  static final AppState I = AppState._();

  late Store _prefs;
  late Api api;

  String server = defaultServer;
  Map<String, dynamic>? user;
  Map<String, dynamic> settings = {};
  List<Currency> currencies = const [Currency.usd];
  String? _currencyCode;
  List<Map<String, dynamic>> tills = const [];
  int? _chosenTillId;
  bool autoPrint = true;

  /// Shown on the sign-in screen after the app signs someone out (e.g. an expired session).
  String? signInNotice;

  bool get signedIn => api.token != null && user != null;

  Future<void> init() async {
    _prefs = await Store.open();
    // In a browser (the web build used for testing) the app talks to the site it was loaded from.
    server = _prefs.getString('server') ?? (kIsWeb ? Uri.base.origin : defaultServer);
    api = Api(server)..token = _prefs.getString('token');
    user = _decodeMap(_prefs.getString('user'));
    settings = _decodeMap(_prefs.getString('settings')) ?? {};
    final cachedCurrencies = _prefs.getString('currencies');
    if (cachedCurrencies != null) {
      try {
        currencies = (jsonDecode(cachedCurrencies) as List).map((c) => Currency.fromJson(asMap(c))).toList();
      } catch (_) {}
    }
    _currencyCode = _prefs.getString('currency');
    _chosenTillId = _prefs.getInt('till');
    autoPrint = _prefs.getBool('autoPrint') ?? true;
    if (api.token == null) user = null;
  }

  String? get lastUsername => _prefs.getString('lastUsername');

  String get serverHost => Uri.tryParse(server)?.host.isNotEmpty == true ? Uri.parse(server).host : server;

  /// Accepts "msilisi.mycorre.com", "https://…/", "…/api" or a local "192.168.1.10:8080".
  static String normaliseServer(String input) {
    var url = input.trim();
    if (url.isEmpty) return defaultServer;
    if (!url.contains('://')) {
      final local = RegExp(r'^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)').hasMatch(url) || !url.split(':').first.contains('.');
      url = '${local ? 'http' : 'https'}://$url';
    }
    url = url.replaceFirst(RegExp(r'/+$'), '').replaceFirst(RegExp(r'/api$'), '');
    return url;
  }

  Future<void> setServer(String input) async {
    server = normaliseServer(input);
    api = Api(server);
    await _prefs.setString('server', server);
    notifyListeners();
  }

  Future<void> signIn(String username, String password) async {
    final body = await api.post('/auth/login', body: {'username': username.trim(), 'password': password});
    final data = asMap(Api.data(body));
    final token = text(data['token']);
    if (token == null) throw ApiException('The server answered without a sign-in token. Is the server address right?');
    api.token = token;
    user = asMap(data['user']);
    signInNotice = null;
    await _prefs.setString('token', token);
    await _prefs.setString('user', jsonEncode(user));
    await _prefs.setString('lastUsername', username.trim());
    try {
      await refresh();
    } on ApiException catch (e) {
      if (e.sessionEnded) rethrow;
      // Settings can load later; the till still works with what's cached.
    }
    notifyListeners();
  }

  /// Settings, currencies and this branch's tills — fetched after sign-in and when the till opens.
  Future<void> refresh() async {
    final results = await Future.wait<dynamic>([
      api.get('/settings').then<dynamic>((b) => b, onError: (Object e) => e),
      api.get('/currencies').then<dynamic>((b) => b, onError: (Object e) => e),
      api.get('/tills', query: {'branch_id': branchId}).then<dynamic>((b) => b, onError: (Object e) => e),
      api.get('/auth/me').then<dynamic>((b) => b, onError: (Object e) => e),
    ]);
    for (final r in results) {
      if (r is ApiException && r.sessionEnded) throw r;
    }
    if (results[0] is! Exception) {
      final s = Api.data(results[0]);
      if (s is Map) {
        settings = Map<String, dynamic>.from(s);
        await _prefs.setString('settings', jsonEncode(settings));
      }
    }
    if (results[1] is! Exception) {
      final list = Api.list(results[1]).map(Currency.fromJson).toList();
      if (list.isNotEmpty) {
        currencies = list;
        await _prefs.setString('currencies', jsonEncode(list.map((c) => c.toJson()).toList()));
      }
    }
    if (results[2] is! Exception) tills = Api.list(results[2]);
    if (results[3] is! Exception) {
      final me = Api.data(results[3]);
      final fresh = me is Map ? asMap(me['user'] ?? me) : null;
      if (fresh != null && fresh['id'] != null) {
        user = {...?user, ...fresh};
        await _prefs.setString('user', jsonEncode(user));
      }
    }
    notifyListeners();
  }

  Future<void> signOut({String? notice}) async {
    final hadToken = api.token != null;
    if (hadToken && notice == null) {
      try {
        await api.post('/auth/logout', timeout: const Duration(seconds: 8));
      } catch (_) {}
    }
    api.token = null;
    user = null;
    signInNotice = notice;
    await _prefs.remove('token');
    await _prefs.remove('user');
    notifyListeners();
  }

  /// The token stopped working (expired, or the user was disabled): back to the sign-in screen.
  Future<void> sessionEnded() => signOut(notice: 'Your session has ended. Sign in again to carry on.');

  // ---- Who and where ------------------------------------------------------

  int get branchId => toInt(user?['branch_id']) ?? toInt(asMap(user?['branch'])['id']) ?? 1;
  String get branchName => text(asMap(user?['branch'])['name']) ?? '';
  String get userName => text(user?['name']) ?? text(user?['username']) ?? '';
  List<String> get roles => (user?['roles'] is List) ? (user!['roles'] as List).map((r) => '$r').toList() : const [];
  String get storeName => text(settings['company_name']) ?? 'Core';

  // ---- Money --------------------------------------------------------------

  Currency get currency {
    for (final c in currencies) {
      if (c.code == _currencyCode) return c;
    }
    for (final c in currencies) {
      if (c.isDefault) return c;
    }
    return currencies.isNotEmpty ? currencies.first : Currency.usd;
  }

  set currency(Currency c) {
    _currencyCode = c.code;
    _prefs.setString('currency', c.code);
    notifyListeners();
  }

  double toActive(double base) => base * currency.rate;
  double toBase(double active) => currency.rate == 0 ? active : active / currency.rate;

  /// A base-currency amount, shown in the till's currency.
  String money(double base) => moneyActive(toActive(base));

  /// An amount already in the till's currency (cash tendered, change).
  String moneyActive(double amount) {
    final sign = (amount * 100).round() < 0 ? '-' : '';
    return '$sign${currency.symbol}${grouped(amount.abs())}';
  }

  // ---- Shop rules ---------------------------------------------------------

  bool get taxEnabled => toBool(settings['tax_enabled']);

  /// VAT rate on a product: its own, else the shop's, else none. Prices include it.
  double taxRateFor(Product p) {
    if (!taxEnabled) return 0;
    if (p.raw['is_taxable'] == false || p.raw['is_taxable'] == 0) return 0;
    final own = toDoubleOrNull(asMap(p.raw['tax_rate'])['rate']);
    return own ?? toDouble(settings['tax_rate']);
  }

  bool get blockNegativeStock => !(settings['block_negative_stock'] == 'false' || settings['block_negative_stock'] == false);

  // ---- Till (register) ----------------------------------------------------

  List<Map<String, dynamic>> get activeTills => tills.where((t) => toBool(t['is_active'], true)).toList();

  /// Which till sales are rung up on: the only one, or the one chosen on this device.
  int? get tillId {
    final active = activeTills;
    if (active.isEmpty) return null;
    if (active.length == 1) return toInt(active.first['id']);
    return active.any((t) => toInt(t['id']) == _chosenTillId) ? _chosenTillId : null;
  }

  String? get tillName {
    final id = tillId;
    for (final t in activeTills) {
      if (toInt(t['id']) == id) return text(t['name']) ?? 'Till $id';
    }
    return null;
  }

  bool get needsTill => activeTills.length > 1 && tillId == null;

  void chooseTill(int id) {
    _chosenTillId = id;
    _prefs.setInt('till', id);
    notifyListeners();
  }

  void setAutoPrint(bool on) {
    autoPrint = on;
    _prefs.setBool('autoPrint', on);
    notifyListeners();
  }

  static Map<String, dynamic>? _decodeMap(String? raw) {
    if (raw == null) return null;
    try {
      final v = jsonDecode(raw);
      return v is Map ? Map<String, dynamic>.from(v) : null;
    } catch (_) {
      return null;
    }
  }
}
