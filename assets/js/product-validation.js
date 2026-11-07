(() => {
  'use strict';
  const config = window.ASET_SUPABASE_CONFIG;
  if (!window.supabase || !config?.url || !config?.anonKey) return;
  const client = window.supabase.createClient(config.url, config.anonKey);
  const form = document.getElementById('productValidationForm');
  if (!form) return;
  const input = document.getElementById('productValidationCode');
  const button = document.getElementById('productValidationSubmit');
  const feedback = document.getElementById('productValidationFeedback');
  const result = document.getElementById('productValidationResult');
  const date = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = input.value.trim().toUpperCase();
    if (!code) return;
    button.disabled = true; feedback.textContent = 'Consultando código…'; result.hidden = true; result.innerHTML = '';
    try {
      const { data, error } = await client.functions.invoke('validate-product-code', { body: { code } });
      if (error) {
        let message = error.message || 'Não foi possível validar o código.';
        if (error.context && typeof error.context.json === 'function') {
          try { const body = await error.context.json(); message = body.error || message; } catch (_) {}
        }
        throw new Error(message);
      }
      const v = data?.data;
      if (!v?.valid) { feedback.textContent = 'Código não encontrado. Confira os caracteres e tente novamente.'; return; }
      result.innerHTML =
        '<div class="validation-result-head ' + (v.first_validation ? 'first' : 'repeat') + '">' +
        '<strong>' + (v.first_validation ? 'Primeira validação registrada' : 'Este código já foi validado anteriormente') + '</strong>' +
        '<span>' + (v.first_validation ? 'Código consultado pela primeira vez' : Number(v.validation_count) + ' consultas registradas') + '</span></div>' +
        '<dl class="validation-result-details"><div><dt>Produto</dt><dd>' + escapeHtml(v.product_name) + '</dd></div>' +
        '<div><dt>Apresentação</dt><dd>' + escapeHtml(v.variant_name) + '</dd></div>' +
        (v.lot_code ? '<div><dt>Lote</dt><dd>' + escapeHtml(v.lot_code) + '</dd></div>' : '') +
        '<div><dt>Primeira consulta</dt><dd>' + date(v.first_validated_at) + '</dd></div>' +
        '<div><dt>Consulta mais recente</dt><dd>' + date(v.last_validated_at) + '</dd></div></dl>' +
        '<p class="validation-result-note">Uma consulta repetida não significa, por si só, que o produto seja falsificado. Em caso de dúvida, entre em contato com a equipe Aset Life.</p>';
      result.hidden = false; feedback.textContent = '';
    } catch (error) { feedback.textContent = error.message || 'Não foi possível validar o código.'; }
    finally { button.disabled = false; }
  });
})();
