import type { NextConfig } from "next";
import path from "path";
import CopyPlugin from "copy-webpack-plugin";
import webpack from "webpack";

const cesiumSource = path.join(__dirname, "node_modules/cesium/Build/Cesium");
const cesiumStatic = path.join(__dirname, "public/cesiumStatic");

const nextConfig: NextConfig = {
  devIndicators: false,
  turbopack: {},
  serverExternalPackages: ['@napi-rs/canvas', '@napi-rs/canvas-win32-x64-msvc', 'pdfjs-dist'],
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
          CESIUM_BASE_URL: JSON.stringify("/cesiumStatic"),
        })
      );
    }
    return config;
  },
};

export default nextConfig;
