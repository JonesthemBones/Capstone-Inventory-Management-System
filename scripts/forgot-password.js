document.addEventListener('DOMContentLoaded', () => {
    const forgotPasswordPage = document.getElementById('forgot-password-page');
    const otpVerificationPage = document.getElementById('otp-verification-page');
    const resetPasswordPage = document.getElementById('reset-password-page');
    
    const backToLoginBtn = document.getElementById('back-to-login');
    const changeEmailBtn = document.getElementById('change-email');
    const forgotPasswordForm = document.getElementById('forgot-password-form');
    const otpVerificationForm = document.getElementById('otp-verification-form');
    const resetPasswordForm = document.getElementById('reset-password-form');
    
    // Keep recovery credentials in memory, separate from normal login sessions.
    const recoveryClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            storageKey: 'amacar-password-recovery',
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    });
    let recoveryUserId = null;
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
        const email = document.getElementById('forgot-email').value.trim().toLowerCase();
        const submitBtn = e.target.querySelector('button[type="submit"]');
        
        if (!email) {
            alert('Please enter your email address');
            return;
        }

        // Disable button and show loading state
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';

        try {
            const { error } = await recoveryClient.auth.resetPasswordForEmail(email);
            if (error) throw error;
            recoveryUserId = null;

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
                window.utils.showToast('If this email is registered, a recovery code has been sent.', 'success');
            } else {
                alert('✅ If this email is registered, check your inbox for a recovery code.');
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
        let seconds = 60;
        clearCountdown(); // Clear any existing countdown

        const resendText = document.querySelector('.resend-text');
        resendText.innerHTML = 'Resend code in <span id="countdown">60s</span>';
        
        countdownInterval = setInterval(() => {
            const countdownElement = document.getElementById('countdown');
            if (!countdownElement) {
                clearCountdown();
                return;
            }

            seconds--;
            countdownElement.textContent = `${seconds}s`;
            
            if (seconds <= 0) {
                clearCountdown();
                resendText.innerHTML = '<a href="#" class="link" id="resend-code">Resend code</a>';
            }
        }, 1000);
    }

    document.querySelector('.resend-text').addEventListener('click', async (e) => {
        const resendLink = e.target.closest('#resend-code');
        if (!resendLink) return;

        e.preventDefault();
        resendLink.style.pointerEvents = 'none';
        resendLink.textContent = 'Sending...';
        await resendOTP();
    });

    function clearCountdown() {
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
    }

    // Resend OTP
    async function resendOTP() {
        try {
            const { error } = await recoveryClient.auth.resetPasswordForEmail(userEmail);
            if (error) throw error;

            // Reset countdown
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
            document.querySelector('.resend-text').innerHTML = '<a href="#" class="link" id="resend-code">Resend code</a>';
            alert('❌ ' + error.message);
        }
    }

    document.querySelectorAll('.password-toggle').forEach(toggle => {
        toggle.addEventListener('click', function() {
            const passwordInput = document.getElementById(this.dataset.target);
            if (!passwordInput) return;

            const showPassword = passwordInput.type === 'password';
            passwordInput.type = showPassword ? 'text' : 'password';
            this.classList.toggle('fa-eye', showPassword);
            this.classList.toggle('fa-eye-slash', !showPassword);
        });
    });

    // Handle OTP verification
    otpVerificationForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const otp = Array.from(otpInputs).map(input => input.value).join('');
        const submitBtn = e.target.querySelector('button[type="submit"]');
        
        if (!/^\d{6}$/.test(otp)) {
            alert('Please enter the complete 6-digit OTP');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Verifying...';

        try {
            const { data, error } = await recoveryClient.auth.verifyOtp({
                email: userEmail,
                token: otp,
                type: 'recovery'
            });
            if (error) throw error;
            if (!data.session || !data.user ||
                data.user.email?.toLowerCase() !== userEmail.toLowerCase()) {
                throw new Error('Unable to verify this recovery session. Request a new code.');
            }
            recoveryUserId = data.user.id;

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
                if (!recoveryUserId) {
                    throw new Error('Please verify your recovery code first.');
                }
                const { data: sessionData, error: sessionError } = await recoveryClient.auth.getSession();
                if (sessionError) throw sessionError;
                if (!sessionData.session || sessionData.session.user.id !== recoveryUserId) {
                    throw new Error('Recovery session expired. Please request a new code.');
                }
                const { error } = await recoveryClient.auth.updateUser({ password: newPassword });
                if (error) throw error;
                recoveryUserId = null;
                // A failed cleanup must not report an already changed password as failed.
                try {
                    await recoveryClient.auth.signOut({ scope: 'local' });
                } catch (cleanupError) {
                    console.warn('Recovery session cleanup failed.');
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
