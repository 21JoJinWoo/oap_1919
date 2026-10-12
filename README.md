# oap_1919

1919년 3월 1일 탑골공원을 **오프-축 투영(off-axis projection)** 으로 보여주는 웹사이트.
웹캠이 사용자의 눈 위치를 추적하고, 화면을 "창문"처럼 만들어 머리를 움직이면 창 너머 공간의 원근이 바뀝니다.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173 (편집·업로드 가능)
```

macOS에서 매번 명령어 없이 쓰기:

- 항상 켜 두기: `./scripts/autostart.sh install` 한 번 실행 → 이후 로그인할 때마다 서버가 백그라운드로 켜지고, 크롬에서 `http://localhost:5173`만 열면 됩니다. 해제는 `uninstall`, 서버 코드 업데이트 후엔 `restart`.
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
| 좌하단 | DEPTH(시차 배율) · LOAD(렌더 부하) · DATA(GLB 용량) |
| 하단 중앙 | 카메라 ↔ 마우스 모드 전환 |
| 우하단 | 카메라 미리보기 · 녹화 |

단축키: 클릭 선택, `E` 이동, `R` 회전, `T` 크기, `Del` 삭제, `Ctrl+D` 복제, `Ctrl+Z/Y` 실행 취소/다시 실행, `Ctrl+S` 저장.

## GLB (Tripo AI 등)

사이트에서 **+ → GLB 파일 업로드**를 하면 서버가 자동으로 최적화합니다.
중복 제거, 삼각형 15만 개를 넘으면 단순화, 텍스처 WebP 변환(최대 2048px), Meshopt 압축 순서로 처리합니다.
명령줄로 한 번에 넣을 수도 있습니다.

```bash
npm run optimize -- ./my-models --add   # 폴더의 GLB를 최적화해 data/models에 넣고 장면에 추가
```

`source-models/`에는 Tripo 원본 GLB를 보관합니다(사이트는 최적화된 `data/models/`만 사용). 상한값은 `MAX_TRIANGLES`, `MAX_TEXTURE_SIZE` 환경 변수로 바꿀 수 있습니다.
현재 장면의 회색 도형들은 GLB가 들어오기 전까지 쓰는 임시 배치용입니다.

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
