/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace-Pakete `shared` (zod-Schemata + Contract-Typen) und `engine`
  // (Parser, §3.2/§3.3) werden aus dem TS-Source transpiliert — kein
  // Build-Order-Zwang zwischen Paketen.
  transpilePackages: ['shared', 'engine'],
}

export default nextConfig
