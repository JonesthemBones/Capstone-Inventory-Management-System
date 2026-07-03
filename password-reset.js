const express = require('express');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const SUPABASE_KEY = process.env.SUPABASE_KEY?.trim();
const SMTP_HOST = process.env.SMTP_HOST?.trim();
const SMTP_PORT = process.env.SMTP_PORT?.trim();
const SMTP_SECURE = process.env.SMTP_SECURE?.trim();
const EMAIL_USER = process.env.EMAIL_USER?.trim();
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD?.trim();

const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
let transporter = null;

if (SMTP_HOST && SMTP_PORT && EMAIL_USER && EMAIL_PASSWORD) {
  console.log('EMAIL_USER:', EMAIL_USER);
  console.log('EMAIL_PASSWORD:', EMAIL_PASSWORD ? '***SET***' : 'undefined');
  console.log('SMTP_HOST:', SMTP_HOST);
  console.log('SMTP_PORT:', SMTP_PORT);
  console.log('SMTP_SECURE:', SMTP_SECURE);

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: SMTP_SECURE === 'true',
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASSWORD
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  transporter.verify((error, success) => {
    if (error) {
      console.error('❌ Email transporter error:', error);
    } else {
      console.log('✅ Email server is ready to send messages');
    }
  });
} else {
  console.warn('⚠️ Email transporter is not fully configured. Password reset routes will return service unavailable.');
}

function checkPasswordResetEnabled(res) {
  if (!supabase) {
    res.status(503).json({ error: 'Password reset disabled: SUPABASE_URL or SUPABASE_KEY is missing.' });
    return false;
  }
  if (!transporter) {
    res.status(503).json({ error: 'Password reset disabled: email/SMTP configuration is missing.' });
    return false;
  }
  return true;
}

// Generate 6-digit OTP
function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

// 1. Send OTP to email
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!checkPasswordResetEnabled(res)) {
      return;
    }

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
    if (!checkPasswordResetEnabled(res)) {
      return;
    }

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
    if (!checkPasswordResetEnabled(res)) {
      return;
    }

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

module.exports = router;