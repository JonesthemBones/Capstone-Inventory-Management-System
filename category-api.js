// Category management shares the receipt API's verified staff/admin authentication.
module.exports = function registerCategories(router, db, requireRoles) {
    router.post('/categories/manage', async (req, res) => {
        try {
            const operator = await requireRoles(req, res, ['admin', 'staff']);
            if (!operator) return;
            const { action, category_id: id } = req.body;
            if (!['create', 'edit', 'archive'].includes(action) ||
                (action !== 'create' && !/^[0-9a-f-]{36}$/i.test(id || ''))) {
                return res.status(400).json({ error: 'Invalid category action.' });
            }
            let values;
            if (action === 'archive') {
                const { count, error } = await db.from('products').select('product_id', { count: 'exact', head: true })
                    .eq('category_id', id).eq('is_active', true);
                if (error) throw error;
                if (count) return res.status(409).json({ error: 'Reassign active products before archiving this category.' });
                values = { is_active: false, archived_at: new Date().toISOString(), archived_by: operator.user.id,
                    archive_reason: 'Archived through category management' };
            } else {
                const name = typeof req.body.category_name === 'string' ? req.body.category_name.trim().replace(/\s+/g, ' ') : '';
                const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
                if (!name || name.length > 100 || description.length > 1000) {
                    return res.status(400).json({ error: 'Enter a name up to 100 characters and a description up to 1,000 characters.' });
                }
                const { data, error } = await db.from('categories').select('category_id, category_name');
                if (error) throw error;
                if (data.some(category => category.category_id !== id &&
                    category.category_name.trim().replace(/\s+/g, ' ').toLowerCase() === name.toLowerCase())) {
                    return res.status(409).json({ error: 'This category name already exists, including archived categories.' });
                }
                values = { category_name: name, description: description || null };
                if (action === 'create') {
                    // Keep slugs stable on edits because receipt classification also uses them.
                    values.category_slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
                        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `category-${require('crypto').randomUUID()}`;
                    values.is_active = true;
                }
            }
            values.updated_at = new Date().toISOString();
            const query = action === 'create' ? db.from('categories').insert(values)
                : db.from('categories').update(values).eq('category_id', id).eq('is_active', true);
            const { data: category, error } = await query.select('category_id, category_name').single();
            if (error) {
                if (error.code === '23505') return res.status(409).json({ error: 'A category with this name or slug already exists.' });
                if (error.code === 'PGRST116') return res.status(409).json({ error: 'Category no longer available. Reopen the list and try again.' });
                throw error;
            }
            return res.json({ success: true, category });
        } catch (error) {
            console.error('Category management failed:', error);
            return res.status(500).json({ error: 'Unable to save category. Please try again.' });
        }
    });
};
