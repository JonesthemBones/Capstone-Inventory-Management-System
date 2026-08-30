// dark-mode.js - Add this as a new file in your scripts folder

class DarkModeManager {
    constructor() {
        this.darkModeKey = 'darkMode';
        this.init();
    }

    init() {
        // Load saved preference or default to light mode
        const savedMode = localStorage.getItem(this.darkModeKey);
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        // If user has saved preference, use it. Otherwise, use system preference
        const isDarkMode = savedMode ? savedMode === 'true' : prefersDark;
        
        if (isDarkMode) {
            this.enableDarkMode(false);
        }

        // Create and insert the toggle button
        this.createToggleButton();
    }

    createToggleButton() {
        // Create toggle button HTML
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'dark-mode-toggle';
        toggleBtn.className = 'dark-mode-toggle';
        toggleBtn.innerHTML = `
            <i class="fas fa-moon"></i>
        `;
        toggleBtn.setAttribute('aria-label', 'Toggle dark mode');
        toggleBtn.title = 'Toggle dark mode';

        // Add click event
        toggleBtn.addEventListener('click', () => this.toggleDarkMode());

        // Set initial button style based on current mode
        this.updateButtonStyle(toggleBtn);

        // Insert button into the page (you can adjust the position)
        document.body.appendChild(toggleBtn);
    }

    updateButtonStyle(button) {
        const btn = button || document.getElementById('dark-mode-toggle');
        if (!btn) return;

        const isDarkMode = document.documentElement.classList.contains('dark-mode');
        
        if (isDarkMode) {
            // Light button with sun icon (dark mode is active)
            btn.style.background = 'white';
            btn.style.color = 'black';
        } else {
            // Dark button with moon icon (light mode is active)
            btn.style.background = 'black';
            btn.style.color = 'white';
        }
    }

    toggleDarkMode() {
        const isDarkMode = document.documentElement.classList.contains('dark-mode');
        
        if (isDarkMode) {
            this.disableDarkMode();
        } else {
            this.enableDarkMode(true);
        }
    }

    enableDarkMode(animate = true) {
        document.documentElement.classList.add('dark-mode');
        localStorage.setItem(this.darkModeKey, 'true');
        
        // Update icon
        const icon = document.querySelector('#dark-mode-toggle i');
        if (icon) {
            icon.classList.remove('fa-moon');
            icon.classList.add('fa-sun');
        }

        // Update button style
        this.updateButtonStyle();

        if (animate) {
            this.animateTransition();
        }
    }

    disableDarkMode() {
        document.documentElement.classList.remove('dark-mode');
        localStorage.setItem(this.darkModeKey, 'false');
        
        // Update icon
        const icon = document.querySelector('#dark-mode-toggle i');
        if (icon) {
            icon.classList.remove('fa-sun');
            icon.classList.add('fa-moon');
        }

        // Update button style
        this.updateButtonStyle();

        this.animateTransition();
    }

    animateTransition() {
        document.documentElement.style.transition = 'background-color 0.3s ease, color 0.3s ease';
        setTimeout(() => {
            document.documentElement.style.transition = '';
        }, 300);
    }

    isDarkMode() {
        return document.documentElement.classList.contains('dark-mode');
    }
}

// Initialize dark mode when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.darkModeManager = new DarkModeManager();
    });
} else {
    window.darkModeManager = new DarkModeManager();
}