function openHelp() {
    document.getElementById('helpModal').classList.add('active');
}

function closeHelp() {
    document.getElementById('helpModal').classList.remove('active');
}

function closeHelpOnOutside(event) {
    if (event.target.id === 'helpModal') {
        closeHelp();
    }
}

document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeHelp();
    }
});