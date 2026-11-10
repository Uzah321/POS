import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// The release key (android/key.properties, never committed). Android only
// installs an update over the app already on a till if it's signed with the
// same key, so every release must be built with this one — without the file
// the build falls back to this computer's debug key.
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

android {
    namespace = "com.corepos.core_pos"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.corepos.pos"
        // Android 7.0+: the Sunmi V2 runs 7.1.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        // One copy of the native code, 32-bit ARM: every Android handheld till
        // runs it (the Sunmi V2's CPU is 32-bit), and the download is half
        // the size of one carrying the 64-bit and x86 copies as well.
        ndk {
            abiFilters += listOf("armeabi-v7a")
        }
    }

    packaging {
        jniLibs {
            // The camera scanner's library brings its other copies along regardless.
            excludes += listOf("lib/arm64-v8a/**", "lib/x86/**", "lib/x86_64/**")
        }
    }

    signingConfigs {
        create("release") {
            if (keystorePropertiesFile.exists()) {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (keystorePropertiesFile.exists()) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    // Sunmi's printer service client (InnerPrinterManager / SunmiPrinterService):
    // the built-in printer on Sunmi handhelds, the V2 included.
    implementation("com.sunmi:printerlibrary:1.0.23")
}

flutter {
    source = "../.."
}
