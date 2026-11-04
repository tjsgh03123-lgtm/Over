export interface InBodyValues {
  weight: number | null;
  skeletal_muscle: number | null;
  body_fat_mass: number | null;
  body_fat_pct: number | null;
}

interface Rule {
  key: keyof InBodyValues;
  label: RegExp;
  min: number;
  max: number;
}

// 체지방률을 체지방량보다 먼저 검사: "체지방" 접두사가 겹치므로 라벨을 구체적으로 구분
const RULES: Rule[] = [
  { key: 'body_fat_pct', label: /체\s*지\s*방\s*률|percent\s*body\s*fat|body\s*fat\s*(?:percentage|%)|PBF/i, min: 2, max: 70 },
  { key: 'body_fat_mass', label: /체\s*지\s*방\s*량|body\s*fat\s*mass/i, min: 1, max: 150 },
  { key: 'skeletal_muscle', label: /골\s*격\s*근\s*량|skeletal\s*muscle\s*mass|SMM/i, min: 5, max: 80 },
  { key: 'weight', label: /체\s*중|(?<![a-z])weight(?![a-z])/i, min: 20, max: 300 },
];

/** 온디바이스 OCR 텍스트에서 4개 지표를 추정. 결과는 항상 사용자가 확인·수정한 뒤 저장한다. */
export function parseInBodyText(text: string): InBodyValues {
  const out: InBodyValues = { weight: null, skeletal_muscle: null, body_fat_mass: null, body_fat_pct: null };
  const src = text.replace(/\r/g, '');
  for (const r of RULES) {
    const re = new RegExp(r.label.source, r.label.flags.includes('g') ? r.label.flags : r.label.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const after = src.slice(m.index + m[0].length, m.index + m[0].length + 40);
      const num = /^[^\d\n]{0,18}\n?[^\d\n]{0,6}(\d{1,3}(?:[.,]\d{1,2})?)/.exec(after) ?? /^[^\d]{0,24}(\d{1,3}(?:[.,]\d{1,2})?)/.exec(after);
      if (!num) continue;
      const v = Number(num[1].replace(',', '.'));
      if (v >= r.min && v <= r.max) {
        out[r.key] = v;
        break;
      }
    }
  }
  return out;
}
