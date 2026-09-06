// Product selection and non-sale stock removal.
let selectedOutboundProduct = null;
let outboundProducts = [];
let outboundSubmitting = false;

function initializeOutbound() { setupOutboundEventListeners(); }

async function loadProductsForOutbound() {
    outboundProducts = [];
    document.getElementById('outbound-product-results').replaceChildren();
    const status = document.getElementById('outbound-results-status');
    status.textContent = 'Loading products...';
    try {
        const { data, error } = await supabaseClient.from('products')
            .select('product_id, product_name, product_code, unit_of_measure, image_url, image_path, category_id, inventory_stock!inventory_stock_product_id_fkey(stock_id, quantity)')
            .eq('is_active', true).order('product_name');
        if (error) throw error;
        const { data: categories, error: categoryError } = await supabaseClient.from('categories')
            .select('category_id, category_name').order('category_name');
        if (categoryError) throw categoryError;
        const categorySelect = document.getElementById('outbound-category');
        categorySelect.replaceChildren(new Option('All Categories', ''));
        for (const category of categories || []) {
            categorySelect.add(new Option(category.category_name, category.category_id));
        }
        outboundProducts = (data || []).map(product => ({ ...product,
            quantity: Number((Array.isArray(product.inventory_stock) ? product.inventory_stock[0] : product.inventory_stock)?.quantity || 0)
        })).filter(product => product.quantity > 0);
        renderOutboundProducts();
    } catch (error) {
        status.textContent = 'Could not load products. Close and reopen this window to retry.';
        console.error('Error loading removal products:', error);
    }
}

function filterOutboundProducts(products, search, category) {
    const query = search.trim().toLowerCase();
    return products.filter(product => (!category || product.category_id === category)
        && `${product.product_name} ${product.product_code || ''}`.toLowerCase().includes(query));
}

function renderOutboundProducts() {
    const matches = filterOutboundProducts(outboundProducts,
        document.getElementById('outbound-search').value,
        document.getElementById('outbound-category').value);
    const results = document.getElementById('outbound-product-results');
    results.replaceChildren();
    document.getElementById('outbound-results-status').textContent = matches.length
        ? `${matches.length} products available. Select a product below.`
        : 'No products match. Try another name, code, or category.';
    for (const product of matches) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'outbound-product-row';
        appendOutboundProduct(row, product);
        row.addEventListener('click', () => selectOutboundProduct(product));
        results.appendChild(row);
    }
}

function appendOutboundProduct(container, product) {
    const thumbnail = document.createElement('span');
    thumbnail.className = 'outbound-thumbnail';
    thumbnail.innerHTML = '<i class="fas fa-box" aria-hidden="true"></i>';
    let imageUrl = product.image_url;
    if (!imageUrl && product.image_path) {
        imageUrl = /^https?:\/\//i.test(product.image_path) ? product.image_path
            : supabaseClient.storage.from('product-images').getPublicUrl(product.image_path.replace(/^product-images\//, '')).data.publicUrl;
    }
    if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
        const image = document.createElement('img');
        image.src = imageUrl;
        image.alt = '';
        image.loading = 'lazy';
        image.addEventListener('error', () => image.remove());
        thumbnail.appendChild(image);
    }
    const details = document.createElement('span');
    details.className = 'outbound-product-info';
    const name = document.createElement('strong');
    name.textContent = product.product_name;
    const code = document.createElement('small');
    code.textContent = product.product_code || 'No product code';
    const stock = document.createElement('small');
    stock.textContent = `Available: ${product.quantity} ${product.unit_of_measure || 'PCS'}`;
    details.append(name, code, stock);
    container.append(thumbnail, details);
}

function selectOutboundProduct(product) {
    selectedOutboundProduct = product;
    const display = document.getElementById('outbound-product-display');
    display.replaceChildren();
    appendOutboundProduct(display, product);
    const change = document.createElement('button');
    change.type = 'button';
    change.className = 'btn';
    change.textContent = 'Change';
    change.addEventListener('click', clearSelectedProduct);
    display.appendChild(change);
    display.hidden = false;
    document.getElementById('outbound-product-picker').hidden = true;
    const quantity = document.getElementById('outbound-quantity');
    quantity.disabled = false;
    quantity.max = product.quantity;
    quantity.value = '';
    calculateOutboundTotal();
    quantity.focus();
}

function clearSelectedProduct() {
    selectedOutboundProduct = null;
    document.getElementById('outbound-product-display').hidden = true;
    document.getElementById('outbound-product-picker').hidden = false;
    const quantity = document.getElementById('outbound-quantity');
    quantity.value = '';
    quantity.disabled = true;
    quantity.removeAttribute('max');
    calculateOutboundTotal();
    document.getElementById('outbound-search').focus();
}

// Setup event listeners
function setupOutboundEventListeners() {
    // Open modal button
    const createOutboundBtn = document.getElementById('create-outbound-btn');
    if (createOutboundBtn) {
        createOutboundBtn.addEventListener('click', openOutboundModal);
    }

    // Close modal buttons
    const closeBtn = document.getElementById('close-outbound-modal');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeOutboundModal);
    }

    const cancelBtn = document.getElementById('cancel-outbound-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeOutboundModal);
    }

    // Quantity input change
    const quantityInput = document.getElementById('outbound-quantity');
    if (quantityInput) {
        quantityInput.addEventListener('input', calculateOutboundTotal);
    }

    document.getElementById('outbound-search').addEventListener('input', renderOutboundProducts);
    document.getElementById('outbound-category').addEventListener('change', renderOutboundProducts);

    // Form submit
    const outboundForm = document.getElementById('outbound-form');
    if (outboundForm) {
        outboundForm.addEventListener('submit', submitOutboundOrder);
    }
}

// Open outbound modal
function openOutboundModal() {
    console.log('Opening outbound modal');
    selectedOutboundProduct = null;
    clearSelectedProduct();
    
    // Reset form
    const form = document.getElementById('outbound-form');
    if (form) {
        form.reset();
    }

    // Reload products
    loadProductsForOutbound();

    const modal = document.getElementById('outbound-modal');
    if (modal) {
        modal.classList.add('active');
        document.getElementById('outbound-search').focus();
    }
}

// Close outbound modal
function closeOutboundModal() {
    if (outboundSubmitting) return;
    const modal = document.getElementById('outbound-modal');
    if (modal) {
        modal.classList.remove('active');
    }
    selectedOutboundProduct = null;
}

// Preview the stock remaining without changing inventory.
function calculateOutboundTotal() {
    const input = document.getElementById('outbound-quantity');
    const preview = document.getElementById('outbound-remaining');
    const quantity = Number(input.value);
    const valid = selectedOutboundProduct && Number.isInteger(quantity)
        && quantity > 0 && quantity <= selectedOutboundProduct.quantity;
    input.setCustomValidity(input.value && !valid ? 'Enter a whole quantity within the available stock.' : '');
    document.getElementById('outbound-submit').disabled = !valid || outboundSubmitting;
    preview.textContent = !selectedOutboundProduct ? 'Select a product to see available stock.'
        : !input.value ? `Available: ${selectedOutboundProduct.quantity} ${selectedOutboundProduct.unit_of_measure || 'PCS'}`
        : valid ? `Available: ${selectedOutboundProduct.quantity} → Remaining: ${selectedOutboundProduct.quantity - quantity} ${selectedOutboundProduct.unit_of_measure || 'PCS'}`
        : 'Enter a whole quantity within the available stock.';
}

// Submit outbound order
async function submitOutboundOrder(e) {
    e.preventDefault();
    if (outboundSubmitting) return;
    
    console.log('Submitting outbound order...');
    
    if (!selectedOutboundProduct) {
        alert('Please select a product');
        return;
    }

    const quantityInput = document.getElementById('outbound-quantity');
    const outboundType = document.getElementById('outbound-type').value;
    const outboundReference = document.getElementById('outbound-reference').value.trim() || `REM-${crypto.randomUUID()}`;
    const outboundNotes = document.getElementById('outbound-notes').value;

    const dispatchQty = Number(quantityInput.value);

    if (!Number.isInteger(dispatchQty) || dispatchQty <= 0 || dispatchQty > selectedOutboundProduct.quantity) {
        alert('Please enter a valid quantity (greater than 0)');
        return;
    }

    if (!outboundType) {
        alert('Please fill in all required fields');
        return;
    }

    console.log('Processing outbound:', {
        outboundType,
        outboundReference,
        product: selectedOutboundProduct,
        quantity: dispatchQty,
        notes: outboundNotes
    });

    outboundSubmitting = true;
    document.getElementById('outbound-submit').disabled = true;
    const controls = [...document.querySelectorAll('#outbound-form input, #outbound-form select, #outbound-form textarea, #outbound-form button, #close-outbound-modal')];
    controls.forEach(control => control.disabled = true);
    try {
        // Get current user session
        const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
        
        if (sessionError) {
            console.error('Error getting session:', sessionError);
            throw new Error('Authentication error. Please log in again.');
        }
        
        if (!session) {
            throw new Error('Please sign in before removing stock.');
        }
        
        const performedBy = session.user.id;

        // Get current stock from inventory_stock table
        const { data: currentStock, error: fetchError } = await supabaseClient
            .from('inventory_stock')
            .select('stock_id, quantity')
            .eq('product_id', selectedOutboundProduct.product_id)
            .single();

        if (fetchError) {
            console.error('Error fetching current stock:', fetchError);
            throw new Error(`Failed to fetch stock: ${fetchError.message}`);
        }

        console.log('Current stock before update:', currentStock);

        // Calculate new quantity
        const newQuantity = currentStock.quantity - dispatchQty;
        
        // Validate stock
        if (newQuantity < 0) {
            throw new Error(`Insufficient stock. Available: ${currentStock.quantity}, Requested: ${dispatchQty}`);
        }

        console.log(`Updating stock: ${currentStock.quantity} -> ${newQuantity}`);

        // Update inventory_stock table
        const { data: updatedStock, error: updateError } = await supabaseClient
            .from('inventory_stock')
            .update({
                quantity: newQuantity,
                updated_at: new Date().toISOString()
            })
            .eq('product_id', selectedOutboundProduct.product_id)
            .select();

        if (updateError) {
            console.error('Error updating stock:', updateError);
            throw new Error(`Failed to update stock: ${updateError.message}`);
        }

        console.log('Stock updated successfully:', updatedStock);

        // Create stock movement record
        const movementNotes = outboundNotes 
            ? `${outboundType}: ${outboundReference} | ${outboundNotes}`
            : `${outboundType}: ${outboundReference}`;
        
        const movementData = {
            product_id: selectedOutboundProduct.product_id,
            movement_type: 'outbound',
            reference_type: 'outbound_order',
            reference_id: outboundReference,
            quantity_change: -dispatchQty,
            quantity_before: currentStock.quantity,
            quantity_after: newQuantity,
            notes: movementNotes,
            movement_date: new Date().toISOString(),
            performed_by: performedBy
        };

        console.log('Creating stock movement:', movementData);

        const { data: movement, error: movementError } = await supabaseClient
            .from('stock_movements')
            .insert([movementData])
            .select();

        if (movementError) {
            console.error('Error creating movement record:', movementError);
            throw new Error(`Failed to create movement record: ${movementError.message}`);
        }

        console.log('Movement record created:', movement);

        // Success
        console.log('Outbound transaction completed successfully');
        
        alert(`✓ Stock removed successfully!\n\nProduct: ${selectedOutboundProduct.product_name}\nDocument number: ${outboundReference}\nReason: ${outboundType}\nQuantity removed: ${dispatchQty}`);
        
        outboundSubmitting = false;
        closeOutboundModal();
        
        // Reload inventory to show updated quantities
        if (typeof loadInventory === 'function' && typeof getFilters === 'function') {
            console.log('Reloading inventory...');
            await loadInventory(getFilters());
        }

    } catch (error) {
        console.error('Error processing outbound transaction:', error);
        alert('✖ Stock could not be removed:\n\n' + error.message);
    } finally {
        outboundSubmitting = false;
        controls.forEach(control => control.disabled = false);
        quantityInput.disabled = !selectedOutboundProduct;
        calculateOutboundTotal();
    }
}

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        console.log('Initializing outbound module...');
        initializeOutbound();
    }, 100);
});
