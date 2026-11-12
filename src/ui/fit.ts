import { useWindowDimensions } from 'react-native';

/** 작은 폰(폭 320·높이 568 등)에서 큰 숫자·제목이 화면을 넘치지 않도록 글자 크기를 화면에 맞춰 줄인다 */
export function useFit() {
  const { width, height } = useWindowDimensions();
  const k = Math.max(0.55, Math.min(1, Math.min(height / 780, width / 380)));
  return (n: number) => Math.round(n * k);
}
