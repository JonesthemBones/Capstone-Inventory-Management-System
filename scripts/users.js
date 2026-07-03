// User Management JavaScript
let allUsers = [];
let filteredUsers = [];
let editingUserId = null;
let backupData = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Require authentication
    await window.authHelpers.requireAuth();
    
    // Check role access - only admin and manager can access user management
    const hasAccess = await window.authHelpers.requireRole(['admin', 'manager']);
    if (!hasAccess) return;
    
    // Load users
    await loadUsers();
    
    // Event listeners
    document.getElementById('add-user-btn').addEventListener('click', openAddUserModal);
    document.getElementById('close-user-modal').addEventListener('click', closeUserModal);
    document.getElementById('cancel-user-btn').addEventListener('click', closeUserModal);
    document.getElementById('user-form').addEventListener('submit', handleUserSubmit);
    
    // Backup/Restore listeners
    document.getElementById('export-backup-btn').addEventListener('click', exportBackup);
    document.getElementById('restore-backup-btn').addEventListener('click', openRestoreModal);
    document.getElementById('close-restore-modal').addEventListener('click', closeRestoreModal);
    document.getElementById('cancel-restore-btn').addEventListener('click', closeRestoreModal);
    document.getElementById('confirm-restore-btn').addEventListener('click', restoreBackup);
    document.getElementById('backup-file').addEventListener('change', handleBackupFileSelect);
    
    // Filter listeners
    document.getElementById('user-search').addEventListener('input', applyFilters);
    document.getElementById('role-filter').addEventListener('change', applyFilters);
    document.getElementById('status-filter').addEventListener('change', applyFilters);
    
    // Close modal on outside click
    document.getElementById('user-modal').addEventListener('click', (e) => {
        if (e.target.id === 'user-modal') {
            closeUserModal();
        }
    });
    
    document.getElementById('restore-modal').addEventListener('click', (e) => {
        if (e.target.id === 'restore-modal') {
            closeRestoreModal();
        }
    });
});

async function loadUsers() {
    try {
        const { data, error } = await window.supabaseClient
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        allUsers = data || [];
        filteredUsers = [...allUsers];
        renderUsers();
        updateUsersCount();
    } catch (error) {
        console.error('Error loading users:', error);
        showToast('Failed to load users', 'error');
    }
}

function renderUsers() {
    const tbody = document.getElementById('users-table-body');
    
    if (filteredUsers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                    <i class="fas fa-users" style="font-size: 48px; margin-bottom: 16px; opacity: 0.3;"></i>
                    <p>No users found</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = filteredUsers.map(user => `
        <tr>
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i class="fas fa-user" style="color: var(--text-secondary);"></i>
                    <span>${escapeHtml(user.first_name)} ${escapeHtml(user.last_name)}</span>
                </div>
            </td>
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i class="fas fa-envelope" style="color: var(--text-secondary); font-size: 12px;"></i>
                    <span>${escapeHtml(user.email)}</span>
                </div>
            </td>
            <td>
                <span class="role-badge role-${user.role}">${capitalizeFirst(user.role)}</span>
            </td>
            <td>
                <span class="status-badge status-${user.is_active ? 'active' : 'inactive'}">
                    ${user.is_active ? 'Active' : 'Inactive'}
                </span>
            </td>
            <td>${formatDate(user.created_at)}</td>
            <td>${user.last_login ? formatDateTime(user.last_login) : '-'}</td>
            <td>
                <div class="action-btns">
                    <button class="icon-btn" onclick="editUser('${user.user_id}')" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="icon-btn" onclick="toggleUserStatus('${user.user_id}', ${!user.is_active})" 
                            title="${user.is_active ? 'Deactivate' : 'Activate'}">
                        <i class="fas fa-${user.is_active ? 'user-slash' : 'user-check'}"></i>
                    </button>
                    <button class="icon-btn delete" onclick="deleteUser('${user.user_id}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function applyFilters() {
    const searchTerm = document.getElementById('user-search').value.toLowerCase();
    const roleFilter = document.getElementById('role-filter').value;
    const statusFilter = document.getElementById('status-filter').value;
    
    filteredUsers = allUsers.filter(user => {
        const matchesSearch = !searchTerm || 
            user.first_name.toLowerCase().includes(searchTerm) ||
            user.last_name.toLowerCase().includes(searchTerm) ||
            user.email.toLowerCase().includes(searchTerm);
        
        const matchesRole = !roleFilter || user.role === roleFilter;
        const matchesStatus = !statusFilter || user.is_active.toString() === statusFilter;
        
        return matchesSearch && matchesRole && matchesStatus;
    });
    
    renderUsers();
    updateUsersCount();
}

function updateUsersCount() {
    const countText = document.getElementById('users-count');
    countText.textContent = `Showing ${filteredUsers.length} of ${allUsers.length} users`;
}

function openAddUserModal() {
    editingUserId = null;
    document.getElementById('user-modal-title').textContent = 'Add New User';
    document.getElementById('user-form').reset();
    document.getElementById('password-section').style.display = 'block';
    document.getElementById('user-password').required = true;
    document.getElementById('user-modal').classList.add('active');
    document.getElementById('user-modal').style.display = 'flex';
}

async function editUser(userId) {
    try {
        const { data, error } = await window.supabaseClient
            .from('users')
            .select('*')
            .eq('user_id', userId)
            .single();
        
        if (error) throw error;
        
        editingUserId = userId;
        document.getElementById('user-modal-title').textContent = 'Edit User';
        document.getElementById('user-first-name').value = data.first_name;
        document.getElementById('user-last-name').value = data.last_name;
        document.getElementById('user-email').value = data.email;
        document.getElementById('user-phone').value = data.phone_number || '';
        document.getElementById('user-role').value = data.role;
        document.getElementById('user-status').value = data.is_active.toString();
        
        // Hide password field for editing
        document.getElementById('password-section').style.display = 'none';
        document.getElementById('user-password').required = false;
        
        document.getElementById('user-modal').classList.add('active');
        document.getElementById('user-modal').style.display = 'flex';
    } catch (error) {
        console.error('Error loading user:', error);
        showToast('Failed to load user details', 'error');
    }
}

function closeUserModal() {
    document.getElementById('user-modal').classList.remove('active');
    document.getElementById('user-modal').style.display = 'none';
    document.getElementById('user-form').reset();
    editingUserId = null;
}

async function handleUserSubmit(e) {
    e.preventDefault();
    
    const firstName = document.getElementById('user-first-name').value.trim();
    const lastName = document.getElementById('user-last-name').value.trim();
    const email = document.getElementById('user-email').value.trim();
    const phone = document.getElementById('user-phone').value.trim();
    const role = document.getElementById('user-role').value;
    const isActive = document.getElementById('user-status').value === 'true';
    const password = document.getElementById('user-password').value;
    
    try {
        if (editingUserId) {
            // Update existing user
            const { error } = await window.supabaseClient
                .from('users')
                .update({
                    first_name: firstName,
                    last_name: lastName,
                    email: email,
                    phone_number: phone || null,
                    role: role,
                    is_active: isActive,
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', editingUserId);
            
            if (error) throw error;
            showToast('User updated successfully', 'success');
        } else {
            // Create new user via Supabase Auth
            const { data: authData, error: authError } = await window.supabaseClient.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        first_name: firstName,
                        last_name: lastName,
                        phone_number: phone || null,
                        role: role
                    }
                }
            });
            
            if (authError) throw authError;
            
            // Use upsert to avoid primary key conflict if user already exists
            const { error: profileError } = await window.supabaseClient
                .from('users')
                .upsert([{
                    user_id: authData.user.id,
                    first_name: firstName,
                    last_name: lastName,
                    email: email,
                    phone_number: phone || null,
                    role: role,
                    is_active: isActive,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }], {
                    onConflict: 'user_id'
                });
            
            if (profileError) throw profileError;
            showToast('User created successfully', 'success');
        }
        
        closeUserModal();
        await loadUsers();
    } catch (error) {
        console.error('Error saving user:', error);
        showToast(error.message || 'Failed to save user', 'error');
    }
}

async function toggleUserStatus(userId, newStatus) {
    const action = newStatus ? 'activate' : 'deactivate';
    if (!confirm(`Are you sure you want to ${action} this user?`)) return;
    
    try {
        const { error } = await window.supabaseClient
            .from('users')
            .update({ 
                is_active: newStatus,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId);
        
        if (error) throw error;
        
        showToast(`User ${action}d successfully`, 'success');
        await loadUsers();
    } catch (error) {
        console.error('Error updating user status:', error);
        showToast('Failed to update user status', 'error');
    }
}

async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) return;
    
    try {
        const { error } = await window.supabaseClient
            .from('users')
            .delete()
            .eq('user_id', userId);
        
        if (error) throw error;
        
        showToast('User deleted successfully', 'success');
        await loadUsers();
    } catch (error) {
        console.error('Error deleting user:', error);
        showToast('Failed to delete user', 'error');
    }
}

// Utility functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDateTime(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function showToast(message, type = 'info') {
    if (window.utils && window.utils.showToast) {
        window.utils.showToast(message, type);
    } else {
        alert(message);
    }
}

// ============== BACKUP & RESTORE FUNCTIONS ==============

async function exportBackup() {
    try {
        showToast('Exporting users backup...', 'info');
        
        const { data: users, error } = await window.supabaseClient
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        const backup = {
            metadata: {
                exportDate: new Date().toISOString(),
                totalUsers: users.length,
                version: '1.0'
            },
            users: users
        };
        
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `users_backup_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast(`Exported ${users.length} users successfully`, 'success');
    } catch (error) {
        console.error('Export error:', error);
        showToast('Failed to export backup', 'error');
    }
}

function openRestoreModal() {
    const modal = document.getElementById('restore-modal');
    modal.classList.add('active');
    modal.style.display = 'flex';
    
    const fileInput = document.getElementById('backup-file');
    fileInput.value = '';
    
    document.getElementById('restore-mode').value = 'replace';
    
    const restoreBtn = document.getElementById('confirm-restore-btn');
    restoreBtn.disabled = true;
    restoreBtn.style.opacity = '0.5';
    restoreBtn.style.cursor = 'not-allowed';
    
    backupData = null;
    console.log('Restore modal opened. backupData reset to null');
}

function closeRestoreModal() {
    const modal = document.getElementById('restore-modal');
    modal.classList.remove('active');
    modal.style.display = 'none';
    document.getElementById('backup-file').value = '';
    console.log('Restore modal closed');
}

function handleBackupFileSelect(event) {
    const file = event.target.files[0];
    const restoreBtn = document.getElementById('confirm-restore-btn');
    
    if (!file) {
        backupData = null;
        restoreBtn.disabled = true;
        restoreBtn.style.opacity = '0.5';
        restoreBtn.style.cursor = 'not-allowed';
        return;
    }
    
    showToast('Reading backup file...', 'info');
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const content = e.target.result;
            let parsedData = null;
            
            if (file.name.endsWith('.json')) {
                const data = JSON.parse(content);
                if (data.users && Array.isArray(data.users)) {
                    parsedData = data.users;
                } else if (Array.isArray(data)) {
                    parsedData = data;
                } else {
                    throw new Error('Invalid backup format');
                }
            } else if (file.name.endsWith('.csv')) {
                parsedData = parseCSV(content);
            } else {
                throw new Error('Unsupported file format');
            }
            
            if (!Array.isArray(parsedData) || parsedData.length === 0) {
                throw new Error('No users found in backup');
            }
            
            if (!parsedData[0].email) {
                throw new Error('Invalid user data: missing email');
            }
            
            backupData = parsedData;
            showToast(`✅ Loaded ${backupData.length} users`, 'success');
            
            restoreBtn.disabled = false;
            restoreBtn.style.opacity = '1';
            restoreBtn.style.cursor = 'pointer';
            
        } catch (error) {
            console.error('Parse error:', error);
            showToast(error.message || 'Failed to parse backup file', 'error');
            backupData = null;
            restoreBtn.disabled = true;
            restoreBtn.style.opacity = '0.5';
            restoreBtn.style.cursor = 'not-allowed';
        }
    };
    
    reader.onerror = () => {
        showToast('Failed to read file', 'error');
        backupData = null;
    };
    
    reader.readAsText(file);
}

function parseCSV(csv) {
    const lines = csv.trim().split('\n').filter(line => line.trim());
    if (lines.length === 0) throw new Error('CSV file is empty');
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    if (!headers.includes('email')) throw new Error('CSV must contain "email" column');
    
    const users = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
        const user = {};
        headers.forEach((header, index) => {
            user[header] = values[index] || '';
        });
        if (user.email) users.push(user);
    }
    
    return users;
}

function generateRandomPassword() {
    const length = 12;
    const chars = {
        upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        lower: 'abcdefghijklmnopqrstuvwxyz',
        nums: '0123456789',
        symbols: '!@#$%^&*'
    };
    const all = chars.upper + chars.lower + chars.nums + chars.symbols;
    
    let pwd = '';
    pwd += chars.upper[Math.floor(Math.random() * chars.upper.length)];
    pwd += chars.lower[Math.floor(Math.random() * chars.lower.length)];
    pwd += chars.nums[Math.floor(Math.random() * chars.nums.length)];
    pwd += chars.symbols[Math.floor(Math.random() * chars.symbols.length)];
    
    for (let i = pwd.length; i < length; i++) {
        pwd += all[Math.floor(Math.random() * all.length)];
    }
    
    return pwd.split('').sort(() => Math.random() - 0.5).join('');
}

async function createUserWithAuth(email, password, firstName, lastName, phoneNumber, role, isActive) {
    try {
        const response = await fetch('http://localhost:3001/api/create-user-with-auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, firstName, lastName, phoneNumber, role, isActive })
        });

        const data = await response.json();
        
        if (response.status === 409) {
            return { success: false, error: 'User already exists', alreadyExists: true };
        }
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to create user');
        }

        return { 
            success: true, 
            userId: data.userId, 
            wasRestored: data.wasRestored || false 
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function sendCredentialsEmail(email, password, firstName) {
    try {
        const response = await fetch('http://localhost:3001/api/send-restored-credentials', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, firstName })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to send email');
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function restoreBackup() {
    if (!backupData || !Array.isArray(backupData) || backupData.length === 0) {
        showToast('Please select a valid backup file first', 'error');
        return;
    }
    
    const mode = document.getElementById('restore-mode').value;
    const confirmMsg = mode === 'replace' 
        ? `⚠️ This will DELETE all ${allUsers.length} users and restore ${backupData.length} users.\n\nType 'DELETE' to confirm:`
        : `Restore ${backupData.length} users in "${mode}" mode?`;
    
    let confirmed = false;
    if (mode === 'replace') {
        confirmed = prompt(confirmMsg) === 'DELETE';
    } else {
        confirmed = confirm(confirmMsg);
    }
    
    if (!confirmed) {
        showToast('Restore cancelled', 'info');
        return;
    }
    
    try {
        showToast('Restoring backup...', 'info');
        
        let success = 0, skipped = 0, failed = 0;
        const errors = [];
        const usersToRestore = Array.from(backupData); // Create proper array copy
        
        closeRestoreModal();
        
        // Replace mode: delete all existing users first
        if (mode === 'replace') {
            const { data: existing } = await window.supabaseClient.from('users').select('user_id');
            if (existing && existing.length > 0) {
                for (const u of existing) {
                    await window.supabaseClient.from('users').delete().eq('user_id', u.user_id);
                }
            }
        }
        
        // Process each user
        for (let i = 0; i < usersToRestore.length; i++) {
            const user = usersToRestore[i];
            
            try {
                const email = (user.email || '').trim();
                if (!email) {
                    failed++;
                    errors.push({ row: i + 1, error: 'Missing email' });
                    continue;
                }
                
                // Normalize and provide defaults
                let firstName = (user.first_name || user.firstName || '').trim() || 'User';
                let lastName = (user.last_name || user.lastName || '').trim() || 'User';
                const phoneNumber = user.phone_number || user.phoneNumber || null;
                let role = (user.role || '').trim().toLowerCase();
                
                if (!['admin', 'manager', 'cashier', 'staff'].includes(role)) {
                    role = 'staff';
                }
                
                const isActive = user.is_active !== undefined ? user.is_active : true;
                
                // Check if user exists (merge/add-only modes)
                if (mode === 'merge' || mode === 'add-only') {
                    const { data: existingUser } = await window.supabaseClient
                        .from('users')
                        .select('user_id')
                        .eq('email', email)
                        .maybeSingle();
                    
                    if (existingUser) {
                        if (mode === 'add-only') {
                            skipped++;
                            continue;
                        }
                        
                        // Merge: update existing
                        await window.supabaseClient
                            .from('users')
                            .update({
                                first_name: firstName,
                                last_name: lastName,
                                phone_number: phoneNumber,
                                role: role,
                                is_active: isActive,
                                updated_at: new Date().toISOString()
                            })
                            .eq('user_id', existingUser.user_id);
                        
                        success++;
                        continue;
                    }
                }
                
                // Create new user
                const password = generateRandomPassword();
                const result = await createUserWithAuth(email, password, firstName, lastName, phoneNumber, role, isActive);
                
                if (result.alreadyExists) {
                    skipped++;
                    continue;
                }
                
                if (result.wasRestored) {
                    // User existed in Auth but was successfully added to database
                    console.log(`✅ Restored auth user to database: ${email}`);
                    success++;
                    continue;
                }
                
                if (!result.success) {
                    throw new Error(result.error);
                }
                
                await sendCredentialsEmail(email, password, firstName);
                success++;
                
            } catch (error) {
                failed++;
                errors.push({ email: user.email, error: error.message });
            }
        }
        
        let message = `Restore complete: ✅${success} succeeded`;
        if (skipped > 0) message += `, ⏭️${skipped} skipped`;
        if (failed > 0) message += `, ❌${failed} failed`;
        
        showToast(message, failed > 0 ? 'warning' : 'success');
        
        if (errors.length > 0) {
            console.error('Restore errors:', errors);
        }
        
        await loadUsers();
        
    } catch (error) {
        console.error('Restore error:', error);
        showToast('Failed to restore backup: ' + error.message, 'error');
    }
}
