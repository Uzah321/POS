import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/app_state.dart';
import 'theme.dart';
import 'widgets.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _username = TextEditingController(text: AppState.I.lastUsername ?? '');
  final _password = TextEditingController();
  final _passwordFocus = FocusNode();
  bool _hidden = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _error = AppState.I.signInNotice;
  }

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    final username = _username.text.trim();
    if (username.isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'Enter your username and password.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AppState.I.signIn(username, _password.text);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = 'Sign-in failed: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _changeServer() async {
    final controller = TextEditingController(text: AppState.I.server);
    final value = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Server'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('The address of your Core site, e.g. msilisi.mycorre.com, or a shop server such as 192.168.1.10:8080.',
                style: TextStyle(color: kMuted)),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              autofocus: true,
              keyboardType: TextInputType.url,
              autocorrect: false,
              decoration: const InputDecoration(hintText: 'msilisi.mycorre.com'),
              onSubmitted: (v) => Navigator.pop(context, v),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, defaultServer), child: const Text('Reset')),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(64, 44)),
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (value != null) {
      await AppState.I.setServer(value);
      if (mounted) setState(() => _error = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        CoreLogo(size: 52),
                        SizedBox(width: 12),
                        Text('Core ', style: TextStyle(fontSize: 32, fontWeight: FontWeight.w800, color: kInk)),
                        Text('POS', style: TextStyle(fontSize: 32, fontWeight: FontWeight.w800, color: kBlue)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    const Text('Sign in to start selling', textAlign: TextAlign.center, style: TextStyle(fontSize: 16, color: kMuted)),
                    const SizedBox(height: 28),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(20),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text('Username or email', style: TextStyle(fontWeight: FontWeight.w600, color: kInk)),
                            const SizedBox(height: 8),
                            TextField(
                              controller: _username,
                              enabled: !_busy,
                              autocorrect: false,
                              textInputAction: TextInputAction.next,
                              autofillHints: const [AutofillHints.username],
                              style: const TextStyle(fontSize: 17),
                              decoration: const InputDecoration(prefixIcon: Icon(Icons.person_outline), hintText: 'Your username'),
                              onSubmitted: (_) => _passwordFocus.requestFocus(),
                            ),
                            const SizedBox(height: 16),
                            const Text('Password', style: TextStyle(fontWeight: FontWeight.w600, color: kInk)),
                            const SizedBox(height: 8),
                            TextField(
                              controller: _password,
                              focusNode: _passwordFocus,
                              enabled: !_busy,
                              obscureText: _hidden,
                              autocorrect: false,
                              enableSuggestions: false,
                              textInputAction: TextInputAction.done,
                              autofillHints: const [AutofillHints.password],
                              style: const TextStyle(fontSize: 17),
                              decoration: InputDecoration(
                                prefixIcon: const Icon(Icons.lock_outline),
                                hintText: 'Your password',
                                suffixIcon: IconButton(
                                  tooltip: _hidden ? 'Show password' : 'Hide password',
                                  icon: Icon(_hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                                  onPressed: () => setState(() => _hidden = !_hidden),
                                ),
                              ),
                              onSubmitted: (_) => _signIn(),
                            ),
                            if (_error != null) ...[
                              const SizedBox(height: 16),
                              Container(
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(color: const Color(0xFFFDECEC), borderRadius: BorderRadius.circular(12)),
                                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  const Icon(Icons.error_outline, color: kRed, size: 20),
                                  const SizedBox(width: 8),
                                  Expanded(child: Text(_error!, style: const TextStyle(color: kRed, fontSize: 14.5))),
                                ]),
                              ),
                            ],
                            const SizedBox(height: 20),
                            FilledButton(
                              onPressed: _busy ? null : _signIn,
                              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56)),
                              child: _busy
                                  ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2.6, color: Colors.white))
                                  : const Text('Sign in'),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextButton.icon(
                      onPressed: _busy ? null : _changeServer,
                      icon: const Icon(Icons.dns_outlined, size: 18),
                      label: Text('Server: ${AppState.I.serverHost}  ·  Change', overflow: TextOverflow.ellipsis),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
