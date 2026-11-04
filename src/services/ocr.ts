/**
 * 온디바이스 OCR (Google ML Kit, 기기 내에서 처리 — 서버·AI API 호출 없음).
 * 네이티브 모듈이라 Expo Go에서는 동작하지 않고 개발 빌드/APK에서만 동작한다.
 * 모듈이 없거나 실패하면 'OCR_UNAVAILABLE'을 던지고, 화면은 수동 입력으로 안내한다.
 */
export async function recognizeText(imageUri: string): Promise<string> {
  let mod: any;
  try {
    mod = require('@react-native-ml-kit/text-recognition');
  } catch {
    throw new Error('OCR_UNAVAILABLE');
  }
  const TextRecognition = mod.default ?? mod;
  const korean = mod.TextRecognitionScript?.KOREAN;
  try {
    const result = korean ? await TextRecognition.recognize(imageUri, korean) : await TextRecognition.recognize(imageUri);
    return String(result?.text ?? '');
  } catch {
    throw new Error('OCR_UNAVAILABLE');
  }
}
