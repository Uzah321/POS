// The HTTP client: on Android one that also trusts Let's Encrypt's roots
// (http_client_io.dart); in a browser the browser's own.
export 'http_client_web.dart' if (dart.library.io) 'http_client_io.dart';
