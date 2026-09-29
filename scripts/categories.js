(() => {
    const modal = document.getElementById('category-modal');
    const form = document.getElementById('category-form');
    const message = document.getElementById('category-message');
    const list = document.getElementById('category-list');
    let editingId = null;
    let busy = false;
    let returnFocus;
    let bodyWasLocked = false;
    const search = document.getElementById('category-search');

    function filterCategories() {
        const term = search.value.trim().toLowerCase();
        let visible = 0;
        list.querySelectorAll('.category-list-row').forEach(row => {
            row.hidden = !row.dataset.name.includes(term);
            if (!row.hidden) visible++;
        });
        document.getElementById('category-count').textContent = visible;
        const empty = list.querySelector('.category-empty');
        if (empty) empty.hidden = visible > 0;
    }
    search.addEventListener('input', filterCategories);

    function reset() {
        editingId = null;
        form.reset();
        document.getElementById('category-form-title').textContent = 'Create Category';
        document.getElementById('category-save').textContent = 'Create Category';
    }

    async function refresh() {
        const response = await window.authHelpers.authenticatedFetch('/api/categories');
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to load categories.');
        list.replaceChildren();
        for (const category of result.categories) {
            const row = document.createElement('div');
            row.className = 'category-list-row';
            row.dataset.name = category.category_name.toLowerCase();
            const label = document.createElement('span');
            label.textContent = category.category_name;
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'btn btn-soft';
            edit.innerHTML = '<i class="fas fa-pen-to-square" aria-hidden="true"></i>';
            edit.title = `Edit ${category.category_name}`;
            edit.setAttribute('aria-label', `Edit ${category.category_name}`);
            edit.onclick = () => {
                if (busy) return;
                editingId = category.category_id;
                document.getElementById('category-name').value = category.category_name;
                document.getElementById('category-description').value = category.description || '';
                document.getElementById('category-form-title').textContent = 'Edit Category';
                document.getElementById('category-save').textContent = 'Save Changes';
                document.getElementById('category-name').focus();
            };
            const archive = document.createElement('button');
            archive.type = 'button';
            archive.className = 'btn btn-soft category-archive';
            archive.innerHTML = '<i class="fas fa-box-archive" aria-hidden="true"></i>';
            archive.title = `Archive ${category.category_name}`;
            archive.setAttribute('aria-label', `Archive ${category.category_name}`);
            archive.onclick = () => {
                if (!busy && window.confirm(`Archive "${category.category_name}"? It will no longer appear in category selectors.`)) {
                    save({ action: 'archive', category_id: category.category_id });
                }
            };
            const actions = document.createElement('div');
            actions.className = 'category-row-actions';
            actions.append(edit, archive);
            row.append(label, actions);
            list.append(row);
        }
        const empty = document.createElement('p');
        empty.className = 'category-empty';
        empty.textContent = result.categories.length ? 'No matching categories. Try another name.' : 'No categories yet. Create your first category using the form.';
        list.append(empty);
        filterCategories();
        // Preserve selections when refreshing the inventory and product forms.
        for (const [id, placeholder] of [['category-filter', 'All Categories'], ['product-category', 'Select Category'], ['outbound-category', 'All Categories']]) {
            const select = document.getElementById(id);
            if (!select) continue;
            const previous = select.value;
            select.replaceChildren(new Option(placeholder, ''), ...result.categories.map(c => new Option(c.category_name, c.category_id)));
            select.value = result.categories.some(c => c.category_id === previous) ? previous : '';
            if (select.value !== previous) select.dispatchEvent(new Event('change'));
        }
        inventoryCategories = result.categories;
    }

    async function save(payload) {
        if (busy) return;
        busy = true;
        modal.querySelectorAll('button, input, textarea').forEach(el => { el.disabled = true; });
        message.textContent = 'Saving category…';
        try {
            const response = await window.authHelpers.authenticatedFetch('/api/categories/manage', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Unable to save category.');
            reset();
            message.textContent = payload.action === 'archive' ? 'Category archived.' : 'Category saved.';
            try { await refresh(); } catch { message.textContent += ' Reopen this dialog to reload the category list.'; }
        } catch (error) {
            message.textContent = error.message;
        } finally {
            busy = false;
            modal.querySelectorAll('button, input, textarea').forEach(el => { el.disabled = false; });
        }
    }

    document.getElementById('manage-categories-btn').onclick = async () => {
        if (!['admin', 'staff'].includes(currentUserRole)) return;
        returnFocus = document.activeElement;
        reset();
        search.value = '';
        list.replaceChildren();
        message.textContent = 'Loading categories…';
        modal.classList.add('active');
        bodyWasLocked = document.body.classList.contains('modal-open');
        document.body.classList.add('modal-open');
        document.getElementById('close-category-modal').focus();
        try { await refresh(); message.textContent = ''; } catch (error) { message.textContent = error.message; }
    };
    function close() {
        if (busy) return;
        modal.classList.remove('active');
        if (!bodyWasLocked) document.body.classList.remove('modal-open');
        returnFocus?.focus();
    }
    document.getElementById('close-category-modal').onclick = close;
    document.getElementById('category-reset').onclick = reset;
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key !== 'Tab') return;
        const controls = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')]
            .filter(control => control.getClientRects().length > 0);
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    form.addEventListener('submit', event => {
        event.preventDefault();
        save({ action: editingId ? 'edit' : 'create', category_id: editingId,
            category_name: document.getElementById('category-name').value,
            description: document.getElementById('category-description').value });
    });
})();
