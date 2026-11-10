import 'store_web.dart' if (dart.library.io) 'store_io.dart' as backend;

/// The app's saved settings (server, sign-in, currency, till, ...): Android's
/// own settings storage on a device (store_io.dart), the browser's local
/// storage in the web build. Read once at start-up, kept in memory, and
/// written through on every change.
class Store {
  Store._(this._values);

  final Map<String, String> _values;

  static Future<Store> open() async {
    try {
      return Store._(await backend.loadAll());
    } catch (_) {
      return Store._({}); // nothing saved (or unreadable): start fresh
    }
  }

  String? getString(String key) => _values[key];
  int? getInt(String key) => int.tryParse(_values[key] ?? '');
  bool? getBool(String key) => switch (_values[key]) { 'true' => true, 'false' => false, _ => null };

  Future<void> setString(String key, String value) => _write(key, value);
  Future<void> setInt(String key, int value) => _write(key, '$value');
  Future<void> setBool(String key, bool value) => _write(key, '$value');
  Future<void> remove(String key) => _write(key, null);

  Future<void> _write(String key, String? value) async {
    if (value == null) {
      _values.remove(key);
    } else {
      _values[key] = value;
    }
    try {
      await backend.write(key, value);
    } catch (_) {
      // Kept in memory for this session either way.
    }
  }
}
