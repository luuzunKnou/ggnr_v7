# PDF용 Chromium (폐쇄망·오프라인)

불법점용 관리카드 등 서버 PDF는 **로컬 Chromium**으로 HTML을 인쇄합니다.  
실행 시 **인터넷은 필요 없습니다.** (구글·CDN 접속 없음)

## 한 번만: 바이너리 반입

1. **인터넷 되는 PC**에서 [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/) 을 받습니다.  
   - OS·아키텍처는 **운영 서버와 동일** (예: Windows 64-bit → `chrome-win64.zip`)
2. zip을 풀어 이 폴더에 둡니다. 예:

   ```
   tools/chromium/chrome-win64/chrome.exe
   ```

   Linux 예: `tools/chromium/chrome-linux64/chrome`

3. 폴더 통째로 **USB·배포 패키지**로 폐쇄망 서버에 복사합니다.  
   (또는 서버에 `chromium/` 로 두고 `CHROME_PATH`만 지정)

## 환경변수 (권장)

앱 기동 계정에:

```text
CHROME_PATH=D:\app\tools\chromium\chrome-win64\chrome.exe
```

`PUPPETEER_EXECUTABLE_PATH` 도 동일하게 인식합니다.  
미설정이어도 `tools/chromium/chrome-win64/chrome.exe` 등 상대 경로를 자동으로 찾습니다.

## 서버에서 기동 확인

앱과 **같은 Windows 계정**으로:

```bat
"%CHROME_PATH%" --headless --disable-gpu --disable-software-rasterizer --in-process-gpu --dump-dom about:blank
```

HTML 조각이 나오면 PDF용 실행은 가능합니다.  
`Code: 1002` 등이 나오면 실행 정책·계정(서비스 계정)·AppLocker를 점검하세요.

## Git

바이너리(수백 MB)는 저장소에 넣지 않습니다. README만 커밋하고 zip은 배포 산출물에 포함하세요.
