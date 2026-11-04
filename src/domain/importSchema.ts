/** 외부 AI(GPT·Claude·Gemini 등)에 복사해 붙일 표준 JSON Schema와 프롬프트 */
export const ROUTINE_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'OVERDRIVE Routine Import',
  type: 'object',
  required: ['routine'],
  properties: {
    version: { type: 'integer', const: 2 },
    routine: {
      type: 'object',
      description: '루틴 = 한 사이클 전체. 하나만 만든다.',
      required: ['name', 'days'],
      properties: {
        name: { type: 'string', description: '루틴 이름 (예: 3분할 근비대 루틴)' },
        mode: {
          enum: ['cycle', 'weekday'],
          description: 'cycle = days를 순서대로 N일마다 반복 / weekday = 날마다 weekday(요일)를 지정',
        },
        days: {
          type: 'array',
          description: '사이클의 날들. cycle이면 순서가 곧 1일차, 2일차 …',
          items: {
            type: 'object',
            required: ['name', 'type'],
            properties: {
              name: { type: 'string', description: '그 날의 이름 (예: 가슴·삼두, 하체, 휴식)' },
              type: { enum: ['weights', 'cardio', 'rest'], description: '웨이트 / 유산소 / 휴식' },
              weekday: {
                description: 'mode가 weekday일 때만: 0=일 … 6=토 또는 "월"/"월요일"',
                oneOf: [{ type: 'integer', minimum: 0, maximum: 6 }, { type: 'string' }],
              },
              exercises: {
                type: 'array',
                description: 'type이 weights일 때 종목 목록 (rest·cardio는 빈 배열)',
                items: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                    sets: { type: 'integer', minimum: 1, default: 3 },
                    reps: { oneOf: [{ type: 'integer' }, { type: 'string', description: '"8-12" 형식 가능' }] },
                    weight: { type: 'number', description: 'kg, 모르면 생략' },
                    restSec: { type: 'integer', description: '세트 간 휴식(초)' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

/** 사용자가 원하는 루틴을 적는 자리는 항상 맨 아래, 구분선 밑 */
export const AI_PROMPT_DIVIDER = '----------아래에 원하는 루틴을 입력하세요----------';

export const AI_IMPORT_PROMPT = `아래 JSON Schema를 정확히 따르는 운동 루틴 하나를 만들어 주세요.
- 루틴은 "한 사이클 전체"입니다. routine 하나에 days(날)를 순서대로 담으세요.
- 출력은 JSON 코드블록 하나만, 설명 문장 없이.
- mode가 "cycle"이면 days 순서대로 반복됩니다 (예: 상체, 하체, 휴식 → 3일 주기). weekday는 쓰지 않습니다.
- mode가 "weekday"이면 날마다 weekday를 0(일)~6(토) 정수로 지정하고, 지정하지 않은 요일은 휴식입니다.
- 휴식 날은 {"name":"휴식","type":"rest","exercises":[]}, 유산소 날은 {"name":"유산소","type":"cardio","exercises":[]}.
- 모르는 값(weight 등)은 생략하세요. 값을 지어내지 마세요.

[JSON Schema]
${JSON.stringify(ROUTINE_JSON_SCHEMA, null, 2)}

[예시]
{"version":2,"routine":{"name":"3분할 루틴","mode":"cycle","days":[{"name":"가슴·삼두","type":"weights","exercises":[{"name":"벤치프레스","sets":4,"reps":"6-8"},{"name":"케이블 푸시다운","sets":3,"reps":12}]},{"name":"등·이두","type":"weights","exercises":[{"name":"렛풀다운","sets":4,"reps":"8-10"}]},{"name":"휴식","type":"rest","exercises":[]}]}}

${AI_PROMPT_DIVIDER}

`;
