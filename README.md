# Amacar Hardware Inventory Management System

A comprehensive, full-stack inventory management system designed for stock monitoring and control. Features real-time analytics, sales trend forecasting, low-stock alerts, VLM-based receipt scanning, and AI-powered inventory management.

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [Features Guide](#features-guide)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Security & Authentication](#security--authentication)
- [Troubleshooting](#troubleshooting)

## 🎯 Overview

The Amacar Hardware Inventory Management System is a capstone project that provides a complete solution for managing hardware inventory, tracking stock levels, generating reports, and forecasting demand. It supports multiple user roles with different permission levels and includes advanced features like VLM-based receipt scanning and AI-assisted inventory management.

## ✨ Features

### Core Functionality
- **Inventory Management**: Add, edit, delete, and track hardware products
- **Stock Monitoring**: Real-time stock level tracking with low-stock alerts
- **Product Categories**: Organize inventory by hardware categories
- **Search & Filter**: Advanced search and filtering capabilities
- **Inventory Analytics**: Sales trends, stock movements, and demand forecasting
- **Reports Generation**: Create custom inventory and sales reports

### Advanced Features
- **Vision Language Model (VLM) Scanning**: Extract product and receipt data from images using advanced vision models
- **AI Integration**: OpenRouter integration for intelligent inventory assistance
- **Audit Logging**: Complete audit trail of all inventory changes
- **Outbound Tracking**: Track product outbound movements and transfers

### User Experience
- **Role-Based Access Control**: Admin and user roles with different permissions
- **User Management**: Create and manage system users
- **Authentication**: Secure login with Supabase authentication
- **Password Reset**: Self-service password recovery via email
- **Dark Mode**: Toggle between light and dark themes
- **Mobile Responsive**: Fully responsive design for desktop and mobile devices
- **Auto-Logout**: Automatic session termination after inactivity

### Security
- **JWT Authentication**: Secure token-based authentication
- **CORS Protection**: Configured cross-origin resource sharing
- **Environment Variables**: Sensitive data management via .env file
- **Session Management**: Secure user session handling

## 🛠️ Tech Stack

### Frontend
- **HTML5** - Semantic markup
- **CSS3** - Responsive styling with dark mode support
- **Vanilla JavaScript** - Client-side logic and interactivity
- **Supabase JS SDK** - Real-time database client

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **Supabase** - PostgreSQL database & authentication
- **Nodemailer** - Email service (password reset)
- **OpenRouter** - AI/LLM integration

### Development Tools
- **Python** - VLM integration and receipt data extraction
- **dotenv** - Environment configuration
- **CORS** - Cross-origin resource sharing

## 📁 Project Structure

```
Capstone-Inventory-Management-System/
├── index.html                    # Main entry point
├── server.js                     # Express server configuration
├── package.json                  # Node.js dependencies
├── openapi.json                  # API documentation
├── python_ocr.py                 # VLM receipt scanning & data extraction
├── password-reset.js             # Password reset logic
├── openrouter.js                 # AI integration
├── .env                          # Environment variables (not in repo)
│
├── pages/                        # HTML pages
│   ├── auth.html                # Login/Registration
│   ├── dashboard.html           # Main dashboard
│   ├── inventory.html           # Inventory management
│   ├── categories.html          # Category management
│   ├── users.html               # User management
│   ├── reports.html             # Reports & analytics
│   ├── audit_logs.html          # Audit trail
│   ├── ocr_scan.html            # VLM receipt scanning
│   ├── forgot-password.html     # Password recovery
│   └── help.html                # Help & documentation
│
├── components/                   # Reusable components
│   └── sidebar.html             # Navigation sidebar
│
├── scripts/                      # JavaScript logic
│   ├── config.js                # Configuration & constants
│   ├── util.js                  # Utility functions
│   ├── supabase_check.js        # Supabase initialization
│   ├── auth.js                  # Authentication logic
│   ├── index.js                 # Main app initialization
│   ├── dashboard.js             # Dashboard logic
│   ├── inventory.js             # Inventory operations
│   ├── categories.js            # Category management
│   ├── users.js                 # User management
│   ├── reports.js               # Report generation
│   ├── audit_logs.js            # Audit logging
│   ├── ocr_scan.js              # VLM receipt scanning functionality
│   ├── outbound.js              # Outbound tracking
│   ├── dark-mode.js             # Theme switching
│   ├── mobile-responsive.js     # Mobile UI handling
│   ├── inactivity-logout.js     # Auto-logout on inactivity
│   ├── password-reset.js        # Password reset flow
│   ├── help.js                  # Help page logic
│   └── sidebar.js               # Sidebar functionality
│
├── styles/                       # CSS stylesheets
│   ├── index.css                # Main styles
│   ├── auth.css                 # Auth page styles
│   ├── dashboard.css            # Dashboard styles
│   ├── inventory-thumbnail.css  # Inventory card styles
│   ├── outbound-product-cards.css
│   ├── modal.css                # Modal dialogs
│   ├── dark-mode.css            # Dark theme styles
│   └── [page-specific styles]
│
├── node-mailer/                  # Email service
│   └── package.json
│
└── README.md                     # This file
```

## 🚀 Installation

### Prerequisites
- **Node.js** (v14 or higher)
- **npm** or **yarn**
- **Python 3.x** (for VLM integration)
- **Supabase Account** (free tier available)
- **Git**

### Steps

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd Capstone-Inventory-Management-System
   ```

2. **Install Node.js dependencies**
   ```bash
   npm install
   ```

3. **Install Python dependencies (for VLM integration)**
   ```bash
   pip install -r requirements.txt
   ```

4. **Set up environment variables** (create `.env` file)
   ```bash
   cp .env.example .env
   ```

## ⚙️ Configuration

Create a `.env` file in the root directory with the following variables:

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# Supabase Configuration
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_key

# Email Configuration (Nodemailer)
EMAIL_SERVICE=gmail
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_app_password
EMAIL_FROM=noreply@amacar.com

# OpenRouter AI Configuration
OPENROUTER_API_KEY=your_openrouter_api_key

# Application Settings
APP_NAME=Amacar Hardware Inventory System
APP_URL=http://localhost:3001
INACTIVITY_TIMEOUT=300000  # 5 minutes in milliseconds
```

### Supabase Setup

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Create tables for:
   - `users` - User account information
   - `products` - Hardware inventory items
   - `categories` - Product categories
   - `stock_movements` - Stock transaction history
   - `audit_logs` - System audit trail

3. Set up authentication policies and row-level security (RLS)

## ▶️ Running the Application

### Development Mode

```bash
# Start the Express server
npm start

# The application will be available at http://localhost:3001
```

### Production Mode

```bash
# Set NODE_ENV to production
set NODE_ENV=production

# Start the server
npm start
```

### With Live Server (Frontend Only)
```bash
# Use VS Code Live Server extension or
python -m http.server 5500
# Access at http://localhost:5500
```

## 📚 Features Guide

### Dashboard
- Overview of inventory status
- Key metrics and statistics
- Recent activities
- Low-stock alerts

### Inventory Management
- View all hardware products
- Add new inventory items
- Edit product details
- Delete products
- Track quantity changes
- Categorize products

### Categories
- Create hardware categories
- Organize products by type
- Manage category details
- Filter inventory by category

### Receipt Scanning with VLM
- Capture receipt images using device camera or file upload
- Extract product details, prices, and quantities using Vision Language Models
- Intelligent data extraction and validation from receipt images
- Works on mobile and desktop devices

### Reports & Analytics
- Generate sales reports
- Analyze stock movements
- View trend forecasting
- Export data to CSV/PDF

### Audit Logs
- Track all system changes
- View who made changes and when
- User activity history
- Data integrity verification

### User Management
- Create new user accounts
- Assign user roles
- Manage permissions
- Deactivate users
- View user activity

### Password Reset
- Self-service password recovery
- Email-based reset link
- Secure token validation

## 🔌 API Documentation

The API documentation is available in [openapi.json](openapi.json).

### Key Endpoints

#### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/logout` - User logout

#### Password Reset
- `POST /api/password-reset/request` - Request password reset
- `POST /api/password-reset/verify` - Verify reset token
- `POST /api/password-reset/reset` - Reset password

#### Inventory
- `GET /api/products` - List all products
- `POST /api/products` - Create new product
- `PUT /api/products/:id` - Update product
- `DELETE /api/products/:id` - Delete product

#### AI Features
- `POST /api/ai/analyze` - Analyze inventory with AI
- `POST /api/ai/suggest` - Get AI suggestions

## 🗄️ Database Schema

### Core Tables

#### Users Table
```
- id (UUID, Primary Key)
- email (String, Unique)
- first_name (String)
- last_name (String)
- phone_number (String)
- role (String: admin, user)
- is_active (Boolean)
- created_at (Timestamp)
- updated_at (Timestamp)
- last_login (Timestamp)
```

#### Products Table
```
- id (UUID, Primary Key)
- product_id (UUID)
- product_name (String)
- description (Text)
- product_code (String, Unique)
- unit_of_measure (String)
- unit_price (Numeric)
- selling_price (Numeric)
- reorder_level (Integer)
- maximum_stock (Integer)
- is_active (Boolean)
- created_at (Timestamp)
- updated_at (Timestamp)
- image_url (String)
- image_path (String)
- image_uploaded_at (Timestamp)
```

#### Inventory Stock Table
```
- id (UUID, Primary Key)
- stock_id (UUID)
- product_id (UUID, Foreign Key)
- quantity (Integer)
- last_restock_date (Timestamp)
- last_sale_date (Timestamp)
- updated_at (Timestamp)
```

#### Stock Movements Table
```
- id (UUID, Primary Key)
- movement_id (UUID)
- product_id (UUID, Foreign Key)
- movement_type (String: IN, OUT, ADJUSTMENT)
- reference_type (String)
- reference_id (Integer)
- quantity_change (Integer)
- quantity_before (Integer)
- quantity_after (Integer)
- movement_date (Timestamp)
- performed_by (UUID, Foreign Key)
- notes (Text)
```

#### Stock Alerts Table
```
- id (UUID, Primary Key)
- alert_id (UUID)
- product_id (UUID, Foreign Key)
- alert_type (String: CRITICAL, WARNING, INFO)
- alert_level (String)
- current_quantity (Integer)
- threshold_value (Integer)
- alert_date (Timestamp)
- is_acknowledged (Boolean)
- acknowledged_by (UUID, Foreign Key)
- acknowledged_at (Timestamp)
- resolution_action (String)
- resolution_notes (String)
- resolved_at (Timestamp)
- notes (Text)
```

### Receipt Processing Tables

#### Receipt Images Table
```
- id (UUID, Primary Key)
- image_id (UUID)
- image_path (String)
- image_format (String: jpg, png, jpeg)
- image_size_bytes (Integer)
- image_hash (String)
- uploaded_by (UUID, Foreign Key)
- uploaded_at (Timestamp)
- created_at (Timestamp)
- updated_at (Timestamp)
```

#### VLM Processing Logs Table
```
- id (UUID, Primary Key)
- log_id (UUID)
- image_id (UUID, Foreign Key)
- processing_status (String)
- attempt_number (Integer)
- response_time_ms (Integer)
- error_message (Text)
- created_at (Timestamp)
- updated_at (Timestamp)
```

#### VLM Extractions Table
```
- id (UUID, Primary Key)
- extraction_id (UUID)
- image_id (UUID, Foreign Key)
- supplier_name (String)
- supplier_address (Text)
- supplier_phone (String)
- supplier_tax_id (String)
- transaction_date (Date)
- transaction_time (Time)
- receipt_number (String)
- subtotal (Numeric)
- tax_amount (Numeric)
- discount_amount (Numeric)
- total_amount (Numeric)
- currency_code (String)
- overall_confidence (Numeric)
- extraction_status (String)
- raw_response (JSONB)
- processing_time_ms (Integer)
- created_at (Timestamp)
- updated_at (Timestamp)
```

#### Extracted Line Items Table
```
- id (UUID, Primary Key)
- line_item_id (UUID)
- extraction_id (UUID, Foreign Key)
- item_description (String)
- item_quantity (Numeric)
- item_unit (String)
- item_unit_price (Numeric)
- item_total_price (Numeric)
- matched_product_id (UUID)
- item_confidence (Numeric)
- item_sequence (Integer)
```

### Audit & Logging Tables

#### Audit Logs Table
```
- id (UUID, Primary Key)
- log_id (UUID)
- user_id (UUID, Foreign Key)
- action_type (String)
- table_affected (String)
- operation (String: INSERT, UPDATE, DELETE)
- old_values (JSONB)
- new_values (JSONB)
- ip_address (Text)
- user_agent (Text)
- action_timestamp (Timestamp)
- last_login (Timestamp)
```

#### Backup Logs Table
```
- id (UUID, Primary Key)
- backup_id (UUID)
- backup_type (String)
- backup_status (String)
- backup_size_mb (Numeric)
- started_at (Timestamp)
- completed_at (Timestamp)
- performed_by (UUID, Foreign Key)
- error_message (Text)
- retention_expires_at (Date)
```

### Authentication Table

#### Auth Users Table (Supabase Auth)
```
- id (UUID, Primary Key)
- email (String, Unique)
- encrypted_password (String)
- otp_code (String)
- otp_expires_at (Timestamp)
- otp_verified (Boolean)
- last_login (Timestamp)
- created_at (Timestamp)
- updated_at (Timestamp)
```

## 💾 Storage Buckets

Your Supabase project has two main storage buckets configured:

### Product Images Bucket
```
Name: product-images
Policies: PUBLIC
File Size Limit: 5 MB
Allowed MIME Types: image/jpg, image/png, image/jpeg
Purpose: Stores hardware product images for inventory
```

**Usage:**
- Upload product photos during inventory creation
- Reference paths: `/product-images/{product_id}/{filename}`
- Publicly accessible for dashboard display

### Receipt Images Bucket
```
Name: receipt-images
Policies: PRIVATE (configurable)
File Size Limit: 50 MB
Allowed MIME Types: image/jpg, image/png, image/jpeg
Purpose: Stores receipt images for VLM processing
```

**Usage:**
- Upload receipt images captured during scanning
- Reference paths: `/receipt-images/{user_id}/{filename}`
- Used for Vision Language Model extraction
- Temporary or permanent storage based on retention policy

## 📊 Database Relationships

```
auth.users
  ├── users (profile extension)
  ├── stock_alerts (alert creator)
  ├── stock_movements (performer)
  ├── audit_logs (user action)
  └── backup_logs (performed_by)

products
  ├── inventory_stock (one-to-one)
  ├── stock_movements (one-to-many)
  └── stock_alerts (one-to-many)

receipt_images
  ├── vlm_processing_logs (one-to-many)
  └── vlm_extractions (one-to-one)

vlm_extractions
  └── extracted_line_items (one-to-many)

```

## 🔒 Security & Authentication

### Authentication Flow
1. User logs in with email/password
2. Supabase validates credentials
3. JWT token is issued and stored in browser
4. Token is included in API requests via Authorization header
5. Backend verifies token on protected routes

### Password Security
- Passwords hashed using bcrypt (by Supabase)
- Password reset uses secure tokens
- Email verification for sensitive operations

### CORS Protection
- Configured allowed origins
- Prevents unauthorized cross-origin requests
- Credentials-based CORS for API calls

### Session Management
- Automatic logout after inactivity (configurable)
- Session validation on each request
- Secure cookie handling

## 🐛 Troubleshooting

### Issue: Cannot connect to Supabase
**Solution**: Verify VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env file

### Issue: CORS errors
**Solution**: Check that your origin is in the allowedOrigins array in server.js

### Issue: Email not sending
**Solution**: Enable "Less secure app access" or use app-specific password for Gmail

### Issue: Receipt scanning not working
**Solution**: Ensure Python is installed, VLM provider is configured in .env, and all required Python packages are installed

### Issue: Auto-logout not working
**Solution**: Check INACTIVITY_TIMEOUT value in .env (in milliseconds)

## 📝 Development Guidelines

- Follow existing code structure and naming conventions
- Use semantic HTML for accessibility
- Keep CSS modular and scoped
- Write clear comments for complex logic
- Test all features before pushing
- Update documentation when adding features

## 🤝 Contributing

1. Create a feature branch
2. Commit your changes
3. Push to the branch
4. Submit a pull request

## 📄 License

This project is part of a capstone assignment. All rights reserved.

## 📧 Support

For issues or questions, please contact the development team or open an issue in the repository.

---

**Last Updated**: 2026-07-09
**Version**: 1.0.0
