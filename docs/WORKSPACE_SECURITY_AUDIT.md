# Workspace Security Audit Report

**Date:** 2026-01-08
**Auditor:** Claude Code (Automated Security Audit)
**Scope:** Workspaces Feature Implementation (Phases 1-5)

---

## Executive Summary

This security audit reviews the Workspaces feature implementation across services, routes, middleware, and Docker infrastructure. The audit identifies security findings categorized by severity and provides remediation recommendations.

**Overall Assessment:** The implementation follows security best practices in most areas. Critical findings require immediate attention before production deployment.

---

## Critical Findings

### C1: API Key Test Endpoint Vulnerable to Rate Limit Bypass

**Severity:** CRITICAL
**File:** `dashboard/src/routes/api-keys.js:99`
**Component:** API Key Test Route

**Description:**
The `/settings/api-keys/anthropic/test` endpoint makes actual API calls to Anthropic without proper rate limiting. An attacker could:
- Exhaust API quota by repeatedly testing keys
- Use this as a timing oracle to validate stolen keys
- Perform denial-of-service by triggering many concurrent API calls

**Current Code:**
```javascript
router.post('/anthropic/test', async (req, res) => {
    // No rate limiting applied
    const anthropic = new Anthropic({ apiKey });
    await anthropic.messages.create({...});
});
```

**Recommendation:**
1. Add aggressive rate limiting (e.g., 3 requests per hour per user)
2. Implement request throttling with exponential backoff
3. Log all test attempts for audit purposes
4. Consider replacing with client-side validation pattern

**Fix:**
```javascript
const testLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    message: { error: 'Too many API key test attempts' }
});

router.post('/anthropic/test', testLimiter, async (req, res) => {
    // Existing code
    logger.warn('API key test attempted', { userId });
});
```

---

### C2: SQL Injection Risk in Dynamic Column Names

**Severity:** CRITICAL
**File:** `dashboard/src/services/workspace.js:708-710, 769-771`
**Component:** API Key Management

**Description:**
The API key functions use template literals to dynamically construct column names from the `provider` parameter without validation:

```javascript
await pool.query(
    `UPDATE user_api_keys SET
        ${provider}_key_encrypted = ?,
        ${provider}_key_iv = ?
    WHERE user_id = ?`,
    [encrypted, iv, userId]
);
```

If the `provider` parameter is not properly validated, an attacker could inject SQL:
- `provider = "anthropic_key_encrypted = NULL, admin = 1 WHERE 1=1; --"`

**Recommendation:**
Use a whitelist validation approach:

**Fix:**
```javascript
function validateProvider(provider) {
    const VALID_PROVIDERS = ['anthropic', 'openai'];
    if (!VALID_PROVIDERS.includes(provider)) {
        throw new Error('Invalid provider');
    }
    return provider;
}

async function setApiKey(userId, provider, apiKey) {
    provider = validateProvider(provider);
    // Rest of function...
}
```

**Apply this to all functions:** `setApiKey`, `getDecryptedApiKey`, `deleteApiKey`, `hasApiKey`

---

### C3: Container Escape via Insufficient Capability Restrictions

**Severity:** CRITICAL
**File:** `dashboard/src/services/workspace.js:291`
**Component:** Workspace Container Configuration

**Description:**
While the workspace container drops all capabilities and adds back minimal ones, the combination `CHOWN + SETUID + SETGID` could potentially be exploited:

```javascript
CapDrop: ['ALL'],
CapAdd: ['CHOWN', 'SETUID', 'SETGID'],
```

The `SETUID` and `SETGID` capabilities are dangerous and have been used in container escape exploits.

**Recommendation:**
1. Remove `SETUID` and `SETGID` if not strictly necessary
2. Test if code-server works without these capabilities
3. If required, add AppArmor/SELinux profile for additional hardening

**Fix:**
```javascript
CapDrop: ['ALL'],
CapAdd: ['CHOWN'], // Remove SETUID and SETGID
```

If capabilities are needed, add AppArmor profile in Dockerfile:
```dockerfile
# Add AppArmor profile
COPY docker-workspace-apparmor /etc/apparmor.d/docker-workspace
RUN apparmor_parser -r /etc/apparmor.d/docker-workspace
```

---

## High Severity Findings

### H1: Preview Password Storage Not Salted Per-User

**Severity:** HIGH
**File:** `dashboard/src/services/preview.js:83-85`
**Component:** Preview Password Hashing

**Description:**
Preview passwords use bcrypt with a fixed cost factor (10). While bcrypt includes internal salting, using a consistent cost factor across all users makes rainbow table attacks easier once one hash is cracked.

**Current Code:**
```javascript
const passwordHash = await bcrypt.hash(password, 10);
```

**Recommendation:**
1. Increase cost factor to 12 for better security
2. Store hash algorithm version for future migration

**Fix:**
```javascript
const BCRYPT_ROUNDS = 12;
const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
```

---

### H2: Race Condition in Port Allocation

**Severity:** HIGH
**File:** `dashboard/src/services/portManager.js:24-47`
**Component:** Port Allocation

**Description:**
The `allocatePort()` function is vulnerable to race conditions. If two workspace start requests occur simultaneously, they could receive the same port:

1. Request A reads used ports: [10000, 10001]
2. Request B reads used ports: [10000, 10001] (same state)
3. Request A allocates port 10002
4. Request B also allocates port 10002 (collision)

**Recommendation:**
Use database-level locking or atomic operations:

**Fix:**
```javascript
async function allocatePort() {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Lock the tables
        await connection.query('LOCK TABLES workspaces WRITE, preview_environments WRITE');

        // Get used ports
        const [rows] = await connection.query(/* query */);
        const usedPorts = new Set(rows.map(r => r.assigned_port));

        // Find available port
        for (let port = PORT_RANGE.start; port <= PORT_RANGE.end; port++) {
            if (!usedPorts.has(port)) {
                await connection.commit();
                await connection.query('UNLOCK TABLES');
                return port;
            }
        }

        throw new Error('No ports available');
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}
```

---

### H3: Missing Input Validation on Workspace Settings

**Severity:** HIGH
**File:** `dashboard/src/routes/workspaces.js:352-380`
**Component:** Workspace Settings Update

**Description:**
The workspace settings update endpoint accepts `cpu_limit`, `ram_limit`, and `idle_timeout_minutes` without proper validation. An attacker could:
- Set extremely high values to exhaust system resources
- Set negative values causing undefined behavior
- Use malformed strings causing parsing errors

**Recommendation:**
Add comprehensive input validation:

**Fix:**
```javascript
const Joi = require('joi');

const settingsSchema = Joi.object({
    cpu_limit: Joi.string().pattern(/^[0-9]+(\.[0-9]+)?$/).max(10).optional(),
    ram_limit: Joi.string().pattern(/^[0-9]+[mMgG]$/).max(10).optional(),
    idle_timeout_minutes: Joi.number().integer().min(5).max(1440).optional()
});

router.put('/:projectName/settings', async (req, res) => {
    // Validate input
    const { error, value } = settingsSchema.validate(req.body);
    if (error) {
        return res.status(400).json({
            success: false,
            error: 'Invalid settings: ' + error.message
        });
    }

    const { cpu_limit, ram_limit, idle_timeout_minutes } = value;
    // Rest of function...
});
```

---

### H4: Encryption Key Derivation Uses Weak Salt

**Severity:** HIGH
**File:** `dashboard/src/services/encryption.js:26`
**Component:** Key Derivation

**Description:**
The scrypt key derivation uses a hardcoded salt `'dployr-api-keys'`. While scrypt is secure, using a static salt means:
- If SESSION_SECRET is leaked, all API keys can be decrypted
- No forward secrecy if keys are rotated

**Current Code:**
```javascript
return crypto.scryptSync(secret, 'dployr-api-keys', KEY_LENGTH);
```

**Recommendation:**
Generate a unique salt per installation and store it securely:

**Fix:**
```javascript
// In database migration, add:
ALTER TABLE settings ADD COLUMN encryption_salt VARCHAR(64);
INSERT INTO settings (encryption_salt) VALUES (HEX(RANDOM_BYTES(32)));

// In encryption.js:
async function deriveKey(secret) {
    const [rows] = await pool.query('SELECT encryption_salt FROM settings LIMIT 1');
    const salt = rows[0].encryption_salt || 'dployr-api-keys'; // Fallback for migration
    return crypto.scryptSync(secret, salt, KEY_LENGTH);
}
```

---

### H5: Workspace IDE Lacks CSRF Protection on Proxied Requests

**Severity:** HIGH
**File:** `dashboard/src/routes/workspaces.js:310-343`
**Component:** Workspace IDE Access

**Description:**
The workspace IDE endpoint serves an iframe that proxies to code-server. If code-server has any state-changing operations accessible via GET requests, they could be vulnerable to CSRF attacks through the proxy.

**Recommendation:**
1. Add Content-Security-Policy headers to restrict iframe embedding
2. Implement Same-Site cookie policy
3. Add X-Frame-Options header

**Fix:**
```javascript
router.get('/:projectName/ide', async (req, res) => {
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Existing code...
});
```

---

### H6: Docker Entrypoint Authentication Disabled

**Severity:** HIGH
**File:** `docker/workspace/entrypoint.sh:42`
**Component:** Code-Server Authentication

**Description:**
The code-server is started with `--auth none`, making it publicly accessible without authentication:

```bash
exec code-server \
    --bind-addr 0.0.0.0:8080 \
    --auth none \
```

If the container port is accidentally exposed (misconfigured firewall, Docker port mapping error), anyone could access the workspace.

**Recommendation:**
Use token-based authentication:

**Fix:**
```bash
# Generate a secure token
if [ -z "$CODE_SERVER_PASSWORD" ]; then
    CODE_SERVER_PASSWORD=$(openssl rand -base64 32)
    echo "Generated password: $CODE_SERVER_PASSWORD" > /workspace/.code-server-password
fi

exec code-server \
    --bind-addr 0.0.0.0:8080 \
    --auth password \
    --password "$CODE_SERVER_PASSWORD" \
    --disable-telemetry \
    /workspace
```

Then inject the password from the dashboard and display it to the user in the IDE view.

---

## Medium Severity Findings

### M1: Activity Heartbeat Not Rate Limited

**Severity:** MEDIUM
**File:** `dashboard/src/routes/workspaces.js:284-301`
**Component:** Activity Update Endpoint

**Description:**
The activity heartbeat endpoint could be abused to keep a workspace alive indefinitely by automated requests:

```javascript
router.post('/:projectName/activity', async (req, res) => {
    await workspaceService.updateActivity(req.workspace.id, userId);
});
```

**Recommendation:**
Add rate limiting to prevent abuse:

**Fix:**
```javascript
const activityLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // 5 heartbeats per minute max
    skipSuccessfulRequests: false
});

router.post('/:projectName/activity', activityLimiter, async (req, res) => {
    // Existing code
});
```

---

### M2: Preview URL Uses HTTP Without TLS

**Severity:** MEDIUM
**File:** `dashboard/src/services/preview.js:453-457`
**Component:** Preview URL Generation

**Description:**
Preview URLs are generated with `http://` protocol, potentially exposing sensitive data in transit.

**Recommendation:**
Detect if the application runs behind HTTPS and generate URLs accordingly:

**Fix:**
```javascript
function generatePreviewUrl(previewHash) {
    const protocol = process.env.USE_HTTPS === 'true' ? 'https' : 'http';
    const domain = process.env.NPM_DASHBOARD_DOMAIN || process.env.SERVER_IP || 'localhost';
    return `${protocol}://${domain}/previews/${previewHash}`;
}
```

---

### M3: Workspace Logs Store Unfiltered Details

**Severity:** MEDIUM
**File:** `dashboard/src/services/workspace.js:65-77`
**Component:** Workspace Logging

**Description:**
The `logWorkspaceAction` function stores arbitrary JSON in the `details` field without filtering sensitive data:

```javascript
await pool.query(
    `INSERT INTO workspace_logs (..., details) VALUES (?, ?, ?, ?, ?)`,
    [..., JSON.stringify(details)]
);
```

If details accidentally include API keys or passwords, they would be stored in plaintext.

**Recommendation:**
Filter sensitive keys before logging:

**Fix:**
```javascript
function sanitizeDetails(details) {
    const SENSITIVE_KEYS = ['api_key', 'password', 'token', 'secret'];
    const sanitized = { ...details };

    for (const key of Object.keys(sanitized)) {
        if (SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k))) {
            sanitized[key] = '[REDACTED]';
        }
    }

    return sanitized;
}

async function logWorkspaceAction(workspaceId, userId, projectName, action, details = {}) {
    const sanitizedDetails = sanitizeDetails(details);
    await pool.query(/* ... */, [/* ... */, JSON.stringify(sanitizedDetails)]);
}
```

---

### M4: Missing Content-Type Validation in API Endpoints

**Severity:** MEDIUM
**File:** Multiple route files
**Component:** All POST/PUT/DELETE routes

**Description:**
Routes do not validate `Content-Type` header, allowing potential request smuggling or MIME confusion attacks.

**Recommendation:**
Add middleware to validate Content-Type for JSON endpoints:

**Fix:**
```javascript
// In app.js or middleware file
function requireJsonContentType(req, res, next) {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        const contentType = req.get('Content-Type');
        if (contentType && !contentType.includes('application/json') &&
            !contentType.includes('application/x-www-form-urlencoded')) {
            return res.status(415).json({ error: 'Unsupported Media Type' });
        }
    }
    next();
}

// Apply to API routes
app.use('/workspaces', requireJsonContentType);
```

---

### M5: Container Resource Limits Bypassable via Multiple Workspaces

**Severity:** MEDIUM
**File:** `dashboard/src/services/workspace.js:119-135`
**Component:** Workspace Creation Limit Check

**Description:**
While individual workspace limits are enforced, a user could create multiple workspaces (up to `max_workspaces`) and aggregate resource usage could exceed acceptable limits.

Example: User limit = 2 workspaces, each with 2GB RAM = 4GB total (might exceed server capacity)

**Recommendation:**
Add aggregate resource limit check:

**Fix:**
```javascript
async function canCreateWorkspace(userId) {
    const limits = await getResourceLimits(userId);

    // Check count
    const [countRows] = await pool.query(
        'SELECT COUNT(*) as count FROM workspaces WHERE user_id = ?',
        [userId]
    );

    if (countRows[0].count >= limits.max_workspaces) {
        return false;
    }

    // Check aggregate resource usage
    const [resourceRows] = await pool.query(`
        SELECT
            SUM(CAST(SUBSTRING_INDEX(ram_limit, 'g', 1) AS UNSIGNED)) as total_ram_gb
        FROM workspaces
        WHERE user_id = ? AND status IN ('running', 'starting')
    `, [userId]);

    const totalRamGb = resourceRows[0].total_ram_gb || 0;
    const maxTotalRamGb = limits.max_total_ram || 8; // Add new limit

    return totalRamGb < maxTotalRamGb;
}
```

---

## Low Severity Findings

### L1: Missing Security Headers in Workspace Routes

**Severity:** LOW
**File:** `dashboard/src/routes/workspaces.js`
**Component:** All routes

**Recommendation:**
Add security headers to all responses:
- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`

---

### L2: Verbose Error Messages Leak Implementation Details

**Severity:** LOW
**File:** Multiple service files
**Component:** Error handling

**Description:**
Error messages like "Workspace image dployr-workspace:latest not found" reveal internal configuration.

**Recommendation:**
Use generic error messages in production, log detailed errors server-side.

---

### L3: Docker Image Not Scanned for Vulnerabilities

**Severity:** LOW
**File:** `docker/workspace/Dockerfile`
**Component:** Base image and dependencies

**Recommendation:**
Integrate Trivy or similar scanner in CI/CD:

```bash
docker build -t dployr-workspace:latest .
trivy image --severity HIGH,CRITICAL dployr-workspace:latest
```

---

## Recommendations Summary

### Immediate Actions (Critical)
1. [ ] Fix SQL injection in API key functions (C2)
2. [ ] Add rate limiting to API key test endpoint (C1)
3. [ ] Review and minimize container capabilities (C3)
4. [ ] Implement provider whitelist validation (C2)

### Short-term Actions (High)
5. [ ] Fix port allocation race condition (H2)
6. [ ] Add input validation to settings endpoint (H3)
7. [ ] Enable code-server authentication (H6)
8. [ ] Add CSP headers to IDE endpoint (H5)
9. [ ] Improve encryption key derivation (H4)

### Medium-term Actions (Medium)
10. [ ] Implement activity heartbeat rate limiting (M1)
11. [ ] Add HTTPS detection for preview URLs (M2)
12. [ ] Filter sensitive data in logs (M3)
13. [ ] Add Content-Type validation (M4)
14. [ ] Implement aggregate resource limits (M5)

### Long-term Actions (Low)
15. [ ] Add comprehensive security headers (L1)
16. [ ] Sanitize error messages (L2)
17. [ ] Implement image scanning in CI/CD (L3)

---

## Testing Checklist

After implementing fixes, verify:

- [ ] SQL injection tests pass (sqlmap, manual payloads)
- [ ] Rate limiters trigger correctly
- [ ] Container escape attempts fail
- [ ] Race condition in port allocation resolved (concurrent test)
- [ ] Input validation rejects malicious values
- [ ] Authentication required for code-server access
- [ ] CSP headers present in IDE view
- [ ] Sensitive data not logged
- [ ] HTTPS URLs generated when applicable

---

## Conclusion

The Workspaces implementation demonstrates good security practices in encryption, authentication, and authorization. However, several critical issues (SQL injection, rate limiting, container hardening) must be addressed before production deployment.

**Security Score:** 7.5/10
**Production Ready:** NO (requires critical fixes)
**Estimated Fix Time:** 4-6 hours for critical/high findings

---

**Next Steps:**
1. Implement all Critical and High severity fixes
2. Re-run security audit
3. Conduct penetration testing
4. Document security architecture
5. Create incident response plan for workspace-related security events
