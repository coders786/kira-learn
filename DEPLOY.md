# Deploy Kira Learn to GitHub Pages

## One-Time Setup (Do This Once)

1. Go to your repo on GitHub: **https://github.com/coders786/kira-learn**
2. Click **Settings** tab
3. In the left sidebar, click **Pages**
4. Under "Build and deployment", set **Source** to **GitHub Actions**
5. That's it. The workflow file `.github/workflows/deploy.yml` handles everything.

The site will be live at:
**https://coders786.github.io/kira-learn**

## How It Works

Every time you push to `main`, GitHub Actions automatically:
1. Checks out the code
2. Installs dependencies (`npm ci`)
3. Builds the static site (`npm run build` → exports to `/out`)
4. Deploys to GitHub Pages

## Local Development

```bash
npm install
npm run dev
# Open http://localhost:3000
```
