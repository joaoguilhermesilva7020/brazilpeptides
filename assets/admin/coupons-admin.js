(() => {
  'use strict';
  const config = window.ASET_SUPABASE_CONFIG;
  if (!window.supabase || !config?.url || !config?.anonKey) return;
  const client = window.supabase.createClient(config.url, config.anonKey);
  const $ = id => document.getElementById(id);
  let coupons = [];
  let initialized = false;
  const money = value => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value || 0));
  const date = value => value ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : '—';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function localDateTime(value) {
    const d = new Date(value);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0,16);
  }
  function feedback(message, success=false) {
    const el=$('couponAdminFeedback'); if(!el) return;
    el.textContent=message || ''; el.style.color=success ? '#aee0bc' : '';
  }
  function init() {
    if(initialized || !$('dashboardView') || $('dashboardView').classList.contains('hidden')) return;
    initialized=true;
    const nav=$('validationButton');
    const button=document.createElement('button');
    button.className='button secondary'; button.id='couponsButton'; button.type='button'; button.textContent='Cupons';
    nav.insertAdjacentElement('afterend',button);
    const top=$('dashboardView').querySelector('.dashboard-top');
    top.insertAdjacentHTML('afterend',
      '<section id="couponsPanel" class="hidden">' +
        '<div class="inventory-intro"><div><div class="eyebrow">GESTÃO COMERCIAL</div><h2>Cupons de desconto</h2><p>Crie cupons por valor fixo ou percentual, defina a validade e desative códigos sem apagar o histórico de pedidos.</p></div></div>' +
        '<form id="couponAdminForm" class="inventory-form">' +
          '<input id="couponAdminId" type="hidden">' +
          '<div class="coupon-admin-grid">' +
            '<div><label for="couponAdminCode">Código do cupom</label><input id="couponAdminCode" type="text" maxlength="30" minlength="3" pattern="[A-Za-z0-9_-]{3,30}" placeholder="EX.: BEMVINDO10" required></div>' +
            '<div><label for="couponAdminType">Tipo de desconto</label><select id="couponAdminType"><option value="percent">Percentual (%)</option><option value="fixed">Valor fixo (R$)</option></select></div>' +
            '<div><label for="couponAdminValue">Valor do desconto</label><input id="couponAdminValue" type="number" min="0.01" max="99.99" step="0.01" inputmode="decimal" required></div>' +
            '<div><label for="couponAdminExpiry">Válido até (data e horário local)</label><input id="couponAdminExpiry" type="datetime-local" required></div>' +
          '</div>' +
          '<label class="affiliate-active-label"><input id="couponAdminActive" type="checkbox" checked> Cupom ativo</label>' +
          '<div class="coupon-admin-actions"><button class="button primary" id="couponAdminSave" type="submit">Salvar cupom</button><button class="button secondary hidden" id="couponAdminCancel" type="button">Cancelar edição</button></div>' +
          '<p class="feedback" id="couponAdminFeedback" role="status"></p>' +
        '</form>' +
        '<div class="orders-table-wrap"><table class="orders-table"><thead><tr><th>Código</th><th>Desconto</th><th>Validade</th><th>Status</th><th>Ações</th></tr></thead><tbody id="couponsAdminBody"><tr><td colspan="5" class="empty-cell">Carregando cupons…</td></tr></tbody></table></div>' +
      '</section>');
    const style=document.createElement('style');
    style.textContent='.coupon-admin-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:14px}.coupon-admin-grid>div{display:grid;gap:6px}.coupon-admin-grid label{font-size:12px;font-weight:700}.coupon-admin-grid input,.coupon-admin-grid select{width:100%;min-height:44px;padding:10px 12px;border:1px solid #cadfd1;border-radius:9px;background:#fff;color:#173a26;font:inherit}.coupon-admin-actions{display:flex;gap:10px;margin-top:12px}.coupon-admin-actions button{min-width:140px}.coupon-action{border:0;background:transparent;color:#16824f;font:inherit;font-weight:700;cursor:pointer;margin-right:12px}.coupon-action.danger{color:#b34b4b}@media(max-width:700px){.coupon-admin-grid{grid-template-columns:1fr}.coupon-admin-actions{flex-direction:column}}';
    document.head.appendChild(style);
    button.addEventListener('click',showPanel);
    $('couponAdminForm').addEventListener('submit',saveCoupon);
    $('couponAdminType').addEventListener('change',updateValueLimit);
    $('couponAdminCancel').addEventListener('click',resetForm);
    $('refreshButton').addEventListener('click',event=>{
      if(!$('couponsPanel').classList.contains('hidden')) { event.stopImmediatePropagation(); loadCoupons(); }
    },true);
    document.addEventListener('click',event=>{
      if(event.target.closest('#ordersButton,#inventoryButton,#affiliatesButton,#validationButton,#productsButton')) $('couponsPanel').classList.add('hidden');
    },true);
    updateValueLimit();
    loadCoupons();
  }
  function updateValueLimit() {
    const percent=$('couponAdminType').value==='percent';
    $('couponAdminValue').max=percent?'99.99':'1000000';
    $('couponAdminValue').placeholder=percent?'Ex.: 10':'Ex.: 25,00';
  }
  function showPanel() {
    ['ordersPanel','inventoryPanel','affiliatesPanel','validationPanel','productsPanel'].forEach(id=>{if($(id)) $(id).classList.add('hidden');});
    $('couponsPanel').classList.remove('hidden');
    document.querySelectorAll('.dashboard-actions .button').forEach(el=>el.classList.remove('active-tab'));
    $('couponsButton').classList.add('active-tab');
    $('dashboardTitle').textContent='Cupons';
    $('dashboardSubtitle').textContent='Gerencie códigos promocionais e suas datas de validade.';
    feedback('');
    loadCoupons();
  }
  async function loadCoupons() {
    $('couponsAdminBody').innerHTML='<tr><td colspan="5" class="empty-cell">Carregando cupons…</td></tr>';
    try {
      const {data,error}=await client.from('discount_coupons').select('id,code,discount_type,discount_value,expires_at,active,created_at').order('created_at',{ascending:false});
      if(error) throw error;
      coupons=data || [];
      renderCoupons();
    } catch(error) {
      $('couponsAdminBody').innerHTML='<tr><td colspan="5" class="empty-cell">Não foi possível carregar os cupons.</td></tr>';
      feedback(error.message || 'Erro ao carregar cupons.');
    }
  }
  function renderCoupons() {
    $('couponsAdminBody').innerHTML=coupons.length ? coupons.map(c=>{
      const expired=new Date(c.expires_at).getTime()<=Date.now();
      const active=Boolean(c.active)&&!expired;
      const discount=c.discount_type==='percent' ? Number(c.discount_value).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%' : money(c.discount_value);
      const status=active?'<span class="status confirmed">Ativo</span>':expired?'<span class="status other">Expirado</span>':'<span class="status other">Desativado</span>';
      return '<tr><td><strong>'+escapeHtml(c.code)+'</strong></td><td>'+escapeHtml(discount)+'</td><td>'+escapeHtml(date(c.expires_at))+'</td><td>'+status+'</td><td><button class="coupon-action" type="button" data-coupon-edit="'+escapeHtml(c.id)+'">Editar</button>'+(c.active?'<button class="coupon-action danger" type="button" data-coupon-off="'+escapeHtml(c.id)+'">Desativar</button>':'')+'</td></tr>';
    }).join(''):'<tr><td colspan="5" class="empty-cell">Nenhum cupom cadastrado.</td></tr>';
    $('couponsAdminBody').querySelectorAll('[data-coupon-edit]').forEach(b=>b.addEventListener('click',()=>editCoupon(b.dataset.couponEdit)));
    $('couponsAdminBody').querySelectorAll('[data-coupon-off]').forEach(b=>b.addEventListener('click',()=>deactivateCoupon(b.dataset.couponOff)));
  }
  function editCoupon(id) {
    const c=coupons.find(item=>item.id===id); if(!c) return;
    $('couponAdminId').value=c.id;
    $('couponAdminCode').value=c.code;
    $('couponAdminType').value=c.discount_type;
    $('couponAdminValue').value=c.discount_value;
    $('couponAdminExpiry').value=localDateTime(c.expires_at);
    $('couponAdminActive').checked=Boolean(c.active);
    $('couponAdminSave').textContent='Salvar alterações';
    $('couponAdminCancel').classList.remove('hidden');
    updateValueLimit();
    $('couponAdminForm').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function resetForm() {
    $('couponAdminForm').reset(); $('couponAdminId').value='';
    $('couponAdminSave').textContent='Salvar cupom';
    $('couponAdminCancel').classList.add('hidden');
    updateValueLimit(); feedback('');
  }
  async function saveCoupon(event) {
    event.preventDefault();
    const button=$('couponAdminSave'); button.disabled=true; feedback('Salvando cupom…',true);
    try {
      const expiry=new Date($('couponAdminExpiry').value);
      if(Number.isNaN(expiry.getTime())) throw new Error('Informe uma data e horário de validade.');
      const {error}=await client.rpc('admin_save_discount_coupon',{
        p_coupon_id:$('couponAdminId').value || null,
        p_code:$('couponAdminCode').value.trim().toUpperCase(),
        p_discount_type:$('couponAdminType').value,
        p_discount_value:Number($('couponAdminValue').value),
        p_expires_at:expiry.toISOString(),
        p_active:$('couponAdminActive').checked
      });
      if(error) throw error;
      resetForm(); feedback('Cupom salvo com sucesso.',true); await loadCoupons();
    } catch(error) { feedback(error.message || 'Não foi possível salvar o cupom.'); }
    finally { button.disabled=false; }
  }
  async function deactivateCoupon(id) {
    const c=coupons.find(item=>item.id===id); if(!c || !confirm('Desativar o cupom '+c.code+'? O histórico dos pedidos será preservado.')) return;
    try {
      const {error}=await client.rpc('admin_save_discount_coupon',{
        p_coupon_id:c.id,p_code:c.code,p_discount_type:c.discount_type,
        p_discount_value:Number(c.discount_value),p_expires_at:c.expires_at,p_active:false
      });
      if(error) throw error;
      feedback('Cupom desativado. O histórico foi preservado.',true); await loadCoupons();
    } catch(error) { feedback(error.message || 'Não foi possível desativar o cupom.'); }
  }
  document.addEventListener('aset:admin-ready',init);
  if($('dashboardView') && !$('dashboardView').classList.contains('hidden')) init();
})();