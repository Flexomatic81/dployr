---
description: Ultra-fast pre-commit checks (staged files only)
allowed-tools: Bash, Grep, Glob, Read
---

# Dployr Pre-Commit Check

Ultra-fast checks on staged files only. Designed for git pre-commit hooks.
**Target runtime: < 10 seconds**

## 1. Get Staged Files

```bash
git diff --cached --name-only --diff-filter=ACM
```

Only check files that are:
- **A**dded
- **C**opied
- **M**odified

## 2. Checks (Staged Files Only)

### JavaScript Files (.js)

**console.log**
```bash
git diff --cached --name-only --diff-filter=ACM | grep '\.js$' | xargs -r grep -l 'console\.log'
```

**German in comments/logs**
Check for German words in staged .js files (ä, ö, ü, ß, common German words in comments).

### Translation Files (.json in locales/)

**Valid JSON**
```bash
node -e "JSON.parse(require('fs').readFileSync('$file'))"
```

**Missing Keys**
If a locale file is staged, check that both DE and EN have matching keys.

### EJS Templates (.ejs)

**Missing t() calls**
Check for hardcoded German text that should use `t('key')`.

## 3. Output Format

```
=== Pre-Commit Check ===

Checking 3 staged files...

✅ src/services/workspace.js
⚠️ src/routes/projects.js
   Line 45: console.log found
✅ src/locales/de/common.json

Result: 1 warning - commit allowed (use --no-verify to skip)
```

## 4. Exit Codes

- `0` - All checks passed
- `1` - Warnings found (allow commit, show message)
- `2` - Errors found (block commit)

## Quick Reference

| Check | Blocks Commit? |
|-------|----------------|
| console.log | No (warning) |
| German in code | No (warning) |
| Invalid JSON | Yes (error) |
| Missing i18n key | Yes (error) |
