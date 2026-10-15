/**
 * Toast - Toast notification system
 */
class Toast {
    static container = null;
    static queue = [];
    static maxVisible = 3;

    /**
     * Initialize toast container
     */
    static init() {
        if (!Toast.container) {
            Toast.container = document.createElement('div');
            Toast.container.className = 'toast-container';
            document.body.appendChild(Toast.container);
        }
    }

    /**
     * Show a toast notification
     */
    static show(message, options = {}) {
        Toast.init();

        const toast = document.createElement('div');
        toast.className = `toast toast-${options.type || 'info'}`;

        const icon = Toast.getIcon(options.type);

        toast.innerHTML = `
            <div class="toast-icon">${icon}</div>
            <div class="toast-content">
                ${options.title ? `<div class="toast-title">${options.title}</div>` : ''}
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close">&times;</button>
        `;

        // Close button
        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', () => Toast.dismiss(toast));

        // Action button
        if (options.action) {
            const actionBtn = document.createElement('button');
            actionBtn.className = 'toast-action';
            actionBtn.textContent = options.action.text;
            actionBtn.addEventListener('click', () => {
                options.action.onClick();
                Toast.dismiss(toast);
            });
            toast.querySelector('.toast-content').appendChild(actionBtn);
        }

        // Add to container
        Toast.container.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // Auto dismiss
        const duration = options.duration || 5000;
        if (duration > 0) {
            setTimeout(() => Toast.dismiss(toast), duration);
        }

        return toast;
    }

    /**
     * Dismiss a toast
     */
    static dismiss(toast) {
        toast.classList.remove('show');
        toast.classList.add('hide');

        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }

    /**
     * Dismiss all toasts
     */
    static dismissAll() {
        const toasts = Toast.container?.querySelectorAll('.toast');
        toasts?.forEach(toast => Toast.dismiss(toast));
    }

    /**
     * Get icon for toast type
     */
    static getIcon(type) {
        switch (type) {
            case 'success':
                return '<i class="icon icon-check"></i>';
            case 'error':
                return '<i class="icon icon-alert"></i>';
            case 'warning':
                return '<i class="icon icon-warning"></i>';
            default:
                return '<i class="icon icon-info"></i>';
        }
    }

    // Convenience methods
    static success(message, options = {}) {
        return Toast.show(message, { ...options, type: 'success' });
    }

    static error(message, options = {}) {
        return Toast.show(message, { ...options, type: 'error' });
    }

    static warning(message, options = {}) {
        return Toast.show(message, { ...options, type: 'warning' });
    }

    static info(message, options = {}) {
        return Toast.show(message, { ...options, type: 'info' });
    }
}


/**
 * Tooltip - Tooltip component
 */
class Tooltip {
    static activeTooltip = null;

    /**
     * Initialize tooltips
     */
    static init() {
        document.addEventListener('mouseover', Tooltip.handleMouseOver);
        document.addEventListener('mouseout', Tooltip.handleMouseOut);
    }

    /**
     * Handle mouse over
     */
    static handleMouseOver(e) {
        const target = e.target.closest('[data-tooltip]');
        if (!target) return;

        const text = target.dataset.tooltip;
        const position = target.dataset.tooltipPosition || 'top';

        Tooltip.show(target, text, position);
    }

    /**
     * Handle mouse out
     */
    static handleMouseOut(e) {
        const target = e.target.closest('[data-tooltip]');
        if (!target) return;

        Tooltip.hide();
    }

    /**
     * Show tooltip
     */
    static show(element, text, position = 'top') {
        Tooltip.hide();

        const tooltip = document.createElement('div');
        tooltip.className = `tooltip tooltip-${position}`;
        tooltip.textContent = text;
        document.body.appendChild(tooltip);

        // Position tooltip
        const rect = element.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        let top, left;

        switch (position) {
            case 'top':
                top = rect.top - tooltipRect.height - 8;
                left = rect.left + (rect.width - tooltipRect.width) / 2;
                break;
            case 'bottom':
                top = rect.bottom + 8;
                left = rect.left + (rect.width - tooltipRect.width) / 2;
                break;
            case 'left':
                top = rect.top + (rect.height - tooltipRect.height) / 2;
                left = rect.left - tooltipRect.width - 8;
                break;
            case 'right':
                top = rect.top + (rect.height - tooltipRect.height) / 2;
                left = rect.right + 8;
                break;
        }

        // Keep in viewport
        left = Math.max(8, Math.min(left, window.innerWidth - tooltipRect.width - 8));
        top = Math.max(8, Math.min(top, window.innerHeight - tooltipRect.height - 8));

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;

        requestAnimationFrame(() => {
            tooltip.classList.add('show');
        });

        Tooltip.activeTooltip = tooltip;
    }

    /**
     * Hide tooltip
     */
    static hide() {
        if (Tooltip.activeTooltip) {
            Tooltip.activeTooltip.remove();
            Tooltip.activeTooltip = null;
        }
    }
}


/**
 * ContextMenu - Right-click context menu
 */
class ContextMenu {
    static activeMenu = null;

    /**
     * Show context menu
     */
    static show(event, items) {
        event.preventDefault();
        ContextMenu.hide();

        const menu = document.createElement('div');
        menu.className = 'context-menu';

        for (const item of items) {
            if (item.separator) {
                const divider = document.createElement('div');
                divider.className = 'context-menu-divider';
                menu.appendChild(divider);
                continue;
            }

            const menuItem = document.createElement('button');
            menuItem.className = `context-menu-item ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}`;

            if (item.disabled) {
                menuItem.disabled = true;
            }

            menuItem.innerHTML = `
                ${item.icon ? `<i class="icon icon-${item.icon}"></i>` : ''}
                <span>${item.label}</span>
                ${item.shortcut ? `<span class="shortcut">${item.shortcut}</span>` : ''}
            `;

            if (item.onClick && !item.disabled) {
                menuItem.addEventListener('click', () => {
                    item.onClick();
                    ContextMenu.hide();
                });
            }

            menu.appendChild(menuItem);
        }

        document.body.appendChild(menu);

        // Position menu
        const x = event.clientX;
        const y = event.clientY;
        const menuRect = menu.getBoundingClientRect();

        let left = x;
        let top = y;

        // Keep in viewport
        if (x + menuRect.width > window.innerWidth) {
            left = window.innerWidth - menuRect.width - 8;
        }
        if (y + menuRect.height > window.innerHeight) {
            top = window.innerHeight - menuRect.height - 8;
        }

        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;

        requestAnimationFrame(() => {
            menu.classList.add('show');
        });

        // Close on click outside
        setTimeout(() => {
            document.addEventListener('click', ContextMenu.hide, { once: true });
            document.addEventListener('contextmenu', ContextMenu.hide, { once: true });
        }, 0);

        ContextMenu.activeMenu = menu;
    }

    /**
     * Hide context menu
     */
    static hide() {
        if (ContextMenu.activeMenu) {
            ContextMenu.activeMenu.remove();
            ContextMenu.activeMenu = null;
        }
    }
}


/**
 * LoadingOverlay - Loading state overlay
 */
class LoadingOverlay {
    static element = null;

    /**
     * Show loading overlay
     */
    static show(message = 'Loading...') {
        if (LoadingOverlay.element) {
            LoadingOverlay.hide();
        }

        LoadingOverlay.element = document.createElement('div');
        LoadingOverlay.element.className = 'loading-overlay';
        LoadingOverlay.element.innerHTML = `
            <div class="loading-content">
                <div class="loading-spinner"></div>
                <p class="loading-message">${message}</p>
            </div>
        `;

        document.body.appendChild(LoadingOverlay.element);

        requestAnimationFrame(() => {
            LoadingOverlay.element.classList.add('show');
        });
    }

    /**
     * Hide loading overlay
     */
    static hide() {
        if (LoadingOverlay.element) {
            LoadingOverlay.element.classList.remove('show');

            setTimeout(() => {
                if (LoadingOverlay.element && LoadingOverlay.element.parentNode) {
                    LoadingOverlay.element.parentNode.removeChild(LoadingOverlay.element);
                }
                LoadingOverlay.element = null;
            }, 300);
        }
    }

    /**
     * Update loading message
     */
    static setMessage(message) {
        if (LoadingOverlay.element) {
            const msgEl = LoadingOverlay.element.querySelector('.loading-message');
            if (msgEl) {
                msgEl.textContent = message;
            }
        }
    }
}


/**
 * ProgressBar - Progress bar component
 */
class ProgressBar {
    constructor(options = {}) {
        this.element = null;
        this.value = 0;
        this.max = options.max || 100;
        this.label = options.label || '';

        this.create();
    }

    create() {
        this.element = document.createElement('div');
        this.element.className = 'progress-bar-container';
        this.element.innerHTML = `
            <div class="progress-label">${this.label}</div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: 0%"></div>
            </div>
            <div class="progress-value">0%</div>
        `;
    }

    /**
     * Set progress value
     */
    setValue(value) {
        this.value = Math.max(0, Math.min(value, this.max));
        const percent = (this.value / this.max) * 100;

        const fill = this.element.querySelector('.progress-fill');
        const valueEl = this.element.querySelector('.progress-value');

        if (fill) fill.style.width = `${percent}%`;
        if (valueEl) valueEl.textContent = `${Math.round(percent)}%`;
    }

    /**
     * Set label
     */
    setLabel(label) {
        this.label = label;
        const labelEl = this.element.querySelector('.progress-label');
        if (labelEl) labelEl.textContent = label;
    }

    /**
     * Append to container
     */
    appendTo(container) {
        container.appendChild(this.element);
    }

    /**
     * Remove from DOM
     */
    remove() {
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }
}


// Initialize components
document.addEventListener('DOMContentLoaded', () => {
    Tooltip.init();
});


// Make available globally
window.Toast = Toast;
window.Tooltip = Tooltip;
window.ContextMenu = ContextMenu;
window.LoadingOverlay = LoadingOverlay;
window.ProgressBar = ProgressBar;
