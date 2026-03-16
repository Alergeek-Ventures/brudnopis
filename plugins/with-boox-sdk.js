const {
  withProjectBuildGradle,
  withAppBuildGradle,
  withMainApplication,
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

    // Add import if not present
    if (!contents.includes('HiddenApiBypass')) {
      contents = contents.replace(
        /^(import .+\n)(?!import)/m,
        `$1import android.os.Build\nimport org.lsposed.hiddenapibypass.HiddenApiBypass\n`,
      );

      // Add bypass call in onCreate, before super.onCreate()
      contents = contents.replace(
        /super\.onCreate\(\)/,
        `// Onyx Boox SDK: bypass linker namespace restrictions for libonyx_pen_touch_reader.so\n    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {\n      HiddenApiBypass.addHiddenApiExemptions("")\n    }\n    super.onCreate()`,
      );

      config.modResults.contents = contents;
    }
    return config;
  });
}

function withBooxNativeLibrary(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const app = manifest.manifest.application?.[0];
    if (!app) return config;

    // Add <uses-native-library> if not present
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
  return config;
};

module.exports = withBooxSdk;
