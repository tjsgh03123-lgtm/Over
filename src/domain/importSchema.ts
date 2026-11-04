/** 외부 AI(GPT·Claude·Gemini 등)에 복사해 붙일 표준 JSON Schema와 프롬프트 */
export const ROUTINE_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'OVERDRIVE Routine Import',
  type: 'object',
  required: ['routines'],
  properties: {
    version: { type: 'integer', const: 1 },
    routines: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'exercises'],
        properties: {
          name: { type: 'string', description: '루틴 이름 (예: 월요일 머신 중심)' },
          weekday: {
            description: '요일: 0=일 … 6=토 또는 "월"/"월요일". 요일이 없으면 생략',
            oneOf: [{ type: 'integer', minimum: 0, maximum: 6 }, { type: 'string' }],
          },
          intensity: { enum: ['high', 'mid', 'low', 'none'], description: '운동일 기본 강도' },
          rest: { type: 'boolean', description: '휴식일이면 true' },
          exercises: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                sets: { type: 'integer', minimum: 1, default: 3 },
                reps: { oneOf: [{ type: 'integer' }, { type: 'string', description: '"8-12" 형식 가능' }] },
                weight: { type: 'number', description: 'kg, 모르면 생략' },
                intensity: { enum: ['high', 'mid', 'low', 'none'] },
                restSec: { type: 'integer', description: '세트 간 휴식(초)' },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const AI_IMPORT_PROMPT = `아래 JSON Schema를 정확히 따르는 운동 루틴을 만들어 주세요.
- 출력은 JSON 코드블록 하나만, 설명 문장 없이.
- weekday는 0(일)~6(토) 정수, 휴식일은 {"name":"휴식","weekday":2,"rest":true,"exercises":[]}.
- intensity는 "high"(고중량) | "mid"(중간중량) | "low"(저중량) | "none" 중 하나.
- 모르는 값(weight 등)은 생략하세요. 값을 지어내지 마세요.

[내 조건]
(여기에 목표, 주당 운동일수, 사용 가능한 장비 등을 적어 주세요)

[JSON Schema]
${JSON.stringify(ROUTINE_JSON_SCHEMA, null, 2)}

[예시]
{"version":1,"routines":[{"name":"월요일 머신","weekday":1,"intensity":"mid","exercises":[{"name":"렛풀다운","sets":3,"reps":"8-12","restSec":90},{"name":"시티드 로우","sets":3,"reps":10}]}]}`;
