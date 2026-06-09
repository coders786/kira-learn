/** @type {import('next').NextConfig} */
const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';
const repoName = 'kira-learn';

const nextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath: isGitHubPages ? `/${repoName}` : '',
  assetPrefix: isGitHubPages ? `/${repoName}/` : '',
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
