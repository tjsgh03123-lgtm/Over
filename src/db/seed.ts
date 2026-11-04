import type { Db } from './adapter.ts';

/**
 * 기본 루틴은 만들지 않는다 (루틴은 사용자가 직접 만들거나 AI에서 가져온다).
 * 예전 버전이 만들어 둔 기본 루틴·요일 일정·미사용 기본 종목은 업데이트 후 처음 실행할 때 한 번 정리한다.
 */

/** 예전 버전이 기본으로 넣어 두던 종목 이름 (기록이 없는 것만 삭제) */
const LEGACY_SEED_EXERCISES = [
  '렛풀다운', '시티드로우', '숄더프레스 머신', '해머 인클라인', '닉레레', '시티드컬 이두', '케이블 바이셉',
  '스미스 클로즈그립', '케이블 푸시다운', '행잉 레그 레이즈 대체 (미정)', '어시스트 풀업', '시티드 로우', '프론트 스쿼트',
  '밀리터리 프레스', '벤치프레스', '데드리프트', '사이드 레터럴 레이즈', '행잉 레그 레이즈', 'T바 로우', '와이드 풀다운',
];

export async function seedDefaults(db: Db): Promise<boolean> {
  const first = !(await db.first<{ value: string }>("SELECT value FROM app_settings WHERE key = 'seeded_v1'"));
  const migrated = !!(await db.first<{ value: string }>("SELECT value FROM app_settings WHERE key = 'migrated_v2'"));
  if (migrated) return false;

  await db.transaction(async () => {
    if (!first) {
      // 예전 버전에서 업데이트한 앱: 기본 루틴과 요일 일정을 모두 삭제 (완료한 기록·그래프는 유지됨)
      await db.run('DELETE FROM schedule_rules');
      await db.run('DELETE FROM workout_templates'); // 템플릿 종목은 함께 삭제, 과거 세션의 template_id는 NULL로
      await db.run("DELETE FROM app_settings WHERE key IN ('plan')");
      const ph = LEGACY_SEED_EXERCISES.map(() => '?').join(',');
      await db.run(
        `DELETE FROM exercises WHERE name IN (${ph})
           AND id NOT IN (SELECT DISTINCT exercise_id FROM workout_session_exercises)`,
        LEGACY_SEED_EXERCISES,
      );
    }
    await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('seeded_v1', '1')");
    await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('default_sets', '3')");
    await db.run("INSERT INTO app_settings (key, value) VALUES ('migrated_v2', '1')");
  });
  return first;
}
