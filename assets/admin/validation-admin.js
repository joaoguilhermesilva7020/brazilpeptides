(() => {
  'use strict';
  const config = window.ASET_SUPABASE_CONFIG;
  if (!window.supabase || !config?.url || !config?.anonKey) return;
  const client = window.supabase.createClient(config.url, config.anonKey);
  const $ = (id) => document.getElementById(id);
  const state = { variants: [], codes: [], isAdmin: false };
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const date = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
  function feedback(message, success = false) {
    $('validationAdminFeedback').textContent = message || '';
    $('validationAdminFeedback').style.color = success ? '#aee0bc' : '';
  }
  function makeCode() {
    const bytes = new Uint8Array(12); crypto.getRandomValues(bytes);
    const raw = Array.from(bytes, byte => alphabet[byte & 31]).join('');
    return 'ASL-' + raw.match(/.{4}/g).join('-');
  }
  function normalizeCodes(text) { return text.split(/[\r\n,;]+/).map(value => value.trim()).filter(Boolean); }
  async function ensureAdmin() {
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData.session) throw new Error('Entre novamente no painel administrativo.');
    const { data, error } = await client.rpc('is_admin');
    if (error) throw error;
    if (data !== true) throw new Error('Acesso restrito ao administrador.');
    state.isAdmin = true;
  }
  async function loadVariants() {
    const { data, error } = await client.from('product_variants').select('id,name,active,product:products(name,active)').order('name', { ascending: true });
    if (error) throw error;
    state.variants = (data || []).filter(item => item.active && item.product?.active);
    $('authCodeVariant').innerHTML = '<option value="">Selecione produto e apresentação</option>' +
      state.variants.map(item => '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.product.name + ' — ' + item.name) + '</option>').join('');
  }
  function renderCodes() {
    $('authCodesBody').innerHTML = state.codes.length ? state.codes.map(item =>
      '<tr><td><strong>•••• ' + escapeHtml(item.code_suffix) + '</strong></td>' +
      '<td>' + escapeHtml(item.product?.name || '—') + '</td><td>' + escapeHtml(item.variant?.name || '—') + '</td>' +
      '<td>' + escapeHtml(item.lot_code || '—') + '</td><td><strong>' + Number(item.validation_count || 0) + '</strong></td>' +
      '<td>' + escapeHtml(date(item.first_validated_at)) + '</td><td>' + escapeHtml(date(item.last_validated_at)) + '</td>' +
      '<td>' + (item.active ? '<span class="status confirmed">Ativo</span>' : '<span class="status other">Inativo</span>') + '</td></tr>'
    ).join('') : '<tr><td colspan="8" class="empty-cell">Nenhum código cadastrado.</td></tr>';
  }
  async function loadCodes() {
    const { data, error } = await client.from('product_auth_codes')
      .select('id,code_suffix,lot_code,active,validation_count,first_validated_at,last_validated_at,created_at,product:products(name),variant:product_variants(name)')
      .order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    state.codes = data || []; renderCodes();
  }
  async function openPanel() {
    if (!state.isAdmin) await ensureAdmin();
    if (!state.variants.length) await loadVariants();
    await loadCodes();
  }
  async function saveCodes(codes, button, label) {
    if (!state.isAdmin) await ensureAdmin();
    const variantId = $('authCodeVariant').value;
    if (!variantId) throw new Error('Selecione o produto e a apresentação.');
    if (!codes.length || codes.length > 500) throw new Error('Informe de 1 a 500 códigos.');
    button.disabled = true; feedback('Registrando códigos no banco…', true);
    try {
      const { data, error } = await client.rpc('admin_create_product_auth_codes', {
        p_variant_id: variantId, p_codes: codes, p_lot_code: $('authCodeLot').value.trim() || null
      });
      if (error) throw error;
      feedback(label + ' ' + data.created + ' código(s).', true);
      await loadCodes();
    } finally { button.disabled = false; }
  }
  $('generateCodesForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('generateCodesButton'); const quantity = Number($('authCodeQuantity').value);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) { feedback('Escolha uma quantidade entre 1 e 500.'); return; }
    const codes = Array.from({ length: quantity }, makeCode);
    try {
      await saveCodes(codes, button, 'Gerados e cadastrados:');
      $('generatedCodesText').value = codes.join('\n'); $('generatedCodesPanel').classList.remove('hidden'); $('importCodesText').value = '';
    } catch (error) { feedback(error.message || 'Não foi possível gerar os códigos.'); }
  });
  $('importCodesForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const codes = normalizeCodes($('importCodesText').value); const button = $('importCodesButton');
    try {
      await saveCodes(codes, button, 'Importados:');
      $('importCodesText').value = ''; $('generatedCodesPanel').classList.add('hidden');
    } catch (error) { feedback(error.message || 'Não foi possível importar os códigos.'); }
  });
  $('copyGeneratedCodes').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('generatedCodesText').value); feedback('Códigos copiados. Guarde-os com segurança; não poderão ser recuperados depois.', true); }
    catch (_) { feedback('Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.'); }
  });
  $('downloadGeneratedCodes').addEventListener('click', () => {
    const csv = 'codigo\r\n' + $('generatedCodesText').value.split('\n').map(code => '"' + code + '"').join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'aset-life-codigos-validacao.csv'; link.click(); URL.revokeObjectURL(url);
  });
  document.addEventListener('aset:validation-open', () => openPanel().catch(error => feedback(error.message || 'Não foi possível carregar os códigos.')));
  document.addEventListener('aset:validation-refresh', () => loadCodes().then(() => feedback('Lista atualizada.', true)).catch(error => feedback(error.message || 'Não foi possível atualizar a lista.')));
})();
