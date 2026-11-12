// 릴리스 서명 + 버전 코드 (환경 변수가 있을 때만 적용, 없으면 기존 APK 빌드 방식 그대로)
const { withAppBuildGradle } = require('@expo/config-plugins');

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let s = cfg.modResults.contents;
    const vc = process.env.VERSION_CODE;
    if (vc) {
      if (!/versionCode\s+\d+/.test(s)) throw new Error('versionCode를 build.gradle에서 찾지 못했습니다');
      s = s.replace(/versionCode\s+\d+/, `versionCode ${parseInt(vc, 10)}`);
    }
    if (process.env.ANDROID_KEYSTORE_PATH) {
      if (!/signingConfigs\s*\{/.test(s)) throw new Error('signingConfigs 블록을 찾지 못했습니다');
      if (!s.includes('overdriveRelease')) {
        s = s.replace(
          /signingConfigs\s*\{/,
          `signingConfigs {
        overdriveRelease {
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }`,
        );
        const before = s;
        s = s.replace(/(release\s*\{[^}]*?)signingConfig\s+signingConfigs\.debug/, '$1signingConfig signingConfigs.overdriveRelease');
        if (s === before) throw new Error('release 빌드 타입의 서명 설정을 찾지 못했습니다');
      }
    }
    cfg.modResults.contents = s;
    return cfg;
  });
};
