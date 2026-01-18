---
description: Quick lint check - language, i18n, code style (fast, CI-friendly)
allowed-tools: Grep, Glob, Read, Bash
---

# Dployr Quick Check (Lint)

Fast automated checks for common issues. Run frequently, before commits, or in CI.
**Target runtime: < 1 minute**

## 1. Language / Code Style

### German in Code (should be English)
Search for German text in comments and logs:
- Comments: `// [German]`, `/* [German] */`, `<%# [German] %>`
- Logger calls: `logger.(info|warn|error|debug)` with German text
- Shell scripts: `echo` with German text

German indicators: ä, ö, ü, ß, common words (und, oder, wenn, dann, nicht, wird, werden, ist, sind, kann, muss, Fehler, Funktion, Prüfen)

**Exception**: User-facing UI text (flash messages, EJS templates) should be German.

### console.log Usage
Search for `console.log` in `dashboard/src/**/*.js` - should use `logger` instead.

### TODO/FIXME Comments
Search for `TODO`, `FIXME`, `HACK`, `XXX` - report but don't fail.

## 2. i18n Consistency

### Missing Translation Keys
Compare keys between `dashboard/src/locales/de/*.json` and `en/*.json`:
1. For each file, verify both languages have matching keys
2. Report missing keys with path (e.g., `projects.json: actions.delete`)

### Empty Translation Values
Search for `""` empty strings in translation files.

### Placeholder Mismatch
Check `{{variable}}` placeholders match between DE and EN.

## 3. Security Quick Checks

### Hardcoded Secrets
Search for patterns (exclude .env.example, tests):
- `password = "` or `password: "` with actual values
- `secret = "` or `secret: "` with actual values
- `token = "` with actual values

### eval() Usage
Search for `eval(` in .js files.

## 4. Git Status

### Uncommitted Changes
```bash
git status --porcelain
```

### Large Untracked Files
Check for files > 1MB that shouldn't be committed.

## Output Format

```
=== Dployr Quick Check ===

Language/Style:
  ✅ No German in code comments
  ⚠️ 2x console.log found
  ℹ️ 3x TODO comments

i18n:
  ✅ All translation keys present
  ⚠️ 1x empty translation value

Security:
  ✅ No hardcoded secrets
  ✅ No eval() usage

Git:
  ✅ Working directory clean

Summary: 2 warnings, 1 info
```

Use:
- ✅ Pass
- ⚠️ Warning (should fix)
- ℹ️ Info (optional)
- ❌ Error (must fix)
