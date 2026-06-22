# OCR PaddleOCR 설정

Data Migration OCR은 **PaddleOCR(로컬) → GPT(텍스트 구조화)** 파이프라인을 사용합니다.

## 1. Python 환경

프로젝트 루트에서 `python/env` conda 환경에 설치합니다.

```bash
conda run --prefix python/env pip install paddlepaddle paddleocr pillow opencv-python-headless
```

`GGNR_PIPELINE_PYTHON=python/env/python.exe` 가 runtime.env에 설정되어 있어야 합니다 (build_yy 등).

## 2. 모델 (오프라인)

모델은 `python/models/paddleocr/` 아래에 둡니다.

```
python/models/paddleocr/
  det/    ← text detection inference model
  rec/    ← korean text recognition inference model
  cls/    ← (선택) textline orientation classifier
```

PaddleOCR 3.x 파라미터: `text_detection_model_dir`, `text_recognition_model_dir`

Windows CPU에서 `ConvertPirAttribute2RuntimeAttribute` 오류가 나면:

```bash
conda run --prefix python/env pip install "paddlepaddle==3.2.2"
```

스크립트는 `FLAGS_enable_pir_api=0`, `enable_mkldnn=False` 를 기본 적용합니다.

환경 변수로 경로 지정:

```text
PADDLEOCR_MODEL_DIR=D:\ggnr_v7\python\models\paddleocr
```

`det/`, `rec/` 가 없으면 최초 실행 시 PaddleOCR이 모델을 **자동 다운로드**합니다 (인터넷 필요).

## 3. 단독 테스트

```bash
conda run --prefix python/env python scripts/ocr_paddle_extract.py --image "D:\path\to\page.jpg"
```

stdout JSON 예:

```json
{
  "fullText": "...",
  "lines": [{ "text": "...", "score": 0.97, "box": [[x,y],...], "centerY": 120 }],
  "imageWidth": 2480,
  "imageHeight": 3508
}
```

## 4. 오프라인 확인

1. `det/`, `rec/` 를 로컬에 배치
2. 네트워크 차단 후 위 테스트 명령 실행
3. JSON이 나오면 OCR 작업(UI)도 동일하게 로컬 추론만 사용합니다

## 5. OCR 작업 실행

개발자 콘솔 → 데이터관리 → Data Migration → OCR  
`OCR/{작업명}/` 이미지 → **OCR 시작**

이미지 파일은 외부 API로 전송되지 않습니다. GPT에는 Paddle이 추출한 **텍스트만** 전송됩니다 (`OPENAI_API_KEY` 필요).
