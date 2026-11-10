import type { Db } from './adapter.ts';
import { uid, localDateStr } from './adapter.ts';
import { addSessionExercise, finishSession, getOrCreateExercise, startFreeSession, updateSet } from './repo.ts';

/** 웹 미리보기에서 화면이 비어 보이지 않도록 넣는 샘플 기록(앱에는 들어가지 않는다) */
const PLAN: { daysAgo: number; title: string; items: { name: string; cat: string; w: number; r: number }[] }[] = [
  { daysAgo: 1, title: '푸시 데이', items: [{ name: '벤치프레스', cat: '가슴', w: 70, r: 8 }, { name: '숄더프레스', cat: '어깨', w: 30, r: 10 }, { name: '케이블 푸시다운', cat: '삼두', w: 25, r: 12 }] },
  { daysAgo: 3, title: '풀 데이', items: [{ name: '랫풀다운', cat: '등', w: 55, r: 10 }, { name: '시티드 로우', cat: '등', w: 50, r: 10 }, { name: '바벨 컬', cat: '이두', w: 25, r: 10 }] },
  { daysAgo: 5, title: '하체 데이', items: [{ name: '스쿼트', cat: '하체', w: 90, r: 6 }, { name: '레그프레스', cat: '하체', w: 160, r: 10 }] },
  { daysAgo: 8, title: '푸시 데이', items: [{ name: '벤치프레스', cat: '가슴', w: 67.5, r: 8 }, { name: '숄더프레스', cat: '어깨', w: 27.5, r: 10 }] },
  { daysAgo: 10, title: '풀 데이', items: [{ name: '랫풀다운', cat: '등', w: 52.5, r: 10 }, { name: '시티드 로우', cat: '등', w: 47.5, r: 10 }] },
  { daysAgo: 15, title: '푸시 데이', items: [{ name: '벤치프레스', cat: '가슴', w: 65, r: 8 }] },
  { daysAgo: 22, title: '하체 데이', items: [{ name: '스쿼트', cat: '하체', w: 85, r: 6 }] },
];

export async function seedDemo(db: Db): Promise<void> {
  const any = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM workout_sessions');
  if (any && any.n > 0) return;
  const now = new Date();
  for (const p of PLAN) {
    const d = new Date(now.getTime() - p.daysAgo * 86400000);
    const date = localDateStr(d);
    const sid = await startFreeSession(db, date, p.title);
    for (const it of p.items) {
      const ex = await getOrCreateExercise(db, it.name, { category: it.cat });
      const seId = await addSessionExercise(db, sid, ex.id, 3);
      const sets = await db.all<{ id: string }>('SELECT id FROM workout_sets WHERE session_exercise_id = ? ORDER BY set_no', [seId]);
      for (let i = 0; i < sets.length; i++) await updateSet(db, sets[i].id, { weight: it.w, reps: Math.max(1, it.r - i), done: true });
    }
    await finishSession(db, sid);
    const start = new Date(d.getTime()); start.setHours(18, 30, 0, 0);
    const end = new Date(start.getTime() + 62 * 60000);
    await db.run('UPDATE workout_sessions SET started_at=?, ended_at=?, duration_sec=? WHERE id=?', [start.toISOString(), end.toISOString(), 62 * 60, sid]);
  }
  const base = [71.2, 71.6, 72.0, 72.3, 72.8];
  for (let i = 0; i < base.length; i++) {
    const date = localDateStr(new Date(now.getTime() - (28 - i * 7) * 86400000));
    await db.run(
      "INSERT OR IGNORE INTO body_measurements (id, date, weight, skeletal_muscle, body_fat_mass, body_fat_pct, source, created_at) VALUES (?,?,?,?,?,?,'manual',?)",
      [uid('bm'), date, base[i], 32 + i * 0.3, 14.5 - i * 0.3, null, new Date().toISOString()],
    );
  }
}
