// PulseRelay Layout - CSP-Compliant User Data and Navigation Handlers

// Initialize user data from data attribute (CSP-compliant)
document.addEventListener('DOMContentLoaded', function() {
    // Load user data from data attribute
    const userDataElement = document.getElementById('user-data');
    if (userDataElement && userDataElement.dataset.user) {
        try {
            window.currentUser = JSON.parse(userDataElement.dataset.user);
            
            // Skip welcome toast on mobile page
            const isMobilePage = document.body.classList.contains('mobile-page');
            
            // Show welcome toast for authenticated users (only once per session)
            if (!isMobilePage && !sessionStorage.getItem('welcomeShown')) {
                setTimeout(() => {
                    if (window.PulseToast) {
                        window.PulseToast.success(`Welcome back, ${window.currentUser.display_name || window.currentUser.username}!`);
                    }
                    sessionStorage.setItem('welcomeShown', 'true');
                }, 1000);
            }
        } catch (error) {
            // Silent error handling

        }
    }
    
    // Handle navigation clicks with data-action attributes
    document.addEventListener('click', function(e) {
        const actionElement = e.target.closest('[data-action]');
        if (actionElement) {
            e.preventDefault();
            const action = actionElement.getAttribute('data-action');
            
            // Call the appropriate navigation function
            if (action === 'showProfile' && window.dashboard && typeof window.dashboard.showProfile === 'function') {
                window.dashboard.showProfile();
            } else if (typeof window[action] === 'function') {
                window[action]();
            }
        }
    });
    
    // Add keyboard shortcut for testing toasts (Ctrl+Shift+T)
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.shiftKey && e.key === 'T') {
            e.preventDefault();
            if (window.PulseToast) {
                const toastTypes = ['success', 'error', 'warning', 'info'];
                const messages = [
                    'This is a success message!',
                    'This is an error message!',
                    'This is a warning message!',
                    'This is an info message!'
                ];
                const randomIndex = Math.floor(Math.random() * toastTypes.length);
                window.PulseToast.show(messages[randomIndex], toastTypes[randomIndex]);
            }
        }
    });
});

// Global delete account handler - single source of truth
window.handleDeleteAccount = async function() {
    // Show delete confirmation modal
    const deleteModal = new bootstrap.Modal(document.getElementById('deleteAccountModal'));
    const deleteInput = document.getElementById('deleteConfirmInput');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    
    // Reset input and button state
    deleteInput.value = '';
    confirmBtn.disabled = true;
    
    // Enable/disable confirm button based on input
    deleteInput.oninput = function() {
        confirmBtn.disabled = this.value !== 'DELETE';
    };
    
    // Handle confirmation
    confirmBtn.onclick = async function() {
        if (deleteInput.value !== 'DELETE') return;
        
        // Disable button and show loading state
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Deleting...';
        
        try {
            const response = await fetch('/auth/account', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                deleteModal.hide();
                if (window.showToast) {
                    window.showToast('Account successfully deleted. Redirecting...', 'success');
                }
                setTimeout(() => {
                    window.location.href = '/';
                }, 2000);
            } else {
                const data = await response.json();
                if (window.showToast) {
                    window.showToast(data.message || 'Failed to delete account. Please try again.', 'danger');
                }
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = '<i class="fas fa-trash-alt me-2"></i>Delete My Account';
            }
        } catch (error) {
            if (window.showToast) {
                window.showToast('Error deleting account. Please try again.', 'danger');
            }
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i class="fas fa-trash-alt me-2"></i>Delete My Account';
        }
    };
    
    deleteModal.show();
};
