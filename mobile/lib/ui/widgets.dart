import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'theme.dart';

/// The Core logo (assets/logo.png), as on the web tills and the launcher icon.
class CoreLogo extends StatelessWidget {
  const CoreLogo({super.key, this.size = 40});

  final double size;

  @override
  Widget build(BuildContext context) =>
      Image.asset('assets/logo.png', width: size, height: size, filterQuality: FilterQuality.medium, semanticLabel: 'Core');
}

/// A big-key number pad: 1–9, then the decimal point (when allowed), 0 and backspace.
class NumberPad extends StatelessWidget {
  const NumberPad({super.key, required this.onKey, this.allowDecimal = true});

  final void Function(String key) onKey;
  final bool allowDecimal;

  @override
  Widget build(BuildContext context) {
    const rows = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['.', '0', 'back'],
    ];
    return LayoutBuilder(builder: (context, box) {
      // The keys fill the room they're given (up to 64 high) and never more: a
      // pad taller than its space slides its last row under whatever is below
      // it, which is what hid 0 on short handheld screens.
      final bounded = box.maxHeight.isFinite;
      final gap = bounded && box.maxHeight < 4 * 48 + 3 * 8 ? 6.0 : 8.0;
      final keyHeight = bounded ? math.max(0.0, math.min(64.0, (box.maxHeight - 3 * gap) / 4)) : 64.0;
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final row in rows)
            Padding(
              padding: EdgeInsets.only(bottom: row == rows.last ? 0 : gap),
              child: Row(children: [
                for (final key in row)
                  Expanded(
                    child: Padding(
                      padding: EdgeInsets.only(right: key == row.last ? 0 : gap),
                      child: _Key(
                        label: key,
                        height: keyHeight,
                        enabled: key != '.' || allowDecimal,
                        onTap: () {
                          HapticFeedback.selectionClick();
                          onKey(key);
                        },
                      ),
                    ),
                  ),
              ]),
            ),
        ],
      );
    });
  }
}

/// How tall a number pad in a bottom sheet can be: 260 on a phone, less on a
/// short handheld screen so the sheet's button below it still fits.
double padHeightFor(BuildContext context) => (MediaQuery.sizeOf(context).height * 0.36).clamp(170.0, 260.0);

class _Key extends StatelessWidget {
  const _Key({required this.label, required this.height, required this.onTap, this.enabled = true});

  final String label;
  final double height;
  final VoidCallback onTap;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final back = label == 'back';
    return Opacity(
      opacity: enabled ? 1 : 0.25,
      child: Material(
        color: back ? const Color(0xFFDDE5F0) : Colors.white,
        borderRadius: BorderRadius.zero,
        child: InkWell(
          borderRadius: BorderRadius.zero,
          onTap: enabled ? onTap : null,
          child: SizedBox(
            height: height,
            child: Center(
              child: back
                  ? Icon(Icons.backspace_outlined, size: height < 44 ? 20 : 24, color: kInk, semanticLabel: 'Backspace')
                  : Text(label, style: TextStyle(fontSize: height < 44 ? 20 : 24, fontWeight: FontWeight.w600, color: kInk, height: 1)),
            ),
          ),
        ),
      ),
    );
  }
}

/// Applies a keypad key to an amount being typed: at most one point, two decimals.
String applyKey(String current, String key, {int decimals = 2}) {
  if (key == 'back') return current.isEmpty ? current : current.substring(0, current.length - 1);
  if (key == '.') {
    if (decimals == 0 || current.contains('.')) return current;
    return current.isEmpty ? '0.' : '$current.';
  }
  final dot = current.indexOf('.');
  if (dot >= 0 && current.length - dot - 1 >= decimals) return current;
  if (current == '0') return key;
  if (current.length >= 10) return current;
  return current + key;
}

void showProblem(BuildContext context, String message) {
  final messenger = ScaffoldMessenger.of(context);
  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(SnackBar(
    content: Text(message, style: const TextStyle(fontSize: 15)),
    backgroundColor: kRed,
    duration: const Duration(seconds: 4),
  ));
}

void showNote(BuildContext context, String message, {Duration duration = const Duration(milliseconds: 1400)}) {
  final messenger = ScaffoldMessenger.of(context);
  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(SnackBar(content: Text(message, style: const TextStyle(fontSize: 15)), duration: duration));
}

Future<bool> confirm(BuildContext context, {required String title, required String message, required String yes, bool danger = false}) async {
  final answer = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(message, style: const TextStyle(fontSize: 15)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
        FilledButton(
          style: danger ? FilledButton.styleFrom(backgroundColor: kRed, minimumSize: const Size(64, 44)) : FilledButton.styleFrom(minimumSize: const Size(64, 44)),
          onPressed: () => Navigator.pop(context, true),
          child: Text(yes),
        ),
      ],
    ),
  );
  return answer ?? false;
}

/// A white rounded panel with a small grey heading.
class Section extends StatelessWidget {
  const Section({super.key, required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 18, 4, 8),
          child: Text(title.toUpperCase(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: kMuted, letterSpacing: 0.6)),
        ),
        Card(clipBehavior: Clip.antiAlias, child: Column(children: children)),
      ],
    );
  }
}
