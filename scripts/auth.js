document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    const errorDescription = params.get('error_description');
    const loginPage = document.getElementById('login-page');
    const signupPage = document.getElementById('signup-page');
    const showSignupBtn = document.getElementById('show-signup');
    const showLoginBtn = document.getElementById('show-login');
    const loggedOut = params.get('logged_out');
    const reason = params.get('reason');
    if (loggedOut === 'true') {
        window.history.replaceState({}, document.title, window.location.pathname);
        
        let message = 'You have been signed out successfully';
        if (reason === 'inactivity') {
            message = '⏱️ You have been logged out due to inactivity';
        }
        
        if (window.utils && window.utils.showToast) {
            window.utils.showToast(message, reason === 'inactivity' ? 'info' : 'success');
        } else {
            alert(reason === 'inactivity' ? '⏱️ ' + message : '✅ ' + message);
        }
    }

    showSignupBtn.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('login-form').reset();
        loginPage.classList.remove('active');
        signupPage.classList.add('active');
    });

    showLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('signup-form').reset();
        signupPage.classList.remove('active');
        loginPage.classList.add('active');
    });
    
    if (error) {
        console.error('Auth error:', error, errorDescription);
        
        if (error === 'access_denied' && errorDescription?.includes('expired')) {
            alert('⚠️ Email confirmation link has expired.\n\nPlease sign up again to receive a new confirmation email.');
        } else {
            alert('Authentication error: ' + (errorDescription || error));
        }
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
    }
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const type = params.get('type');

    if (type === 'signup' && accessToken && refreshToken) {
        try {
            console.log('Processing email confirmation...');
            
            const { data, error } = await supabaseClient.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken
            });
            
            if (error) throw error;
            console.log('Email confirmed successfully!', data);
            
            const { data: userData, error: userError } = await supabaseClient
                .from('users')
                .select('*')
                .eq('user_id', data.user.id)
                .single();

            if (userError && userError.code === 'PGRST116') {
                console.log('Creating user profile...');
                
                const metadata = data.user.user_metadata || {};
                console.log('User metadata:', metadata);
                
                const { error: createError } = await supabaseClient
                    .from('users')
                    .insert([{
                        user_id: data.user.id,
                        first_name: metadata.first_name || '',
                        last_name: metadata.last_name || '',
                        email: data.user.email,
                        phone_number: metadata.phone_number || null,
                        role: metadata.role || 'staff',
                        is_active: true
                    }]);
                
                if (createError) {
                    console.error('Failed to create user profile:', createError);
                    alert('Profile creation failed: ' + createError.message + '\n\nYou can still try to access the dashboard.');
                }
            } else if (userError) {
                console.error('Error fetching user profile:', userError);
            }
            
            // Get user role for redirect
            const { data: userProfile } = await supabaseClient
                .from('users')
                .select('role')
                .eq('user_id', data.user.id)
                .single();
            
            const redirectPage = (userProfile?.role === 'cashier' || userProfile?.role === 'staff') 
                ? 'inventory.html' 
                : 'dashboard.html';
            
            window.history.replaceState({}, document.title, window.location.pathname);
            alert('✅ Email confirmed successfully!\n\nRedirecting...');
            window.location.href = redirectPage;
            return;
            
        } catch (error) {
            console.error('Error confirming email:', error);
            alert('❌ Error confirming email: ' + error.message);
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
    const session = await window.authHelpers.checkAuth();
    if (session) {
        // Get user role for redirect
        const user = await window.authHelpers.getCurrentUser();
        const { data: userProfile } = await supabaseClient
            .from('users')
            .select('role')
            .eq('user_id', user.id)
            .single();
        
        const redirectPage = (userProfile?.role === 'cashier' || userProfile?.role === 'staff') 
            ? 'inventory.html' 
            : 'dashboard.html';
        window.location.href = redirectPage;
        return;
    }
    
    checkLoginLockout();
});

// Function to check and display login lockout status
function checkLoginLockout() {
    const loginAttempts = JSON.parse(localStorage.getItem('loginAttempts') || '{"count": 0, "lockoutUntil": null, "lockoutLevel": 0}');
    const now = new Date().getTime();
    
    if (loginAttempts.lockoutUntil && now < loginAttempts.lockoutUntil) {
        const loginBtn = document.querySelector('#login-form button[type="submit"]');
        
        loginBtn.disabled = true;
        loginBtn.style.backgroundColor = '#dc3545';
        loginBtn.style.cursor = 'not-allowed';
        loginBtn.style.transition = 'all 0.3s ease';
        
        // Update countdown every second for smooth timer
        const updateCountdown = () => {
            const currentTime = new Date().getTime();
            const remainingMs = loginAttempts.lockoutUntil - currentTime;
            
            if (currentTime >= loginAttempts.lockoutUntil) {
                // Reset count but keep lockout level for progressive penalties
                const newAttempts = {
                    count: 0,
                    lockoutUntil: null,
                    lockoutLevel: loginAttempts.lockoutLevel || 0
                };
                localStorage.setItem('loginAttempts', JSON.stringify(newAttempts));
                
                loginBtn.disabled = false;
                loginBtn.innerHTML = 'Sign In';
                loginBtn.style.backgroundColor = '';
                loginBtn.style.cursor = '';
                if (window.lockoutInterval) {
                    clearInterval(window.lockoutInterval);
                }
                
                if (window.utils && window.utils.showToast) {
                    window.utils.showToast('Login lockout expired. You can try again now.', 'success');
                }
                return;
            }
            
            // Calculate minutes and seconds
            const totalSeconds = Math.ceil(remainingMs / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            
            // Format time display
            let timeDisplay;
            if (minutes > 0) {
                timeDisplay = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            } else {
                timeDisplay = `${seconds}s`;
            }
            
            loginBtn.innerHTML = `🔒 Locked (${timeDisplay})`;
            
            // Add pulsing effect when under 30 seconds
            if (totalSeconds <= 30) {
                loginBtn.style.animation = 'pulse 1s ease-in-out infinite';
            }
        };
        
        // Initial update
        updateCountdown();
        
        // Update every second
        if (window.lockoutInterval) {
            clearInterval(window.lockoutInterval);
        }
        window.lockoutInterval = setInterval(updateCountdown, 1000);
        
    } else if (loginAttempts.lockoutUntil) {
        // Lockout expired, reset count but keep level
        const newAttempts = {
            count: 0,
            lockoutUntil: null,
            lockoutLevel: loginAttempts.lockoutLevel || 0
        };
        localStorage.setItem('loginAttempts', JSON.stringify(newAttempts));
    }
}

// Add CSS animation for pulse effect
if (!document.getElementById('lockout-animation-style')) {
    const style = document.createElement('style');
    style.id = 'lockout-animation-style';
    style.textContent = `
        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.8; transform: scale(0.98); }
        }
    `;
    document.head.appendChild(style);
}


document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const rememberMe = document.getElementById('remember-me').checked;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    const originalBg = submitBtn.style.backgroundColor;
    
    // Check for login cooldown
    const loginAttempts = JSON.parse(localStorage.getItem('loginAttempts') || '{"count": 0, "lockoutUntil": null, "lockoutLevel": 0}');
    const now = new Date().getTime();
    
    if (loginAttempts.lockoutUntil && now < loginAttempts.lockoutUntil) {
        const remainingTime = Math.ceil((loginAttempts.lockoutUntil - now) / 1000 / 60);
        const remainingSeconds = Math.ceil((loginAttempts.lockoutUntil - now) / 1000);
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        const timeDisplay = minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`;
        
        if (window.utils && window.utils.showToast) {
            window.utils.showToast(`Too many failed attempts. Please try again in ${timeDisplay}.`, 'error');
        } else {
            alert(`🔒 Too many failed login attempts.\n\nPlease try again in ${timeDisplay}.`);
        }
        return;
    }
    
    // Reset lockout if time has passed
    if (loginAttempts.lockoutUntil && now >= loginAttempts.lockoutUntil) {
        localStorage.setItem('loginAttempts', JSON.stringify({ 
            count: 0, 
            lockoutUntil: null, 
            lockoutLevel: loginAttempts.lockoutLevel || 0 
        }));
    }
    
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in...';
    submitBtn.style.backgroundColor = '#5a6c7d';
    submitBtn.style.cursor = 'not-allowed';
    
    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });
        
        if (error) throw error;
        
        if (!data.user.email_confirmed_at) {
            alert('Please confirm your email before logging in. Check your inbox for the confirmation link.');
            await supabaseClient.auth.signOut();
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
            submitBtn.style.opacity = '1';
            return;
        }
        
        const { data: userData, error: userError } = await supabaseClient
            .from('users')
            .select('*')
            .eq('user_id', data.user.id)
            .single();

        if (userError && userError.code === 'PGRST116') {
            console.log('User profile missing. Creating profile...');
            
            const metadata = data.user.user_metadata || {};
            console.log('Creating profile with metadata:', metadata);
            
            const { error: createError } = await supabaseClient
                .from('users')
                .insert([{
                    user_id: data.user.id,
                    first_name: metadata.first_name || '',
                    last_name: metadata.last_name || '',
                    email: data.user.email,
                    phone_number: metadata.phone_number || null,
                    role: metadata.role || 'staff',
                    is_active: true
                }]);
            
            if (createError) {
                console.error('Failed to create user profile:', createError);
                console.error('Error details:', JSON.stringify(createError, null, 2));
                alert(
                    'There was an issue setting up your account.\n\n' +
                    'Error: ' + createError.message + '\n\n' +
                    'Please contact support or try again.'
                );
                await supabaseClient.auth.signOut();
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
                submitBtn.style.opacity = '1';
                return;
            }
            
            console.log('User profile created successfully via fallback');
        } else if (userData) {
            await supabaseClient
                .from('users')
                .update({ last_login: new Date().toISOString() })
                .eq('user_id', userData.user_id);
        }
        
        // Reset failed login attempts on successful login
        localStorage.removeItem('loginAttempts');
        
        // Redirect based on role
        const redirectPage = (userData?.role === 'cashier' || userData?.role === 'staff') 
            ? 'inventory.html' 
            : 'dashboard.html';
        
        if (window.utils && window.utils.showToast) {
            window.utils.showToast('Welcome back! Logging you in...', 'success');
            setTimeout(() => {
                window.location.href = redirectPage;
            }, 1000);
        } else {
            alert('✅ Login successful! Welcome back.');
            window.location.href = redirectPage;
        }
        
    } catch (error) {
        console.error('Login error:', error);
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        submitBtn.style.opacity = '1';
        
        // Track failed login attempts with progressive lockout
        const loginAttempts = JSON.parse(localStorage.getItem('loginAttempts') || '{"count": 0, "lockoutUntil": null, "lockoutLevel": 0}');
        loginAttempts.count += 1;
        
        let errorMessage = 'Login failed: ';
        if (error.message.includes('Invalid login credentials')) {
            errorMessage += 'Invalid email or password. Please try again.';
            
            // Progressive lockout: 3 fails = 5min, 3 more = 10min, 3 more = 15min
            const remainingAttempts = 3 - (loginAttempts.count % 3 || 3);
            if (loginAttempts.count >= 3 && loginAttempts.count % 3 === 0) {
                // Increment lockout level (0->1->2, then cap at 2)
                loginAttempts.lockoutLevel = Math.min((loginAttempts.lockoutLevel || 0) + 1, 3);
                
                // Calculate lockout duration: 5, 10, or 15 minutes
                const lockoutMinutes = loginAttempts.lockoutLevel * 5;
                const lockoutTime = new Date().getTime() + (lockoutMinutes * 60 * 1000);
                loginAttempts.lockoutUntil = lockoutTime;
                
                errorMessage = `🔒 Too many failed login attempts.\n\nYour account has been temporarily locked for ${lockoutMinutes} minutes.`;
            } else if (loginAttempts.count % 3 >= 1) {
                const currentLevel = loginAttempts.lockoutLevel || 0;
                const nextLockoutMinutes = (currentLevel + 1) * 5;
                errorMessage += `\n\n⚠️ Warning: ${remainingAttempts} attempt(s) remaining before ${nextLockoutMinutes}-minute lockout.`;
            }
        } else if (error.message.includes('Email not confirmed')) {
            errorMessage += 'Please confirm your email before logging in.';
        } else {
            errorMessage += error.message;
        }
        
        localStorage.setItem('loginAttempts', JSON.stringify(loginAttempts));
        
        if (window.utils && window.utils.showToast) {
            window.utils.showToast(errorMessage, 'error');
        } else {
            alert('❌ ' + errorMessage);
        }
    }
});

document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const firstName = document.getElementById('signup-first-name').value.trim();
    const lastName = document.getElementById('signup-last-name').value.trim();
    const phone_number = document.getElementById('signup-phone-number').value.trim();
    const role = document.getElementById('signup-role').value;
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm-password').value;
    
    if (!firstName) {
        alert('Please enter your first name');
        document.getElementById('signup-first-name').focus();
        return;
    }

    if (!email) {
        alert('Please enter your email');
        document.getElementById('signup-email').focus();
        return;
    }

    if (phone_number && !/^\+?[0-9 ()-]{7,20}$/.test(phone_number)) {
        alert('Please enter a valid phone number');
        document.getElementById('signup-phone-number').focus();
        return;
    }

    if (password !== confirmPassword) {
        alert('Passwords do not match!');
        document.getElementById('signup-confirm-password').focus();
        return;
    }
    
    if (password.length < 6) {
        alert('Password must be at least 6 characters long');
        document.getElementById('signup-password').focus();
        return;
    }
    
    try {
        console.log('Starting signup process...', { 
            firstName, 
            lastName, 
            email, 
            role,
            phone_number: phone_number || 'none'
        });

        const redirectBase = window.location.origin && window.location.origin !== 'null'
            ? window.location.origin
            : 'http://localhost:3000';
        const redirectUrl = `${redirectBase}/pages/auth.html`;
        console.log('Email redirect URL:', redirectUrl);
        
        const { data: authData, error: authError } = await supabaseClient.auth.signUp({
            email,
            password,
            options: {
                data: {
                    first_name: firstName,
                    last_name: lastName,
                    full_name: (firstName + ' ' + lastName).trim(),
                    phone_number: phone_number || null,
                    role: role
                },
                emailRedirectTo: redirectUrl
            }
        });
        
        if (authError) {
            console.error('Signup error:', authError);
            throw authError;
        }
        
        console.log('Auth user created successfully:', authData.user.id);
        console.log('User metadata:', authData.user.user_metadata);
        
        alert(
            'Account created successfully! 🎉\n\n' +
            'Please check your email for a confirmation link.\n' +
            'The link will expire in 24 hours.\n\n' +
            '⚠️ Important: Click the link from the device where you signed up\n' +
            'or make sure to use the same address (' + window.location.host + ')'
        );
        
        document.getElementById('signup-form').reset();
        document.getElementById('signup-page').classList.remove('active');
        document.getElementById('login-page').classList.add('active');

    } catch (error) {
        console.error('Signup error:', error);
        let errorMessage = 'Signup failed: ';
        
        if (error.message.includes('already registered')) {
            errorMessage += 'This email is already registered. Please sign in instead.';
        } else if (error.message.includes('invalid email')) {
            errorMessage += 'Please enter a valid email address.';
        } else if (error.message.includes('weak password')) {
            errorMessage += 'Please use a stronger password (at least 6 characters).';
        } else {
            errorMessage += error.message;
        }
        
        alert(errorMessage);
    }
});
