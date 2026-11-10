
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';

import 'core/app_state.dart';
import 'core/cart.dart';
import 'core/catalog.dart';
import 'ui/login_screen.dart';
import 'ui/theme.dart';
import 'ui/till_screen.dart';

final navigatorKey = GlobalKey<NavigatorState>();
/// Kept so the web build's semantics stay on.
SemanticsHandle? webSemantics;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppState.I.init();
  if (kIsWeb) {
    // The browser build (used for testing) exposes its buttons and fields to the page.
    webSemantics = SemanticsBinding.instance.ensureSemantics();
  } else {
    // Phones and handheld tills are held upright; tablets turn either way.
    final view = PlatformDispatcher.instance.views.first;
    if (view.physicalSize.shortestSide / view.devicePixelRatio < 600) {
      await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
    }
  }
  runApp(const CoreApp());
}

class CoreApp extends StatefulWidget {
  const CoreApp({super.key});

  @override
  State<CoreApp> createState() => _CoreAppState();
}

class _CoreAppState extends State<CoreApp> {
  bool _wasSignedIn = AppState.I.signedIn;

  @override
  void initState() {
    super.initState();
    AppState.I.addListener(_onSession);
  }

  @override
  void dispose() {
    AppState.I.removeListener(_onSession);
    super.dispose();
  }

  /// Signed out (or the session ended) from any screen: close it, drop the sale and catalogue.
  void _onSession() {
    final signedIn = AppState.I.signedIn;
    if (_wasSignedIn && !signedIn) {
      navigatorKey.currentState?.popUntil((route) => route.isFirst);
      Cart.I.clear();
      Catalog.I.clear();
    }
    _wasSignedIn = signedIn;
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: navigatorKey,
      title: 'Core POS',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      home: ListenableBuilder(
        listenable: AppState.I,
        builder: (context, _) => AppState.I.signedIn ? const TillScreen() : const LoginScreen(),
      ),
    );
  }
}
