---
description: Deep code review - architecture, security, performance, tests
allowed-tools: Grep, Glob, Read, Bash
---

# Dployr Deep Review

Comprehensive code review for architecture, security, and quality. Run before releases or major PRs.
**Target runtime: 5-10 minutes**

**Note**: Run `/dployr-check` first for quick issues. This review focuses on deeper analysis.

## 1. Architecture Review

### Service Layer Separation
- Routes should only handle HTTP (req/res)
- Business logic must be in services
- Database queries in services or providers

Check for violations:
- Direct `db.query()` calls in route files
- Complex logic (>10 lines) in route handlers

### Provider Pattern
- MariaDB and PostgreSQL providers should have identical interfaces
- No provider-specific code in `database.js`

### Middleware Consistency
- `requireAuth` on all protected routes?
- `requireAdmin` on admin routes?
- `projectAccess` on project routes?
- Validation middleware on user input?

## 2. Security Deep Dive

### Input Validation
- All user inputs validated with Joi schemas?
- File uploads checked (type, size, extension)?
- URL parameters sanitized?

### SQL Injection
- All queries use parameterized statements?
- No string concatenation in SQL?

Search patterns:
```javascript
// Bad: `SELECT * FROM users WHERE id = ${id}`
// Good: `SELECT * FROM users WHERE id = ?`, [id]
```

### Authentication & Authorization
- Protected routes have `requireAuth`?
- Admin routes have `requireAdmin`?
- Project routes check ownership/sharing?

### Path Traversal
- User-supplied paths validated?
- `path.join()` with user input sanitized?

## 3. Code Quality

### Error Handling Quality
- Async handlers wrapped in try/catch?
- Errors logged with context (userId, projectName)?
- User-friendly flash messages vs technical logs?

### Logging Quality
- Appropriate log levels (info/warn/error)?
- Sensitive data excluded (passwords, tokens)?
- Sufficient context for debugging?

### Code Complexity
- Functions > 50 lines?
- Nested conditionals > 3 levels?
- Functions with > 4 parameters?

### Code Duplication
- Similar code blocks that could be utils?
- Repeated validation patterns?
- Repeated query patterns?

## 4. Performance Review

### Database
- N+1 query patterns (queries in loops)?
- Missing indexes for frequent queries?
- Unnecessary queries?

### Docker Operations
- Blocking Docker calls that could be async?
- Repeated container status checks?

### File Operations
- Large files loaded into memory?
- Temporary files cleaned up?

## 5. Tests

### Run Test Suite
```bash
cd dashboard && npm test
```

### Analyze Results
- Total tests: passed / failed / skipped
- Test duration
- For failures: error message, likely cause, suggested fix

### Test Coverage
If coverage available:
- Overall coverage percentage
- Files with low coverage (<80%)
- Uncovered critical paths

### Missing Tests
Check for untested code:
- Services without `*.test.js`
- Middleware without tests
- Critical paths (auth, CRUD) untested

### Test Quality
- AAA pattern (Arrange, Act, Assert)?
- Proper mocking of dependencies?
- Edge cases covered?
- Error conditions tested?

## Output Format

```
=== Dployr Deep Review ===

Overall Health: Good / Needs Attention / Critical

Top 3 Priorities:
1. [Most important issue]
2. [Second issue]
3. [Third issue]

--- Architecture ---
✅ Service layer separation: Good
⚠️ Middleware: Missing validation on 2 routes

--- Security ---
✅ SQL injection: All queries parameterized
⚠️ Input validation: 3 routes missing Joi schemas

--- Code Quality ---
✅ Error handling: Consistent
⚠️ Complexity: 2 functions > 50 lines

--- Performance ---
✅ No N+1 patterns found
ℹ️ Consider caching for /api/status

--- Tests ---
✅ 45 tests passed (2.3s)
⚠️ Missing tests for: workspace.js, preview.js

Action Items:
1. Add Joi validation to POST /projects/:name/share
2. Refactor syncToProject() - 65 lines
3. Add tests for workspace service
```

Severity levels:
- ✅ Good
- ℹ️ Suggestion (nice to have)
- ⚠️ Warning (should fix)
- ❌ Critical (must fix before release)
