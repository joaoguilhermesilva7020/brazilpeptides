(() => {
  'use strict';

  const config = window.ASET_SUPABASE_CONFIG;
  if (!window.supabase || !config?.url || !config?.anonKey) {
    document.getElementById('loginFeedback').textContent = 'Configuração do Supabase não encontrada.';
    return;
  }

  const client = window.supabase.createClient(config.url, config.anonKey);
  const $ = (id) => document.getElementById(id);
  const state = { orders: [], selectedOrder: null, isAdmin: false, inventory: [], inventoryLoaded: false };
  const statusLabels = {
    pending_payment: 'Aguardando pagamento', paid: 'Pago', processing: 'Em processamento',
    completed: 'Concluído', cancelled: 'Cancelado', payment_issue: 'Problema no pagamento', refunded: 'Reembolsado'
  };
  const paymentLabels = { pending: 'Pendente', confirmed: 'Confirmado', rejected: 'Rejeitado', refunded: 'Reembolsado' };
  const methodLabels = { pix: 'PIX', transfer: 'Transferência', cash: 'Dinheiro', other: 'Outro' };

  const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
  const date = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const latestPayment = (order) => (order.payments || []).slice().sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null;

  function setFeedback(id, message, success = false) {
    const el = $(id);
    el.textContent = message || '';
    el.style.color = success ? '#aee0bc' : '';
  }

  async function checkAdmin(user) {
    const { data, error } = await client.rpc('is_admin');
    if (error) throw error;
    if (data !== true) throw new Error('Este usuário não possui permissão de administrador ativo.');
    state.isAdmin = true;
    $('adminEmail').textContent = user.email || '';
    $('loginView').classList.add('hidden');
    $('dashboardView').classList.remove('hidden');
    await loadOrders();
  }

  async function restoreSession() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data.session?.user) {
      try { await checkAdmin(data.session.user); }
      catch (error) {
        await client.auth.signOut();
        $('loginView').classList.remove('hidden');
        setFeedback('loginFeedback', error.message || 'Acesso não autorizado.');
      }
    }
  }

  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('loginButton');
    button.disabled = true;
    setFeedback('loginFeedback', '');
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: $('email').value.trim(),
        password: $('password').value
      });
      if (error) throw error;
      await checkAdmin(data.user);
    } catch (error) {
      await client.auth.signOut();
      setFeedback('loginFeedback', error.message || 'Não foi possível entrar.');
    } finally {
      button.disabled = false;
    }
  });

  $('logoutButton').addEventListener('click', async () => {
    await client.auth.signOut();
    state.isAdmin = false;
    state.orders = [];
    state.inventory = [];
    state.inventoryLoaded = false;
    $('dashboardView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
    $('password').value = '';
    setFeedback('loginFeedback', 'Sessão encerrada.', true);
  });

  async function loadOrders() {
    $('refreshButton').disabled = true;
    setFeedback('dashboardFeedback', 'Atualizando pedidos…', true);
    try {
      const { data, error } = await client
        .from('orders')
        .select('id,order_number,customer_name,customer_phone,customer_email,status,payment_status,subtotal,discount,total,affiliate_ref,notes,created_at,order_items(id,product_name_snapshot,variant_name_snapshot,sku_snapshot,unit_price,quantity,line_total),payments(id,method,amount,status,payment_reference,confirmed_at,notes,created_at)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      state.orders = data || [];
      renderOrders();
      setFeedback('dashboardFeedback', state.orders.length ? '' : 'Nenhum pedido encontrado.', true);
    } catch (error) {
      setFeedback('dashboardFeedback', error.message || 'Erro ao carregar pedidos.');
    } finally {
      $('refreshButton').disabled = false;
    }
  }

  function renderOrders() {
    const pending = state.orders.filter(order => order.payment_status === 'pending').length;
    const confirmed = state.orders.filter(order => order.payment_status === 'confirmed').length;
    $('statTotal').textContent = state.orders.length;
    $('statPending').textContent = pending;
    $('statPaid').textContent = confirmed;

    const query = $('orderSearch').value.trim().toLocaleLowerCase('pt-BR');
    const filter = $('statusFilter').value;
    const rows = state.orders.filter(order => {
      const matchesQuery = [order.order_number, order.customer_name, order.customer_phone].join(' ').toLocaleLowerCase('pt-BR').includes(query);
      const matchesFilter = filter === 'all' ||
        (filter === 'pending' && order.payment_status === 'pending') ||
        (filter === 'confirmed' && order.payment_status === 'confirmed') ||
        (filter === 'other' && !['pending','confirmed'].includes(order.payment_status));
      return matchesQuery && matchesFilter;
    });

    $('ordersBody').innerHTML = rows.length ? rows.map(order => {
      const isPending = order.payment_status === 'pending';
      const label = statusLabels[order.status] || order.status;
      const payment = paymentLabels[order.payment_status] || order.payment_status;
      const badgeClass = isPending ? 'pending' : order.payment_status === 'confirmed' ? 'confirmed' : 'other';
      return '<tr>' +
        '<td><span class="order-number">#' + escapeHtml(order.order_number) + '</span><span class="subline">' + escapeHtml(payment) + '</span></td>' +
        '<td><span class="customer-name">' + escapeHtml(order.customer_name) + '</span><span class="subline">' + escapeHtml(order.customer_phone) + '</span></td>' +
        '<td>' + escapeHtml(date(order.created_at)) + '</td>' +
        '<td><strong>' + escapeHtml(money(order.total)) + '</strong></td>' +
        '<td><span class="status ' + badgeClass + '">' + escapeHtml(label) + '</span></td>' +
        '<td><button class="view-button" type="button" data-order-id="' + escapeHtml(order.id) + '">Detalhes</button></td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="6" class="empty-cell">Nenhum pedido corresponde ao filtro.</td></tr>';

    $('ordersBody').querySelectorAll('[data-order-id]').forEach(button => {
      button.addEventListener('click', () => openOrder(button.dataset.orderId));
    });
  }

  async function loadInventory() {
    $('refreshButton').disabled = true;
    setFeedback('dashboardFeedback', 'Atualizando estoque…', true);
    try {
      const { data, error } = await client
        .from('product_variants')
        .select('id,name,sku,active,product:products(name),inventory_balances(quantity_on_hand,low_stock_threshold)')
        .order('name', { ascending: true });
      if (error) throw error;
      state.inventory = data || [];
      state.inventoryLoaded = true;
      renderInventory();
      setFeedback('dashboardFeedback', '', true);
    } catch (error) {
      setFeedback('dashboardFeedback', error.message || 'Erro ao carregar estoque.');
      $('inventoryBody').innerHTML = '<tr><td colspan="5" class="empty-cell">Não foi possível carregar o estoque.</td></tr>';
    } finally {
      $('refreshButton').disabled = false;
    }
  }

  function balanceFor(variant) {
    const balance = Array.isArray(variant.inventory_balances)
      ? variant.inventory_balances[0]
      : variant.inventory_balances;
    return balance || null;
  }

  function renderInventory() {
    const current = $('inventoryVariant').value;
    const options = state.inventory.map(variant => {
      const productName = variant.product?.name || 'Produto';
      return '<option value="' + escapeHtml(variant.id) + '">' +
        escapeHtml(productName + ' — ' + variant.name + (variant.sku ? ' (' + variant.sku + ')' : '') + (variant.active ? '' : ' [inativa]')) +
        '</option>';
    }).join('');
    $('inventoryVariant').innerHTML = '<option value="">Selecione uma variante</option>' + options;
    if (current && state.inventory.some(item => item.id === current)) $('inventoryVariant').value = current;

    $('inventoryBody').innerHTML = state.inventory.length ? state.inventory.map(variant => {
      const balance = balanceFor(variant);
      const quantity = balance ? Number(balance.quantity_on_hand) : 0;
      const threshold = balance ? Number(balance.low_stock_threshold ?? 3) : 3;
      let situation = 'Sem saldo cadastrado';
      let className = 'stock-state';
      if (quantity === 0 && balance) situation = 'Sem estoque';
      else if (quantity > 0 && quantity <= threshold) { situation = 'Estoque baixo'; className += ' low'; }
      else if (quantity > threshold) { situation = 'Disponível'; className += ' ok'; }
      return '<tr>' +
        '<td><strong>' + escapeHtml(variant.product?.name || 'Produto') + '</strong></td>' +
        '<td>' + escapeHtml(variant.name) + (variant.active ? '' : '<span class="subline">Variante inativa</span>') + '</td>' +
        '<td>' + escapeHtml(variant.sku || '—') + '</td>' +
        '<td><strong>' + escapeHtml(quantity) + '</strong></td>' +
        '<td><span class="' + className + '">' + escapeHtml(situation) + '</span></td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="5" class="empty-cell">Nenhuma variante encontrada.</td></tr>';
  }

  function showPanel(panel) {
    const inventory = panel === 'inventory';
    $('ordersPanel').classList.toggle('hidden', inventory);
    $('inventoryPanel').classList.toggle('hidden', !inventory);
    $('dashboardTitle').textContent = inventory ? 'Estoque' : 'Pedidos';
    $('dashboardSubtitle').textContent = inventory
      ? 'Consulte os saldos e registre entradas reais de mercadoria.'
      : 'Consulte os pedidos e confira os pagamentos recebidos.';
    $('ordersButton').classList.toggle('active-tab', !inventory);
    $('inventoryButton').classList.toggle('active-tab', inventory);
    setFeedback('dashboardFeedback', '');
    if (inventory && !state.inventoryLoaded) loadInventory();
  }

  function openOrder(id) {
    const order = state.orders.find(item => item.id === id);
    if (!order) return;
    state.selectedOrder = order;
    const payment = latestPayment(order);
    $('dialogTitle').textContent = 'Pedido #' + order.order_number;
    $('paymentReference').value = payment?.payment_reference || '';
    $('paymentNotes').value = '';
    $('confirmFeedback').textContent = '';

    const details = [
      ['Cliente', order.customer_name],
      ['Telefone', order.customer_phone],
      ['E-mail', order.customer_email || '—'],
      ['Data do pedido', date(order.created_at)],
      ['Status do pedido', statusLabels[order.status] || order.status],
      ['Status do pagamento', paymentLabels[order.payment_status] || order.payment_status],
      ['Forma de pagamento', methodLabels[payment?.method] || payment?.method || '—'],
      ['Referência afiliado', order.affiliate_ref || '—'],
      ['Subtotal', money(order.subtotal)],
      ['Desconto', money(order.discount)],
      ['Total', money(order.total)],
      ['Pagamento registrado', payment ? money(payment.amount) : '—']
    ];
    const detailHtml = '<div class="detail-grid">' + details.map(([label,value]) =>
      '<div class="detail-box"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>'
    ).join('') + '</div>';

    const itemsHtml = (order.order_items || []).map(item =>
      '<div class="item-row"><div><strong>' + escapeHtml(item.product_name_snapshot) + '</strong><small>' +
      escapeHtml(item.variant_name_snapshot) + ' · ' + escapeHtml(item.quantity) + ' × ' + escapeHtml(money(item.unit_price)) +
      '</small></div><span class="item-total">' + escapeHtml(money(item.line_total)) + '</span></div>'
    ).join('') || '<div class="item-row">Itens não encontrados.</div>';

    $('orderDetails').innerHTML = detailHtml +
      '<div class="detail-section-title">Itens do pedido</div><div class="item-list">' + itemsHtml + '</div>' +
      (order.notes ? '<div class="detail-section-title">Observações do pedido</div><p>' + escapeHtml(order.notes) + '</p>' : '');

    const canConfirm = order.payment_status === 'pending' && ['pending_payment','payment_issue'].includes(order.status);
    $('confirmForm').classList.toggle('hidden', !canConfirm);
    $('orderDialog').showModal();
  }

  $('inventoryForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.isAdmin) return;
    const variantId = $('inventoryVariant').value;
    const quantity = Number($('inventoryQuantity').value);
    if (!variantId || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
      setFeedback('inventoryFeedback', 'Selecione uma variante e informe uma quantidade inteira válida.');
      return;
    }

    const button = $('inventorySubmit');
    button.disabled = true;
    setFeedback('inventoryFeedback', 'Registrando entrada…', true);
    try {
      const { data, error } = await client.rpc('register_inventory_entry', {
        p_variant_id: variantId,
        p_quantity: quantity,
        p_notes: $('inventoryNotes').value.trim() || null
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      $('inventoryQuantity').value = '';
      $('inventoryNotes').value = '';
      await loadInventory();
      setFeedback('inventoryFeedback', 'Entrada registrada. Novo saldo: ' + data.quantity_on_hand + ' unidades.', true);
    } catch (error) {
      setFeedback('inventoryFeedback', error.message || 'Não foi possível registrar a entrada.');
    } finally {
      button.disabled = false;
    }
  });

  $('confirmForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const order = state.selectedOrder;
    if (!order || !state.isAdmin) return;
    const button = $('confirmButton');
    const accepted = window.confirm(
      'Confirma que o pagamento do pedido #' + order.order_number + ' foi recebido?\n\n' +
      'A confirmação altera o pedido para PAGO e baixa o estoque das variantes automaticamente.'
    );
    if (!accepted) return;

    button.disabled = true;
    setFeedback('confirmFeedback', 'Confirmando pagamento…', true);
    try {
      const { data, error } = await client.functions.invoke('confirm-payment', {
        body: {
          order_id: order.id,
          payment_reference: $('paymentReference').value.trim() || null,
          notes: $('paymentNotes').value.trim() || null
        }
      });
      if (error) {
        let message = error.message || 'Falha ao confirmar pagamento.';
        if (error.context && typeof error.context.json === 'function') {
          try { const body = await error.context.json(); message = body.error || message; } catch (_) {}
        }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      setFeedback('confirmFeedback', 'Pagamento confirmado. Atualizando pedido…', true);
      await loadOrders();
      const updated = state.orders.find(item => item.id === order.id);
      if (updated) {
        state.selectedOrder = updated;
        $('confirmForm').classList.add('hidden');
        $('orderDetails').insertAdjacentHTML('afterbegin', '<p class="status confirmed">Pagamento confirmado com sucesso.</p>');
      }
      $('toast').textContent = 'Pagamento confirmado e estoque atualizado.';
      $('toast').classList.add('show');
      window.setTimeout(() => $('toast').classList.remove('show'), 3200);
    } catch (error) {
      setFeedback('confirmFeedback', error.message || 'Não foi possível confirmar o pagamento.');
    } finally {
      button.disabled = false;
    }
  });

  $('closeDialog').addEventListener('click', () => $('orderDialog').close());
  $('orderDialog').addEventListener('click', (event) => {
    if (event.target === $('orderDialog')) $('orderDialog').close();
  });
  $('refreshButton').addEventListener('click', () => {
    if (!$('inventoryPanel').classList.contains('hidden')) loadInventory();
    else loadOrders();
  });
  $('ordersButton').addEventListener('click', () => showPanel('orders'));
  $('inventoryButton').addEventListener('click', () => showPanel('inventory'));
  $('orderSearch').addEventListener('input', renderOrders);
  $('statusFilter').addEventListener('change', renderOrders);

  restoreSession().catch(error => setFeedback('loginFeedback', error.message || 'Não foi possível validar a sessão.'));
})();