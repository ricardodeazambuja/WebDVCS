# GitHub Actions CI/CD Setup

This directory contains automated workflows for the WebDVCS project.

## 🚀 Workflows Overview

### CI/CD Pipeline (`ci-cd.yml`)
**Purpose**: Automated testing, building, and deployment

**Triggers:**
- **Push to main/master** (with specific file changes): Runs tests + deploys to GitHub Pages
- **Pull Requests** (with specific file changes): Runs tests only (no deployment)

**Path Filters** (only triggers when these files change):
- `lib/**` - Core library code
- `tests/**` - Test files  
- `webdvcs*.js` - CLI and core files
- `webdvcs-browser.html` - Browser demo
- `package*.json` - Dependencies
- `webpack.config.js` - Build configuration
- `playwright.config.js` - Test configuration
- `.github/workflows/**` - Workflow changes

**Jobs:**
1. **Test**: Install dependencies, build browser bundle, run Node.js tests + browser tests with Playwright
2. **Deploy**: Build and deploy browser demo to GitHub Pages (only on main/master/a_new_hope)

## ⚙️ Setup Instructions

### 1. Enable GitHub Pages
1. Go to repository **Settings** → **Pages**
2. Set **Source** to "GitHub Actions"
3. Site will be available at: `https://<username>.github.io/<repository-name>`

### 2. Configure Repository Permissions
Go to **Settings** → **Actions** → **General**:
- **Actions permissions**: Allow all actions
- **Workflow permissions**: Read and write permissions

### 3. Required Repository Settings
The workflows need these permissions:
- **Actions**: Read and write
- **Contents**: Write
- **Pages**: Write
- **Metadata**: Read

## 🔧 Technical Implementation

### Test Job
```yaml
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '18'
        cache: 'npm'
    - run: npm ci
    - run: npm run build
    - run: npx playwright install --with-deps
    - run: npm test
    - run: npm run test:browser
```

### Deploy Job (Production Only)
```yaml
build-and-deploy:
  needs: test
  runs-on: ubuntu-latest
  if: github.ref == 'refs/heads/main'
  
  permissions:
    pages: write
    id-token: write
    contents: read
  
  environment:
    name: github-pages
    url: ${{ steps.deployment.outputs.page_url }}
  
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
    - run: npm ci
    - run: npm run build:github
    - uses: actions/configure-pages@v5
    - uses: actions/upload-pages-artifact@v3
      with:
        path: ./dist
    - uses: actions/deploy-pages@v4
      id: deployment
```

## 🎯 When Workflows Run

| Event | Branch | Files Changed | Test Job | Deploy Job | Result |
|-------|--------|---------------|----------|------------|--------|
| Push | `main` | App files | ✅ Runs | ✅ Runs | Full CI/CD |
| Push | `main` | Docs only | ❌ No trigger | ❌ No trigger | No action |
| Push | `feature/*` | Any | ❌ No trigger | ❌ No trigger | No action |
| PR to `main` | Any | App files | ✅ Runs | ❌ Skipped | Test only |
| PR to `main` | Any | Docs only | ❌ No trigger | ❌ No trigger | No action |

**Note**: "App files" refers to the path filters listed above. Documentation-only changes (README.md, etc.) will not trigger builds.

## 🔧 Customization

### Environment Variables
Add to **Settings** → **Secrets and variables** → **Actions**:
- `NODE_VERSION`: Node.js version (default: 18)

### Workflow Modifications
- **Test timeout**: Modify Playwright config
- **Build commands**: Update `package.json` scripts
- **Deployment target**: Change actions in deploy job

### Branch Protection (Optional)
Recommended for `main` branch:
- ✅ Require status checks to pass
- ✅ Require up-to-date branches
- ✅ Include administrators

## 📊 Status Badges
Add to your README:

```markdown
![CI/CD](https://github.com/<username>/<repo>/workflows/CI/CD%20Pipeline/badge.svg)
```

## 🐛 Troubleshooting

### Common Issues
1. **Tests failing**: Check Playwright browser installation
2. **Build errors**: Verify `package.json` scripts
3. **Deploy fails**: Check Pages configuration and permissions
4. **Permission errors**: Review Actions permissions in Settings

### Debug Steps
1. Check **Actions** tab for detailed logs
2. Review failed step outputs
3. Test locally with same Node.js version
4. Verify `"type": "module"` in `package.json`

### Recent Fixes Applied
- **ES Module Support**: Added proper module configuration
- **Test Optimization**: Fixed selectors for 100% pass rate
- **Dependency Updates**: Automated via Dependabot

## 🔄 Maintenance

The workflows automatically:
- Cache npm dependencies for faster builds
- Install required browsers for testing
- Deploy only when tests pass
- Provide deployment URLs for verification

**Dependencies**: Updated weekly via Dependabot
**Security**: Regular automated security audits

---

These workflows ensure code quality and seamless deployment for the WebDVCS project.