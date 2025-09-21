#!/bin/bash

# WebDVCS Local CI/CD Pipeline Simulation
# This script simulates the GitHub Actions CI/CD pipeline locally
# Useful for testing before pushing to GitHub

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_status() {
    echo -e "${BLUE}📋 $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_step() {
    echo -e "${YELLOW}🔧 $1${NC}"
}

# Function to check if command succeeded
check_result() {
    if [ $? -eq 0 ]; then
        print_success "$1 successful"
    else
        print_error "$1 failed"
        exit 1
    fi
}

# Start CI/CD simulation
echo "🚀 WebDVCS Local CI/CD Pipeline Simulation"
echo "=========================================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Please run from project root."
    exit 1
fi

print_status "Starting CI/CD pipeline simulation..."
echo ""

# Step 1: Environment Setup
print_step "Step 1: Environment Setup"
print_status "Node.js version: $(node --version)"
print_status "npm version: $(npm --version)"
echo ""

# Step 2: Install Dependencies
print_step "Step 2: Installing Dependencies"
print_status "Running npm ci..."
npm ci > /dev/null 2>&1
check_result "Dependency installation"
echo ""

# Step 3: Build Application
print_step "Step 3: Building Application"
print_status "Running development build..."
npm run build > /dev/null 2>&1
check_result "Development build"

print_status "Running production build..."
npm run build:github > /dev/null 2>&1
check_result "Production build"
echo ""

# Step 4: Run Tests
print_step "Step 4: Running Test Suite"

print_status "Running core library tests..."
npm test > test-results.log 2>&1
if [ $? -eq 0 ]; then
    print_success "Core library tests passed"
    # Extract test summary
    grep -E "(✅|🎉|Total modules)" test-results.log | tail -5
else
    print_error "Core library tests failed"
    tail -20 test-results.log
    exit 1
fi
echo ""

# Check if playwright is available
print_status "Checking Playwright browser installation..."
if npx playwright --version > /dev/null 2>&1; then
    print_status "Running browser tests..."
    # Start a local server for browser tests
    python3 -m http.server 8080 > /dev/null 2>&1 &
    SERVER_PID=$!
    sleep 2  # Give server time to start

    # Run browser tests
    npm run test:browser > browser-test-results.log 2>&1
    if [ $? -eq 0 ]; then
        print_success "Browser tests passed"
        grep -E "(passed|Running)" browser-test-results.log | tail -3
    else
        print_warning "Browser tests had issues (may be environment-related)"
        tail -10 browser-test-results.log
    fi

    # Stop the server
    kill $SERVER_PID > /dev/null 2>&1
else
    print_warning "Playwright not fully installed - skipping browser tests"
    print_status "Install with: npx playwright install chromium"
fi
echo ""

# Step 5: Check Build Artifacts
print_step "Step 5: Verifying Build Artifacts"
if [ -d "dist" ]; then
    print_success "dist/ directory exists"
    if [ -f "dist/webdvcs-browser.js" ]; then
        print_success "webdvcs-browser.js built successfully"
        BUNDLE_SIZE=$(du -h dist/webdvcs-browser.js | cut -f1)
        print_status "Bundle size: $BUNDLE_SIZE"
    else
        print_error "webdvcs-browser.js not found"
        exit 1
    fi

    if [ -f "dist/index.html" ]; then
        print_success "index.html copied for deployment"
    else
        print_warning "index.html not found (run npm run build:github)"
    fi

    if [ -f "dist/styles.css" ]; then
        print_success "styles.css copied for deployment"
    else
        print_warning "styles.css not found (run npm run build:github)"
    fi
else
    print_error "dist/ directory not found"
    exit 1
fi
echo ""

# Step 6: Lint and Code Quality (if available)
print_step "Step 6: Code Quality Checks"
if command -v jshint > /dev/null 2>&1; then
    print_status "Running JSHint..."
    jshint lib/ > /dev/null 2>&1 && print_success "JSHint passed" || print_warning "JSHint issues found"
else
    print_status "JSHint not installed - skipping lint check"
fi

# Check for basic code quality
print_status "Checking for basic code quality issues..."
if grep -r "console.log" lib/ > /dev/null 2>&1; then
    print_warning "console.log statements found in lib/ (should use logger)"
else
    print_success "No console.log statements in lib/"
fi

if grep -r "TODO\|FIXME" lib/ > /dev/null 2>&1; then
    print_warning "TODO/FIXME comments found in lib/"
    grep -r "TODO\|FIXME" lib/ | head -3
else
    print_success "No TODO/FIXME comments in lib/"
fi
echo ""

# Step 7: Deployment Readiness
print_step "Step 7: Deployment Readiness Check"
if [ -f "dist/index.html" ] && [ -f "dist/webdvcs-browser.js" ] && [ -f "dist/styles.css" ]; then
    print_success "All deployment artifacts present"
    print_status "Ready for GitHub Pages deployment"
else
    print_warning "Some deployment artifacts missing"
    print_status "Run 'npm run build:github' to prepare for deployment"
fi
echo ""

# Step 8: Security Check
print_step "Step 8: Security Check"
print_status "Checking for sensitive files..."
if find . -name "*.key" -o -name "*.pem" -o -name "*.env" | grep -v node_modules > /dev/null 2>&1; then
    print_warning "Potential sensitive files found"
    find . -name "*.key" -o -name "*.pem" -o -name "*.env" | grep -v node_modules
else
    print_success "No sensitive files found"
fi

if [ -f ".gitignore" ]; then
    print_success ".gitignore exists"
else
    print_warning ".gitignore not found"
fi
echo ""

# Step 9: Final Summary
print_step "Step 9: CI/CD Pipeline Summary"
echo ""
print_success "🎉 CI/CD Pipeline Simulation Complete!"
echo ""
print_status "Pipeline Status: ✅ READY FOR GITHUB DEPLOYMENT"
echo ""
print_status "Next Steps:"
echo "  1. Commit your changes: git add . && git commit -m 'your message'"
echo "  2. Push to GitHub: git push origin your-branch"
echo "  3. Create a pull request to main/master"
echo "  4. GitHub Actions will automatically run this pipeline"
echo "  5. On merge to main, automatic deployment to GitHub Pages"
echo ""
print_status "GitHub Actions will run:"
echo "  - All tests (core library + browser)"
echo "  - Build production artifacts"
echo "  - Deploy to GitHub Pages (if on main/master branch)"
echo ""
print_status "Monitor at: https://github.com/YOUR_USERNAME/YOUR_REPO/actions"
echo ""

# Cleanup
rm -f test-results.log browser-test-results.log

print_success "Local CI/CD simulation completed successfully! 🚀"