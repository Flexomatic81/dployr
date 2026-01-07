---
description: Run tests and analyze results with improvement suggestions (project)
allowed-tools: Bash, Read, Glob, Grep
---

# Dployr Test Runner

Run the test suite and provide detailed analysis of results.

## 1. Run Tests

Execute the Jest test suite:
```bash
cd dashboard && npm test
```

## 2. Analyze Results

### Test Summary
- Total tests run
- Passed / Failed / Skipped
- Test duration

### Failed Tests
For each failed test:
- Test name and file location
- Error message and stack trace
- Likely cause analysis
- Suggested fix

### Test Coverage
If coverage is available:
- Overall coverage percentage
- Files with low coverage (<80%)
- Uncovered critical paths

## 3. Test Quality Analysis

### Missing Tests
Check for untested code:
- Services without corresponding test files
- Middleware without tests
- Route handlers without integration tests

Current test structure:
```
dashboard/tests/
├── services/
│   └── user.test.js
└── middleware/
    ├── auth.test.js
    └── validation.test.js
```

### Test Patterns
- Are tests following AAA pattern (Arrange, Act, Assert)?
- Proper mocking of dependencies?
- Edge cases covered?

## 4. Recommendations

Provide prioritized list of:
- Tests to fix (if any failed)
- Tests to add (critical paths)
- Test improvements (better assertions, edge cases)

## Output Format

```
=== Dployr Test Results ===

Status: PASS / FAIL

Summary:
- X tests passed
- X tests failed
- X tests skipped
- Duration: X.XXs

[If failures:]
Failed Tests:
1. test name (file:line)
   Error: ...
   Suggestion: ...

Missing Test Coverage:
- service/xyz.js - no tests
- middleware/abc.js - no tests

Recommendations:
1. ...
2. ...
```
