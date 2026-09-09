/** @type {import('next').NextConfig} */
module.exports = {
  output: "standalone",
  // pdf-parse is CJS and reads files at require time; keep it server-external.
  experimental: { serverComponentsExternalPackages: ["pdf-parse", "neo4j-driver"] },
};
