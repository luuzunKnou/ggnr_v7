import type { NextConfig } from "next";
import path from "path";
import CopyPlugin from "copy-webpack-plugin";
import webpack from "webpack";
import { getProjectEnvVars } from "./scripts/load-project-env";

/**
 * [project].env 의 [dev|demo|prod] 섹션 BASE_PATH → Next basePath.
 * 게이트 등록: https://dggskorea/[프로젝트명] 과 동일하게 BASE_PATH=/[프로젝트명] (또는 프로젝트명만).
 * run.ts 가 먼저 process.env 에 넣은 값을 쓰고, 없으면 GGNR_PROJECT+GGNR_ENV 로 파일에서 읽음.
 * 없으면 "" → localhost/IP 루트 접속(기존과 동일).
 *
 * 주의: basePath 는 next build / next dev 기동 시점에 반영됨. env만 바꾸고 재빌드 없이 start 하면 CSS/JS 경로가 어긋날 수 있음.
 */
function resolveBasePath(): string {
  let raw = (process.env.BASE_PATH ?? "").trim();
  if (!raw) {
    const project = (process.env.GGNR_PROJECT ?? "").trim();
    const type = (process.env.GGNR_ENV ?? "").trim();
    if (project && type) {
      try {
        raw = (getProjectEnvVars(project, type).BASE_PATH ?? "").trim();
      } catch {
        /* project env 없음 */
      }
    }
  }
  if (!raw) return "";
  // 실수로 전체 URL을 넣은 경우 pathname만 사용 (예: https://dggskorea/uav_ulsan)
  if (/^https?:\/\//i.test(raw)) {
    try {
      raw = new URL(raw).pathname;
    } catch {
      /* keep raw */
    }
  }
  let p = raw.replace(/\/+$/, "");
  if (!p.startsWith("/")) p = `/${p}`;
  // `/` 단독은 basePath로 쓰지 않음
  if (p === "/") return "";
  return p;
}

const basePath = resolveBasePath();
const cesiumBaseUrl = `${basePath}/cesiumStatic`;

const cesiumSource = path.join(__dirname, "node_modules/cesium/Build/Cesium");
const cesiumStatic = path.join(__dirname, "public/cesiumStatic");

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  env: {
    BASE_PATH: basePath,
  },
  devIndicators: false,
  turbopack: {},
  /** conda env 등 대량 파일이 Turbopack 파일 추적에 잡히지 않게 */
  outputFileTracingExcludes: {
    '*': [
      './python/env/**',
      './python/env.zip',
      './python/env.z*',
      './python/env_parts/**',
      './python/**/__pycache__/**',
      './geoserver_modules/geoserver/**',
      './geoserver_modules/java/**',
      './.next/**',
    ],
  },
  serverExternalPackages: [
    '@napi-rs/canvas',
    '@napi-rs/canvas-win32-x64-msvc',
    'pdfjs-dist',
    'pg',
    'pg-native',
  ],
  async rewrites() {
    return [
      { source: '/vworldLandCharacteristics.api', destination: '/api/vworld/land-characteristics' },
      { source: '/vworldLandCharacteristics_https.api', destination: '/api/vworld/land-characteristics' },
      { source: '/vworldLandUseAttr.api', destination: '/api/vworld/land-use' },
      { source: '/vworldLandUseAttr_https.api', destination: '/api/vworld/land-use' },
      { source: '/vworldIndvdLandPriceAttr.api', destination: '/api/vworld/land-price' },
      { source: '/vworldIndvdLandPriceAttr_https.api', destination: '/api/vworld/land-price' },
      { source: '/vworldPossessionAttr.api', destination: '/api/vworld/possession' },
      { source: '/vworldPossessionAttr_https.api', destination: '/api/vworld/possession' },
      {
        source: '/proxy/dapi.kakao.com/v2/maps/sdk.js',
        destination: '/api/kakao/maps-sdk',
      },
    ];
  },
  // 개발 서버에서 /api 요청 로그 비표시 (POST /api 200 in ... 제거)
  logging: {
    incomingRequests: { ignore: [/\/api/] },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.plugins.push(
        new CopyPlugin({
          patterns: [
            { from: path.join(cesiumSource, "Workers"), to: path.join(cesiumStatic, "Workers") },
            { from: path.join(cesiumSource, "ThirdParty"), to: path.join(cesiumStatic, "ThirdParty") },
            { from: path.join(cesiumSource, "Assets"), to: path.join(cesiumStatic, "Assets") },
            { from: path.join(cesiumSource, "Widgets"), to: path.join(cesiumStatic, "Widgets") },
          ],
        })
      );
      config.resolve.alias = config.resolve.alias || {};
      (config.resolve.alias as Record<string, string>)["cesium"] = path.join(__dirname, "node_modules/cesium");
      config.plugins.push(
        new webpack.DefinePlugin({
          CESIUM_BASE_URL: JSON.stringify(cesiumBaseUrl),
        })
      );
    }
    return config;
  },
};

export default nextConfig;
