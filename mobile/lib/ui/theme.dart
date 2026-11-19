import 'package:flutter/material.dart';

const kBlue = Color(0xFF2563EB);
const kNavy = Color(0xFF0B1F44);
const kBg = Color(0xFFEEF2F8);
const kInk = Color(0xFF0F172A);
const kMuted = Color(0xFF64748B);
const kLine = Color(0xFFE2E8F0);
const kGreen = Color(0xFF0E9F6E);
const kRed = Color(0xFFDC2626);
const kAmber = Color(0xFFB45309);

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: kBlue, primary: kBlue, surface: Colors.white, error: kRed);
  // Square corners everywhere — the same boxy edges as the web system.
  const square = RoundedRectangleBorder();
  const radius = BorderRadius.zero;
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: kBg,
    visualDensity: VisualDensity.standard,
    appBarTheme: const AppBarTheme(
      backgroundColor: kNavy,
      foregroundColor: Colors.white,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(fontSize: 19, fontWeight: FontWeight.w700, color: Colors.white),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(64, 52),
        shape: square,
        textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(64, 48),
        shape: square,
        side: const BorderSide(color: kLine, width: 1.5),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: const OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: kLine)),
      enabledBorder: const OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: kLine)),
      focusedBorder: const OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: kBlue, width: 2)),
    ),
    cardTheme: const CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: square,
    ),
    textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(shape: square)),
    iconButtonTheme: IconButtonThemeData(style: IconButton.styleFrom(shape: square)),
    dialogTheme: const DialogThemeData(shape: square),
    bottomSheetTheme: const BottomSheetThemeData(shape: square),
    chipTheme: const ChipThemeData(shape: square),
    popupMenuTheme: const PopupMenuThemeData(shape: square),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating, shape: square),
    dividerTheme: const DividerThemeData(color: kLine, space: 1, thickness: 1),
  );
}
