/**
 * 대중적인 운동 182개 표. 순서 = 대중성 순위(공개 통계 StrengthLog·Fitbod·Arvo 등을 참고한 대략의 순서이며 정확한 순위는 아님).
 * 각 운동의 "움직임 유형"은 근육·궤적 기준의 분류이고, 카메라가 구분할 수 있는 굵은 유형(CoarsePattern)은 COARSE_OF로 따로 묶는다.
 * 카메라로는 바벨/덤벨/머신 같은 도구를 구분할 수 없으므로, 판별은 항상 움직임 유형 단위로만 한다.
 */
export type Tier = 'A' | 'B' | 'C';
export type Row = readonly [ko: string, en: string, part: string, equip: string, pattern: string, posture: string, tier: Tier];

export const EXERCISE_TABLE: readonly Row[] = [
  ["벤치프레스", "Barbell Bench Press", "가슴", "바벨", "수평 밀기", "누움", "A"],
  ["인클라인 덤벨 프레스", "Incline Dumbbell Press", "가슴", "덤벨", "경사 밀기", "경사 누움", "A"],
  ["덤벨 체스트 프레스", "Dumbbell Chest Press", "가슴", "덤벨", "수평 밀기", "누움", "A"],
  ["스탠딩 케이블 체스트 플라이", "Standing Cable Chest Fly", "가슴", "케이블", "가슴 모으기", "서기", "A"],
  ["클로즈그립 벤치프레스", "Close-Grip Bench Press", "가슴", "바벨", "수평 밀기", "누움", "A"],
  ["푸시업", "Push-Up", "가슴", "맨몸", "푸시업", "엎드림", "A"],
  ["인클라인 벤치프레스", "Incline Barbell Bench Press", "가슴", "바벨", "경사 밀기", "경사 누움", "B"],
  ["덤벨 플라이", "Dumbbell Fly", "가슴", "덤벨", "가슴 모으기", "누움", "B"],
  ["펙덱 플라이(머신 플라이)", "Pec Deck Fly", "가슴", "머신", "가슴 모으기", "앉음", "B"],
  ["체스트 프레스 머신", "Machine Chest Press", "가슴", "머신", "수평 밀기", "앉음", "B"],
  ["케이블 크로스오버", "Cable Crossover", "가슴", "케이블", "가슴 모으기", "서기", "B"],
  ["디클라인 벤치프레스", "Decline Bench Press", "가슴", "바벨", "하향 밀기", "디클라인", "B"],
  ["딥스(가슴)", "Chest Dip", "가슴", "맨몸", "수직 밀기(딥)", "매달림", "B"],
  ["인클라인 체스트 프레스 머신", "Incline Machine Press", "가슴", "머신", "경사 밀기", "앉음", "B"],
  ["스미스머신 벤치프레스", "Smith Machine Bench Press", "가슴", "스미스", "수평 밀기", "누움", "B"],
  ["스미스머신 인클라인 프레스", "Smith Machine Incline Press", "가슴", "스미스", "경사 밀기", "경사 누움", "B"],
  ["인클라인 덤벨 플라이", "Incline Dumbbell Fly", "가슴", "덤벨", "가슴 모으기", "경사 누움", "C"],
  ["디클라인 푸시업", "Decline Push-Up", "가슴", "맨몸", "푸시업", "엎드림", "C"],
  ["인클라인 푸시업", "Incline Push-Up", "가슴", "맨몸", "푸시업", "엎드림", "C"],
  ["무릎 푸시업", "Knee Push-Up", "가슴", "맨몸", "푸시업", "엎드림", "C"],
  ["다이아몬드 푸시업", "Diamond Push-Up", "가슴", "맨몸", "푸시업", "엎드림", "C"],
  ["덤벨 풀오버", "Dumbbell Pullover", "가슴", "덤벨", "풀오버", "누움", "C"],
  ["케이블 체스트 프레스", "Cable Chest Press", "가슴", "케이블", "수평 밀기", "서기", "C"],
  ["플로어 프레스", "Floor Press", "가슴", "바벨", "수평 밀기", "누움", "C"],
  ["해머스트렝스 체스트 프레스", "Hammer Strength Chest Press", "가슴", "머신", "수평 밀기", "앉음", "C"],
  ["로우 케이블 플라이", "Low Cable Fly", "가슴", "케이블", "가슴 모으기", "서기", "C"],
  ["랫풀다운", "Lat Pulldown", "등", "케이블", "수직 당기기", "앉음", "A"],
  ["바벨 로우", "Barbell Row", "등", "바벨", "수평 당기기", "숙임", "A"],
  ["시티드 케이블 로우", "Seated Cable Row", "등", "케이블", "수평 당기기", "앉음", "A"],
  ["덤벨 로우", "Dumbbell Row", "등", "덤벨", "수평 당기기", "숙임", "A"],
  ["풀업", "Pull-Up", "등", "맨몸", "수직 당기기", "매달림", "A"],
  ["페이스풀", "Face Pull", "어깨", "케이블", "후면 당기기", "서기", "A"],
  ["데드리프트", "Deadlift", "등", "바벨", "힙힌지", "서기", "A"],
  ["친업", "Chin-Up", "등", "맨몸", "수직 당기기", "매달림", "B"],
  ["티바 로우", "T-Bar Row", "등", "바벨", "수평 당기기", "숙임", "B"],
  ["원암 덤벨 로우", "One-Arm Dumbbell Row", "등", "덤벨", "수평 당기기", "숙임", "B"],
  ["머신 로우", "Machine Row", "등", "머신", "수평 당기기", "앉음", "B"],
  ["어시스트 풀업 머신", "Assisted Pull-Up Machine", "등", "머신", "수직 당기기", "앉음", "B"],
  ["와이드 그립 랫풀다운", "Wide-Grip Lat Pulldown", "등", "케이블", "수직 당기기", "앉음", "B"],
  ["클로즈그립 랫풀다운", "Close-Grip Lat Pulldown", "등", "케이블", "수직 당기기", "앉음", "B"],
  ["스트레이트암 풀다운", "Straight-Arm Pulldown", "등", "케이블", "풀오버", "서기", "B"],
  ["펜들레이 로우", "Pendlay Row", "등", "바벨", "수평 당기기", "숙임", "C"],
  ["체스트 서포티드 로우", "Chest-Supported Row", "등", "덤벨", "수평 당기기", "엎드려 기댐", "C"],
  ["인버티드 로우(바디로우)", "Inverted Row", "등", "맨몸", "수평 당기기", "누운 매달림", "C"],
  ["백 익스텐션", "Back Extension", "등", "맨몸", "힙힌지", "엎드림", "B"],
  ["굿모닝", "Good Morning", "등", "바벨", "힙힌지", "서기", "C"],
  ["랙풀", "Rack Pull", "등", "바벨", "힙힌지", "서기", "C"],
  ["케이블 풀오버", "Cable Pullover", "등", "케이블", "풀오버", "서기", "C"],
  ["싱글암 랫풀다운", "Single-Arm Lat Pulldown", "등", "케이블", "수직 당기기", "앉음", "C"],
  ["바벨 슈러그", "Barbell Shrug", "어깨", "바벨", "승모 올리기", "서기", "B"],
  ["덤벨 슈러그", "Dumbbell Shrug", "어깨", "덤벨", "승모 올리기", "서기", "B"],
  ["슈퍼맨", "Superman", "등", "맨몸", "후면 들기", "엎드림", "C"],
  ["오버헤드 프레스", "Overhead Press", "어깨", "바벨", "수직 밀기", "서기", "A"],
  ["덤벨 사이드 레터럴 레이즈", "Dumbbell Lateral Raise", "어깨", "덤벨", "측면 들기", "서기", "A"],
  ["덤벨 숄더프레스", "Dumbbell Shoulder Press", "어깨", "덤벨", "수직 밀기", "앉음", "A"],
  ["프런트 레이즈", "Front Raise", "어깨", "덤벨", "전면 들기", "서기", "B"],
  ["리어 델트 플라이", "Rear Delt Fly", "어깨", "덤벨", "후면 들기", "숙임", "B"],
  ["리버스 펙덱", "Reverse Pec Deck", "어깨", "머신", "후면 들기", "앉음", "B"],
  ["숄더프레스 머신", "Machine Shoulder Press", "어깨", "머신", "수직 밀기", "앉음", "B"],
  ["아놀드 프레스", "Arnold Press", "어깨", "덤벨", "수직 밀기", "앉음", "B"],
  ["케이블 레터럴 레이즈", "Cable Lateral Raise", "어깨", "케이블", "측면 들기", "서기", "B"],
  ["머신 레터럴 레이즈", "Machine Lateral Raise", "어깨", "머신", "측면 들기", "앉음", "B"],
  ["업라이트 로우", "Upright Row", "어깨", "바벨", "승모 올리기", "서기", "B"],
  ["밀리터리 프레스", "Military Press", "어깨", "바벨", "수직 밀기", "서기", "B"],
  ["스미스머신 숄더프레스", "Smith Machine Shoulder Press", "어깨", "스미스", "수직 밀기", "앉음", "C"],
  ["푸시 프레스", "Push Press", "어깨", "바벨", "수직 밀기", "서기", "C"],
  ["케이블 프런트 레이즈", "Cable Front Raise", "어깨", "케이블", "전면 들기", "서기", "C"],
  ["플레이트 프런트 레이즈", "Plate Front Raise", "어깨", "원판", "전면 들기", "서기", "C"],
  ["파이크 푸시업", "Pike Push-Up", "어깨", "맨몸", "수직 밀기", "엎드림", "C"],
  ["핸드스탠드 푸시업", "Handstand Push-Up", "어깨", "맨몸", "수직 밀기", "거꾸로", "C"],
  ["케이블 리어 델트 플라이", "Cable Rear Delt Fly", "어깨", "케이블", "후면 들기", "서기", "C"],
  ["스쿼트", "Barbell Squat", "하체", "바벨", "스쿼트", "서기", "A"],
  ["레그 익스텐션", "Leg Extension", "하체", "머신", "무릎 펴기", "앉음", "A"],
  ["레그프레스", "Leg Press", "하체", "머신", "레그프레스", "앉음", "A"],
  ["라잉 레그컬", "Lying Leg Curl", "하체", "머신", "무릎 굽히기", "엎드림", "A"],
  ["루마니안 데드리프트", "Romanian Deadlift", "하체", "바벨", "힙힌지", "서기", "A"],
  ["시티드 레그컬", "Seated Leg Curl", "하체", "머신", "무릎 굽히기", "앉음", "A"],
  ["힙쓰러스트", "Hip Thrust", "하체", "바벨", "힙쓰러스트", "누움(등 받침)", "A"],
  ["불가리안 스플릿 스쿼트", "Bulgarian Split Squat", "하체", "덤벨", "런지", "서기", "A"],
  ["스티프레그 데드리프트", "Stiff-Leg Deadlift", "하체", "바벨", "힙힌지", "서기", "A"],
  ["힙 어브덕션 머신", "Hip Abduction Machine", "하체", "머신", "고관절 벌리기", "앉음", "A"],
  ["프런트 스쿼트", "Front Squat", "하체", "바벨", "스쿼트", "서기", "B"],
  ["핵 스쿼트", "Hack Squat", "하체", "머신", "스쿼트", "기댄 서기", "B"],
  ["스미스머신 스쿼트", "Smith Machine Squat", "하체", "스미스", "스쿼트", "서기", "B"],
  ["고블릿 스쿼트", "Goblet Squat", "하체", "덤벨", "스쿼트", "서기", "B"],
  ["워킹 런지", "Walking Lunge", "하체", "덤벨", "런지", "서기", "B"],
  ["리버스 런지", "Reverse Lunge", "하체", "덤벨", "런지", "서기", "B"],
  ["런지", "Lunge", "하체", "맨몸", "런지", "서기", "B"],
  ["스플릿 스쿼트", "Split Squat", "하체", "맨몸", "런지", "서기", "B"],
  ["스텝업", "Step-Up", "하체", "덤벨", "런지", "서기", "B"],
  ["힙 어덕션 머신", "Hip Adduction Machine", "하체", "머신", "고관절 모으기", "앉음", "B"],
  ["스탠딩 카프 레이즈", "Standing Calf Raise", "하체", "머신", "발끝 들기", "서기", "B"],
  ["시티드 카프 레이즈", "Seated Calf Raise", "하체", "머신", "발끝 들기", "앉음", "B"],
  ["레그프레스 카프 레이즈", "Leg Press Calf Raise", "하체", "머신", "발끝 들기", "앉음", "B"],
  ["글루트 브릿지", "Glute Bridge", "하체", "맨몸", "힙쓰러스트", "누움", "B"],
  ["맨몸 스쿼트", "Bodyweight Squat", "하체", "맨몸", "스쿼트", "서기", "B"],
  ["덤벨 루마니안 데드리프트", "Dumbbell Romanian Deadlift", "하체", "덤벨", "힙힌지", "서기", "B"],
  ["스모 데드리프트", "Sumo Deadlift", "하체", "바벨", "힙힌지", "서기", "B"],
  ["트랩바 데드리프트", "Trap Bar Deadlift", "하체", "바벨", "힙힌지", "서기", "B"],
  ["케이블 풀스루", "Cable Pull-Through", "하체", "케이블", "힙힌지", "서기", "C"],
  ["케이블 킥백", "Cable Kickback", "하체", "케이블", "고관절 펴기", "서기", "B"],
  ["카프 레이즈(맨몸)", "Bodyweight Calf Raise", "하체", "맨몸", "발끝 들기", "서기", "B"],
  ["노르딕 햄스트링 컬", "Nordic Hamstring Curl", "하체", "맨몸", "무릎 굽히기", "무릎 서기", "C"],
  ["싱글레그 힙쓰러스트", "Single-Leg Hip Thrust", "하체", "맨몸", "힙쓰러스트", "누움(등 받침)", "C"],
  ["싱글레그 루마니안 데드리프트", "Single-Leg RDL", "하체", "덤벨", "힙힌지", "서기", "C"],
  ["점핑 스쿼트", "Jump Squat", "하체", "맨몸", "점프", "서기", "C"],
  ["월 싯(벽 스쿼트)", "Wall Sit", "하체", "맨몸", "정적 버티기", "기댄 서기", "C"],
  ["사이드 런지", "Lateral Lunge", "하체", "맨몸", "런지", "서기", "C"],
  ["커츠시 런지", "Curtsy Lunge", "하체", "맨몸", "런지", "서기", "C"],
  ["박스 스쿼트", "Box Squat", "하체", "바벨", "스쿼트", "서기", "C"],
  ["제퍼슨 스쿼트", "Zercher Squat", "하체", "바벨", "스쿼트", "서기", "C"],
  ["피스톨 스쿼트", "Pistol Squat", "하체", "맨몸", "스쿼트", "서기", "C"],
  ["케이블 힙 어브덕션", "Cable Hip Abduction", "하체", "케이블", "고관절 벌리기", "서기", "C"],
  ["글루트 킥백 머신", "Glute Kickback Machine", "하체", "머신", "고관절 펴기", "서기", "C"],
  ["싯업 레그컬(스탠딩 레그컬)", "Standing Leg Curl", "하체", "머신", "무릎 굽히기", "서기", "C"],
  ["바벨 컬", "Barbell Curl", "이두", "바벨", "팔꿈치 굽히기", "서기", "A"],
  ["덤벨 컬", "Dumbbell Curl", "이두", "덤벨", "팔꿈치 굽히기", "서기", "A"],
  ["해머 컬", "Hammer Curl", "이두", "덤벨", "팔꿈치 굽히기", "서기", "A"],
  ["EZ바 컬", "EZ-Bar Curl", "이두", "바벨", "팔꿈치 굽히기", "서기", "B"],
  ["프리처 컬", "Preacher Curl", "이두", "머신", "팔꿈치 굽히기", "앉음", "B"],
  ["인클라인 덤벨 컬", "Incline Dumbbell Curl", "이두", "덤벨", "팔꿈치 굽히기", "경사 누움", "B"],
  ["케이블 컬", "Cable Curl", "이두", "케이블", "팔꿈치 굽히기", "서기", "B"],
  ["컨센트레이션 컬", "Concentration Curl", "이두", "덤벨", "팔꿈치 굽히기", "앉음", "B"],
  ["스파이더 컬", "Spider Curl", "이두", "덤벨", "팔꿈치 굽히기", "엎드려 기댐", "C"],
  ["리버스 컬", "Reverse Curl", "이두", "바벨", "팔꿈치 굽히기", "서기", "C"],
  ["케이블 해머 컬(로프)", "Cable Rope Hammer Curl", "이두", "케이블", "팔꿈치 굽히기", "서기", "B"],
  ["머신 바이셉 컬", "Machine Biceps Curl", "이두", "머신", "팔꿈치 굽히기", "앉음", "B"],
  ["얼터네이트 덤벨 컬", "Alternating Dumbbell Curl", "이두", "덤벨", "팔꿈치 굽히기", "서기", "B"],
  ["드래그 컬", "Drag Curl", "이두", "바벨", "팔꿈치 굽히기", "서기", "C"],
  ["리스트 컬", "Wrist Curl", "팔", "바벨", "손목 굽히기", "앉음", "C"],
  ["바 푸시다운", "Tricep Pushdown (Bar)", "삼두", "케이블", "팔꿈치 펴기", "서기", "A"],
  ["로프 푸시다운", "Tricep Pushdown (Rope)", "삼두", "케이블", "팔꿈치 펴기", "서기", "A"],
  ["스컬크러셔(라잉 트라이셉 익스텐션)", "Skullcrusher", "삼두", "바벨", "팔꿈치 펴기", "누움", "B"],
  ["오버헤드 트라이셉 익스텐션", "Overhead Triceps Extension", "삼두", "덤벨", "팔꿈치 펴기", "서기/앉음", "B"],
  ["케이블 오버헤드 트라이셉 익스텐션", "Cable Overhead Triceps Extension", "삼두", "케이블", "팔꿈치 펴기", "서기", "B"],
  ["딥스(삼두)", "Triceps Dip", "삼두", "맨몸", "수직 밀기(딥)", "매달림", "B"],
  ["벤치 딥스", "Bench Dip", "삼두", "맨몸", "수직 밀기(딥)", "앉은 지지", "B"],
  ["킥백", "Triceps Kickback", "삼두", "덤벨", "팔꿈치 펴기", "숙임", "B"],
  ["덤벨 스컬크러셔", "Dumbbell Skullcrusher", "삼두", "덤벨", "팔꿈치 펴기", "누움", "C"],
  ["리버스 그립 푸시다운", "Reverse-Grip Pushdown", "삼두", "케이블", "팔꿈치 펴기", "서기", "C"],
  ["싱글암 푸시다운", "Single-Arm Pushdown", "삼두", "케이블", "팔꿈치 펴기", "서기", "C"],
  ["딥스 머신", "Dip Machine", "삼두", "머신", "수직 밀기(딥)", "앉음", "C"],
  ["트라이셉 익스텐션 머신", "Machine Triceps Extension", "삼두", "머신", "팔꿈치 펴기", "앉음", "C"],
  ["플랭크", "Plank", "복근", "맨몸", "정적 버티기", "엎드림", "B"],
  ["크런치", "Crunch", "복근", "맨몸", "상체 굽히기", "누움", "B"],
  ["싯업", "Sit-Up", "복근", "맨몸", "상체 굽히기", "누움", "B"],
  ["레그레이즈", "Lying Leg Raise", "복근", "맨몸", "다리 들기", "누움", "B"],
  ["행잉 레그레이즈", "Hanging Leg Raise", "복근", "맨몸", "다리 들기", "매달림", "B"],
  ["행잉 니레이즈", "Hanging Knee Raise", "복근", "맨몸", "다리 들기", "매달림", "B"],
  ["케이블 크런치", "Cable Crunch", "복근", "케이블", "상체 굽히기", "무릎 서기", "B"],
  ["러시안 트위스트", "Russian Twist", "복근", "맨몸", "몸통 회전", "앉음", "B"],
  ["바이시클 크런치", "Bicycle Crunch", "복근", "맨몸", "몸통 회전", "누움", "B"],
  ["마운틴 클라이머", "Mountain Climber", "복근", "맨몸", "전신 반복(유산소형)", "엎드림", "B"],
  ["사이드 플랭크", "Side Plank", "복근", "맨몸", "정적 버티기", "옆 엎드림", "B"],
  ["앱 롤아웃(휠)", "Ab Wheel Rollout", "복근", "휠", "몸통 펴기", "무릎 서기", "B"],
  ["데드버그", "Dead Bug", "복근", "맨몸", "다리 들기", "누움", "C"],
  ["버드독", "Bird Dog", "복근", "맨몸", "정적 버티기", "네발", "C"],
  ["토즈 투 바", "Toes-to-Bar", "복근", "맨몸", "다리 들기", "매달림", "C"],
  ["V업", "V-Up", "복근", "맨몸", "상체 굽히기", "누움", "C"],
  ["플러터 킥", "Flutter Kick", "복근", "맨몸", "다리 들기", "누움", "C"],
  ["할로우 바디 홀드", "Hollow Body Hold", "복근", "맨몸", "정적 버티기", "누움", "C"],
  ["우드찹", "Cable Woodchop", "복근", "케이블", "몸통 회전", "서기", "C"],
  ["팔로프 프레스", "Pallof Press", "복근", "케이블", "정적 버티기", "서기", "C"],
  ["리버스 크런치", "Reverse Crunch", "복근", "맨몸", "다리 들기", "누움", "C"],
  ["싯업 머신(복근 머신)", "Ab Crunch Machine", "복근", "머신", "상체 굽히기", "앉음", "C"],
  ["힙 레이즈 에어", "Decline Sit-Up", "복근", "맨몸", "상체 굽히기", "디클라인", "C"],
  ["백 익스텐션(로만체어)", "Roman Chair Back Extension", "등", "머신", "힙힌지", "엎드림", "B"],
  ["버피", "Burpee", "전신", "맨몸", "전신 반복(유산소형)", "서기/엎드림", "B"],
  ["점핑잭", "Jumping Jack", "전신", "맨몸", "점프", "서기", "B"],
  ["케틀벨 스윙", "Kettlebell Swing", "전신", "케틀벨", "힙힌지", "서기", "B"],
  ["클린", "Power Clean", "전신", "바벨", "전신 폭발", "서기", "C"],
  ["스내치", "Snatch", "전신", "바벨", "전신 폭발", "서기", "C"],
  ["파머스 워크", "Farmer's Walk", "전신", "덤벨", "운반", "서기", "C"],
  ["박스 점프", "Box Jump", "하체", "맨몸", "점프", "서기", "C"],
  ["로프(배틀로프)", "Battle Ropes", "전신", "로프", "전신 반복(유산소형)", "서기", "C"],
  ["싱글레그 데드리프트(케틀벨)", "Kettlebell Single-Leg Deadlift", "하체", "케틀벨", "힙힌지", "서기", "C"],
  ["터키시 겟업", "Turkish Get-Up", "전신", "케틀벨", "전신 복합", "누움→서기", "C"],
  ["슬레드 푸시", "Sled Push", "하체", "슬레드", "운반", "서기", "C"],
  ["하이니 러닝(제자리 달리기)", "High Knees", "전신", "맨몸", "점프", "서기", "C"],
  ["머슬업", "Muscle-Up", "등", "맨몸", "수직 당기기", "매달림", "C"],
  ["L싯", "L-Sit", "복근", "맨몸", "정적 버티기", "지지", "C"],
  ["덤벨 쓰러스터", "Dumbbell Thruster", "전신", "덤벨", "전신 복합", "서기", "C"],
] as unknown as readonly Row[];

/** 카메라(관절 33점)로 구분할 수 있는 굵은 동작 유형 */
export type CoarsePattern =
  | 'squat' | 'hinge' | 'lunge' | 'pushH' | 'pushUp' | 'pushV' | 'pullV' | 'pullH'
  | 'curlExt' | 'lift' | 'shrug' | 'legExt' | 'calf' | 'bridge' | 'core';

export const COARSE_LABEL: Record<CoarsePattern, string> = {
  squat: '스쿼트·레그프레스', hinge: '힙힌지(데드리프트·굿모닝)', lunge: '런지', pushH: '가슴 밀기(벤치·플라이)', pushUp: '몸 밀어 올리기(푸시업·딥스)',
  pushV: '머리 위로 밀기(숄더프레스)', pullV: '수직 당기기(풀다운·턱걸이)', pullH: '수평 당기기(로우)', curlExt: '팔꿈치 굽히고 펴기(컬·푸시다운)',
  lift: '팔 들기(레이즈·풀오버)', shrug: '어깨 으쓱(슈러그)', legExt: '무릎 펴고 굽히기(레그 익스텐션·컬)', calf: '발끝 들기(카프 레이즈)',
  bridge: '엉덩이 들기(힙쓰러스트)', core: '복근(크런치·레그레이즈)',
};

/** 표의 움직임 유형 → 굵은 유형. 여기 없는 것(버티기·점프·운반 등)은 카메라로 구분하지 않는다 */
export const COARSE_OF: Record<string, CoarsePattern> = {
  '스쿼트': 'squat', '레그프레스': 'squat', '힙힌지': 'hinge', '런지': 'lunge',
  '수평 밀기': 'pushH', '경사 밀기': 'pushH', '하향 밀기': 'pushH', '가슴 모으기': 'pushH',
  '푸시업': 'pushUp', '수직 밀기(딥)': 'pushUp', '수직 밀기': 'pushV', '수직 당기기': 'pullV',
  '수평 당기기': 'pullH', '후면 당기기': 'pullH', '팔꿈치 굽히기': 'curlExt', '팔꿈치 펴기': 'curlExt',
  '측면 들기': 'lift', '전면 들기': 'lift', '후면 들기': 'lift', '풀오버': 'lift', '승모 올리기': 'shrug',
  '무릎 펴기': 'legExt', '무릎 굽히기': 'legExt', '발끝 들기': 'calf', '힙쓰러스트': 'bridge',
  '상체 굽히기': 'core', '다리 들기': 'core', '몸통 회전': 'core', '몸통 펴기': 'core',
};

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_·.]/g, '');
/** "이름(별칭)" → ['이름','별칭'] */
function namesOf(ko: string): string[] {
  const m = ko.match(/^(.*?)\((.*)\)\s*$/);
  return (m ? [m[1], m[2]] : [ko]).map(norm).filter(Boolean);
}
let index: { key: string; row: Row }[] | null = null;
function idx() {
  if (!index) {
    index = [];
    for (const r of EXERCISE_TABLE) {
      for (const k of namesOf(r[0])) index.push({ key: k, row: r });
      index.push({ key: norm(r[1]), row: r });
    }
  }
  return index;
}

/** 이름으로 표에서 찾기: 완전히 같으면 그것, 아니면 서로 포함하는 것 중 가장 긴 이름. 없으면 null */
export function lookupExercise(name: string): Row | null {
  const q = norm(name);
  if (!q) return null;
  let best: { len: number; row: Row } | null = null;
  for (const { key, row } of idx()) {
    if (key === q) return row;
    if (key.length >= 3 && (q.includes(key) || (q.length >= 3 && key.includes(q)))) {
      if (!best || key.length > best.len) best = { len: key.length, row };
    }
  }
  return best ? best.row : null;
}

/** 운동 이름 → 카메라가 구분하는 굵은 유형. 구분 대상이 아니면 null */
export function coarseOfExercise(name: string): CoarsePattern | null {
  const r = lookupExercise(name);
  return r ? COARSE_OF[r[4]] ?? null : null;
}
