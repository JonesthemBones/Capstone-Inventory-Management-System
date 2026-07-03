require('dotenv').config();
const express = require('express');
const cors = require('cors');
const passwordResetRoutes = require('./password-reset');
const openRouterRoutes = require('./openrouter');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS Configuration - MUST BE BEFORE ROUTES
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, postman)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://127.0.0.1:5500',
      'http://localhost:5500',
      'http://127.0.0.1:3000',
      'http://localhost:3000',
      'http://127.0.0.1:3001',
      'http://localhost:3001',
      'http://127.0.0.1',
      'http://localhost',
      'https://127.0.0.1',
      'https://localhost'
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      callback(null, true); 
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Serve static files
app.use(express.static(__dirname));

app.use('/api', passwordResetRoutes);
app.use('/api', openRouterRoutes);

// Direct test route
app.post('/api/test-save', (req, res) => {
  res.json({ success: true, message: 'Test endpoint works' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`\n✅ Server running on http://localhost:${PORT}`);
  console.log(`📧 Email: ${process.env.EMAIL_USER}`);
  console.log(`🗄️  Database: ${process.env.SUPABASE_URL}`);
  console.log(`🌐 CORS enabled for development`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /api/send-otp`);
  console.log(`  POST /api/verify-otp`);
  console.log(`  POST /api/reset-password`);
  console.log(`  POST /api/ocr-scan`);
  console.log(`  POST /api/save-items-to-inventory`);
  console.log(`\n`);
});