import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

/** 앱 캐시에 파일을 쓰고 공유 시트(드라이브 저장, 카톡 등)로 내보낸다. 네트워크를 사용하지 않음. */
export async function shareTextFile(filename: string, content: string, mimeType: string): Promise<void> {
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
  if (!(await Sharing.isAvailableAsync())) throw new Error('이 기기에서는 공유 기능을 사용할 수 없습니다');
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: filename });
}

export async function pickTextFile(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets?.length) return null;
  return FileSystem.readAsStringAsync(res.assets[0].uri, { encoding: FileSystem.EncodingType.UTF8 });
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
