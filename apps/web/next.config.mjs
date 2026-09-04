/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A verification build must not disturb a running dev server. Both write to
  // `.next` by default, and `next build` replaces the chunks `next dev` is
  // still serving — the running app then answers 500 with "Cannot find module
  // './523.js'" and the next person spends twenty minutes debugging an
  // application that is fine. `npm run check` sets this to `.next-build`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The floating route badge sits over the bottom-left of the editor and eats
  // clicks meant for the tool panel.
  devIndicators: false,
  webpack(config) {
    config.experiments = { ...config.experiments, topLevelAwait: true };
    return config;
  },
  async headers() {
    // The datasets carry their version in the filename and the engine carries a
    // content hash in its URL, so both are safe to cache hard in production.
    // In development the same filenames are rewritten constantly, and a cached
    // copy silently pairs old data with new code — so nothing is cached there.
    const value =
      process.env.NODE_ENV === 'production'
        ? 'public, max-age=31536000, immutable'
        : 'no-store, must-revalidate';
    return [
      // The manifest points at the hashed files and therefore must not be held.
      { source: '/data/manifest.json', headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }] },
      { source: '/data/:file*', headers: [{ key: 'Cache-Control', value }] },
      { source: '/engine/:file*', headers: [{ key: 'Cache-Control', value }] },
    ];
  },
};
export default nextConfig;
