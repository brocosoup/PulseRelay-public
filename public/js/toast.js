// PulseRelay Global Toast Notification System
// CSP-Compliant toast notifications for the entire application

window.PulseToast = {
    init: function() {
        // Initialize the toast system
        this.createContainer();
    },

    createContainer: function() {
        // Create or get the toast container
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 9999;
                max-width: 350px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                pointer-events: none;
            `;
            document.body.appendChild(toastContainer);
        }
        return toastContainer;
    },

    show: function(message, type = 'info', duration = 5000) {
        // Create or get the toast container
        const toastContainer = this.createContainer();
        
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `alert alert-${type === 'error' ? 'danger' : type} alert-dismissible fade show`;
        notification.style.cssText = `
            margin-bottom: 0;
            min-width: 300px;
            animation: slideInRight 0.3s ease-out;
            pointer-events: auto;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        `;
        
        notification.innerHTML = `
            <div class="d-flex align-items-center">
                <i class="fas fa-${this.getIconForType(type)} me-2"></i>
                <span>${message}</span>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        
        // Add click handler for manual dismissal
        const closeBtn = notification.querySelector('.btn-close');
        closeBtn.addEventListener('click', () => {
            this.remove(notification);
        });
        
        // Add to container
        toastContainer.appendChild(notification);
        
        // Auto-remove after specified duration
        if (duration > 0) {
            setTimeout(() => {
                this.remove(notification);
            }, duration);
        }

        return notification;
    },

    remove: function(notification) {
        if (notification && notification.parentNode) {
            // Add fade out animation
            notification.style.animation = 'slideOutRight 0.3s ease-in';
            
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                    
                    // Remove container if empty
                    const container = document.getElementById('toast-container');
                    if (container && container.children.length === 0) {
                        container.remove();
                    }
                }
            }, 300);
        }
    },

    getIconForType: function(type) {
        switch (type) {
            case 'success': return 'check-circle';
            case 'error':
            case 'danger': return 'exclamation-triangle';
            case 'warning': return 'exclamation-triangle';
            case 'info': return 'info-circle';
            default: return 'info-circle';
        }
    },

    // Convenience methods for different toast types
    success: function(message, duration = 5000) {
        return this.show(message, 'success', duration);
    },

    error: function(message, duration = 8000) {
        return this.show(message, 'error', duration);
    },

    warning: function(message, duration = 6000) {
        return this.show(message, 'warning', duration);
    },

    info: function(message, duration = 5000) {
        return this.show(message, 'info', duration);
    },

    // Persistent toast that doesn't auto-dismiss
    persistent: function(message, type = 'info') {
        return this.show(message, type, 0);
    },

    // Clear all toasts
    clearAll: function() {
        const container = document.getElementById('toast-container');
        if (container) {
            const notifications = container.querySelectorAll('.alert');
            notifications.forEach(notification => {
                this.remove(notification);
            });
        }
    }
};

// Auto-initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    window.PulseToast.init();
});

// Global convenience functions for backward compatibility and ease of use
window.showNotification = function(message, type = 'info', duration = 5000) {
    return window.PulseToast.show(message, type, duration);
};

window.showToast = function(message, type = 'info', duration = 5000) {
    return window.PulseToast.show(message, type, duration);
};
