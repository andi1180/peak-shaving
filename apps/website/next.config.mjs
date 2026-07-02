/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace-Paket `shared` (zod-Schemata + Contract-Typen) wird aus dem
  // TS-Source transpiliert — kein Build-Order-Zwang zwischen Paketen.
  transpilePackages: ['shared'],
}

export default nextConfig
