import React, { useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, Text, View } from 'react-native';
import { C, S } from './theme.ts';

/**
 * 웹 미리보기 전용: react-native-web의 Alert.alert는 아무것도 하지 않아서(삭제 확인 등이 안 됨)
 * 같은 모양의 확인 창을 직접 띄운다. 안드로이드 앱에서는 아무 영향이 없다.
 */
interface AlertButton { text?: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' }
interface Pending { title: string; message?: string; buttons: AlertButton[] }

let show: ((p: Pending) => void) | null = null;

if (Platform.OS === 'web') {
  (Alert as any).alert = (title: string, message?: string, buttons?: AlertButton[]) => {
    show?.({ title, message, buttons: buttons && buttons.length ? buttons : [{ text: '확인' }] });
  };
}

export function WebAlertHost() {
  const [p, setP] = useState<Pending | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    show = setP;
    return () => { show = null; };
  }, []);
  if (Platform.OS !== 'web' || !p) return null;
  const press = (b: AlertButton) => { setP(null); b.onPress?.(); };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setP(null)}>
      <View style={{ flex: 1, backgroundColor: C.overlay, alignItems: 'center', justifyContent: 'center', padding: S.xl }}>
        <View style={{ backgroundColor: C.card, borderRadius: 14, padding: S.lg, width: '100%', maxWidth: 340, borderWidth: 1, borderColor: C.line }}>
          <Text style={{ color: C.text, fontSize: 17, fontWeight: '800' }}>{p.title}</Text>
          {!!p.message && <Text style={{ color: C.muted, fontSize: 14, marginTop: 8, lineHeight: 20 }}>{p.message}</Text>}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: S.lg }}>
            {p.buttons.map((b, i) => (
              <Pressable key={i} onPress={() => press(b)} style={{ minHeight: 40, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: b.style === 'cancel' ? C.card2 : C.accent }}>
                <Text style={{ color: b.style === 'cancel' ? C.text : C.onAccent, fontWeight: '700' }}>{b.text ?? '확인'}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}
