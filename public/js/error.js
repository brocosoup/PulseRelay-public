/**
 * Error Page JavaScript
 * CSP-compliant external JavaScript for error.ejs template
 */

document.addEventListener('DOMContentLoaded', function() {
    const goBackBtn = document.getElementById('go-back-btn');
    if (goBackBtn) {
        goBackBtn.addEventListener('click', function() {
            history.back();
        });
    }
});
