# Google Play 출시 준비 (OVERDRIVE)

이 폴더와 `.github/workflows/build-aab.yml` 로 Play Console에 올릴 준비가 되어 있습니다.
**아직 사람이 직접 해야 하는 것**은 아래 1~5번입니다.

## 1. Play 개발자 계정
- https://play.google.com/console 에서 개발자 계정 등록 (일회성 등록비, 본인 인증 필요)
- 개인 계정은 신규 계정이면 **비공개 테스트(최소 인원·최소 기간)를 마쳐야 프로덕션 신청**이 가능한 정책이 있습니다. 인원·기간은 바뀔 수 있으니 콘솔 안내를 확인하세요.

## 2. 개인정보처리방침 주소 만들기
- 루트의 `PRIVACY.md` 맨 아래 `[연락처 이메일을 여기에 적으세요]`(한국어/영어 두 곳)를 본인 이메일로 고치고 푸시
- 방침 URL: https://github.com/tjsgh03123-lgtm/Over/blob/main/PRIVACY.md

## 3. 서명 키(Secrets) 4개 등록 — GitHub 저장소 Settings ▸ Secrets and variables ▸ Actions ▸ New repository secret
| 이름 | 값 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | 대화로 받은 `keystore_base64.txt` 파일 내용 전체 |
| `ANDROID_KEYSTORE_PASSWORD` | 대화로 받은 비밀번호 |
| `ANDROID_KEY_ALIAS` | `overdrive` |
| `ANDROID_KEY_PASSWORD` | 대화로 받은 비밀번호 (위와 같은 값) |

- `overdrive-upload.keystore` 파일은 **안전한 곳에 백업**하세요. 저장소에는 올리지 마세요.
- Play 앱 서명을 쓰므로 이 키는 '업로드 키'입니다. 분실해도 Play 지원에 요청해 재설정할 수 있습니다.

## 4. AAB 빌드
- GitHub ▸ Actions ▸ **Build AAB (Play 업로드용)** ▸ Run workflow
- 끝나면 맨 아래 Artifacts의 `overdrive-aab` 를 받아 압축을 풀면 `app-release.aab`
- 실행 로그에서 확인할 것: `16KB 메모리 페이지 정렬 확인` 단계(경고가 나오면 알려 주세요), `앱이 요청하는 권한 목록`(CAMERA, VIBRATE, INTERNET 정도만 나와야 함)
- 버전 코드는 빌드 번호(1, 2, 3…)로 자동 증가합니다. 표시용 버전 이름은 `app.json`의 `version`.

## 5. Play Console 입력
1. 앱 만들기: 이름 `OVERDRIVE – 운동 기록`, 한국어, 앱, 무료
2. 문구·분류: `store/listing-ko.md` 그대로 붙여넣기
3. 그래픽: `store/graphics/` — 앱 아이콘 512, 그래픽 이미지 1024×500, 휴대전화 스크린샷 6장
4. 앱 콘텐츠: `store/data-safety.md` 의 답으로 데이터 보안, 광고, 앱 액세스, 콘텐츠 등급, 타겟층, 건강 앱 선언 입력
5. 비공개(또는 내부) 테스트 트랙에 `app-release.aab` 업로드 → 테스트 시작 → 조건을 채운 뒤 프로덕션 신청

## 참고
- 스크린샷은 웹 미리보기의 샘플 데이터 화면입니다. 실제 폰 화면으로 바꾸고 싶으면 앱 설치 후 캡처해 교체하세요.
- 카메라 횟수 세기는 폰에서 아직 충분히 검증되지 않았습니다. 설명에는 정확도가 촬영 각도에 따라 달라질 수 있다는 문장만 남겼습니다.
