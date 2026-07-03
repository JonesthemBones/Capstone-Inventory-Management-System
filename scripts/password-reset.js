const express = require('express');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const router = express.Router();

// Initialize Supabase client with service role key
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // Service role key for admin operations
);

// Configure nodemailer for Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Verify transporter configuration on startup
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Email transporter error:', error);
  } else {
    console.log('✅ Email server is ready to send messages');
  }
});

// Generate 6-digit OTP
function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

// 1. Send OTP to email
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user exists
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email, first_name, user_id')
      .eq('email', email)
      .single();

    if (userError || !user) {
      return res.status(404).json({ 
        error: 'No account found with this email address' 
      });
    }

    // Generate OTP and expiration (5 minutes)
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    console.log(`Generated OTP for ${email}: ${otp}`);

    // Store OTP in database
    const { error: updateError } = await supabase
      .from('users')
      .update({
        otp_code: otp,
        otp_expires_at: expiresAt,
        otp_verified: false
      })
      .eq('email', email);

    if (updateError) {
      console.error('Database update error:', updateError);
      throw updateError;
    }

    // Send email with OTP
    const mailOptions = {
      from: `"Inventory System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Password Reset OTP - Inventory Management System',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <div style="width: 64px; height: 64px; background-color: #1f2937; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
              <span style="color: white; font-size: 28px;">📊</span>
            </div>
            <h1 style="color: #1f2937; margin-bottom: 10px;">Password Reset Request</h1>
            <p style="color: #6b7280; font-size: 14px;">Hello ${user.first_name || 'User'},</p>
          </div>
          
          <div style="background-color: #f3f4f6; border-radius: 8px; padding: 30px; text-align: center; margin: 20px 0;">
            <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">Your verification code:</p>
            <h1 style="color: #1f2937; font-size: 48px; letter-spacing: 8px; margin: 0; font-weight: bold;">${otp}</h1>
          </div>
          
          <div style="margin-top: 30px; padding: 20px; background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px;">
            <p style="color: #92400e; font-size: 14px; margin: 0;">
              ⚠️ <strong>Important:</strong> This code will expire in 5 minutes.
            </p>
          </div>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 12px; text-align: center;">
              If you didn't request this code, please ignore this email.<br>
              Your password will not be changed.
            </p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ OTP email sent successfully to ${email}`);

    res.json({ 
      success: true, 
      message: 'OTP sent to your email',
      expiresIn: 300 // 5 minutes in seconds
    });

  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ 
      error: 'Failed to send OTP. Please try again.' 
    });
  }
});

// 2. Verify OTP
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    console.log(`Verifying OTP for ${email}: ${otp}`);

    // Get user with OTP
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email, otp_code, otp_expires_at, otp_verified')
      .eq('email', email)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'Invalid request' });
    }

    // Check if OTP exists
    if (!user.otp_code) {
      return res.status(400).json({ 
        error: 'No OTP request found. Please request a new code.' 
      });
    }

    // Check if OTP is expired
    if (new Date() > new Date(user.otp_expires_at)) {
      return res.status(400).json({ 
        error: 'OTP has expired. Please request a new code.' 
      });
    }

    // Verify OTP
    if (user.otp_code !== otp) {
      console.log(`❌ Invalid OTP. Expected: ${user.otp_code}, Got: ${otp}`);
      return res.status(400).json({ 
        error: 'Invalid OTP. Please check and try again.' 
      });
    }

    // Mark OTP as verified
    const { error: updateError } = await supabase
      .from('users')
      .update({ otp_verified: true })
      .eq('email', email);

    if (updateError) {
      throw updateError;
    }

    console.log(`✅ OTP verified successfully for ${email}`);

    res.json({ 
      success: true, 
      message: 'OTP verified successfully'
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ 
      error: 'Failed to verify OTP. Please try again.' 
    });
  }
});

// 3. Reset password (after OTP verification)
router.post('/reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ 
        error: 'Email and new password are required' 
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ 
        error: 'Password must be at least 6 characters long' 
      });
    }

    console.log(`Resetting password for ${email}`);

    // Check if OTP was verified
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('user_id, otp_verified, otp_expires_at, first_name')
      .eq('email', email)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'Invalid request' });
    }

    if (!user.otp_verified) {
      return res.status(400).json({ 
        error: 'OTP not verified. Please verify your OTP first.' 
      });
    }

    // Check if OTP verification is still valid (10 minutes after verification)
    if (new Date() > new Date(new Date(user.otp_expires_at).getTime() + 10 * 60 * 1000)) {
      return res.status(400).json({ 
        error: 'Verification expired. Please request a new OTP.' 
      });
    }

    // Update password using Supabase Auth Admin API
    const { error: passwordError } = await supabase.auth.admin.updateUserById(
      user.user_id,
      { password: newPassword }
    );

    if (passwordError) {
      console.error('Password update error:', passwordError);
      throw passwordError;
    }

    // Clear OTP data
    await supabase
      .from('users')
      .update({
        otp_code: null,
        otp_expires_at: null,
        otp_verified: false
      })
      .eq('email', email);

    console.log(`✅ Password reset successfully for ${email}`);

    // Send confirmation email
    try {
      await transporter.sendMail({
        from: `"Inventory System" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Password Changed Successfully',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1f2937;">Password Changed</h2>
            <p>Hello ${user.first_name || 'User'},</p>
            <p>Your password has been successfully changed.</p>
            <p style="color: #6b7280; font-size: 14px;">
              If you didn't make this change, please contact support immediately.
            </p>
          </div>
        `
      });
    } catch (emailError) {
      console.error('Confirmation email error:', emailError);
      // Don't fail the request if confirmation email fails
    }

    res.json({ 
      success: true, 
      message: 'Password reset successfully'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ 
      error: 'Failed to reset password. Please try again.' 
    });
  }
});

// Helper function to generate random password
function generateRandomPassword() {
  const length = 12;
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*';
  const allChars = uppercase + lowercase + numbers + symbols;
  
  let password = '';
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += symbols[Math.floor(Math.random() * symbols.length)];
  
  for (let i = password.length; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

// 4. Create user with auth (for backup restore) - FIXED
router.post('/create-user-with-auth', async (req, res) => {
  try {
    let { email, password, firstName, lastName, phoneNumber, role, isActive } = req.body;

    // Trim and normalize all string inputs
    email = email?.trim();
    firstName = firstName?.trim();
    lastName = lastName?.trim();
    role = role?.trim()?.toLowerCase();

    // Enhanced validation with better error messages
    const errors = [];
    if (!email) errors.push('email');
    if (!password || password.length < 6) errors.push('password (min 6 chars)');
    if (!firstName) errors.push('firstName');
    if (!lastName) {
      // If lastName is empty, use a default value
      lastName = 'User';
      console.warn(`⚠️ Empty lastName for ${email}, using default: "User"`);
    }
    if (!role) errors.push('role');
    
    if (errors.length > 0) {
      console.error('❌ Validation failed. Missing/invalid:', errors);
      console.error('Received data:', { 
        email, 
        password: password ? '***' : 'missing',
        firstName, 
        lastName, 
        phoneNumber, 
        role, 
        isActive 
      });
      return res.status(400).json({ 
        error: `Missing or invalid fields: ${errors.join(', ')}`,
        details: errors
      });
    }

    // Validate role
    const validRoles = ['admin', 'manager', 'cashier', 'staff'];
    if (!validRoles.includes(role)) {
      console.warn(`⚠️ Invalid role "${role}" for ${email}, defaulting to "staff"`);
      role = 'staff';
    }

    console.log(`Creating user with auth: ${email} (${firstName} ${lastName}, ${role})`);

    // Check if user already exists in Auth
    const { data: existingAuthUsers, error: listError } = await supabase.auth.admin.listUsers();
    if (!listError && existingAuthUsers) {
      const userExists = existingAuthUsers.users.find(u => u.email === email);
      if (userExists) {
        console.log(`⚠️ User already exists in Auth: ${email}`);
        
        // Check if user exists in database
        const { data: dbUser, error: dbCheckError } = await supabase
          .from('users')
          .select('user_id')
          .eq('email', email)
          .maybeSingle();
        
        if (!dbUser && !dbCheckError) {
          // User exists in Auth but not in database - add to database
          console.log(`⚠️ User exists in Auth but not in database. Adding to database: ${email}`);
          
          const { error: dbInsertError } = await supabase
            .from('users')
            .insert([{
              user_id: userExists.id,
              first_name: firstName,
              last_name: lastName,
              email: email,
              phone_number: phoneNumber || null,
              role: role,
              is_active: isActive !== undefined ? isActive : true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }]);
          
          if (dbInsertError) {
            console.error('❌ Failed to add existing auth user to database:', dbInsertError);
            return res.status(500).json({ 
              error: 'User exists in Auth but failed to add to database',
              details: dbInsertError.message
            });
          }
          
          console.log(`✅ Added existing auth user to database: ${email}`);
          return res.json({ 
            success: true, 
            userId: userExists.id,
            message: 'User already existed in Auth, now added to database',
            wasRestored: true
          });
        }
        
        // User exists in both Auth and database
        return res.status(409).json({ 
          error: 'User already exists',
          details: `A user with email ${email} already exists in the system`
        });
      }
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        phone_number: phoneNumber || null,
        role: role
      }
    });

    if (authError) {
      console.error('❌ Auth creation error:', authError);
      throw authError;
    }

    console.log(`✅ Auth user created: ${authData.user.id}`);

    // Create user profile in database
    const { error: dbError } = await supabase
      .from('users')
      .insert([{
        user_id: authData.user.id,
        first_name: firstName,
        last_name: lastName,
        email: email,
        phone_number: phoneNumber || null,
        role: role,
        is_active: isActive !== undefined ? isActive : true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }]);

    if (dbError) {
      console.error('❌ Database creation error:', dbError);
      // Try to delete auth user if database insert fails
      try {
        await supabase.auth.admin.deleteUser(authData.user.id);
        console.log('🗑️ Rolled back auth user after DB error');
      } catch (rollbackError) {
        console.error('❌ Rollback failed:', rollbackError);
      }
      throw dbError;
    }

    console.log(`✅ User created successfully: ${email}`);

    res.json({ 
      success: true, 
      userId: authData.user.id,
      message: 'User created successfully'
    });

  } catch (error) {
    console.error('❌ Create user error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to create user',
      details: error.toString()
    });
  }
});

// 5. Send restored credentials email
router.post('/send-restored-credentials', async (req, res) => {
  try {
    const { email, password, firstName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required' 
      });
    }

    console.log(`Sending credentials email to: ${email}`);

    await transporter.sendMail({
      from: `"Inventory System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Your Account Has Been Restored',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
          <div style="background-color: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="color: #1f2937; margin-top: 0;">Account Restored</h2>
            <p>Hello ${firstName || 'User'},</p>
            <p>Your account has been restored in the Inventory Management System.</p>
            
            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 20px 0;">
              <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;">Your Login Credentials:</p>
              <p style="margin: 5px 0;"><strong>Email:</strong> ${email}</p>
              <p style="margin: 5px 0;"><strong>Temporary Password:</strong> <code style="background-color: #e5e7eb; padding: 2px 6px; border-radius: 3px; font-family: monospace;">${password}</code></p>
            </div>
            
            <p style="color: #dc2626; font-size: 14px;">
              <strong>⚠️ Important:</strong> Please change your password immediately after logging in.
            </p>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
              If you didn't expect this email, please contact your system administrator.
            </p>
          </div>
        </div>
      `
    });

    console.log(`✅ Credentials email sent to: ${email}`);

    res.json({ 
      success: true, 
      message: 'Credentials email sent successfully'
    });

  } catch (error) {
    console.error('Send credentials error:', error);
    res.status(500).json({ 
      error: 'Failed to send credentials email'
    });
  }
});

module.exports = router;