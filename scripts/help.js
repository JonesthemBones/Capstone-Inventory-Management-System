function openHelp() {
    const helpModal = document.getElementById('helpModal');
    if (!helpModal) return;
    helpModal.classList.add('active');
    helpModal.setAttribute('aria-hidden', 'false');
}

function closeHelp() {
    const helpModal = document.getElementById('helpModal');
    if (!helpModal) return;
    helpModal.classList.remove('active');
    helpModal.setAttribute('aria-hidden', 'true');
}

function closeHelpOnOutside(event) {
    if (event.target.id === 'helpModal') {
        closeHelp();
    }
}

document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const openOverlay = [...document.querySelectorAll('.help-modal.active, .modal.active, .modal[style*="display: flex"], .modal[style*="display:flex"], .vlm-image-modal.active, .vlm-camera-modal.active')]
            .filter(modal => getComputedStyle(modal).display !== 'none')
            .pop();
        if (openOverlay) closeOverlay(openOverlay);
    }
});

function closeOverlay(overlay) {
    if (overlay.classList.contains('help-modal')) {
        closeHelp();
        return;
    }

    const closeButton = overlay.querySelector('.modal-close, .close-btn, .vlm-image-modal-close, .vlm-camera-close, [data-modal-close]');
    if (closeButton) {
        closeButton.click();
        return;
    }

    overlay.classList.remove('active');
    overlay.style.display = 'none';
}

document.addEventListener('click', function(event) {
    const overlay = event.target.closest('.modal, .help-modal, .vlm-image-modal, .vlm-camera-modal');
    if (overlay && event.target === overlay) closeOverlay(overlay);
});
