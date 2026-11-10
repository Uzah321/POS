import 'package:flutter/services.dart';

// Android's SharedPreferences, through MainActivity's "core_pos/store" channel.
const _channel = MethodChannel('core_pos/store');

Future<Map<String, String>> loadAll() async {
  final all = await _channel.invokeMapMethod<String, String?>('load') ?? const {};
  return {
    for (final e in all.entries)
      if (e.value != null) e.key: e.value!,
  };
}

Future<void> write(String key, String? value) => _channel.invokeMethod<bool>('set', {'key': key, 'value': value});
