import 'package:web/web.dart' as web;

// The browser's localStorage, each key prefixed so it can't clash with the site's own.
const _prefix = 'core_pos.';

Future<Map<String, String>> loadAll() async {
  final storage = web.window.localStorage;
  final out = <String, String>{};
  for (var i = 0; i < storage.length; i++) {
    final key = storage.key(i);
    if (key == null || !key.startsWith(_prefix)) continue;
    final value = storage.getItem(key);
    if (value != null) out[key.substring(_prefix.length)] = value;
  }
  return out;
}

Future<void> write(String key, String? value) async {
  if (value == null) {
    web.window.localStorage.removeItem('$_prefix$key');
  } else {
    web.window.localStorage.setItem('$_prefix$key', value);
  }
}
