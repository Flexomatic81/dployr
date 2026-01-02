# Dployr TODO

Aus Code Review vom 02.01.2026

## Priorität 2 - Empfohlen

### 1. Joi-Validierung für Admin-Routes hinzufügen
Aktuell fehlt Input-Validierung auf folgenden Routes:

- [ ] `POST /admin/users` - createUser Schema erstellen
- [ ] `PUT /admin/users/:id` - updateUser Schema erstellen
- [ ] `POST /proxy/:name/domains` - addDomain Schema erstellen

**Dateien:**
- `dashboard/src/middleware/validation.js` - Schemas hinzufügen
- `dashboard/src/routes/admin/users.js` - validate() Middleware einbinden
- `dashboard/src/routes/proxy.js` - validate() Middleware einbinden

### 2. Fehlende Tests hinzufügen
Folgende Module haben keine Tests:

- [ ] `tests/services/update.test.js` - Update Service testen
- [ ] `tests/middleware/projectAccess.test.js` - ProjectAccess Middleware testen

## Priorität 3 - Nice-to-have

### 3. Große Services refactoren (optional)
- [ ] `proxy.js` (1204 Zeilen) - NPM-API vs Domain-Management aufteilen
- [ ] `project.js` (938 Zeilen) - Env-Handling auslagern
- [ ] `git.js` (853 Zeilen) - Type Detection auslagern

---

## Metriken aus Review
| Metrik | Wert |
|--------|------|
| Routes | 21 Dateien |
| Services | 17 Dateien |
| Tests | 287 bestanden |
| Test Coverage | ~90% geschätzt |
