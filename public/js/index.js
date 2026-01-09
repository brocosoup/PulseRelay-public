/**
 * Index Page JavaScript
 * CSP-compliant external JavaScript for index.ejs template
 */

// Demo functionality
function showDemo() {
    if (typeof Utils !== 'undefined' && Utils.showToast) {
        Utils.showToast('Demo coming soon! 🚀', 'info');
    } else {
        alert('Demo coming soon! 🚀');
    }
}

// Add page-specific animations
document.addEventListener('DOMContentLoaded', function() {
    // Demo functionality
    const showDemoBtn = document.getElementById('show-demo-btn');
    if (showDemoBtn) {
        showDemoBtn.addEventListener('click', function(e) {
            e.preventDefault();
            showDemo();
        });
    }
    
    // Animate stats on scroll
    const observerOptions = {
        threshold: 0.5,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('fade-in');
            }
        });
    }, observerOptions);
    
    // Observe all cards
    document.querySelectorAll('.card').forEach(card => {
        observer.observe(card);
    });
    
    // Android App Screenshot Carousel
    const carousel = document.querySelector('.android-carousel');
    if (carousel) {
        const images = carousel.querySelectorAll('.carousel-image');
        let currentIndex = 0;
        
        setInterval(() => {
            // Remove active class from current image
            images[currentIndex].classList.remove('active');
            
            // Move to next image (loop back to 0 after last image)
            currentIndex = (currentIndex + 1) % images.length;
            
            // Add active class to next image
            images[currentIndex].classList.add('active');
        }, 3000); // Change image every 3 seconds
    }
    
    // Overlay Image Lightbox
    const overlayImages = document.querySelectorAll('.overlay-image');
    const imageModal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    
    if (overlayImages.length > 0 && imageModal && modalImage) {
        overlayImages.forEach(img => {
            img.addEventListener('click', function() {
                const imageSrc = this.getAttribute('data-overlay-image');
                const imageAlt = this.getAttribute('alt');
                modalImage.src = imageSrc;
                modalImage.alt = imageAlt;
                
                // Show modal using Bootstrap 5
                const modal = new bootstrap.Modal(imageModal);
                modal.show();
            });
        });
    }
});