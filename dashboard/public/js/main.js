// Webserver Dashboard JavaScript

// CSRF Token Management
function initCsrfProtection() {
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
    if (!csrfToken) return;

    // Füge CSRF-Token zu allen bestehenden Formularen hinzu
    document.querySelectorAll('form[method="POST"], form[method="post"]').forEach(form => {
        if (!form.querySelector('input[name="_csrf"]')) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = '_csrf';
            input.value = csrfToken;
            form.appendChild(input);
        }
    });

    // MutationObserver für dynamisch hinzugefügte Formulare
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Prüfe ob das hinzugefügte Element ein Formular ist
                    if (node.tagName === 'FORM' && (node.method === 'post' || node.method === 'POST')) {
                        if (!node.querySelector('input[name="_csrf"]')) {
                            const input = document.createElement('input');
                            input.type = 'hidden';
                            input.name = '_csrf';
                            input.value = csrfToken;
                            node.appendChild(input);
                        }
                    }
                    // Prüfe auch verschachtelte Formulare
                    node.querySelectorAll?.('form[method="POST"], form[method="post"]').forEach(form => {
                        if (!form.querySelector('input[name="_csrf"]')) {
                            const input = document.createElement('input');
                            input.type = 'hidden';
                            input.name = '_csrf';
                            input.value = csrfToken;
                            form.appendChild(input);
                        }
                    });
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Füge CSRF-Header zu fetch-Requests hinzu
    const originalFetch = window.fetch;
    window.fetch = function(url, options = {}) {
        if (options.method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method.toUpperCase())) {
            options.headers = options.headers || {};
            if (!(options.headers instanceof Headers)) {
                options.headers['X-CSRF-Token'] = csrfToken;
            } else {
                options.headers.set('X-CSRF-Token', csrfToken);
            }
        }
        return originalFetch(url, options);
    };
}

// Theme Management
function initTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeIcon');

    if (!themeToggle || !themeIcon) return;

    // Aktuelles Theme aus localStorage oder default
    const currentTheme = localStorage.getItem('theme') || 'light';
    updateThemeIcon(themeIcon, currentTheme);

    themeToggle.addEventListener('click', function() {
        const html = document.documentElement;
        const currentTheme = html.getAttribute('data-bs-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

        html.setAttribute('data-bs-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(themeIcon, newTheme);
    });
}

function updateThemeIcon(iconElement, theme) {
    if (theme === 'dark') {
        iconElement.className = 'bi bi-moon-fill';
    } else {
        iconElement.className = 'bi bi-sun-fill';
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // CSRF Protection initialisieren (muss vor anderen Form-Handlern laufen)
    initCsrfProtection();

    // Theme initialisieren
    initTheme();
    // Auto-dismiss alerts after 5 seconds
    const alerts = document.querySelectorAll('.alert-dismissible');
    alerts.forEach(alert => {
        setTimeout(() => {
            const bsAlert = bootstrap.Alert.getOrCreateInstance(alert);
            bsAlert.close();
        }, 5000);
    });

    // Confirm dangerous actions
    const dangerForms = document.querySelectorAll('form[data-confirm]');
    dangerForms.forEach(form => {
        form.addEventListener('submit', function(e) {
            const message = this.dataset.confirm || 'Bist du sicher?';
            if (!confirm(message)) {
                e.preventDefault();
            }
        });
    });

    // Add loading state to buttons on form submit
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        form.addEventListener('submit', function() {
            const submitBtn = this.querySelector('button[type="submit"]');
            if (submitBtn && !submitBtn.dataset.noLoading) {
                submitBtn.disabled = true;
                const originalText = submitBtn.innerHTML;
                submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> Laden...';

                // Re-enable after 10 seconds (fallback)
                setTimeout(() => {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalText;
                }, 10000);
            }
        });
    });

    // Tooltips
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    tooltipTriggerList.forEach(el => new bootstrap.Tooltip(el));

    // Popovers (für längere Hilfetexte)
    const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]');
    popoverTriggerList.forEach(el => new bootstrap.Popover(el));
});

// Utility functions
function copyToClipboard(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('In Zwischenablage kopiert!');
        });
    } else {
        // Fallback
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('In Zwischenablage kopiert!');
    }
}

function showToast(message, type = 'success') {
    // Simple toast notification
    const toast = document.createElement('div');
    toast.className = `alert alert-${type} position-fixed bottom-0 end-0 m-3`;
    toast.style.zIndex = '9999';
    toast.innerHTML = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}
