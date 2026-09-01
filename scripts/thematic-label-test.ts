/**
 * 주제도(lsmd_cont) 라벨 테스트 — CSS 3건만 갱신
 *
 * 주의:
 * - GeoCSS에 Coalesce 없음 → Function not found → GetMap/범례 전부 실패
 * - 한글 문자열 리터럴은 플랫폼 인코딩으로 깨질 수 있음 → 속성 필드(mnum) 사용
 *
 * 사용: npx tsx scripts/thematic-label-test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildCssFromSimpleStyle, parseSimpleStyleFromCss, type StyleProps } from '../src/lib/geoserverStyleUtils';

const STYLES_DIR = path.join(process.cwd(), 'geoserver_modules/data_dir/styles');

type TestCase = {
  styleName: string;
  korName: string;
  /** GeoServer label 표현식 (대괄호 안) — 단일 속성명 권장 */
  labelExpr: string;
};

const TESTS: TestCase[] = [
  {
    styleName: 'lsmd_cont_ue101_uea110',
    korName: '농업진흥구역',
    labelExpr: 'mnum',
  },
  {
    styleName: 'lsmd_cont_ub210_ubj100',
    korName: '지역특화발전특구',
    labelExpr: 'mnum',
  },
  {
    styleName: 'lsmd_cont_ub950_uby100',
    korName: '지역개발사업구역',
    labelExpr: 'mnum',
  },
];

function readExistingProps(styleName: string): StyleProps {
  const cssPath = path.join(STYLES_DIR, `${styleName}.css`);
  if (!fs.existsSync(cssPath)) {
    return { fillColor: '#808080', strokeColor: '#FFFFFF', strokeWidth: 1, opacity: 0.3 };
  }
  const body = fs.readFileSync(cssPath, 'utf8');
  const { styleProps } = parseSimpleStyleFromCss(body);
  return styleProps;
}

function main() {
  console.log('=== 주제도 라벨 테스트 CSS 갱신 (mnum) ===');
  console.log('');

  for (const t of TESTS) {
    const cssPath = path.join(STYLES_DIR, `${t.styleName}.css`);
    if (!fs.existsSync(cssPath)) {
      console.warn(`[skip] ${t.styleName} — css 없음`);
      continue;
    }

    const styleProps: StyleProps = {
      ...readExistingProps(t.styleName),
      labelField: t.labelExpr,
      size: 12,
    };
    // Coalesce 등 미지원 함수·한글 리터럴이 남지 않도록 labelField만 덮어씀
    const cssBody = buildCssFromSimpleStyle('POLYGON', styleProps);
    fs.writeFileSync(cssPath, cssBody + '\n', 'utf8');
    console.log(`[ok] ${t.styleName} (${t.korName}) → label: [${t.labelExpr}]`);
  }

  console.log('');
  console.log('GeoServer 재시작 후 주제도에서 위 3개 레이어 확인');
}

main();
