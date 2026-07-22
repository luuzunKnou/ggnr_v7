# 개인 Rules (ggnr_v7)

**Git에 올라가지 않습니다.** (`.gitignore` → `.cursor/local/`)

## Cursor가 읽는 경로

```
.cursor/rules/_personal/   ← junction → 이 폴더 (.cursor/local/rules/)
```

팀 공용 rules 는 `.cursor/rules/*.mdc` (project-core, work-plan 등) 입니다.

## 파일 추가

1. 이 폴더에 `personal-*.mdc` 작성
2. frontmatter 예시:

```yaml
---
description: 설명 (규칙 선택 UI에 표시)
alwaysApply: true
---
```

또는 특정 파일만:

```yaml
---
description: plan 문서 작성 시
globs: docs/plan/**
alwaysApply: false
---
```

## 전역 원본

다른 PC·프로젝트와 공유할 개인 규칙 원본:

```
C:\Users\PC\.cursor\personal-rules\
```

복사:

```powershell
Copy-Item "$env:USERPROFILE\.cursor\personal-rules\*.mdc" .cursor\local\rules\
```

## junction 다시 만들기

삭제 후 재생성 (프로젝트 루트):

```powershell
cmd /c rmdir .cursor\rules\_personal
cmd /c mklink /J .cursor\rules\_personal .cursor\local\rules
```
