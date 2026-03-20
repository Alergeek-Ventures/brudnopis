const {
  withProjectBuildGradle,
  withAppBuildGradle,
  withMainApplication,
  withMainActivity,
  withAndroidManifest,
} = require('expo/config-plugins');

/**
 * Expo config plugin for Onyx Boox SDK support.
 *
 * 1. Adds the Boox Maven repo to allprojects.repositories
 * 2. Adds HiddenApiBypass dependency to app/build.gradle
 * 3. Calls HiddenApiBypass.addHiddenApiExemptions("") in MainApplication.onCreate()
 *    to bypass Android linker namespace restrictions that block loading
 *    /system/lib64/libonyx_pen_touch_reader.so
 * 4. Declares <uses-native-library> in AndroidManifest.xml (belt-and-suspenders)
 * 5. Fixes Boox per-app DPI override in MainActivity.onCreate().
 *    Boox firmware silently inflates densityDpi for third-party apps (e.g. 300→450).
 *    PixelUtil.toDIPFromPixel() reads DisplayMetricsHolder.getScreenDisplayMetrics()
 *    which stores the physical density (1.875) from Display.getRealMetrics().
 *    react-native-screens calls toDIPFromPixel() to convert its pixel dimensions,
 *    resulting in 1860px / 1.875 = 992dp instead of the correct 661dp.
 *    Fix: after super.onCreate() (which triggers ReactRootView + initDisplayMetrics),
 *    copy windowDisplayMetrics.density into screenDisplayMetrics.density.
 */

function withBooxMavenRepo(config) {
  return withProjectBuildGradle(config, (config) => {
    const buildGradle = config.modResults.contents;
    const booxRepo = `        maven { url "https://repo.boox.com/repository/maven-public/" }`;

    if (!buildGradle.includes('repo.boox.com')) {
      config.modResults.contents = buildGradle.replace(
        /allprojects\s*\{[\s\S]*?repositories\s*\{/,
        (match) => `${match}\n${booxRepo}`,
      );
    }
    return config;
  });
}

function withHiddenApiBypassDep(config) {
  return withAppBuildGradle(config, (config) => {
    const buildGradle = config.modResults.contents;

    if (!buildGradle.includes('hiddenapibypass')) {
      config.modResults.contents = buildGradle.replace(
        /dependencies\s*\{/,
        `dependencies {\n    // Fix for Onyx Boox SDK: bypass linker namespace restrictions\n    implementation 'org.lsposed.hiddenapibypass:hiddenapibypass:6.1'`,
      );
    }
    return config;
  });
}

function withHiddenApiBypassInit(config) {
  return withMainApplication(config, (config) => {
    let contents = config.modResults.contents;

    if (!contents.includes('HiddenApiBypass')) {
      contents = contents.replace(
        /^(import .+\n)(?!import)/m,
        `$1import android.os.Build\nimport org.lsposed.hiddenapibypass.HiddenApiBypass\n`,
      );

      contents = contents.replace(
        /super\.onCreate\(\)/,
        `// Onyx Boox SDK: bypass linker namespace restrictions for libonyx_pen_touch_reader.so\n    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {\n      HiddenApiBypass.addHiddenApiExemptions("")\n    }\n    super.onCreate()`,
      );

      config.modResults.contents = contents;
    }
    return config;
  });
}

function withBooxDensityFix(config) {
  return withMainActivity(config, (config) => {
    let contents = config.modResults.contents;

    if (contents.includes('fixScreenDisplayMetrics')) {
      return config;
    }

    contents = contents.replace(
      /^(import .+\n)(?!import)/m,
      '$1import com.facebook.react.uimanager.DisplayMetricsHolder\n',
    );

    contents = contents.replace(
      /super\.onCreate\(null\)/,
      'super.onCreate(null)\n    fixScreenDisplayMetrics()',
    );

    contents = contents.replace(
      /(\n)(}\s*$)/m,
      `$1  /**
   * Fix Boox per-app DPI override.
   *
   * Boox firmware silently inflates densityDpi for third-party apps (e.g. 300 -> 450).
   * React Native's PixelUtil uses DisplayMetricsHolder.getScreenDisplayMetrics().density
   * for all dp<->px conversions. screenDisplayMetrics is populated from Display.getRealMetrics()
   * which returns the physical density (1.875), not the app window density (2.8125).
   *
   * react-native-screens calls PixelUtil.toDIPFromPixel() to convert its pixel dimensions
   * to dp, resulting in 1860px / 1.875 = 992dp instead of the correct 661dp.
   * This causes the screen to be laid out wider than the visible window.
   *
   * Fix: after super.onCreate() (which creates ReactRootView and calls initDisplayMetrics),
   * copy the correct window density into screenDisplayMetrics. This is safe because
   * getScreenDisplayMetrics() returns a mutable object reference.
   * On non-Boox devices where densities match, this is a no-op.
   */
  private fun fixScreenDisplayMetrics() {
    try {
      val window = DisplayMetricsHolder.getWindowDisplayMetrics()
      val screen = DisplayMetricsHolder.getScreenDisplayMetrics()
      if (screen.density != window.density) {
        screen.density = window.density
        screen.densityDpi = window.densityDpi
      }
    } catch (_: Exception) {
      // DisplayMetricsHolder not yet initialized — safe to ignore
    }
  }
$1$2`,
    );

    config.modResults.contents = contents;
    return config;
  });
}

function withBooxNativeLibrary(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const app = manifest.manifest.application?.[0];
    if (!app) return config;

    if (!app['uses-native-library']) {
      app['uses-native-library'] = [];
    }

    const existing = app['uses-native-library'].find(
      (lib) => lib.$?.['android:name'] === 'libonyx_pen_touch_reader.so',
    );

    if (!existing) {
      app['uses-native-library'].push({
        $: {
          'android:name': 'libonyx_pen_touch_reader.so',
          'android:required': 'false',
        },
      });
    }

    return config;
  });
}

const withBooxSdk = (config) => {
  config = withBooxMavenRepo(config);
  config = withHiddenApiBypassDep(config);
  config = withHiddenApiBypassInit(config);
  config = withBooxNativeLibrary(config);
  config = withBooxDensityFix(config);
  return config;
};

module.exports = withBooxSdk;
