
    const grid = document.getElementById('productGrid');
    const modal = document.getElementById('productModal');
    const search = document.getElementById('search');
    let catalog = { brand: 'Aset Life', whatsapp: '', products: [] };
    const supabaseClient = window.supabase.createClient(window.ASET_SUPABASE_CONFIG.url, window.ASET_SUPABASE_CONFIG.anonKey);
    let selectedProduct = null;
    let currentAffiliate = null;
    let currentAffiliateId = '';
    const AFFILIATE_STORAGE_KEY = 'bp_affiliate_id';

    function captureAffiliate() {
      const params = new URLSearchParams(window.location.search);
      const referralId = (params.get('ref') || params.get('affiliate') || '').trim().toUpperCase();
      try {
        if (referralId) {
          currentAffiliateId = referralId;
          localStorage.setItem(AFFILIATE_STORAGE_KEY, referralId);
        } else {
          currentAffiliateId = (localStorage.getItem(AFFILIATE_STORAGE_KEY) || '').trim().toUpperCase();
        }
      } catch (_) {
        currentAffiliateId = referralId;
      }
      currentAffiliate = currentAffiliateId ? { id: currentAffiliateId } : null;
    }

    function money(value) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(value));
    }
    function waUrl(message) {
      const digits = String(catalog.whatsapp || '').replace(/\D/g, '');
      return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(message);
    }
    function safeText(value) {
      return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    }
    function productMinPrice(product) {
      const prices = (product.variants || []).map(v => Number(v.price)).filter(n => Number.isFinite(n) && n >= 0);
      return prices.length ? Math.min(...prices) : null;
    }
    let featuredProducts = [];
    let featuredIndex = 0;
    let featuredTimer = null;
    function renderFeaturedProduct() {
      if (!featuredProducts.length) return;
      const p = featuredProducts[featuredIndex];
      const variants = [...(p.variants || [])].sort((a,b) => Number(a.price) - Number(b.price));
      const featuredVariant = variants[0];
      document.getElementById('heroProductCategory').textContent = p.category || 'Destaque do catálogo';
      document.getElementById('heroProductName').textContent = p.name;
      document.getElementById('heroVialName').textContent = p.name;
      document.getElementById('heroProductDescription').textContent = p.shortDescription || 'Consulte os detalhes e as apresentações disponíveis no catálogo.';
      document.getElementById('heroProductSize').textContent = featuredVariant ? featuredVariant.size : 'Consulte apresentações';
      document.getElementById('heroProductPrice').textContent = featuredVariant ? money(featuredVariant.price) : 'Consulte';
      document.getElementById('heroBuyNow').dataset.product = p.id;
      document.getElementById('heroDots').innerHTML = featuredProducts.map((item,i) => '<button type="button" class="featured-dot' + (i===featuredIndex?' active':'') + '" data-feature-index="' + i + '" aria-label="Ver destaque ' + (i+1) + '" aria-current="' + (i===featuredIndex?'true':'false') + '"></button>').join('');
      document.querySelectorAll('[data-feature-index]').forEach(dot => dot.addEventListener('click', () => { featuredIndex = Number(dot.dataset.featureIndex); renderFeaturedProduct(); restartFeaturedTimer(); }));
    }
    function changeFeatured(direction) {
      if (!featuredProducts.length) return;
      featuredIndex = (featuredIndex + direction + featuredProducts.length) % featuredProducts.length;
      renderFeaturedProduct();
    }
    function restartFeaturedTimer() {
      if (featuredTimer) clearInterval(featuredTimer);
      if (featuredProducts.length > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        featuredTimer = setInterval(() => changeFeatured(1), 6500);
      }
    }
    function setupFeaturedProducts() {
      featuredProducts = (catalog.products || []).filter(p => p.active !== false && p.category !== 'Soluções & Diluentes' && (p.variants || []).length);
      if (!featuredProducts.length) return;
      renderFeaturedProduct();
      restartFeaturedTimer();
    }
    document.getElementById('heroBuyNow').addEventListener('click', () => {
      const id = document.getElementById('heroBuyNow').dataset.product;
      if (id) openProduct(id);
    });
    document.getElementById('heroPrev').addEventListener('click', () => { changeFeatured(-1); restartFeaturedTimer(); });
    document.getElementById('heroNext').addEventListener('click', () => { changeFeatured(1); restartFeaturedTimer(); });
    function renderProducts() {
      const query = search.value.trim().toLocaleLowerCase('pt-BR');
      const products = (catalog.products || []).filter(p => p.active !== false && [p.name,p.category,p.shortDescription,p.description].join(' ').toLocaleLowerCase('pt-BR').includes(query));
      document.getElementById('resultCount').textContent = products.length + (products.length === 1 ? ' produto' : ' produtos');
      if (!products.length) { grid.innerHTML = '<div class="empty">Nenhum produto encontrado. Tente outro termo de busca.</div>'; return; }
      grid.innerHTML = products.map(p => {
        const min = productMinPrice(p);
        const priceText = min === null ? 'Consulte' : 'A partir de ' + money(min);
        return '<article class="product"><div class="product-art"><div class="vial-visual"><img src="./assets/vial-base.png" alt="Frasco Aset Life Peptides"><span class="vial-name">' + safeText(p.name) + '</span></div></div><div class="product-body"><div class="tag">' + safeText(p.category || 'Catálogo') + '</div><h3>' + safeText(p.name) + '</h3><p class="short-desc">' + safeText(p.shortDescription || 'Abra para consultar os detalhes do produto.') + '</p><div class="price-row"><div><div class="price-caption">VALORES</div><div class="price">' + priceText + '</div></div><span class="tag">' + (p.variants || []).length + ' tamanhos</span></div><button class="btn btn-primary" type="button" data-product="' + safeText(p.id) + '">Ver detalhes ↗</button></div></article>';
      }).join('');
      grid.querySelectorAll('[data-product]').forEach(btn => btn.addEventListener('click', () => openProduct(btn.dataset.product)));
    }
    function openProduct(id) {
      const p = (catalog.products || []).find(item => item.id === id);
      if (!p) return;
      selectedProduct = p;
      document.getElementById('modalCategory').textContent = p.category || 'CATÁLOGO';
      document.getElementById('modalTitle').textContent = p.name;
      const variants = (p.variants || []);
      const variantHtml = variants.length ? '<h3>Escolha uma apresentação</h3><div class="variant-list">' + variants.map((v,i) => '<label class="variant"><span style="display:flex;align-items:center;gap:10px"><input type="radio" name="variant" value="' + i + '" ' + (i===0?'checked':'') + '><span class="variant-label">' + safeText(v.size) + '</span></span><span class="variant-price">' + money(v.price) + '</span></label>').join('') + '</div>' : '<p>Consulte a equipe para informações sobre apresentações.</p>';
      const useHtml = p.uses ? '<h3>Usos investigados / finalidade descrita</h3><p>' + safeText(p.uses) + '</p>' : '';
      const evidenceHtml = p.evidence ? '<h3>Contexto das evidências</h3><p>' + safeText(p.evidence) + '</p>' : '';
      const disclaimer = p.disclaimer || 'Informação geral, não é recomendação médica. Não use para diagnóstico, prevenção ou tratamento sem orientação profissional. Verifique a situação regulatória aplicável.';
      document.getElementById('modalContent').innerHTML = '<p>' + safeText(p.description || '') + '</p>' + useHtml + evidenceHtml + variantHtml + '<div class="modal-disclaimer">' + safeText(disclaimer) + '</div><button class="btn btn-primary" id="addFromDetails"><span class="wa-icon">＋</span> Adicionar ao carrinho</button>';
      document.getElementById('addFromDetails').addEventListener('click', () => { const chosen = modal.querySelector('input[name="variant"]:checked'); const variant = chosen ? variants[Number(chosen.value)] : null; if (!variant) { alert('Este produto não possui apresentação cadastrada.'); return; } addToCart(p, variant); closeModal(); openCart(); });
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
      document.getElementById('closeModal').focus();
    }

    const cart = new Map();
    const cartBackdrop = document.getElementById('cartBackdrop');
    const cartItemsEl = document.getElementById('cartItems');
    const cartTotalEl = document.getElementById('cartTotal');
    const cartCountEl = document.getElementById('cartCount');
    const toastEl = document.getElementById('toast');
    let toastTimer;
    function addToCart(product, variant) {
      const key = String(product.id) + '::' + String(variant.size);
      const existing = cart.get(key);
      if (existing) existing.qty += 1;
      else cart.set(key, { id: product.id, variantId: variant.id, name: product.name, size: variant.size, price: Number(variant.price), qty: 1 });
      renderCart();
      toastEl.textContent = product.name + ' adicionado ao carrinho';
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
    }
    function changeQty(key, delta) { const item = cart.get(key); if (!item) return; item.qty += delta; if (item.qty <= 0) cart.delete(key); renderCart(); }
    function renderCart() {
      const count = [...cart.values()].reduce((sum, item) => sum + item.qty, 0);
      const total = [...cart.values()].reduce((sum, item) => sum + item.price * item.qty, 0);
      cartCountEl.textContent = count;
      cartTotalEl.textContent = money(total);
      if (!count) {
        cartItemsEl.innerHTML = '<div class="cart-empty">Seu carrinho está vazio.<br><span>Adicione produtos do catálogo para continuar.</span></div>';
        document.getElementById('checkoutWhatsapp').disabled = true;
        document.getElementById('checkoutWhatsapp').style.opacity = '.55';
        return;
      }
      document.getElementById('checkoutWhatsapp').disabled = false;
      document.getElementById('checkoutWhatsapp').style.opacity = '1';
      cartItemsEl.innerHTML = [...cart.entries()].map(([key, item]) => '<div class="cart-line"><div class="cart-line-top"><div><div class="cart-line-name">' + safeText(item.name) + '</div><div class="cart-line-meta">' + safeText(item.size) + ' · ' + money(item.price) + ' por unidade</div></div><div class="cart-line-price">' + money(item.price * item.qty) + '</div></div><div class="cart-line-controls"><div class="qty-control"><button type="button" data-qty="-1" data-key="' + safeText(key) + '" aria-label="Diminuir quantidade">−</button><span>' + item.qty + '</span><button type="button" data-qty="1" data-key="' + safeText(key) + '" aria-label="Aumentar quantidade">+</button></div><button type="button" class="remove-item" data-remove="' + safeText(key) + '">Remover</button></div></div>').join('');
      cartItemsEl.querySelectorAll('[data-qty]').forEach(btn => btn.addEventListener('click', () => changeQty(btn.dataset.key, Number(btn.dataset.qty))));
      cartItemsEl.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => { cart.delete(btn.dataset.remove); renderCart(); }));
    }
    function openCart() { renderCart(); cartBackdrop.classList.add('open'); document.body.style.overflow = 'hidden'; document.getElementById('closeCart').focus(); }
    function closeCart() { cartBackdrop.classList.remove('open'); document.body.style.overflow = ''; }
    document.getElementById('openCart').addEventListener('click', openCart);
    document.getElementById('closeCart').addEventListener('click', closeCart);
    cartBackdrop.addEventListener('click', e => { if (e.target === cartBackdrop) closeCart(); });
    document.getElementById('checkoutWhatsapp').addEventListener('click', async () => {
      if (!cart.size) return;
      if (!catalog.whatsapp || catalog.whatsapp.replace(/\D/g, '').length < 10) {
        alert('O WhatsApp da loja não está configurado. Entre em contato com o suporte.');
        return;
      }

      const customerName = window.prompt('Informe seu nome completo:');
      if (!customerName || !customerName.trim()) return;
      const customerPhone = window.prompt('Informe seu telefone com DDD:');
      if (!customerPhone || customerPhone.replace(/\D/g, '').length < 10) return;
      const paymentChoice = (window.prompt('Forma de pagamento: PIX, transferência, dinheiro ou outro.', 'PIX') || '').trim().toLowerCase();
      const paymentMap = { pix: 'pix', 'transferência': 'transfer', transferencia: 'transfer', dinheiro: 'cash', cash: 'cash', outro: 'other', other: 'other' };
      const paymentMethod = paymentMap[paymentChoice];
      if (!paymentMethod) {
        alert('Forma de pagamento inválida. Informe PIX, transferência, dinheiro ou outro.');
        return;
      }

      const items = [...cart.values()];
      if (items.some(item => !item.variantId)) {
        alert('Uma apresentação do carrinho não possui vínculo com o catálogo. Atualize a página e tente novamente.');
        return;
      }

      const checkoutButton = document.getElementById('checkoutWhatsapp');
      const originalLabel = checkoutButton.textContent;
      const whatsappWindow = window.open('about:blank', '_blank');
      checkoutButton.disabled = true;
      checkoutButton.textContent = 'Registrando pedido...';

      try {
        const response = await fetch(window.ASET_SUPABASE_CONFIG.url + '/functions/v1/create-order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': window.ASET_SUPABASE_CONFIG.anonKey
          },
          body: JSON.stringify({
            customer_name: customerName.trim(),
            customer_phone: customerPhone,
            payment_method: paymentMethod,
            affiliate_ref: currentAffiliateId || null,
            items: items.map(item => ({ variant_id: item.variantId, quantity: item.qty }))
          })
        });
        const result = await response.json();
        if (!response.ok || !result.data || !result.data.order_id) {
          throw new Error(result.error || 'Não foi possível registrar o pedido.');
        }

        const order = result.data;
        const lines = items.map(item => '• ' + item.name + ' — ' + item.size + ' | Qtd: ' + item.qty + ' | ' + money(item.price * item.qty));
        const affiliateLine = currentAffiliateId ? '\nREF: ' + currentAffiliateId : '';
        const message = 'Olá! Meu pedido foi registrado no site.\n\nPedido nº: ' + order.order_number +
          '\n' + lines.join('\n') + '\n\nTotal registrado: ' + money(order.total) +
          '\nPagamento: ' + paymentChoice.toUpperCase() + affiliateLine +
          '\n\nAguardo as orientações para pagamento e confirmação.';
        const destination = waUrl(message);
        if (whatsappWindow) {
          whatsappWindow.location.href = destination;
        } else {
          window.location.href = destination;
        }
        cart.clear();
        renderCart();
        closeCart();
      } catch (error) {
        if (whatsappWindow) whatsappWindow.close();
        alert(error.message || 'Falha ao registrar o pedido. Tente novamente.');
      } finally {
        checkoutButton.disabled = cart.size === 0;
        checkoutButton.textContent = originalLabel;
      }
    });

    const calcProductAmount = document.getElementById("calcProductAmount");
    const calcWaterVolume = document.getElementById("calcWaterVolume");
    function formatCalc(value, maximumFractionDigits = 6) {
      return new Intl.NumberFormat("pt-BR", { maximumFractionDigits }).format(value);
    }
    function updateCalculator() {
      const productAmount = Number(calcProductAmount.value);
      const waterVolume = Number(calcWaterVolume.value);
      const validProduct = calcProductAmount.value !== "" && Number.isFinite(productAmount) && productAmount > 0;
      const validVolume = calcWaterVolume.value !== "" && Number.isFinite(waterVolume) && waterVolume > 0;
      if (!validProduct || !validVolume) {
        document.getElementById("calcConcentrationResult").textContent = "Informe valores positivos para o produto e o volume.";
      } else {
        const mgMl = productAmount / waterVolume;
        document.getElementById("calcConcentrationResult").textContent =
          formatCalc(mgMl) + " mg/mL";
        document.getElementById("calcConverted").textContent =
          formatCalc(mgMl * 1000) + " mcg/mL";
      }
    }
    [calcProductAmount, calcWaterVolume].forEach(field => {
      field.addEventListener("input", updateCalculator);
      field.addEventListener("change", updateCalculator);
    });
    updateCalculator();

    function closeModal() { modal.classList.remove('open'); document.body.style.overflow = ''; }
    document.getElementById('closeModal').addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    search.addEventListener('input', renderProducts);

    function setupAffiliatePopup() {
      const popup = document.getElementById('affiliatePopup');
      const closeButton = document.getElementById('affiliatePopupClose');
      const dismissButton = document.getElementById('affiliatePopupDismiss');
      const whatsappButton = document.getElementById('affiliatePopupWhatsapp');
      const storageKey = 'aset_affiliate_popup_seen';
      if (!popup || !closeButton || !dismissButton || !whatsappButton) return;
      whatsappButton.href = waUrl('Olá! Tenho interesse em participar do programa de afiliados da Aset Life Peptides. Gostaria de solicitar meu link exclusivo para divulgar e receber comissões pelas vendas realizadas por meio das minhas indicações. Poderiam me informar como funciona o cadastro e as condições do programa?');
      const closePopup = () => {
        popup.classList.remove('open');
        document.body.style.overflow = '';
        try { sessionStorage.setItem(storageKey, '1'); } catch (_) {}
      };
      closeButton.addEventListener('click', closePopup);
      dismissButton.addEventListener('click', closePopup);
      popup.addEventListener('click', event => { if (event.target === popup) closePopup(); });
      document.addEventListener('keydown', event => { if (event.key === 'Escape' && popup.classList.contains('open')) closePopup(); });
      let alreadySeen = false;
      try { alreadySeen = sessionStorage.getItem(storageKey) === '1'; } catch (_) {}
      const phoneIsValid = String(catalog.whatsapp || '').replace(/\\D/g, '').length >= 10;
      if (!alreadySeen && !currentAffiliateId && phoneIsValid) {
        window.setTimeout(() => {
          popup.classList.add('open');
          document.body.style.overflow = 'hidden';
          closeButton.focus();
        }, 900);
      }
    }

    async function loadCatalogFromSupabase() {
      const [settingsResult, productsResult] = await Promise.all([
        supabaseClient.from('site_settings').select('key,value').in('key', ['brand', 'whatsapp']),
        supabaseClient.from('products')
          .select('id,legacy_id,name,short_description,description,uses,evidence,disclaimer,active,sort_order,product_categories(category:categories(name,sort_order)),product_variants(id,name,price,active,sort_order)')
          .eq('active', true)
          .order('sort_order', { ascending: true })
      ]);

      if (settingsResult.error) throw settingsResult.error;
      if (productsResult.error) throw productsResult.error;

      const settings = Object.fromEntries((settingsResult.data || []).map(item => [item.key, item.value]));
      catalog = {
        brand: settings.brand || 'Aset Life',
        whatsapp: String(settings.whatsapp || ''),
        products: (productsResult.data || []).map(product => {
          const categories = (product.product_categories || [])
            .map(item => item.category)
            .filter(Boolean)
            .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
            .map(item => item.name);
          const variants = (product.product_variants || [])
            .filter(variant => variant.active)
            .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
            .map(variant => ({
              id: variant.id,
              size: variant.name,
              price: Number(variant.price)
            }));
          return {
            id: product.id,
            legacyId: product.legacy_id,
            name: product.name,
            active: product.active,
            category: categories[0] || 'Catálogo',
            categories,
            shortDescription: product.short_description || '',
            description: product.description || '',
            uses: product.uses || '',
            evidence: product.evidence || '',
            disclaimer: product.disclaimer || '',
            variants
          };
        })
      };

      captureAffiliate();
      const brand = catalog.brand || 'Aset Life';
      document.getElementById('brandName').textContent = brand.toUpperCase();
      document.getElementById('footerBrand').textContent = brand.toUpperCase();
      document.title = brand + ' — Catálogo';
      const footerLink = document.getElementById('footerWhatsapp');
      if (footerLink) {
        footerLink.href = catalog.whatsapp.replace(/\D/g, '').length >= 10
          ? waUrl('Olá! Gostaria de mais informações sobre o catálogo.')
          : '#catalogo';
      }
      renderProducts();
      setupFeaturedProducts();
      setupAffiliatePopup();
    }

    loadCatalogFromSupabase().catch(error => {
      console.error('Erro ao carregar o catálogo do Supabase:', error);
      grid.innerHTML = '<div class="empty">Não foi possível carregar o catálogo. Atualize a página ou tente novamente mais tarde.</div>';
    });
  