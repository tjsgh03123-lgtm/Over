import { ALL_ITEMS, matchProfile, partOf, PARTS, type Equip } from './exerciseCatalog.ts';

/** 종목 선택·관리 목록에서 쓰는 최소 종목 정보 */
export interface ListExercise { id: string; name: string; category: string | null; weight_mode: string }

export interface PickItem<T extends ListExercise = ListExercise> {
  key: string;
  name: string;
  part: string;
  equip: Equip | null;
  /** 이미 만들어진 종목이면 그 행, 기본 종목 중 아직 안 쓴 것이면 null */
  row: T | null;
  /** 기본 종목에 없는, 직접 추가한 종목 */
  custom: boolean;
}
export interface PickGroup<T extends ListExercise = ListExercise> { part: string; items: PickItem<T>[] }

/** 목록·칩에 쓰는 부위 순서 (맨 뒤는 분류 없는 종목) */
export const GROUP_ORDER: string[] = [...PARTS, '기타'];

const n = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 장비: 기본 종목에 맞으면 그 장비, 직접 만든 체중 종목은 맨몸, 나머지는 알 수 없음(null) */
export function equipOf(name: string, mode?: string): Equip | null {
  return matchProfile(name)?.equip ?? (mode === 'bodyweight' ? '맨몸' : null);
}

/**
 * 하나로 합친 종목 목록: 부위별로 묶고, 각 부위 안에서는 직접 추가한 종목을 맨 위에, 그 아래에 기본 종목을 둔다.
 * includeCatalog=false면 이미 만들어진 종목만 (종목 관리용).
 */
export function buildPickGroups<T extends ListExercise>(
  rows: T[], opts: { part?: string | null; equip?: Equip | null; q?: string; includeCatalog?: boolean } = {},
): PickGroup<T>[] {
  const nq = n(opts.q ?? '');
  const includeCatalog = opts.includeCatalog ?? true;

  const byCatalog = new Map<string, T>();
  const customs: PickItem<T>[] = [];
  for (const row of rows) {
    const cat = ALL_ITEMS.find((c) => n(c.name) === n(row.name));
    if (cat) byCatalog.set(cat.name, row);
    else customs.push({ key: `e:${row.id}`, name: row.name, part: partOf(row.name, row.category), equip: equipOf(row.name, row.weight_mode), row, custom: true });
  }
  customs.sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  const catalogs: PickItem<T>[] = [];
  for (const c of ALL_ITEMS) {
    const row = byCatalog.get(c.name) ?? null;
    if (!row && !includeCatalog) continue;
    catalogs.push({ key: `c:${c.name}`, name: c.name, part: row ? partOf(row.name, row.category) : c.part, equip: c.equip, row, custom: false });
  }

  const aliasOf = new Map(ALL_ITEMS.map((c) => [c.name, c.aliases]));
  const pass = (it: PickItem<T>) => {
    if (opts.part && it.part !== opts.part) return false;
    if (opts.equip && it.equip !== opts.equip) return false;
    if (nq && !n(it.name).includes(nq) && !(aliasOf.get(it.name) ?? []).some((a) => n(a).includes(nq))) return false;
    return true;
  };

  const out: PickGroup<T>[] = [];
  for (const part of GROUP_ORDER) {
    const items = [...customs.filter((i) => i.part === part), ...catalogs.filter((i) => i.part === part)].filter(pass);
    if (items.length) out.push({ part, items });
  }
  return out;
}
