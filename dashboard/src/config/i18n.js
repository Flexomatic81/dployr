const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const middleware = require('i18next-http-middleware');
const path = require('path');

// Initialize i18next
i18next
    .use(Backend)
    .use(middleware.LanguageDetector)
    .init({
        fallbackLng: 'de',
        supportedLngs: ['de', 'en'],
        preload: ['de', 'en'],
        defaultNS: 'common',
        ns: ['common', 'projects', 'databases', 'admin', 'auth', 'help', 'errors', 'setup', 'proxy', 'profile', 'backups', 'workspaces'],
        backend: {
            loadPath: path.join(__dirname, '../locales/{{lng}}/{{ns}}.json')
        },
        detection: {
            order: ['session', 'querystring', 'cookie', 'header'],
            lookupSession: 'language',
            lookupQuerystring: 'lng',
            lookupCookie: 'i18next',
            caches: ['session', 'cookie']
        },
        interpolation: {
            escapeValue: false // EJS handles escaping
        }
    });

module.exports = { i18next, i18nMiddleware: middleware };
