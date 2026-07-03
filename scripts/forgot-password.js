const API_URL = `${window.location.hostname ? `${window.location.protocol}//${window.location.hostname}:3001` : 'http://localhost:3001'}/api`;

document.addEventListener('DOMContentLoaded', () => {
    const forgotPasswordPage = document.getElementById('forgot-password-page');
    const otpVerificationPage = document.getElementById('otp-verification-page');
    const resetPasswordPage = document.getElementById('reset-password-page');
    
    const backToLoginBtn = document.getElementById('back-to-login');
    const changeEmailBtn = document.getElementById('change-email');
    const forgotPasswordForm = document.getElementById('forgot-password-form');
    const otpVerificationForm = document.getElementById('otp-verification-form');
    const resetPasswordForm = document.getElementById('reset-password-form');
    
    let userEmail = '';
    let countdownInterval = null;

    // Navigate back to login
    backToLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.href = 'auth.html';
    });

    // Change email - go back to forgot password page
    changeEmailBtn.addEventListener('click', (e) => {
        e.preventDefault();
        otpVerificationPage.classList.remove('active');
        forgotPasswordPage.classList.add('active');
        clearCountdown();
    });

    // Handle forgot password form submission - Send OTP
    forgotPasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('forgot-email').value.trim();
        const submitBtn = e.target.querySelector('button[type="submit"]');
        
        if (!email) {
            alert('Please enter your email address');
            return;
        }

        // Disable button and show loading state
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';

        try {
            const response = await fetch(`${API_URL}/send-otp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to send OTP');
            }

            userEmail = email;
            document.getElementById('user-email').textContent = email;
            
            // Switch to OTP page
            forgotPasswordPage.classList.remove('active');
            otpVerificationPage.classList.add('active');
            
            // Start countdown
            startCountdown();
            
            // Clear OTP inputs
            document.querySelectorAll('.otp-input').forEach(input => input.value = '');
            document.querySelector('.otp-input').focus();

            if (window.utils && window.utils.showToast) {
                window.utils.showToast('OTP sent to your email', 'success');
            } else {
                alert('✅ OTP sent to your email! Check your inbox.');
            }

        } catch (error) {
            console.error('Send OTP error:', error);
            alert('❌ ' + error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send OTP Code';
        }
    });

    // OTP Input handling
    const otpInputs = document.querySelectorAll('.otp-input');
    
    otpInputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            // Only allow numbers
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
            
            if (e.target.value.length === 1) {
                if (index < otpInputs.length - 1) {
                    otpInputs[index + 1].focus();
                }
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && index > 0) {
                otpInputs[index - 1].focus();
            }
        });

        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const pastedData = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, 6);
            pastedData.split('').forEach((char, i) => {
                if (otpInputs[i]) {
                    otpInputs[i].value = char;
                }
            });
            if (pastedData.length === 6) {
                otpInputs[5].focus();
            }
        });
    });

    // Countdown timer
    function startCountdown() {
        let seconds = 59;
        const countdownElement = document.getElementById('countdown');
        
        clearCountdown(); // Clear any existing countdown
        
        countdownInterval = setInterval(() => {
            countdownElement.textContent = `${seconds}s`;
            seconds--;
            
            if (seconds < 0) {
                clearInterval(countdownInterval);
                countdownElement.parentElement.innerHTML = '<a href="#" class="link" id="resend-code">Resend code</a>';
                
                document.getElementById('resend-code').addEventListener('click', async (e) => {
                    e.preventDefault();
                    await resendOTP();
                });
            }
        }, 1000);
    }

    function clearCountdown() {
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
    }

    // Resend OTP
    async function resendOTP() {
        try {
            const response = await fetch(`${API_URL}/send-otp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email: userEmail })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to resend OTP');
            }

            // Reset countdown
            const countdownElement = document.getElementById('countdown');
            if (!countdownElement) {
                const resendText = document.querySelector('.resend-text');
                resendText.innerHTML = 'Resend code in <span id="countdown">59s</span>';
            }
            
            startCountdown();
            
            // Clear OTP inputs
            otpInputs.forEach(input => input.value = '');
            otpInputs[0].focus();

            if (window.utils && window.utils.showToast) {
                window.utils.showToast('OTP resent successfully', 'success');
            } else {
                alert('✅ OTP resent! Check your email.');
            }

        } catch (error) {
            console.error('Resend OTP error:', error);
            alert('❌ ' + error.message);
        }
    }

    // Handle OTP verification
    otpVerificationForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const otp = Array.from(otpInputs).map(input => input.value).join('');
        const submitBtn = e.target.querySelector('button[type="submit"]');
        
        if (otp.length !== 6) {
            alert('Please enter the complete 6-digit OTP');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Verifying...';

        try {
            const response = await fetch(`${API_URL}/verify-otp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    email: userEmail,
                    otp: otp
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Invalid OTP');
            }

            // OTP verified, show reset password page
            clearCountdown();
            otpVerificationPage.classList.remove('active');
            resetPasswordPage.classList.add('active');

            if (window.utils && window.utils.showToast) {
                window.utils.showToast('OTP verified successfully', 'success');
            }

        } catch (error) {
            console.error('Verify OTP error:', error);
            alert('❌ ' + error.message);
            
            // Clear OTP inputs on error
            otpInputs.forEach(input => input.value = '');
            otpInputs[0].focus();
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Verify OTP';
        }
    });

    // Handle password reset
    if (resetPasswordForm) {
        resetPasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            const submitBtn = e.target.querySelector('button[type="submit"]');

            if (newPassword.length < 6) {
                alert('Password must be at least 6 characters long');
                return;
            }

            if (newPassword !== confirmPassword) {
                alert('Passwords do not match');
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'Resetting...';

            try {
                const response = await fetch(`${API_URL}/reset-password`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ 
                        email: userEmail,
                        newPassword: newPassword
                    })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Failed to reset password');
                }

                alert('✅ Password reset successfully!\n\nYou can now login with your new password.');
                window.location.href = 'auth.html';

            } catch (error) {
                console.error('Reset password error:', error);
                alert('❌ ' + error.message);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Reset Password';
            }
        });
    }
});