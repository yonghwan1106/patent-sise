import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // 워크스페이스 루트를 이 프로젝트로 고정(상위 한글 경로/다중 lockfile 경고 제거, Vercel 배포 안정화).
  // dev/build 모두 --webpack 플래그로 기동한다(package.json scripts) — 한글 경로에서 Turbopack panic 회피.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
