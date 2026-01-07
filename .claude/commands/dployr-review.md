---
description: Deep code review for architecture, best practices, security, and improvement suggestions (project)
allowed-tools: Grep, Glob, Read, Bash
---

# Dployr Code Review

Perform a comprehensive code review of the Dployr codebase. This is a deeper analysis than /dployr-check, focusing on architecture, patterns, and improvement opportunities.

## 1. Architecture Review

### Service Layer Separation
- Check that routes only handle HTTP concerns (req/res)
- Business logic should be in services, not routes
- Database queries should be in services or providers

### Provider Pattern Consistency
- MariaDB and PostgreSQL providers should have identical interfaces
- Check for provider-specific code leaking into database.js

### Middleware Usage
- Auth middleware applied consistently?
- Validation middleware on all user input routes?
- Project access middleware on all project routes?

## 2. Code Quality

### Error Handling
- All async route handlers wrapped in try/catch?
- Errors logged with context (userId, projectName)?
- User-friendly error messages (flash) vs technical logs?

### Logging Quality
- Appropriate log levels (info vs warn vs error)?
- Sensitive data excluded from logs (passwords, tokens)?
- Sufficient context for debugging?

### Code Duplication
- Similar code blocks that could be extracted to utils?
- Repeated validation patterns?
- Repeated database query patterns?

### Function Complexity
- Functions longer than 50 lines?
- Deeply nested conditionals (>3 levels)?
- Functions with too many parameters (>4)?

## 3. Security Review

### Input Validation
- All user inputs validated with Joi?
- File uploads validated (type, size)?
- URL parameters sanitized?

### SQL Injection Protection
- All queries use parameterized statements?
- No string concatenation in SQL?

### Authentication & Authorization
- Protected routes have requireAuth?
- Admin routes have requireAdmin?
- Project routes check ownership/sharing permissions?

### Path Traversal
- User-supplied paths validated?
- No direct file access with user input?

### Secrets Management
- No hardcoded credentials?
- Environment variables for all secrets?
- .env excluded from git?

## 4. Performance Review

### Database Queries
- N+1 query patterns?
- Missing indexes suggested by query patterns?
- Unnecessary queries in loops?

### Docker Operations
- Blocking Docker calls that could be async?
- Repeated container status checks?

### File Operations
- Large file handling (streaming vs loading in memory)?
- Temporary file cleanup?

## 5. Test Coverage

### Critical Paths
- Authentication flow tested?
- Project CRUD operations tested?
- Database operations tested?

### Edge Cases
- Invalid input handling tested?
- Permission denial tested?
- Error conditions tested?

### Missing Tests
- Services without test files?
- Middleware without tests?
- Utils without tests?

## 6. Documentation Accuracy

### CLAUDE.md
- Does it reflect current architecture?
- Are all services documented?
- Are all routes documented?

### Code Comments
- Complex logic explained?
- Public APIs documented with JSDoc?

## Output Format

Provide a structured report with:

### Summary
- Overall code health assessment (Good / Needs Attention / Critical)
- Top 3 priority improvements

### Detailed Findings
For each category:
- Findings with file:line references
- Severity (Info / Warning / Critical)
- Concrete improvement suggestions

### Action Items
Prioritized list of recommended changes.
