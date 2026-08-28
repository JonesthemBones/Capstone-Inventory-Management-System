let currentCart = [];
let currentUserRole = null;
let currentUserId = null;
let currentTransaction = null;

// Roles allowed to use the POS terminal
const POS_ALLOWED_ROLES = ['cashier', 'admin', 'manager'];

document.addEventListener('DOMContentLoaded', async () => {
    const session = await window.authHelpers.requireAuth();
    if (!session) return;
    await loadPosUserInfo();
    if (!POS_ALLOWED_ROLES.includes(currentUserRole)) {
        alert('Access denied. Only cashiers and admins can use POS.');
        redirectByRole(currentUserRole);
        return;
    }
    window.authHelpers.revealProtectedContent();
    
    setupEventListeners();
    setupKeyboardShortcuts();
    handleProductSearch({ target: document.getElementById('product-search') });
    loadTodaysTransactions();
    await handlePayMongoReturn();
});

// Send a rejected user to the page that's actually theirs, matching index.js's routing
function redirectByRole(role) {
    const target = '../pages/dashboard.html';
    window.location.href = target;
}

async function loadPosUserInfo() {
    try {
        // Fetch the role directly instead of polling window.currentUserRole.
        // Depending on sidebar.js to populate that global in time is a race
        // condition — sidebar.js does its own network round trips first, and
        // there's no guarantee it wins before pos.js needs the answer. Doing
        // our own lookup (same query + lowercasing sidebar.js uses) makes
        // this reliable regardless of load order or timing.
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

        if (authError || !user) {
            currentUserRole = window.currentUserRole || 'staff';
            currentUserId = null;
            console.warn('Could not resolve authenticated user for role lookup:', authError?.message);
            return;
        }

        const { data: userProfile, error: dbError } = await supabaseClient
            .from('users')
            .select('role')
            .eq('user_id', user.id)
            .maybeSingle();

        currentUserRole = (!dbError && userProfile?.role)
            ? userProfile.role.toLowerCase()
            : (window.currentUserRole || 'staff');

        currentUserId = user.id;
        console.log('Loaded user info:', { role: currentUserRole, userId: currentUserId });
    } catch (error) {
        console.error('Error loading user info:', error);
        currentUserRole = 'staff';
    }
}

function setupEventListeners() {
    // Product search
    const productSearch = document.getElementById('product-search');
    productSearch.addEventListener('input', debounce(handleProductSearch, 250));
    productSearch.addEventListener('keydown', handleSearchKeydown);

    const stockFilter = document.getElementById('pos-stock-filter');
    if (stockFilter) {
        stockFilter.addEventListener('change', () => handleProductSearch({ target: productSearch }));
    }
    ['pos-unit-filter', 'pos-sort'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => handleProductSearch({ target: productSearch }));
    });
    ['pos-min-price', 'pos-max-price'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', debounce(() => handleProductSearch({ target: productSearch }), 250));
    });
    document.getElementById('pos-reset-filters')?.addEventListener('click', () => {
        productSearch.value = '';
        document.getElementById('pos-stock-filter').value = 'available';
        document.getElementById('pos-unit-filter').value = '';
        document.getElementById('pos-min-price').value = '';
        document.getElementById('pos-max-price').value = '';
        document.getElementById('pos-sort').value = 'name_asc';
        handleProductSearch({ target: productSearch });
    });

    const mobileFilterToggle = document.getElementById('pos-mobile-filter-toggle');
    const posToolbar = document.getElementById('pos-toolbar');
    mobileFilterToggle?.addEventListener('click', () => {
        const isOpen = posToolbar.classList.toggle('mobile-open');
        mobileFilterToggle.setAttribute('aria-expanded', String(isOpen));
    });

    document.getElementById('pos-mobile-cart-bar')?.addEventListener('click', openMobileCart);
    document.getElementById('pos-cart-close')?.addEventListener('click', closeMobileCart);
    document.getElementById('pos-cart-overlay')?.addEventListener('click', closeMobileCart);

    document.getElementById('product-grid').addEventListener('click', event => {
        const card = event.target.closest('.product-card-grid');
        if (!card || card.disabled) return;
        addToCart(card.dataset.productId, card.dataset.productName,
            Number(card.dataset.price), Number(card.dataset.availableQuantity));
    });
    
    // Cart interactions
    document.getElementById('clear-cart-btn').addEventListener('click', clearCart);
    document.getElementById('checkout-btn').addEventListener('click', handleCheckout);
    
    // Payment method change
    document.getElementById('payment-method').addEventListener('change', handlePaymentMethodChange);
    
    // Discount and tender inputs
    document.getElementById('discount-input').addEventListener('input', updateCartSummary);
    document.getElementById('tender-amount').addEventListener('input', updateChangeDisplay);
    
    // Escape key to clear search
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (document.body.classList.contains('pos-cart-open')) {
                closeMobileCart();
                return;
            }
            document.getElementById('product-search').value = '';
            document.getElementById('product-suggestions').innerHTML = '';
            handleProductSearch({ target: document.getElementById('product-search') });
        }
    });

    handlePaymentMethodChange({ target: document.getElementById('payment-method') });
}

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl+S or Cmd+S for checkout
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            if (currentCart.length > 0) {
                handleCheckout();
            }
        }
        
        // Escape to clear cart
        if (e.key === 'Escape' && currentCart.length === 0) {
            clearCart();
        }
    });
}

async function getProductStockQuantity(productId) {
    if (!productId) return 0;

    try {
        const { data, error } = await supabaseClient
            .from('inventory_stock')
            .select('quantity')
            .eq('product_id', productId)
            .maybeSingle();

        if (error) {
            if (error.code !== 'PGRST116') {
                throw error;
            }
            return 0;
        }

        return Number(data?.quantity ?? 0);
    } catch (error) {
        console.error(`Error loading stock for product ${productId}:`, error);
        return 0;
    }
}

function getProductImageUrl(imagePath) {
    if (!imagePath) return null;
    if (imagePath.startsWith('http')) return imagePath;

    const storageBaseUrl = 'https://wxhkhxsxftundtrahpst.supabase.co/storage/v1/object/public/product-images';
    const relativePath = imagePath.replace(/^product-images\//, '');
    return `${storageBaseUrl}/${relativePath}`;
}

function openMobileCart() {
    if (window.innerWidth > 768) return;
    document.body.classList.add('pos-cart-open');
    document.getElementById('pos-mobile-cart-bar')?.setAttribute('aria-expanded', 'true');
    document.getElementById('pos-cart-overlay')?.setAttribute('aria-hidden', 'false');
    document.getElementById('pos-cart-close')?.focus();
}

function closeMobileCart() {
    document.body.classList.remove('pos-cart-open');
    document.getElementById('pos-mobile-cart-bar')?.setAttribute('aria-expanded', 'false');
    document.getElementById('pos-cart-overlay')?.setAttribute('aria-hidden', 'true');
}

function getPOSProductQuantity(product) {
    const inventory = Array.isArray(product.inventory_stock) ? (product.inventory_stock[0] || {}) : (product.inventory_stock || {});
    return Number(inventory.quantity || 0);
}

function getPOSStockStatus(product) {
    const quantity = getPOSProductQuantity(product);
    const reorderLevel = Number(product.reorder_level ?? 10);
    if (quantity <= 0) return 'out_of_stock';
    if (quantity <= reorderLevel) return 'low_stock';
    return 'in_stock';
}

function updatePOSUnitOptions(products) {
    const select = document.getElementById('pos-unit-filter');
    if (!select) return;
    const selected = select.value;
    const units = [...new Set((products || []).map(product => String(product.unit_of_measure || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
    select.replaceChildren(new Option('All units', ''), ...units.map(unit => new Option(unit, unit)));
    if (units.includes(selected)) select.value = selected;
}

function renderProductGrid(products) {
    const productGrid = document.getElementById('product-grid');
    if (!productGrid) return;

    if (!products || products.length === 0) {
        productGrid.innerHTML = '<div class="product-empty-state"><i class="fas fa-box-open"></i><p>No products match your filters.</p></div>';
        return;
    }

    productGrid.innerHTML = products.map(product => {
        const quantity = getPOSProductQuantity(product);
        const stockStatus = getPOSStockStatus(product).replaceAll('_', '-');
        const imageUrl = product.image_url || getProductImageUrl(product.image_path);
        const safeName = escapeHTML(product.product_name);
        const safeCode = escapeHTML(product.product_code || 'N/A');
        const safeImageUrl = escapeHTML(imageUrl || '');
        const imageMarkup = imageUrl
            ? `<img src="${safeImageUrl}" alt="${safeName}" onerror="this.onerror=null; this.src='https://via.placeholder.com/220?text=No+Image';">`
            : `<div class="product-card-image-placeholder"><i class="fas fa-image"></i></div>`;

        return `
            <button class="product-card-grid" type="button"
                data-product-id="${escapeHTML(product.product_id)}"
                data-product-name="${safeName}"
                data-price="${Number(product.selling_price || 0)}"
                data-available-quantity="${quantity}"
                ${quantity <= 0 ? 'disabled aria-disabled="true"' : ''}>
                <div class="product-card-image ${imageUrl ? '' : 'placeholder'}">
                    ${imageMarkup}
                    <span class="stock-badge ${stockStatus}">${quantity} in stock</span>
                </div>
                <div class="product-card-info">
                    <div class="product-card-name">${safeName}</div>
                    <div class="product-card-code">${safeCode}</div>
                    <div class="product-card-footer">
                        <div class="product-card-price">₱${Number(product.selling_price || 0).toFixed(2)}</div>
                        <span class="product-card-add" aria-hidden="true"><i class="fas fa-plus"></i></span>
                    </div>
                </div>
            </button>
        `;
    }).join('');
}

async function handleProductSearch(e) {
    const productSearch = document.getElementById('product-search');
    const query = (e?.target?.value || productSearch?.value || '').trim();
    const suggestionsDiv = document.getElementById('product-suggestions');
    const productGrid = document.getElementById('product-grid');
    const stockFilter = document.getElementById('pos-stock-filter');
    const filterValue = stockFilter ? stockFilter.value : 'available';
    const unitFilter = document.getElementById('pos-unit-filter')?.value || '';
    const minPrice = document.getElementById('pos-min-price')?.value ?? '';
    const maxPrice = document.getElementById('pos-max-price')?.value ?? '';
    const sortValue = document.getElementById('pos-sort')?.value || 'name_asc';

    if (query.length >= 2 && suggestionsDiv) {
        suggestionsDiv.innerHTML = '';
    }

    try {
        let productQuery = supabaseClient
            .from('products')
            .select(`
                product_id,
                product_code,
                product_name,
                selling_price,
                image_url,
                image_path,
                unit_of_measure,
                reorder_level,
                is_active,
                inventory_stock!inventory_stock_product_id_fkey(quantity)
            `)
            .eq('is_active', true)
            .order('product_name');

        if (query.length >= 2) {
            productQuery = productQuery.or(`product_name.ilike.%${query}%,product_code.ilike.%${query}%`);
        }

        const { data: products, error } = await productQuery;
        if (error) throw error;

        updatePOSUnitOptions(products);
        const filteredProducts = (products || []).filter(product => {
            const quantity = getPOSProductQuantity(product);
            const price = Number(product.selling_price || 0);
            const status = getPOSStockStatus(product);
            if (filterValue === 'available' && quantity <= 0) return false;
            if (['in_stock', 'low_stock', 'out_of_stock'].includes(filterValue) && status !== filterValue) return false;
            if (unitFilter && product.unit_of_measure !== unitFilter) return false;
            if (minPrice !== '' && price < Number(minPrice)) return false;
            if (maxPrice !== '' && price > Number(maxPrice)) return false;
            return true;
        });

        const sorters = {
            name_asc: (a, b) => String(a.product_name || '').localeCompare(String(b.product_name || '')),
            name_desc: (a, b) => String(b.product_name || '').localeCompare(String(a.product_name || '')),
            price_asc: (a, b) => Number(a.selling_price || 0) - Number(b.selling_price || 0),
            price_desc: (a, b) => Number(b.selling_price || 0) - Number(a.selling_price || 0),
            stock_desc: (a, b) => getPOSProductQuantity(b) - getPOSProductQuantity(a)
        };
        filteredProducts.sort(sorters[sortValue] || sorters.name_asc);

        renderProductGrid(filteredProducts);
        if (suggestionsDiv) {
            suggestionsDiv.style.display = 'none';
        }

        if (query.length >= 2 && filteredProducts.length === 0 && productGrid) {
            productGrid.innerHTML = '<div class="product-empty-state"><i class="fas fa-box-open"></i><p>No products found.</p></div>';
        }
    } catch (error) {
        console.error('Error searching products:', error);
        if (productGrid) {
            productGrid.innerHTML = '<div class="product-empty-state"><i class="fas fa-exclamation-circle"></i><p>Unable to load products.</p></div>';
        }
    }
}

function handleSearchKeydown(e) {
    if (e.key === 'Enter') {
        const firstSuggestion = document.querySelector('.suggestion-item');
        if (firstSuggestion && !firstSuggestion.classList.contains('no-results')) {
            firstSuggestion.click();
        }
    }
}

function addToCart(productId, productName, price, availableQuantity) {
    if (!productId || !Number.isFinite(price) || availableQuantity <= 0) {
        alert('This product is currently out of stock and cannot be added.');
        return;
    }
    // Check if product already in cart
    const existingItem = currentCart.find(item => item.productId === productId);
    
    if (existingItem) {
        if (existingItem.quantity < availableQuantity) {
            existingItem.quantity++;
        } else {
            alert(`Cannot add more. Only ${availableQuantity} available in stock.`);
        }
    } else {
        currentCart.push({
            productId,
            productName,
            price: parseFloat(price),
            quantity: 1,
            availableQuantity
        });
    }
    
    // Clear search
    document.getElementById('product-search').value = '';
    document.getElementById('product-suggestions').innerHTML = '';
    
    updateCartDisplay();
    updateCartSummary();
}

function removeFromCart(productId) {
    currentCart = currentCart.filter(item => item.productId !== productId);
    updateCartDisplay();
    updateCartSummary();
}

function updateItemQuantity(productId, newQuantity) {
    const item = currentCart.find(item => item.productId === productId);
    if (!item) return;
    
    newQuantity = parseInt(newQuantity);
    
    if (newQuantity <= 0) {
        removeFromCart(productId);
        return;
    }
    
    if (newQuantity > item.availableQuantity) {
        alert(`Cannot add more. Only ${item.availableQuantity} available in stock.`);
        return;
    }
    
    item.quantity = newQuantity;
    updateCartDisplay();
    updateCartSummary();
}

function updateCartDisplay() {
    const cartDiv = document.getElementById('cart-items');
    
    if (currentCart.length === 0) {
        cartDiv.innerHTML = `
            <div class="empty-cart">
                <i class="fas fa-shopping-cart"></i>
                <p>Cart is empty</p>
            </div>
        `;
        return;
    }
    
    cartDiv.innerHTML = currentCart.map((item, index) => {
        const subtotal = item.price * item.quantity;
        return `
            <div class="cart-item">
                <div class="cart-item-header">
                    <h4>${escapeHTML(item.productName)}</h4>
                    <button class="btn-icon" onclick="removeFromCart('${item.productId}')">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
                <div class="cart-item-details">
                    <div class="item-detail">
                        <span>Price:</span>
                        <span>₱${item.price.toFixed(2)}</span>
                    </div>
                    <div class="item-detail">
                        <span>Quantity:</span>
                        <input 
                            type="number" 
                            class="qty-input"
                            value="${item.quantity}" 
                            min="1" 
                            max="${item.availableQuantity}"
                            onchange="updateItemQuantity('${item.productId}', this.value)"
                        >
                    </div>
                    <div class="item-detail subtotal">
                        <span>Subtotal:</span>
                        <span>₱${subtotal.toFixed(2)}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function updateCartSummary() {
    const discountAmount = parseFloat(document.getElementById('discount-input').value) || 0;
    const { subtotal, tax, total } = POSCalculations.calculateTotals(currentCart, discountAmount);

    document.getElementById('summary-subtotal').textContent = POSCalculations.formatCurrency(subtotal);
    document.getElementById('summary-discount').textContent = `-${POSCalculations.formatCurrency(discountAmount)}`;
    document.getElementById('summary-tax').textContent = POSCalculations.formatCurrency(tax);
    document.getElementById('summary-total').textContent = POSCalculations.formatCurrency(total);

    const itemCount = currentCart.reduce((sum, item) => sum + item.quantity, 0);
    const mobileCount = document.getElementById('mobile-cart-count');
    const mobileTotal = document.getElementById('mobile-cart-total');
    if (mobileCount) mobileCount.textContent = itemCount === 0
        ? 'Cart is empty'
        : `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
    if (mobileTotal) mobileTotal.textContent = POSCalculations.formatCurrency(total);
    document.getElementById('pos-mobile-cart-bar')?.classList.toggle('has-items', itemCount > 0);

    // If cash payment, recalculate change
    if (document.getElementById('payment-method').value === 'cash') {
        updateChangeDisplay();
    }
}

function clearCart(force = false) {
    if (currentCart.length === 0) return;
    
    if (force || confirm('Clear all items from cart?')) {
        currentCart = [];
        document.getElementById('discount-input').value = '';
        document.getElementById('tender-amount').value = '';
        updateCartDisplay();
        updateCartSummary();
        document.getElementById('product-search').focus();
    }
}


function handlePaymentMethodChange(e) {
    const paymentMethod = e.target.value;
    const tenderSection = document.getElementById('tender-section');
    
    if (paymentMethod === 'cash') {
        tenderSection.style.display = 'block';
        document.getElementById('tender-amount').focus();
    } else {
        tenderSection.style.display = 'none';
        document.getElementById('tender-amount').value = '';
    }
}

function updateChangeDisplay() {
    const discountAmount = parseFloat(document.getElementById('discount-input').value) || 0;
    const calculatedTotal = POSCalculations.calculateTotals(currentCart, discountAmount).total;
    const tender = parseFloat(document.getElementById('tender-amount').value) || 0;
    const change = POSCalculations.calculateChange(calculatedTotal, tender);

    const changeDisplay = document.getElementById('change-amount');
    changeDisplay.textContent = POSCalculations.formatCurrency(change);

    if (tender < calculatedTotal) {
        changeDisplay.style.color = 'var(--color-danger)';
    } else {
        changeDisplay.style.color = 'var(--color-success)';
    }
}

const PAYMONGO_PENDING_KEY = 'amacar_pending_paymongo_checkout';

async function startPayMongoCheckout(discountAmount) {
    const checkoutBtn = document.getElementById('checkout-btn');
    const { total } = POSCalculations.calculateTotals(currentCart, discountAmount);
    const referenceNumber = `TXN-${Date.now()}`;
    checkoutBtn.disabled = true;

    try {
        const response = await fetch('/api/paymongo/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: Math.round(total * 100),
                referenceNumber
            })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to start PayMongo checkout.');

        sessionStorage.setItem(PAYMONGO_PENDING_KEY, JSON.stringify({
            checkoutId: result.checkoutId,
            referenceNumber,
            cart: currentCart,
            discountAmount
        }));
        window.location.assign(result.checkoutUrl);
    } catch (error) {
        console.error('Error starting PayMongo checkout:', error);
        alert(error.message);
        checkoutBtn.disabled = false;
    }
}

async function handlePayMongoReturn() {
    const returnStatus = new URLSearchParams(window.location.search).get('paymongo');
    if (!returnStatus) return;

    const stored = sessionStorage.getItem(PAYMONGO_PENDING_KEY);
    const pending = stored ? JSON.parse(stored) : null;
    history.replaceState({}, document.title, window.location.pathname);

    if (!pending) {
        alert('The pending PayMongo checkout could not be found in this browser session.');
        return;
    }

    currentCart = pending.cart || [];
    document.getElementById('discount-input').value = pending.discountAmount || '';
    document.getElementById('payment-method').value = 'bank_transfer';
    handlePaymentMethodChange({ target: document.getElementById('payment-method') });
    updateCartDisplay();
    updateCartSummary();

    if (returnStatus === 'cancelled') {
        sessionStorage.removeItem(PAYMONGO_PENDING_KEY);
        alert('QR payment was cancelled. The cart has been restored.');
        return;
    }

    const checkoutBtn = document.getElementById('checkout-btn');
    checkoutBtn.disabled = true;
    try {
        const response = await fetch(`/api/paymongo/checkout/${encodeURIComponent(pending.checkoutId)}`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to verify PayMongo payment.');
        if (!result.paid || result.referenceNumber !== pending.referenceNumber) {
            throw new Error('PayMongo has not confirmed this payment as paid. The cart was not finalized.');
        }

        const transaction = await createPOSTransaction({
            paymentMethod: 'bank_transfer',
            transactionNumber: pending.referenceNumber
        });
        currentTransaction = transaction;
        sessionStorage.removeItem(PAYMONGO_PENDING_KEY);
        await loadTodaysTransactions();
        displayReceipt(transaction);
        clearCart(true);
        await handleProductSearch({ target: document.getElementById('product-search') });
    } catch (error) {
        console.error('Error verifying PayMongo checkout:', error);
        alert(error.message);
    } finally {
        checkoutBtn.disabled = false;
    }
}

async function handleCheckout() {
    if (currentCart.length === 0) {
        alert('Cart is empty. Add items to proceed.');
        return;
    }

    const discountAmount = parseFloat(document.getElementById('discount-input').value) || 0;

    const subtotal = POSCalculations.calculateSubtotal(currentCart);
    if (discountAmount < 0 || discountAmount > subtotal) {
        alert('Discount must be between zero and the order subtotal.');
        document.getElementById('discount-input').focus();
        return;
    }

    if (POSCalculations.requiresDiscountApproval(discountAmount)) {
        const approved = confirm(
            `This discount of ${POSCalculations.formatCurrency(discountAmount)} exceeds the ` +
            `${POSCalculations.formatCurrency(POSCalculations.MIN_DISCOUNT_APPROVAL_AMOUNT)} approval threshold ` +
            `and requires manager sign-off.\n\nConfirm a manager has approved this discount?`
        );
        if (!approved) {
            return;
        }
    }

    const paymentMethod = document.getElementById('payment-method').value;
    
    // Validate payment method
    if (paymentMethod === 'cash') {
        const tender = parseFloat(document.getElementById('tender-amount').value) || 0;
        const calculatedTotal = POSCalculations.calculateTotals(currentCart, discountAmount).total;
        if (tender === 0) {
            alert('Please enter tender amount.');
            document.getElementById('tender-amount').focus();
            return;
        }
        
        if (tender < calculatedTotal) {
            alert('Tender amount is insufficient.');
            return;
        }
    }

    if (paymentMethod === 'bank_transfer') {
        await startPayMongoCheckout(discountAmount);
        return;
    }
    
    // Disable button to prevent double-click
    const checkoutBtn = document.getElementById('checkout-btn');
    checkoutBtn.disabled = true;
    
    try {
        // Create POS transaction
        const transaction = await createPOSTransaction();
        
        if (transaction) {
            currentTransaction = transaction;
            await loadTodaysTransactions();
            displayReceipt(transaction);
            clearCart(true);
            await handleProductSearch({ target: document.getElementById('product-search') });
        }
        
    } catch (error) {
        console.error('Error during checkout:', error);
        alert(`Error processing transaction: ${error.message || 'Please try again.'}`);
    } finally {
        checkoutBtn.disabled = false;
    }
}

async function createPOSTransaction(options = {}) {
    try {
        const discountAmount = parseFloat(document.getElementById('discount-input').value) || 0;
        const { subtotal, tax, total } = POSCalculations.calculateTotals(currentCart, discountAmount);
        const paymentMethod = options.paymentMethod || document.getElementById('payment-method').value;
        const tenderAmount = parseFloat(document.getElementById('tender-amount')?.value || 0) || 0;
        const changeAmount = POSCalculations.calculateChange(total, tenderAmount);
        
        // Step 1: Create transaction record
        const { data: transaction, error: transError } = await supabaseClient
            .from('pos_transactions')
            .insert({
                cashier_id: currentUserId,
                transaction_datetime: new Date().toISOString(),
                transaction_number: options.transactionNumber || `TXN-${Date.now()}`,
                subtotal: subtotal,
                discount_amount: discountAmount,
                tax_amount: tax,
                total_amount: total,
                payment_method: paymentMethod,
                tender_amount: tenderAmount,
                change_amount: changeAmount,
                is_active: true
            })
            .select()
            .single();
        
        if (transError) throw transError;
        
        console.log('Transaction created:', transaction);
        
        // Step 2: Store the complete line values required by the database.
        const items = currentCart.map(item => {
            const unitPrice = Number(item.price);
            const quantity = Number(item.quantity);

            return {
                transaction_id: transaction.transaction_id,
                product_id: item.productId,
                product_name: item.productName,
                quantity,
                unit_price: unitPrice,
                line_discount: 0,
                line_total: Number((unitPrice * quantity).toFixed(2))
            };
        });

        const { error: itemsError } = await supabaseClient
            .from('pos_transaction_items')
            .insert(items);

        if (itemsError) {
            // Rollback transaction if items insert fails
            await supabaseClient
                .from('pos_transactions')
                .delete()
                .eq('transaction_id', transaction.transaction_id);
            throw itemsError;
        }
        
        console.log('Items added to transaction');
        
        // Step 3: Finalize transaction (update inventory and create movements)
        await finalizePOSTransaction(transaction.transaction_id);
        
        // Step 4: Create audit log
        await createAuditLog({
            action_type: 'pos_sale',
            table_affected: 'pos_transactions',
            record_id: transaction.transaction_id,
            action_details: `POS Sale completed. Total: ₱${total.toFixed(2)}`
        });
        
        return {
            ...transaction,
            pos_transaction_items: currentCart.map(item => {
                const lineTotal = Number((item.price * item.quantity).toFixed(2));
                return {
                    product_id: item.productId,
                    product_name: item.productName,
                    quantity: item.quantity,
                    unit_price: item.price,
                    subtotal: lineTotal,
                    line_total: lineTotal,
                    item_total: lineTotal
                };
            })
        };
        
    } catch (error) {
        console.error('Error creating POS transaction:', error);
        throw error;
    }
}

async function finalizePOSTransaction(transactionId) {
    try {
        const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
        if (sessionError || !session) throw sessionError || new Error('Your session has expired.');

        const response = await fetch(`/api/pos/transactions/${encodeURIComponent(transactionId)}/finalize`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` }
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to update inventory.');
        
        console.log('Inventory finalized for transaction:', transactionId);
        
    } catch (error) {
        console.error('Error finalizing POS transaction:', error);
        throw error;
    }
}

async function createAuditLog(details) {
    try {
        await supabaseClient
            .from('audit_logs')
            .insert({
                user_id: currentUserId,
                action_type: details.action_type,
                table_affected: details.table_affected,
                record_id: details.record_id,
                new_values: { details: details.action_details },
                user_agent: navigator.userAgent,
                action_timestamp: new Date().toISOString()
            });
    } catch (error) {
        console.error('Error creating audit log:', error);
        // Don't throw - log creation shouldn't break the transaction
    }
}

async function loadTodaysTransactions() {
    try {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

        const { data: transactions, error } = await supabaseClient
            .from('pos_transactions')
            .select(`
                *,
                pos_transaction_items(*)
            `)
            .gte('transaction_datetime', startOfDay)
            .lt('transaction_datetime', endOfDay)
            .order('transaction_datetime', { ascending: false })
            .limit(10);
        
        if (error) throw error;
        
        displayRecentTransactions(transactions || []);
        
    } catch (error) {
        console.error('Error loading transactions:', error);
    }
}

function displayRecentTransactions(transactions) {
    const container = document.getElementById('recent-transactions');
    
    if (transactions.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No transactions yet</p></div>';
        return;
    }
    
    container.innerHTML = transactions.map(transaction => `
        <div class="transaction-row">
            <div class="transaction-time">${new Date(transaction.transaction_datetime).toLocaleTimeString()}</div>
            <div class="transaction-items">${transaction.pos_transaction_items.length} items</div>
            <div class="transaction-amount">₱${parseFloat(transaction.total_amount).toFixed(2)}</div>
            <div class="transaction-payment">${transaction.payment_method === 'bank_transfer' ? 'QR / E-wallet' : transaction.payment_method}</div>
            <div class="transaction-actions">
                <button class="btn-icon" onclick="showReceiptModal('${transaction.transaction_id}')" title="View Receipt">
                    <i class="fas fa-receipt"></i>
                </button>
                <button class="btn-icon" onclick="openVoidModal('${transaction.transaction_id}')" title="Void Transaction">
                    <i class="fas fa-ban"></i>
                </button>
            </div>
        </div>
    `).join('');
}

// ============================================================
// RECEIPT DISPLAY
// ============================================================

function displayReceipt(transaction) {
    // Track the currently displayed transaction so the modal's Print/Email
    // buttons (which call printReceipt()/emailReceipt() with no arguments)
    // always know what to act on, regardless of whether this receipt came
    // from a fresh checkout or from re-opening one in Today's Transactions.
    currentTransaction = transaction;

    const modal = document.getElementById('receipt-modal');
    modal.style.display = 'flex';
    document.getElementById('receipt-content').innerHTML = ReceiptPrinter.generateHTML(transaction);
}

function closeReceiptModal() {
    document.getElementById('receipt-modal').style.display = 'none';
}

// ============================================================
// VOID TRANSACTION
// ============================================================

let voidingTransactionId = null;

function openVoidModal(transactionId) {
    voidingTransactionId = transactionId;
    document.getElementById('void-modal').style.display = 'flex';
}

function closeVoidModal() {
    document.getElementById('void-modal').style.display = 'none';
    voidingTransactionId = null;
}

async function confirmVoidTransaction() {
    if (!voidingTransactionId) return;
    
    const reason = document.getElementById('void-reason').value.trim();
    
    if (!reason) {
        alert('Please enter a reason for voiding.');
        return;
    }
    
    try {
        // Mark transaction as void
        const { error } = await supabaseClient
            .from('pos_transactions')
            .update({
                is_active: false,
                void_reason: reason,
                voided_by: currentUserId,
                voided_at: new Date().toISOString()
            })
            .eq('transaction_id', voidingTransactionId);
        
        if (error) throw error;
        
        // Restore inventory
        const { data: transaction } = await supabaseClient
            .from('pos_transactions')
            .select('pos_transaction_items(*)')
            .eq('transaction_id', voidingTransactionId)
            .single();
        
        if (transaction && transaction.pos_transaction_items) {
            for (const item of transaction.pos_transaction_items) {
                const { data: currentStock } = await supabaseClient
                    .from('inventory_stock')
                    .select('quantity')
                    .eq('product_id', item.product_id)
                    .single();
                
                await supabaseClient
                    .from('inventory_stock')
                    .update({
                        quantity: (currentStock?.quantity || 0) + item.quantity,
                        updated_at: new Date().toISOString()
                    })
                    .eq('product_id', item.product_id);
            }
        }
        
        // Create audit log
        await createAuditLog({
            action_type: 'pos_void',
            table_affected: 'pos_transactions',
            record_id: voidingTransactionId,
            action_details: `Transaction voided. Reason: ${reason}`
        });
        
        alert('Transaction voided successfully.');
        closeVoidModal();
        await loadTodaysTransactions();
        
    } catch (error) {
        console.error('Error voiding transaction:', error);
        alert('Error voiding transaction. Please try again.');
    }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function printReceipt() {
    ReceiptPrinter.print(currentTransaction);
}

function emailReceipt() {
    ReceiptPrinter.email(currentTransaction);
}

async function showReceiptModal(transactionId) {
    try {
        const { data: transaction, error } = await supabaseClient
            .from('pos_transactions')
            .select('*,pos_transaction_items(*)')
            .eq('transaction_id', transactionId)
            .single();
        
        if (error) throw error;
        
        displayReceipt(transaction);
    } catch (error) {
        console.error('Error loading receipt:', error);
        alert('Error loading receipt.');
    }
}
