import { nowIso, uid, type Db } from './adapter.ts';
import type { Intensity, WeightMode } from '../domain/types.ts';

/** 사용자의 기본 예시 루틴. 앱 구조를 제한하지 않으며 모두 수정·삭제 가능. */
interface SeedExercise { name: string; mode?: WeightMode; category?: string }

const E = (name: string, category?: string, mode: WeightMode = 'weighted'): SeedExercise => ({ name, category, mode });

const MONDAY = [
  E('렛풀다운', '등'), E('시티드로우', '등'), E('숄더프레스 머신', '어깨'), E('해머 인클라인', '가슴'),
  E('닉레레', '하체'), E('시티드컬 이두', '팔'), E('케이블 바이셉', '팔'), E('스미스 클로즈그립', '팔'),
  E('케이블 푸시다운', '팔'),
  // 원문: "행잉 레그 레이즈 대체 운동 미정" → 별도 종목으로 두어 행잉 레그 레이즈 기록과 섞이지 않게 함
  E('행잉 레그 레이즈 대체 (미정)', '복근', 'bodyweight'),
];
const FULLBODY = (back: string) => [
  E('어시스트 풀업', '등', 'assisted'), E(back, '등'), E('프론트 스쿼트', '하체'), E('밀리터리 프레스', '어깨'),
  E('벤치프레스', '가슴'), E('데드리프트', '하체'), E('사이드 레터럴 레이즈', '어깨'),
  E('행잉 레그 레이즈', '복근', 'bodyweight'),
];

interface SeedTemplate { name: string; weekday: number; intensity: Intensity; exercises: SeedExercise[]; postCardio: boolean }
const TEMPLATES: SeedTemplate[] = [
  { name: '월요일 · 머신 중심 웨이트', weekday: 1, intensity: 'none', exercises: MONDAY, postCardio: false },
  { name: '수요일 · 전신 웨이트', weekday: 3, intensity: 'none', exercises: [
    E('어시스트 풀업', '등', 'assisted'), E('T바 로우', '등'), ...FULLBODY('').slice(2)], postCardio: true },
  { name: '금요일 · 고중량 전신 웨이트', weekday: 5, intensity: 'high', exercises: FULLBODY('시티드 로우'), postCardio: true },
  { name: '일요일 · 전신 웨이트', weekday: 0, intensity: 'none', exercises: FULLBODY('와이드 풀다운'), postCardio: true },
];

export async function seedDefaults(db: Db): Promise<boolean> {
  const done = await db.first<{ value: string }>("SELECT value FROM app_settings WHERE key = 'seeded_v1'");
  if (done) return false;

  await db.transaction(async () => {
    const ids = new Map<string, string>();
    const ensureEx = async (e: SeedExercise): Promise<string> => {
      const hit = ids.get(e.name);
      if (hit) return hit;
      const id = uid('ex');
      await db.run('INSERT INTO exercises (id, name, category, weight_mode, archived, created_at) VALUES (?,?,?,?,0,?)', [
        id, e.name, e.category ?? null, e.mode ?? 'weighted', nowIso(),
      ]);
      ids.set(e.name, id);
      return id;
    };

    const tplByWeekday = new Map<number, string>();
    for (const t of TEMPLATES) {
      const tid = uid('tpl');
      await db.run(
        'INSERT INTO workout_templates (id, name, default_intensity, post_cardio_min, is_default, created_at) VALUES (?,?,?,?,1,?)',
        [tid, t.name, t.intensity, t.postCardio ? 20 : null, nowIso()],
      );
      let pos = 0;
      for (const ex of t.exercises) {
        const eid = await ensureEx(ex);
        await db.run(
          'INSERT INTO workout_template_exercises (id, template_id, exercise_id, position, target_sets) VALUES (?,?,?,?,3)',
          [uid('twe'), tid, eid, pos++],
        );
      }
      tplByWeekday.set(t.weekday, tid);
    }

    // 요일 규칙: 월 웨이트 / 화 휴식 / 수 웨이트 / 목 중강도 유산소 / 금 고중량 / 토 중강도 유산소 / 일 웨이트
    const rules: { wd: number; kind: 'weights' | 'cardio' | 'rest'; intensity: Intensity; label: string }[] = [
      { wd: 1, kind: 'weights', intensity: 'none', label: '머신 중심 웨이트' },
      { wd: 2, kind: 'rest', intensity: 'none', label: '휴식' },
      { wd: 3, kind: 'weights', intensity: 'none', label: '전신 웨이트' },
      { wd: 4, kind: 'cardio', intensity: 'mid', label: '중강도 유산소' },
      { wd: 5, kind: 'weights', intensity: 'high', label: '고중량 전신 웨이트' },
      { wd: 6, kind: 'cardio', intensity: 'mid', label: '중강도 유산소' },
      { wd: 0, kind: 'weights', intensity: 'none', label: '전신 웨이트' },
    ];
    for (const r of rules) {
      await db.run(
        'INSERT INTO schedule_rules (id, weekday, kind, template_id, default_intensity, label) VALUES (?,?,?,?,?,?)',
        [uid('sch'), r.wd, r.kind, tplByWeekday.get(r.wd) ?? null, r.intensity, r.label],
      );
    }
    await db.run("INSERT INTO app_settings (key, value) VALUES ('seeded_v1', '1')");
    await db.run("INSERT INTO app_settings (key, value) VALUES ('default_sets', '3')");
  });
  return true;
}
