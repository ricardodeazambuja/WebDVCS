# WebDVCS Browser Tests

Comprehensive test suite for the WebDVCS browser interface using Playwright.

## Test Structure

### Test Files
- **`repository-lifecycle.spec.js`** - Repository creation, upload, download, and management
- **`file-operations.spec.js`** - File upload, staging, removal, and content handling  
- **`vcs-operations.spec.js`** - Commits, branches, checkout, diff, and version control
- **`ui-interactions.spec.js`** - Visual design, responsiveness, accessibility, and UX

### Support Files
- **`pages/webdvcs-page.js`** - Page Object Model for WebDVCS interface
- **`fixtures/test-files.js`** - Test data, sample files, and scenarios
- **`data/`** - Test repositories and binary files
- **`screenshots/`** - Visual regression test screenshots (generated)

## Running Tests

### All Tests
```bash
npm run test:browser
# or
npx playwright test tests/browser
```

### Specific Test Files
```bash
npx playwright test tests/browser/repository-lifecycle.spec.js
npx playwright test tests/browser/file-operations.spec.js
npx playwright test tests/browser/vcs-operations.spec.js
npx playwright test tests/browser/ui-interactions.spec.js
```

### Debug Mode
```bash
npx playwright test --debug
```

### UI Mode (Interactive)
```bash
npx playwright test --ui
```

### Generate Test Report
```bash
npx playwright show-report
```

## Test Coverage

### Repository Operations
- ✅ Create new repository
- ✅ Upload existing SQLite repository  
- ✅ Download repository as file
- ✅ Repository validation and error handling
- ✅ Multiple repository management

### File Management
- ✅ Single and multiple file upload
- ✅ Binary file handling
- ✅ Large file performance
- ✅ Drag and drop support
- ✅ File validation and naming
- ✅ Content integrity preservation
- ✅ Directory structure support

### Version Control
- ✅ Commit creation and validation
- ✅ Branch management and switching
- ✅ Checkout operations
- ✅ Status and diff operations
- ✅ Commit history and logging
- ✅ Merge and advanced operations

### Terminal Interface
- ✅ Command execution and validation
- ✅ Command history and shortcuts
- ✅ Output formatting and colors
- ✅ Error handling and suggestions
- ✅ Performance and responsiveness
- ✅ Security (command injection prevention)

### User Interface
- ✅ Visual layout and design consistency
- ✅ Responsive design (desktop, tablet, mobile)
- ✅ Accessibility (ARIA, keyboard navigation)
- ✅ User interactions and feedback
- ✅ Error handling and progress indicators
- ✅ Performance and user experience

## Test Data

### Sample Files
- Text files with various content types
- Binary files (PNG images)
- Large files for performance testing
- Unicode and special character testing
- Directory structures

### Test Scenarios
- Multiple commit workflows
- Branch creation and switching patterns
- Error conditions and edge cases
- Performance stress tests

## Browser Support

Tests run on:
- ✅ Chromium (Chrome/Edge)
- ✅ Firefox
- ✅ WebKit (Safari)

Viewport testing:
- ✅ Desktop (1920x1080)
- ✅ Tablet (768x1024) 
- ✅ Mobile (375x667)

## Prerequisites

1. **Playwright installed**: `npm install --save-dev @playwright/test`
2. **Browsers installed**: `npx playwright install`
3. **Local server running**: Tests expect WebDVCS interface at `http://localhost:8000`

## Test Development

### Adding New Tests
1. Choose appropriate spec file or create new one
2. Use WebDVCSPage methods for interactions
3. Follow existing patterns for assertions
4. Include error cases and edge conditions

### Page Objects
Use the WebDVCSPage class for all UI interactions:
```javascript
import { WebDVCSPage } from './pages/webdvcs-page.js';

test('my test', async ({ browser }) => {
  const page = await browser.newPage();
  const webdvcs = new WebDVCSPage(page);
  await webdvcs.goto();
  await webdvcs.createNewRepository();
  // ... test logic
});
```

### Test Data
Use fixtures for consistent test data:
```javascript
import { testFiles, commitScenarios } from './fixtures/test-files.js';

await webdvcs.uploadFileContent('README.md', testFiles['README.md']);
```

## CI/CD Integration

Tests are configured for continuous integration:
- Retries failed tests 2x on CI
- Generates HTML reports
- Takes screenshots on failures
- Records video for failed tests
- Runs in headless mode

## Debugging

### Visual Debugging
- Screenshots saved on failure
- `await webdvcs.takeScreenshot('debug-name')`
- Video recordings available for failures

### Console Debugging
- Browser console logs captured
- Network request monitoring
- Performance timing metrics

### Interactive Debugging
```bash
npx playwright test --debug --headed
```

## Performance Benchmarks

Tests include performance validations:
- Interface load time < 5 seconds
- Command response time < 2 seconds  
- File upload progress indication
- Memory usage limits
- Concurrent operation handling

## Known Issues

- Repository persistence across page reloads depends on implementation
- Some visual regression tests may need baseline updates
- Mobile tests may require adjustments for different devices
- Binary file upload testing limited by browser constraints

## Contributing

1. Add tests for new features before implementation
2. Include both happy path and error scenarios
3. Follow accessibility testing patterns
4. Update page objects when UI changes
5. Maintain test data fixtures for consistency