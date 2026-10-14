# oap_1919

1919년 3월 1일 탑골공원을 **오프-축 투영(off-axis projection)** 으로 보여주는 웹사이트.
웹캠이 사용자의 눈 위치를 추적하고, 화면을 "창문"처럼 만들어 머리를 움직이면 창 너머 공간의 원근이 바뀝니다.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173 (편집·업로드 가능)
```

macOS에서 매번 명령어 없이 쓰기:

- 항상 켜 두기: `./scripts/autostart.sh install` 한 번 실행 → 이후 로그인할 때마다 서버가 백그라운드로 켜지고, 크롬에서 `http://localhost:5173`만 열면 됩니다. 1분마다 GitHub의 새 수정을 자동으로 받아 반영합니다(`scripts/run-with-sync.sh`). 사이트에서 저장한 배치가 GitHub 수정과 겹치면 `data/backups/`에 백업한 뒤 GitHub 버전을 적용합니다. 해제는 `uninstall`.
- 필요할 때만: Finder에서 `start.command` 더블클릭 → 서버가 켜지고 크롬이 열립니다(창을 닫으면 종료).

배포(서버 실행):

```bash
npm run build
EDIT_TOKEN=비밀번호 npm start   # http://localhost:3000
```

- `EDIT_TOKEN`을 설정하면 저장·업로드할 때 비밀번호를 묻습니다. 설정하지 않으면 누구나 편집할 수 있습니다.
- `DATA_DIR`(기본 `data/`)에 장면(`scene.json`)과 GLB(`models/`)가 저장됩니다. 서버를 재시작해도 남도록 영구 디스크를 연결하세요.
- `dist/`만 정적 호스팅에 올리면 보기 전용으로 동작합니다(빌드 시점의 `data/`가 포함됨).

## 화면 구성

| 위치 | 기능 |
|---|---|
| 우상단 `SPATIAL` / `EDIT` (Tab) | 얼굴 추적 포탈 보기 ↔ 자유 카메라 편집 |
| 좌상단 | 레이어 · 오브젝트 추가(GLB 업로드) · 히스토리 · 설정(포탈, 화면 보정, 안개, 그림자) |
| 좌하단 | LOAD(렌더 부하) · DATA(GLB 용량) |
| 하단 중앙 | 카메라 ↔ 마우스 모드 전환 |
| 우하단 | 카메라 미리보기 · 녹화 |

단축키: 클릭 선택, `E` 이동, `R` 회전, `T` 크기, `Del` 삭제, `Ctrl+D` 복제, `Ctrl+Z/Y` 실행 취소/다시 실행, `Ctrl+S` 저장.

## GLB (Tripo AI 등)

사이트에서 **+ → GLB 파일 업로드**를 하면 서버가 자동으로 최적화합니다.
중복 제거, 삼각형 15만 개를 넘으면 단순화, 텍스처 WebP 변환(최대 2048px), Meshopt 압축 순서로 처리합니다. `TEXTURE_FORMAT=ktx2 MAX_TEXTURE_SIZE=4096`이면 텍스처를 GPU 압축 KTX2(UASTC)로 만들어 4K 텍스처도 그래픽 메모리를 약 1/4만 씁니다(화면에 크게 보이는 모델 10개에 적용).
명령줄로 한 번에 넣을 수도 있습니다.

```bash
npm run optimize -- ./my-models --add   # 폴더의 GLB를 최적화해 data/models에 넣고 장면에 추가
```

`source-models/`에는 Tripo 원본 GLB를 보관합니다(사이트는 최적화된 `data/models/`만 사용). 상한값은 `MAX_TRIANGLES`, `MAX_TEXTURE_SIZE` 환경 변수로 바꿀 수 있습니다.
현재 장면의 회색 도형들은 GLB가 들어오기 전까지 쓰는 임시 배치용입니다.

## 하늘 · 조명 (HDRI)

```bash
npx tsx scripts/prepare-hdri.ts source-models/<파일>.hdr --azimuth 205.1
```

HDRI를 태양이 지정 방위(북에서 시계방향 °)에 오도록 회전하고, 조명용 1K HDR(`data/env/*-env.hdr`)과 노출을 구워 넣은 하늘 배경(`*-sky.webp`)을 만든 뒤 태양 방향·지평선 색·노출을 출력합니다. 출력값을 `scene.json`의 `settings.environment`(구울 때 쓴 방위는 `sunAzimuth`), 안개 색에 넣습니다. 시각은 `settings.timeOfDay.hour`에 16.75(16시 45분)로 고정되어 있고, 하늘과 환경광은 그 시각의 태양 방위에 맞춰 회전합니다(HDRI 속 해의 고도는 바뀌지 않음). 그림자를 만드는 태양광은 1919년 3월 1일 16시 45분 탑골공원 기준(고도 17.9°, 방위 244.4°, NOAA 태양 위치 계산식)입니다. 시각 슬라이더(TIME)는 현재 화면에서 빠져 있습니다.

## 시네마틱 연출

- **후처리** (`settings.cinematic`): N8AO 앰비언트 오클루전(접촉 그림자), 블룸, 마지막 패스에서 ACES 톤매핑 → 채도·S커브 대비·그림자 청록/하이라이트 주황 스플릿 토닝·비네팅·필름 그레인. PCSS 소프트 섀도우(`softShadows`)는 16:45의 긴 그림자를 지워 버려 꺼 두었습니다.
- **정지된 순간** (오브젝트 `kind: "fx"`, 박스 크기 = 효과 범위): 총구 연기(`smoke`, 총구에서 사선 방향 +Z), 흩날리는 선언서(`leaflets`, `avoid`의 얼굴·총구를 시선 기준으로 가리지 않음), 햇빛 속 먼지(`dust`).
- **총알 순간 연출**: 총알은 강선 회전처럼 제자리에서 계속 돌고(`spin`), 궤적의 구슬은 총알 뒤에서 총구 쪽으로 흘러가며(`trail.flow`) 가는 속도선(`trail.streaks`)이 함께 지나갑니다. 총구 화염(`flash`)은 블룸이 잡도록 밝게 그리고 사수에게 주황빛 점광원을 비춥니다. 바닥 흙먼지(`groundDust`)는 달리는 사람·말 발 뒤(`sources`)에 뭉쳐 일어납니다.
- **지면 안개**: 거리 안개에 높이 감쇠(약 2.2 m)를 곱해 바닥 가까이만 흙먼지처럼 깔립니다(`settings.fog`).

## 바닥 질감

지면은 사진 스캔 PBR 텍스처(Poly Haven `forest_ground_05`, CC0, 4K)를 타일로 깝니다. 색상·노멀(OpenGL)·AO·거칠기 이미지를 GPU 압축 KTX2로 바꿉니다.

```bash
npx tsx scripts/prepare-surface.ts forest_ground_05 source-models/forest_ground_05_diff_4k.jpg \
  source-models/forest_ground_05_nor_gl_4k.jpg source-models/forest_ground_05_ao_4k.jpg source-models/forest_ground_05_rough_4k.jpg
```

`scene.json`에서 지면 오브젝트의 `surface`(`tile` = 한 장이 덮는 미터)로 지정합니다. 넓은 바닥에서 같은 무늬가 반복돼 보이지 않도록, 저주파 노이즈로 영역마다 텍스처 좌표를 무작위로 옮겨 섞습니다(Inigo Quilez, *Texture Repetition*).

## 화면 보정

설정 패널의 **화면 너비 cm**에는 실제 화면 가로 길이를 자로 재서 입력하세요.
웹캠 화각(기본 60°)은 기기마다 다르므로 근사치입니다.

## 기술 구성

- **화면:** Vite, React, React Three Fiber, three.js
- **얼굴 추적:** MediaPipe Face Detector (BlazeFace short-range, 모델 파일 포함)
- **서버:** Express, glTF-Transform, sharp, meshoptimizer
- **투영:** 눈 위치를 기준으로 창 네 모서리를 지나는 비대칭 절두체를 계산합니다(Kooima, *Generalized Perspective Projection*, 2008).
- **거리 추정:** 두 눈 사이 픽셀 거리와 평균 동공 간 거리 63mm로 계산합니다.
- **떨림 보정:** One Euro 필터(Casiez et al., CHI 2012)를 씁니다.
