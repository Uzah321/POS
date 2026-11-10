package com.corepos.core_pos

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.util.Base64
import com.sunmi.peripheral.printer.InnerPrinterCallback
import com.sunmi.peripheral.printer.InnerPrinterManager
import com.sunmi.peripheral.printer.InnerResultCallback
import com.sunmi.peripheral.printer.SunmiPrinterService
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * The receipt printer, for the Dart side's "core_pos/printer" channel.
 *
 * A Sunmi handheld (V2, V2 Pro, P2, ...) has its printer behind Sunmi's printer
 * service; this binds to it at start-up and hands it the receipt's ESC/POS
 * bytes. Any other Android device can print through the RawBT app instead.
 */
class MainActivity : FlutterActivity() {
    private var sunmi: SunmiPrinterService? = null
    private var binding = false

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        bindSunmi()
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "core_pos/printer").setMethodCallHandler { call, result ->
            when (call.method) {
                "status" -> result.success(status())
                "print" -> printOnSunmi(call.argument<ByteArray>("data"), result)
                "rawbt" -> printWithRawbt(call.argument<ByteArray>("data"), result)
                else -> result.notImplemented()
            }
        }
        // The app's few saved settings (server, sign-in, currency, till) — kept
        // here rather than through the shared_preferences plugin, which needs
        // Android 7 while Sunmi handhelds still run 6.
        val store = getSharedPreferences("core_pos", MODE_PRIVATE)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "core_pos/store").setMethodCallHandler { call, result ->
            when (call.method) {
                "load" -> result.success(store.all.mapValues { it.value?.toString() })
                "set" -> {
                    val key = call.argument<String>("key")
                    val value = call.argument<String>("value")
                    if (key == null) {
                        result.error("NO_KEY", "No key given.", null)
                    } else {
                        store.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
                        result.success(true)
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun bindSunmi() {
        binding = try {
            InnerPrinterManager.getInstance().bindService(applicationContext, object : InnerPrinterCallback() {
                override fun onConnected(service: SunmiPrinterService) {
                    sunmi = service
                    binding = false
                }

                override fun onDisconnected() {
                    sunmi = null
                }
            })
        } catch (e: Exception) {
            false // not a Sunmi device
        }
    }

    private fun status(): Map<String, Any?> {
        val printer = sunmi
        val state = if (printer == null) 0 else try {
            printer.updatePrinterState()
        } catch (e: Exception) {
            -1
        }
        return mapOf(
            "sunmi" to (printer != null),
            "binding" to (printer == null && binding),
            "state" to state,
            "rawbt" to isInstalled(RAWBT),
        )
    }

    private fun printOnSunmi(data: ByteArray?, result: MethodChannel.Result) {
        val printer = sunmi
        if (printer == null || data == null) {
            result.error("NO_PRINTER", "No built-in printer found on this device.", null)
            return
        }
        try {
            printer.sendRAWData(data, object : InnerResultCallback() {
                override fun onRunResult(isSuccess: Boolean) {}
                override fun onReturnString(result: String?) {}
                override fun onRaiseException(code: Int, msg: String?) {}
                override fun onPrintResult(code: Int, msg: String?) {}
            })
            result.success(true)
        } catch (e: Exception) {
            result.error("PRINT_FAILED", e.message ?: "The printer didn't take the receipt.", null)
        }
    }

    private fun printWithRawbt(data: ByteArray?, result: MethodChannel.Result) {
        if (data == null) {
            result.error("NO_DATA", "Nothing to print.", null)
            return
        }
        val link = "rawbt:base64," + Base64.encodeToString(data, Base64.NO_WRAP)
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(RAWBT))
            result.success(true)
        } catch (e: ActivityNotFoundException) {
            result.error("NO_RAWBT", "Install the RawBT app to print on this device.", null)
        }
    }

    private fun isInstalled(pkg: String): Boolean = try {
        packageManager.getPackageInfo(pkg, 0)
        true
    } catch (e: PackageManager.NameNotFoundException) {
        false
    }

    companion object {
        private const val RAWBT = "ru.a402d.rawbtprinter"
    }
}
