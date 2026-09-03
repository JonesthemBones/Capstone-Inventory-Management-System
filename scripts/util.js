function formatCurrency(amount) {
    return new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP'
    }).format(amount);
}

function formatDate(dateString, includeTime = false) {
    const date = new Date(dateString);
    const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    };
    
    if (includeTime) {
        options.hour = '2-digit';
        options.minute = '2-digit';
    }
    
    return date.toLocaleDateString('en-US', options);
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    
    const intervals = {
        year: 31536000,
        month: 2592000,
        week: 604800,
        day: 86400,
        hour: 3600,
        minute: 60,
        second: 1
    };
    
    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInUnit);
        if (interval >= 1) {
            return `${interval} ${unit}${interval !== 1 ? 's' : ''} ago`;
        }
    }
    
    return 'just now';
}

const TOAST_ICONS = {
    success: 'fa-circle-check',
    error: 'fa-circle-exclamation',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
};

function inferToastType(message) {
    const text = String(message || '').toLowerCase();
    if (/error|failed|cannot|could not|unable|denied|invalid|insufficient|not enough/.test(text)) return 'error';
    if (/warning|please|no items|empty|allow pop-ups|locked|out of stock/.test(text)) return 'warning';
    if (/success|saved|updated|added|deleted|exported|sent|complete|confirmed|voided|removed/.test(text)) return 'success';
    return 'info';
}

function showToast(message, type = 'info', options = {}) {
    const normalizedType = TOAST_ICONS[type] ? type : 'info';
    const normalizedMessage = String(message ?? '').replace(/^[✅❌⚠️🔒✓✖]\s*/u, '').trim();
    if (!normalizedMessage) return;

    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
    }

    const duplicate = [...container.querySelectorAll('.app-toast')]
        .find(item => item.dataset.message === normalizedMessage && item.dataset.type === normalizedType);
    if (duplicate) return duplicate;

    const toast = document.createElement('div');
    toast.className = `app-toast app-toast-${normalizedType}`;
    toast.dataset.message = normalizedMessage;
    toast.dataset.type = normalizedType;
    toast.setAttribute('role', normalizedType === 'error' ? 'alert' : 'status');
    toast.innerHTML = `
        <i class="fas ${TOAST_ICONS[normalizedType]} app-toast-icon" aria-hidden="true"></i>
        <span class="app-toast-message"></span>
        <button type="button" class="app-toast-close" aria-label="Dismiss notification">
            <i class="fas fa-times" aria-hidden="true"></i>
        </button>
    `;
    toast.querySelector('.app-toast-message').textContent = normalizedMessage;
    
    container.appendChild(toast);

    let removeTimer;
    const dismiss = () => {
        window.clearTimeout(removeTimer);
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            toast.remove();
            if (!container.children.length) container.remove();
        }, 300);
    };
    toast.querySelector('.app-toast-close').addEventListener('click', dismiss);
    removeTimer = window.setTimeout(dismiss, options.duration || (normalizedType === 'error' ? 7000 : 5000));

    if (options.carryAcrossNavigation !== false) {
        const pending = { message: normalizedMessage, type: normalizedType, createdAt: Date.now() };
        try { sessionStorage.setItem('amacar:pending-toast', JSON.stringify(pending)); } catch (_) { /* Storage is optional. */ }
        window.setTimeout(() => {
            try {
                const stored = JSON.parse(sessionStorage.getItem('amacar:pending-toast') || 'null');
                if (stored?.createdAt === pending.createdAt) sessionStorage.removeItem('amacar:pending-toast');
            } catch (_) { /* Storage is optional. */ }
        }, 1500);
    }

    return toast;
}

const style = document.createElement('style');
style.textContent = `
    #toast-container {
        position: fixed;
        top: max(20px, env(safe-area-inset-top));
        right: max(20px, env(safe-area-inset-right));
        width: min(420px, calc(100vw - 40px));
        display: flex;
        flex-direction: column;
        gap: 10px;
        z-index: 20000;
        pointer-events: none;
    }
    .app-toast {
        --toast-accent: #2563eb;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: start;
        gap: 12px;
        padding: 14px 12px 14px 16px;
        color: var(--text-primary, #1f2937);
        background: var(--bg-white, #ffffff);
        border: 1px solid var(--border-color, #e5e7eb);
        border-radius: 10px;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18);
        line-height: 1.45;
        overflow-wrap: anywhere;
        white-space: pre-line;
        pointer-events: auto;
        animation: slideIn 0.3s ease;
        max-height: min(45dvh, 320px);
        overflow-y: auto;
    }
    .app-toast-success { --toast-accent: #16a34a; }
    .app-toast-error { --toast-accent: #dc2626; }
    .app-toast-warning { --toast-accent: #d97706; }
    .app-toast-info { --toast-accent: #2563eb; }
    .app-toast-icon { color: var(--toast-accent); margin-top: 3px; font-size: 17px; }
    .app-toast-message { min-width: 0; }
    .app-toast-close {
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        margin: -6px -4px -6px 0;
        padding: 0;
        color: var(--text-secondary, #6b7280);
        background: transparent;
        border: 0;
        border-radius: 6px;
        cursor: pointer;
    }
    .app-toast-close:hover { background: var(--bg-light, #f3f4f6); color: var(--text-primary, #1f2937); }
    .app-toast-close:focus-visible { outline: 2px solid var(--toast-accent); outline-offset: 2px; }
    .app-confirm-overlay {
        position: fixed;
        inset: 0;
        z-index: 21000;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(15, 23, 42, 0.62);
        animation: confirmFadeIn 0.18s ease;
    }
    .app-confirm-dialog {
        display: flex;
        flex-direction: column;
        width: min(440px, 100%);
        max-height: calc(100dvh - 40px);
        overflow: hidden;
        color: var(--text-primary, #1f2937);
        background: var(--bg-white, #ffffff);
        border: 1px solid var(--border-color, #e5e7eb);
        border-radius: 14px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
    }
    .app-confirm-heading {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 14px;
        padding: 22px 22px 18px;
        min-height: 0;
        overflow-y: auto;
    }
    .app-confirm-symbol {
        display: grid;
        width: 38px;
        height: 38px;
        place-items: center;
        color: #d97706;
        background: rgba(217, 119, 6, 0.12);
        border-radius: 50%;
    }
    .app-confirm-dialog h2 { margin: 0 0 7px; font-size: 18px; line-height: 1.3; }
    .app-confirm-dialog p { margin: 0; color: var(--text-secondary, #64748b); line-height: 1.55; white-space: pre-line; }
    .app-confirm-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        padding: 10px 22px 20px 74px;
        flex: 0 0 auto;
    }
    .app-confirm-btn {
        width: 100%;
        min-height: 42px;
        padding: 9px 17px;
        color: var(--text-primary, #1f2937);
        background: var(--bg-white, #ffffff);
        border: 1px solid var(--border-color, #d1d5db);
        border-radius: 8px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
    }
    .app-confirm-btn:hover { filter: brightness(0.96); }
    .app-confirm-btn:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.3); outline-offset: 2px; }
    .app-confirm-accept.is-primary { color: #fff; background: #2563eb; border-color: #2563eb; }
    .app-confirm-accept.is-danger { color: #fff; background: #dc2626; border-color: #dc2626; }
    @keyframes confirmFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
    @media (max-width: 640px) {
        #toast-container {
            top: calc(72px + env(safe-area-inset-top));
            left: 12px;
            right: 12px;
            width: auto;
        }
        .app-toast {
            max-height: min(40dvh, 280px);
            padding: 13px 10px 13px 14px;
            font-size: 14px;
        }
        .app-confirm-overlay { align-items: end; padding: 0; }
        .app-confirm-dialog {
            width: 100%;
            max-height: calc(100dvh - max(8px, env(safe-area-inset-top)));
            border-radius: 18px 18px 0 0;
        }
        .app-confirm-heading { padding: 20px 16px 16px; }
        .app-confirm-actions {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            padding: 10px 16px max(16px, env(safe-area-inset-bottom));
        }
        .app-confirm-btn { min-height: 46px; }
    }
    @media (max-width: 380px) {
        #toast-container {
            left: 8px;
            right: 8px;
        }
        .app-toast {
            grid-template-columns: auto minmax(0, 1fr) auto;
            gap: 9px;
            padding-left: 12px;
        }
        .app-confirm-heading {
            gap: 11px;
            padding: 18px 14px 14px;
        }
        .app-confirm-symbol { width: 34px; height: 34px; }
        .app-confirm-dialog h2 { font-size: 17px; }
        .app-confirm-actions {
            grid-template-columns: 1fr;
            padding: 8px 14px max(14px, env(safe-area-inset-bottom));
        }
        .app-confirm-btn { min-height: 48px; }
    }
    @media (max-height: 480px) and (orientation: landscape) {
        .app-confirm-overlay { align-items: center; padding: 8px; }
        .app-confirm-dialog { width: min(520px, 100%); max-height: calc(100dvh - 16px); border-radius: 12px; }
        .app-confirm-heading { padding: 14px 16px 10px; }
        .app-confirm-actions { padding: 8px 16px 12px 68px; }
    }
    @media (prefers-reduced-motion: reduce) {
        .app-toast,
        .app-confirm-overlay { animation: none; }
    }
`;
document.head.appendChild(style);

// Transitional compatibility: remaining legacy alert() calls now use system UI.
window.alert = function styledApplicationAlert(message) {
    showToast(message, inferToastType(message));
};

document.addEventListener('DOMContentLoaded', () => {
    try {
        const pending = JSON.parse(sessionStorage.getItem('amacar:pending-toast') || 'null');
        sessionStorage.removeItem('amacar:pending-toast');
        if (pending && Date.now() - pending.createdAt < 10000) {
            showToast(pending.message, pending.type, { carryAcrossNavigation: false });
        }
    } catch (_) {
        sessionStorage.removeItem('amacar:pending-toast');
    }
});

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function exportToCSV(data, filename = 'export.csv') {
    if (!data || data.length === 0) {
        alert('No data to export');
        return;
    }
    
    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => 
            headers.map(header => {
                const value = row[header];
                if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            }).join(',')
        )
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function generateSKU(productName) {
    const cleanedName = String(productName || 'PRD')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .substring(0, 3)
        .padEnd(3, 'X');
    const timestamp = Date.now().toString().slice(-5);
    const randomSuffix = Math.random().toString(36).slice(2, 5).toUpperCase();
    return `${cleanedName}-${timestamp}-${randomSuffix}`;
}

function getStockStatus(quantity, minQuantity = 10) {
    if (quantity === 0) {
        return { status: 'out_of_stock', class: 'status-out', text: 'Out of Stock' };
    } else if (quantity < minQuantity) {
        return { status: 'low_stock', class: 'status-low', text: 'Low Stock' };
    } else {
        return { status: 'in_stock', class: 'status-in', text: 'In Stock' };
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function groupBy(array, key) {
    return array.reduce((result, item) => {
        const group = item[key];
        if (!result[group]) {
            result[group] = [];
        }
        result[group].push(item);
        return result;
    }, {});
}

function sumBy(array, key) {
    return array.reduce((sum, item) => sum + (Number(item[key]) || 0), 0);
}

function sortBy(array, key, ascending = true) {
    return [...array].sort((a, b) => {
        const aVal = a[key];
        const bVal = b[key];
        
        if (aVal < bVal) return ascending ? -1 : 1;
        if (aVal > bVal) return ascending ? 1 : -1;
        return 0;
    });
}

function truncate(text, maxLength = 50) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

function createLoadingSpinner() {
    const spinner = document.createElement('div');
    spinner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
    `;
    spinner.innerHTML = `
        <div style="background: white; padding: 30px; border-radius: 12px; text-align: center;">
            <i class="fas fa-spinner fa-spin" style="font-size: 48px; color: var(--primary-color);"></i>
            <p style="margin-top: 16px; color: var(--text-primary);">Loading...</p>
        </div>
    `;
    return spinner;
}

function showLoading() {
    const spinner = createLoadingSpinner();
    spinner.id = 'global-loading';
    document.body.appendChild(spinner);
}

function hideLoading() {
    const spinner = document.getElementById('global-loading');
    if (spinner) {
        spinner.remove();
    }
}

function confirmDialog(message, options = {}, legacyCancel) {
    if (typeof options === 'function') {
        const legacyConfirm = options;
        return confirmDialog(message).then(confirmed => {
            if (confirmed) legacyConfirm();
            else if (legacyCancel) legacyCancel();
            return confirmed;
        });
    }

    const settings = {
        title: 'Confirm action',
        confirmText: 'Confirm',
        cancelText: 'Cancel',
        variant: 'primary',
        ...options
    };

    return new Promise(resolve => {
    const dialog = document.createElement('div');
    dialog.className = 'app-confirm-overlay';
    dialog.setAttribute('role', 'presentation');
    dialog.innerHTML = `
        <div class="app-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="app-confirm-title" aria-describedby="app-confirm-message">
            <div class="app-confirm-heading">
                <span class="app-confirm-symbol" aria-hidden="true"><i class="fas fa-question"></i></span>
                <div>
                    <h2 id="app-confirm-title"></h2>
                    <p id="app-confirm-message"></p>
                </div>
            </div>
            <div class="app-confirm-actions">
                <button type="button" class="app-confirm-btn app-confirm-cancel"></button>
                <button type="button" class="app-confirm-btn app-confirm-accept"></button>
            </div>
        </div>
    `;
    dialog.querySelector('#app-confirm-title').textContent = settings.title;
    dialog.querySelector('#app-confirm-message').textContent = String(message);
    dialog.querySelector('.app-confirm-cancel').textContent = settings.cancelText;
    const acceptButton = dialog.querySelector('.app-confirm-accept');
    acceptButton.textContent = settings.confirmText;
    acceptButton.classList.add(settings.variant === 'danger' ? 'is-danger' : 'is-primary');
    document.body.appendChild(dialog);

    let settled = false;
    const finish = confirmed => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', handleKeydown);
        dialog.remove();
        resolve(confirmed);
    };
    const handleKeydown = event => {
        if (event.key === 'Escape') finish(false);
    };

    dialog.querySelector('.app-confirm-cancel').addEventListener('click', () => finish(false));
    acceptButton.addEventListener('click', () => finish(true));
    dialog.addEventListener('click', event => {
        if (event.target === dialog) finish(false);
    });
    document.addEventListener('keydown', handleKeydown);
    window.requestAnimationFrame(() => dialog.querySelector('.app-confirm-cancel').focus());
    });
}

window.utils = {
    formatCurrency,
    formatDate,
    getTimeAgo,
    showToast,
    debounce,
    exportToCSV,
    isValidEmail,
    generateSKU,
    getStockStatus,
    formatFileSize,
    deepClone,
    groupBy,
    sumBy,
    sortBy,
    truncate,
    showLoading,
    hideLoading,
    confirmDialog
};
