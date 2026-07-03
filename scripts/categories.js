let currentEditingCategoryId = null;

document.addEventListener('DOMContentLoaded', async () => {
    const session = await window.authHelpers.requireAuth();
    if (!session) return;
    
    await loadCategories();
    setupEventListeners();
    setupRealtimeSubscriptions();
});

async function loadCategories(searchTerm = '') {
    try {
        let query = supabaseClient
            .from('categories')
            .select(`
                *,
                products:products(count)
            `)
            .order('category_name');
        
        if (searchTerm) {
            query = query.ilike('category_name', `%${searchTerm}%`);
        }
        
        const { data: categories, error } = await query;
        
        if (error) throw error;
        
        displayCategories(categories || []);
        document.getElementById('category-count').textContent = 
            `${categories?.length || 0} categories`;

        populateParentCategories(categories || []);
        
    } catch (error) {
        console.error('Error loading categories:', error);
        alert('Error loading categories: ' + error.message);
    }
}

function displayCategories(categories) {
    const tbody = document.getElementById('category-table-body');
    
    if (!categories || categories.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                    No categories found
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = categories.map(category => {
        const productCount = category.products?.[0]?.count || 0;
        const parentCategory = categories.find(c => c.category_id === category.parent_category_id);
        const createdDate = category.created_at ? 
            new Date(category.created_at).toLocaleDateString() : 'N/A';
        
        return `
            <tr data-category-id="${category.category_id}">
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-folder" style="color: var(--primary-color);"></i>
                        <strong>${category.category_name}</strong>
                    </div>
                </td>
                <td>${category.description || '-'}</td>
                <td>${parentCategory ? parentCategory.category_name : '-'}</td>
                <td>
                    <span class="product-count-badge">${productCount} products</span>
                </td>
                <td>${createdDate}</td>
                <td>
                    <div class="action-btns">
                        <button class="icon-btn edit-btn" data-id="${category.category_id}" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="icon-btn delete delete-btn" data-id="${category.category_id}" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => editCategory(btn.dataset.id));
    });
    
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteCategory(btn.dataset.id));
    });
}

function populateParentCategories(categories) {
    const parentSelect = document.getElementById('parent-category');
    parentSelect.innerHTML = '<option value="">None (Top Level)</option>';
    categories.forEach(cat => {
        if (currentEditingCategoryId && cat.category_id === currentEditingCategoryId) {
            return;
        }
        const option = new Option(cat.category_name, cat.category_id);
        parentSelect.add(option);
    });
}

function setupEventListeners() {
    document.getElementById('back-to-inventory-btn').addEventListener('click', () => {
        window.location.href = 'inventory.html';
    });

    document.getElementById('category-search').addEventListener('input', (e) => {
        loadCategories(e.target.value);
    });

    document.getElementById('add-category-btn').addEventListener('click', () => {
        currentEditingCategoryId = null;
        document.getElementById('modal-title').textContent = 'Add New Category';
        document.getElementById('category-form').reset();
        document.getElementById('category-modal').classList.add('active');
    });

    document.getElementById('close-category-modal').addEventListener('click', closeModal);
    document.getElementById('cancel-category-btn').addEventListener('click', closeModal);
    document.getElementById('category-form').addEventListener('submit', saveCategory);
    document.getElementById('category-modal').addEventListener('click', (e) => {
        if (e.target.id === 'category-modal') {
            closeModal();
        }
    });
}

function closeModal() {
    document.getElementById('category-modal').classList.remove('active');
    document.getElementById('category-form').reset();
    currentEditingCategoryId = null;
}

async function saveCategory(e) {
    e.preventDefault();
    
    const categoryData = {
        category_name: document.getElementById('category-name').value.trim(),
        description: document.getElementById('category-description').value.trim() || null,
        parent_category_id: document.getElementById('parent-category').value || null
    };
    
    try {
        if (currentEditingCategoryId) {
            const { error } = await supabaseClient
                .from('categories')
                .update(categoryData)
                .eq('category_id', currentEditingCategoryId);
            
            if (error) throw error;
            alert('Category updated successfully!');
        } else {
            const { error } = await supabaseClient
                .from('categories')
                .insert([categoryData]);
            
            if (error) throw error;
            alert('Category added successfully!');
        }
        
        closeModal();
        await loadCategories();
        
    } catch (error) {
        console.error('Error saving category:', error);
        alert('Error saving category: ' + error.message);
    }
}

async function editCategory(categoryId) {
    try {
        const { data: category, error } = await supabaseClient
            .from('categories')
            .select('*')
            .eq('category_id', categoryId)
            .single();
        
        if (error) throw error;
        if (!category) throw new Error('Category not found');
        
        currentEditingCategoryId = categoryId;
        document.getElementById('modal-title').textContent = 'Edit Category';
        document.getElementById('category-name').value = category.category_name;
        document.getElementById('category-description').value = category.description || '';
        document.getElementById('parent-category').value = category.parent_category_id || '';
        
        document.getElementById('category-modal').classList.add('active');
        
    } catch (error) {
        console.error('Error loading category:', error);
        alert('Error loading category: ' + error.message);
    }
}

async function deleteCategory(categoryId) {
    try {
        const { data: products } = await supabaseClient
            .from('products')
            .select('product_id')
            .eq('category_id', categoryId);
        
        if (products && products.length > 0) {
            alert(`Cannot delete this category. It has ${products.length} product(s) assigned to it. Please reassign or delete the products first.`);
            return;
        }
        
        if (!confirm('Are you sure you want to delete this category?')) return;
        
        const { error } = await supabaseClient
            .from('categories')
            .delete()
            .eq('category_id', categoryId);
        
        if (error) throw error;
        
        alert('Category deleted successfully!');
        await loadCategories();
        
    } catch (error) {
        console.error('Error deleting category:', error);
        alert('Error deleting category: ' + error.message);
    }
}

function setupRealtimeSubscriptions() {
    supabaseClient
        .channel('categories_changes')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'categories' },
            () => loadCategories(document.getElementById('category-search').value)
        )
        .subscribe();
}