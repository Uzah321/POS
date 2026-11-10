import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'theme.dart';

/// The Core mark: a blue hexagon with a white ring, as on the web sign-in page.
class CoreLogo extends StatelessWidget {
  const CoreLogo({super.key, this.size = 40});

  final double size;

  @override
  Widget build(BuildContext context) => SizedBox(width: size, height: size, child: CustomPaint(painter: _LogoPainter()));
}

class _LogoPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 36;
    final hex = Path()
      ..moveTo(18 * s, 2 * s)
      ..lineTo(32.5 * s, 10.25 * s)
      ..lineTo(32.5 * s, 26.75 * s)
      ..lineTo(18 * s, 35 * s)
      ..lineTo(3.5 * s, 26.75 * s)
      ..lineTo(3.5 * s, 10.25 * s)
      ..close();
    canvas.drawPath(hex, Paint()..color = kBlue);
    final centre = Offset(18 * s, 18 * s);
    canvas.drawCircle(centre, 8 * s, Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5 * s);
    canvas.drawCircle(centre, 4 * s, Paint()..color = Colors.white.withValues(alpha: 0.35));
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
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
      final keyHeight = math.max(44.0, math.min(64.0, (box.maxHeight - 3 * 8) / 4));
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final row in rows)
            Padding(
              padding: EdgeInsets.only(bottom: row == rows.last ? 0 : 8),
              child: Row(children: [
                for (final key in row)
                  Expanded(
                    child: Padding(
                      padding: EdgeInsets.only(right: key == row.last ? 0 : 8),
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
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: enabled ? onTap : null,
          child: SizedBox(
            height: height,
            child: Center(
              child: back
                  ? const Icon(Icons.backspace_outlined, size: 24, color: kInk, semanticLabel: 'Backspace')
                  : Text(label, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w600, color: kInk)),
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
