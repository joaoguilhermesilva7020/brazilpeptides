(() => {
  'use strict';
  const config = window.ASET_SUPABASE_CONFIG;
  if (!window.supabase || !config?.url || !config?.anonKey) return;
  const client = window.supabase.createClient(config.url, config.anonKey);
  const $ = id => document.getElementById(id);
  const state = { allowed: false, products: [], categories: [], variants: [] };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value || 0));
  const feedback = (message, success = false) => {
    $('productAdminFeedback').textContent = message || '';
    $('productAdminFeedback').style.color = success ? '#aee0bc' : '';
  };

  async function authorize() {
    const { data } = await client.auth.getSession();
    if (!data.session?.user) return;
    const { data: allowed, error } = await client.rpc('is_admin');
    if (error || allowed !== true) return;
    state.allowed = true;
    $('productsButton').classList.remove('hidden');
  }

  function showProducts() {
    ['ordersPanel','inventoryPanel','affiliatesPanel','validationPanel'].forEach(id => $(id)?.classList.add('hidden'));
    $('productsPanel').classList.remove('hidden');
    $('dashboardTitle').textContent = 'Produtos';
    $('dashboardSubtitle').textContent = 'Cadastre e mantenha o catálogo, as descrições, preços e apresentações.';
    ['ordersButton','inventoryButton','affiliatesButton','validationButton','productsButton'].forEach(id => $(id)?.classList.toggle('active-tab', id === 'productsButton'));
    if (!state.products.length) loadProducts();
  }

  async function loadProducts() {
    feedback('Carregando catálogo…', true);
    try {
      const [productsResult, categoriesResult] = await Promise.all([
        client.from('products').select('id,legacy_id,name,short_description,description,uses,evidence,disclaimer,active,sort_order,badge_active,badge_text,badge_style,product_categories(category_id,category:categories(id,name)),product_variants(id,name,sku,price,active,sort_order)').order('sort_order').order('name'),
        client.from('categories').select('id,name,sort_order').order('sort_order').order('name')
      ]);
      if (productsResult.error) throw productsResult.error;
      if (categoriesResult.error) throw categoriesResult.error;
      state.products = productsResult.data || [];
      state.categories = categoriesResult.data || [];
      renderProducts();
      feedback(state.products.length + ' produto(s) carregado(s).', true);
    } catch (error) {
      feedback(error.message || 'Não foi possível carregar o catálogo.');
    }
  }

  function renderProducts() {
    const query = $('productSearch').value.trim().toLocaleLowerCase('pt-BR');
    const rows = state.products.filter(p => [p.name,p.legacy_id].join(' ').toLocaleLowerCase('pt-BR').includes(query));
    $('productsAdminBody').innerHTML = rows.length ? rows.map(p => {
      const activeVariants = (p.product_variants || []).filter(v => v.active).length;
      const category = p.product_categories?.[0]?.category?.name || '—';
      return '<tr><td><strong>' + esc(p.name) + '</strong><span class="subline">' + esc(p.legacy_id || '') + '</span></td><td>' + esc(category) + '</td><td>' + activeVariants + '</td><td>' + (p.active ? '<span class="status confirmed">Ativo</span>' : '<span class="status other">Inativo</span>') + '</td><td><button class="view-button" type="button" data-edit-product="' + esc(p.id) + '">Editar</button></td></tr>';
    }).join('') : '<tr><td colspan="5" class="empty-cell">Nenhum produto encontrado.</td></tr>';
    $('productsAdminBody').querySelectorAll('[data-edit-product]').forEach(button => button.addEventListener('click', () => openEditor(button.dataset.editProduct)));
  }

  function variantRow(variant = {}) {
    const row = document.createElement('div');
    row.className = 'product-variant-row';
    row.dataset.id = variant.id || '';
    row.innerHTML = '<div><label>Apresentação</label><input class="pv-name" maxlength="100" required placeholder="Ex.: 50 mg" value="' + esc(variant.name || '') + '"></div>' +
      '<div><label>Preço (R$)</label><input class="pv-price" type="number" min="0" step="0.01" required placeholder="0,00" value="' + (variant.price ?? '') + '"></div>' +
      '<div><label>SKU (opcional)</label><input class="pv-sku" maxlength="80" placeholder="Código interno" value="' + esc(variant.sku || '') + '"></div>' +
      '<label class="pv-active"><input class="pv-enabled" type="checkbox" ' + (variant.active === false ? '' : 'checked') + '> Ativa</label>' +
      '<button class="view-button pv-remove" type="button">Remover</button>';
    row.querySelector('.pv-remove').addEventListener('click', () => row.remove());
    $('productVariantRows').appendChild(row);
  }

  function openEditor(productId = null) {
    const p = productId ? state.products.find(item => item.id === productId) : null;
    $('productForm').reset();
    $('productId').value = p?.id || '';
    $('productDialogTitle').textContent = p ? 'Editar produto' : 'Novo produto';
    $('productName').value = p?.name || '';
    $('productLegacyId').value = p?.legacy_id || '';
    $('productShortDescription').value = p?.short_description || '';
    $('productDescription').value = p?.description || '';
    $('productUses').value = p?.uses || '';
    $('productEvidence').value = p?.evidence || '';
    $('productDisclaimer').value = p?.disclaimer || '';
    $('productBadgeActive').checked = p ? Boolean(p.badge_active) : false;
    $('productBadgeText').value = p?.badge_text || '';
    $('productBadgeStyle').value = p?.badge_style || 'green';
    $('productActive').checked = p ? Boolean(p.active) : true;
    $('productSortOrder').value = p?.sort_order ?? 0;
    const categoryId = p?.product_categories?.[0]?.category_id || '';
    $('productCategory').innerHTML = '<option value="">Selecione uma categoria</option>' + state.categories.map(c => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join('');
    $('productCategory').value = categoryId;
    $('productVariantRows').innerHTML = '';
    (p?.product_variants || []).slice().sort((a,b) => Number(a.sort_order)-Number(b.sort_order)).forEach(variantRow);
    if (!p) variantRow({name:'',price:'',sku:'',active:true});
    $('productFormFeedback').textContent = '';
    $('productDialog').showModal();
  }

  function collectVariants() {
    return Array.from($('productVariantRows').querySelectorAll('.product-variant-row')).map((row,index) => ({
      id: row.dataset.id || null,
      name: row.querySelector('.pv-name').value.trim(),
      price: Number(row.querySelector('.pv-price').value),
      sku: row.querySelector('.pv-sku').value.trim() || null,
      active: row.querySelector('.pv-enabled').checked,
      sort_order: index
    }));
  }

  async function saveProduct(event) {
    event.preventDefault();
    if (!state.allowed) return;
    const variants = collectVariants();
    if (!variants.length) {
      $('productFormFeedback').textContent = 'Adicione pelo menos uma apresentação. Se não quiser vendê-la, desative-a.';
      return;
    }
    if (variants.some(v => !v.name || !Number.isFinite(v.price) || v.price < 0)) {
      $('productFormFeedback').textContent = 'Confira o nome e o preço de todas as apresentações.';
      return;
    }
    const button = $('saveProductButton');
    button.disabled = true;
    $('productFormFeedback').textContent = 'Salvando produto…';
    try {
      const { data, error } = await client.rpc('admin_save_product', {
        p_product_id: $('productId').value || null,
        p_category_id: $('productCategory').value || null,
        p_product: {
          legacy_id: $('productLegacyId').value.trim() || null,
          name: $('productName').value.trim(),
          short_description: $('productShortDescription').value.trim(),
          description: $('productDescription').value.trim(),
          uses: $('productUses').value.trim(),
          evidence: $('productEvidence').value.trim(),
          disclaimer: $('productDisclaimer').value.trim(),
          badge_active: $('productBadgeActive').checked,
          badge_text: $('productBadgeText').value.trim(),
          badge_style: $('productBadgeStyle').value,
          active: $('productActive').checked,
          sort_order: Number($('productSortOrder').value || 0)
        },
        p_variants: variants
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      $('productDialog').close();
      state.products = [];
      await loadProducts();
      feedback('Produto salvo com sucesso.', true);
    } catch (error) {
      $('productFormFeedback').textContent = error.message || 'Não foi possível salvar o produto.';
    } finally {
      button.disabled = false;
    }
  }

  $('productsButton').addEventListener('click', showProducts);
  document.addEventListener('aset:admin-ready', authorize);
  ['ordersButton','inventoryButton','affiliatesButton','validationButton'].forEach(id => $(id).addEventListener('click', () => {
    $('productsPanel').classList.add('hidden');
    $('productsButton').classList.remove('active-tab');
  }));
  $('newProductButton').addEventListener('click', () => openEditor());
  $('addProductVariant').addEventListener('click', () => variantRow());
  $('closeProductDialog').addEventListener('click', () => $('productDialog').close());
  $('productForm').addEventListener('submit', saveProduct);
  $('productSearch').addEventListener('input', renderProducts);
  $('refreshProductsButton').addEventListener('click', loadProducts);
  authorize();
})();