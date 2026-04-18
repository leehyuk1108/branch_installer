# branch_installer

`branch_installer`는 comma 기기에서 쓸 수 있는 설치 링크를 짧고 쉽게 만들어 주는 프로젝트입니다.

이 저장소로 할 수 있는 일은 크게 두 가지입니다.

1. 특정 GitHub 저장소와 브랜치를 가리키는 설치 파일을 미리 만들어 두기
2. 그 설치 파일을 짧은 링크로 배포하거나, 필요할 때 바로 생성해서 내려주기

## 이 프로젝트가 필요한 이유

comma 기기는 일반 웹페이지를 여는 방식으로 설치하지 않습니다.  
설치 URL을 입력하면, 그 주소에서 실제 설치 파일을 내려받아야만 설치가 진행됩니다.

그래서 사람용 안내 페이지와 comma 기기용 설치 링크는 역할이 다릅니다.

- 사람은 웹페이지에서 브랜치를 고르고 링크를 복사합니다.
- comma 기기는 최종 설치 파일 링크를 직접 받아서 설치를 진행합니다.

예를 들면 이런 식입니다.

```text
https://<도메인>/<짧은별칭>
https://<도메인>/installers/<owner>/<branch>/installer
```

## 어떻게 동작하나요?

이 프로젝트는 공식 installer를 바탕으로, 안에 들어 있는 Git 저장소 주소와 브랜치 이름만 바꾼 설치 파일을 만듭니다.

쉽게 말하면:

1. 어떤 저장소를 설치할지 정합니다.
2. 어떤 브랜치를 설치할지 정합니다.
3. 그 정보를 담은 설치 파일을 만듭니다.
4. 그 파일을 짧은 링크로 열 수 있게 배포합니다.

## 지원하는 방식

### 1. GitHub Pages

미리 만들어 둔 설치 파일만 배포하는 가장 단순한 방식입니다.

장점:

- GitHub만 있으면 운영 가능
- 관리가 단순함
- 자주 쓰는 브랜치를 짧은 링크로 고정하기 좋음

주의:

- GitHub Pages는 정적 호스팅이라서, 새 브랜치를 즉석에서 만들 수는 없습니다.
- 올릴 브랜치는 미리 생성해 둬야 합니다.

### 2. 로컬 서버

내 PC에서 직접 서버를 띄우는 방식입니다.

장점:

- 원하는 GitHub 브랜치를 즉석에서 설치 링크로 바꿀 수 있음
- 테스트할 때 가장 편함

주의:

- 외부에서 쓰려면 포트포워딩이나 터널 설정이 필요함
- 서버가 켜져 있어야 함

### 3. Netlify

정적 페이지와 동적 API를 같이 운영하는 방식입니다.

장점:

- 내 PC를 계속 켜둘 필요가 없음
- 짧은 고정 링크와 동적 생성 기능을 함께 쓸 수 있음

## 주요 파일

- `installer_targets.json`: 미리 만들어 둘 설치 링크 목록
- `featured_groups.json`: 사이트 아래쪽에 보여줄 대표 저장소/브랜치 그룹 설정
- `installer_lib.py`: 설치 파일 생성에 공통으로 쓰는 코드
- `scripts/generate_installers.py`: 설치 파일과 목록 JSON 생성 스크립트
- `server.py`: 로컬에서 돌리는 동적 서버
- `netlify/functions/installer.mts`: Netlify에서 동적으로 링크를 만들어 주는 함수
- `docs/`: 웹페이지와 생성된 설치 파일들이 들어 있는 폴더

## 가장 많이 쓰는 작업

### 1. 설치 파일 다시 만들기

```bash
cd /Users/ijonghyeog/Desktop/Coding/branch_installer
python3 scripts/generate_installers.py
```

이 명령을 실행하면:

- 공식 installer 기반 파일을 내려받고
- 각 저장소/브랜치에 맞게 내용을 바꾸고
- `docs/installers/...` 아래에 결과 파일을 만들고
- 사이트에서 쓸 목록 파일도 함께 갱신합니다

### 2. 로컬에서 사이트 열기

```bash
cd /Users/ijonghyeog/Desktop/Coding/branch_installer
python3 server.py --host 127.0.0.1 --port 8130
```

브라우저에서 아래 주소로 열면 됩니다.

```text
http://127.0.0.1:8130
```

이 모드에서는:

- 자주 쓰는 브랜치를 선택해서 바로 짧은 링크를 볼 수 있고
- 아직 미리 등록하지 않은 브랜치도 동적으로 링크를 만들 수 있습니다

### 3. Netlify 로컬 모드로 확인하기

```bash
cd /Users/ijonghyeog/Desktop/Coding/branch_installer
npm install
npm run netlify:dev
```

이 방법은 Netlify 배포 전 동작을 비슷하게 확인할 때 유용합니다.

## 새 설치 링크 추가하기

`installer_targets.json`에 항목을 하나 추가하면 됩니다.

예시:

```json
{
  "slug_owner": "example",
  "slug_branch": "release-c3",
  "aliases": ["rc3"],
  "git_url": "https://github.com/example/openpilot.git",
  "git_branch": "release-c3",
  "title": "Example release-c3",
  "description": "예시 설치 링크"
}
```

설명:

- `git_url`: 설치할 저장소 주소
- `git_branch`: 설치할 브랜치 이름
- `aliases`: 짧은 링크 별칭

예를 들어 `aliases`가 `["rc3"]`이면 이런 주소로 바로 설치할 수 있습니다.

```text
https://<도메인>/rc3
```

별칭을 여러 개 둘 수도 있습니다.

```json
["h", "hl"]
```

이 경우 `/h`와 `/hl` 둘 다 동작합니다.

추가한 뒤에는 다시 생성하면 됩니다.

```bash
python3 scripts/generate_installers.py
```

## 자주 쓰는 API/경로

- `/c`, `/h`, `/op` 같은 짧은 고정 링크
- `/i/<owner>/<repo>/<branch>`: 등록되지 않은 브랜치를 즉석에서 설치 링크로 생성
- `/api/resolve?input=<브랜치링크>`: 웹페이지에서 입력한 링크를 변환할 때 사용하는 API

예시:

```text
http://127.0.0.1:8130/h
http://127.0.0.1:8130/i/leehyuk1108/sunny-hl/release-c3-hl
```

## GitHub Pages로 배포하기

1. GitHub 저장소를 만듭니다.
2. 이 프로젝트를 push 합니다.
3. GitHub Pages를 켭니다.
4. `docs/` 폴더 또는 GitHub Actions 기반으로 배포합니다.

이 방식은 관리가 쉽지만, 새 브랜치를 실시간으로 만들어 주지는 못합니다.

## Netlify로 배포하기

이 저장소는 이미 Netlify 기준으로도 동작하게 구성되어 있습니다.

- 정적 파일은 `docs/`에서 제공
- 동적 처리 경로는 `netlify/functions/installer.mts`에서 처리
- 설정은 `netlify.toml`에 있음

즉, GitHub Pages보다 조금 더 유연하게 운영할 수 있습니다.

## 외부에서 접속하게 만들기

집 PC에서 직접 서버를 돌린다면 보통 두 가지 방법 중 하나를 씁니다.

1. 공유기 포트포워딩
2. 터널 또는 리버스 프록시 연결

짧은 링크를 정말 짧게 만들고 싶다면, 짧은 도메인을 연결하는 것이 가장 효과적입니다.

예:

```text
https://p.example/h
https://p.example/c
```

## 한 줄 요약

이 프로젝트는 GitHub 브랜치를 comma 기기에서 바로 쓸 수 있는 짧은 설치 링크로 바꿔서 배포하기 위한 도구입니다.
