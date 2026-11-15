// Fictional store used as the application under test; the discount code bug is intentional.
(() => {
  const PRODUCTS = [
    { id: 'tent', name: 'Ridgeline 2P Tent', meta: 'Three-season · 1.9 kg', price: 249, icon: '⛺', bg: 'linear-gradient(135deg,#0ea5e9,#0f766e)' },
    { id: 'jacket', name: 'Alpine Down Jacket', meta: '800-fill · Packable', price: 189, icon: '🧥', bg: 'linear-gradient(135deg,#f97316,#b45309)' },
    { id: 'pack', name: 'Trail Runner Pack 28L', meta: 'Vest-style harness', price: 119, icon: '🎒', bg: 'linear-gradient(135deg,#6366f1,#312e81)' },
    { id: 'bag', name: 'Basecamp Sleeping Bag', meta: 'Comfort −5 °C', price: 139, icon: '🛌', bg: 'linear-gradient(135deg,#ec4899,#831843)' },
    { id: 'cook', name: 'Titanium Cook Set', meta: '750 ml pot + lid', price: 64, icon: '🍲', bg: 'linear-gradient(135deg,#64748b,#1e293b)' },
    { id: 'lamp', name: 'Headlamp 400 lm', meta: 'USB-C · IPX6', price: 39, icon: '🔦', bg: 'linear-gradient(135deg,#eab308,#a16207)' },
  ];
  const CODES = { SAVE10: { pct: 10 }, SUMMER24: { expired: true } };
  const money = (n) => n.toFixed(2);
  const $ = (s, r = document) => r.querySelector(s);

  const state = {
    get cart() {
      try { return JSON.parse(sessionStorage.getItem('cart') || '{}'); } catch { return {}; }
    },
    set cart(v) { sessionStorage.setItem('cart', JSON.stringify(v)); renderBadge(); },
    get code() { return sessionStorage.getItem('code') || ''; },
    set code(v) { if (v) sessionStorage.setItem('code', v); else sessionStorage.removeItem('code'); },
  };
  const items = () => Object.entries(state.cart).map(([id, qty]) => ({ ...PRODUCTS.find((p) => p.id === id), qty }));
  const totals = (shippingMethod = 'standard') => {
    const subtotal = items().reduce((a, i) => a + i.price * i.qty, 0);
    const code = CODES[state.code];
    const discount = code && code.pct ? subtotal * (code.pct / 100) : 0;
    const shipping = subtotal === 0 ? 0 : shippingMethod === 'express' ? 14.95 : subtotal >= 75 ? 0 : 6.95;
    // BUG (intentional, for demos): the discount is displayed but not subtracted.
    const total = subtotal + shipping;
    return { subtotal, discount, shipping, total };
  };

  function renderBadge() {
    const n = items().reduce((a, i) => a + i.qty, 0);
    const b = $('#cart-badge');
    b.textContent = n;
    b.hidden = n === 0;
  }
  let toastT;
  function toast(msg) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    clearTimeout(toastT);
    toastT = setTimeout(() => t.remove(), 1800);
  }

  const views = {
    '/': () => `
      <div class="hero"><div><h1>Gear for the long way round</h1><p>Free shipping on orders over $75.</p></div></div>
      <div class="grid">${PRODUCTS.map((p) => `
        <article class="card">
          <div class="card__img" style="background:${p.bg}">${p.icon}</div>
          <div class="card__body">
            <div class="card__name">${p.name}</div>
            <div class="card__meta">${p.meta}</div>
            <div class="card__row"><span class="price">$${money(p.price)}</span><button class="btn btn--sm" data-add="${p.id}" aria-label="Add ${p.name} to cart">Add to cart</button></div>
          </div>
        </article>`).join('')}</div>`,
    '/cart': () => {
      const list = items();
      if (!list.length) return `<h1>Your cart</h1><div class="panel empty">Your cart is empty. <a href="/" data-link class="link">Continue shopping</a></div>`;
      const t = totals();
      const code = CODES[state.code];
      return `
      <h1>Your cart</h1>
      <div class="two">
        <section class="panel">
          ${list.map((i) => `
            <div class="line" data-line="${i.id}">
              <div class="line__thumb" style="background:${i.bg}">${i.icon}</div>
              <div class="grow"><div class="line__name">${i.name}</div><div class="line__meta">$${money(i.price)} each</div></div>
              <div class="qty"><button data-dec="${i.id}" aria-label="Decrease quantity">−</button><input aria-label="Quantity of ${i.name}" data-qty="${i.id}" value="${i.qty}" inputmode="numeric"><button data-inc="${i.id}" aria-label="Increase quantity">+</button></div>
              <div class="price">$${money(i.price * i.qty)}</div>
              <button class="link" data-remove="${i.id}">Remove</button>
            </div>`).join('')}
        </section>
        <aside class="panel">
          <h2>Order summary</h2>
          <div class="sum"><span>Subtotal</span><span id="sum-subtotal">$${money(t.subtotal)}</span></div>
          ${t.discount ? `<div class="sum sum--discount"><span>Discount (${state.code})</span><span id="sum-discount">−$${money(t.discount)}</span></div>` : ''}
          <div class="sum"><span>Shipping</span><span id="sum-shipping">${t.shipping ? `$${money(t.shipping)}` : 'Free'}</span></div>
          <div class="sum sum--total"><span>Total</span><span id="sum-total">$${money(t.total)}</span></div>
          <form class="coupon" id="coupon-form">
            <input id="coupon" name="coupon" placeholder="Discount code" aria-label="Discount code" value="${code ? state.code : ''}" autocomplete="off">
            <button class="btn btn--ghost" type="submit">Apply</button>
          </form>
          <p class="msg" id="coupon-msg">${code && !code.expired ? '<span class="msg--ok">Discount applied</span>' : ''}</p>
          <a href="/checkout" data-link class="btn" style="display:block;text-align:center;margin-top:14px">Checkout</a>
        </aside>
      </div>`;
    },
    '/checkout': () => {
      if (!items().length) return views['/cart']();
      const t = totals();
      return `
      <h1>Checkout</h1>
      <div class="two">
        <form class="panel" id="checkout-form" novalidate>
          <h2>Contact</h2>
          <div class="row2">
            <label>Full name<input name="name" autocomplete="name" required></label>
            <label>Email<input name="email" type="email" autocomplete="email" required></label>
          </div>
          <h2>Shipping address</h2>
          <label>Street address<input name="address" autocomplete="street-address" required></label>
          <div class="row3">
            <label>City<input name="city" required></label>
            <label>Postal code<input name="postal" required></label>
            <label>Country<select name="country"><option>Norway</option><option>Sweden</option><option>Denmark</option><option>Germany</option><option>Netherlands</option></select></label>
          </div>
          <h2>Shipping method</h2>
          <label class="radio"><input type="radio" name="shipping" value="standard" checked> Standard (3–5 days) — ${t.subtotal >= 75 ? 'Free' : '$6.95'}</label>
          <label class="radio"><input type="radio" name="shipping" value="express"> Express (1–2 days) — $14.95</label>
          <h2>Payment</h2>
          <label>Card number<input name="card" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" required></label>
          <div class="row2">
            <label>Expiry<input name="expiry" placeholder="MM/YY" autocomplete="cc-exp" required></label>
            <label>CVC<input name="cvc" inputmode="numeric" autocomplete="cc-csc" required></label>
          </div>
          <button class="btn" type="submit" id="place-order">Place order</button>
        </form>
        <aside class="panel">
          <h2>Order summary</h2>
          ${items().map((i) => `<div class="sum"><span>${i.name} × ${i.qty}</span><span>$${money(i.price * i.qty)}</span></div>`).join('')}
          ${t.discount ? `<div class="sum sum--discount"><span>Discount (${state.code})</span><span>−$${money(t.discount)}</span></div>` : ''}
          <div class="sum"><span>Shipping</span><span id="co-shipping">${t.shipping ? `$${money(t.shipping)}` : 'Free'}</span></div>
          <div class="sum sum--total"><span>Total</span><span id="co-total">$${money(t.total)}</span></div>
        </aside>
      </div>`;
    },
    '/confirmation': () => {
      const o = JSON.parse(sessionStorage.getItem('order') || 'null');
      if (!o) return views['/']();
      return `
      <div class="confirm">
        <div style="font-size:44px">✅</div>
        <h1>Thanks, ${o.name.split(' ')[0]}!</h1>
        <p>Your order <span class="order-no">${o.number}</span> is confirmed. A receipt was sent to ${o.email}.</p>
      </div>
      <section class="panel" style="max-width:520px;margin:0 auto">
        ${o.items.map((i) => `<div class="sum"><span>${i.name} × ${i.qty}</span><span>$${money(i.price * i.qty)}</span></div>`).join('')}
        <div class="sum"><span>Shipping</span><span>${o.shipping ? `$${money(o.shipping)}` : 'Free'}</span></div>
        <div class="sum sum--total"><span>Charged</span><span>$${money(o.total)}</span></div>
      </section>`;
    },
  };

  function render() {
    const path = location.pathname in views ? location.pathname : '/';
    $('#view').innerHTML = views[path]();
    renderBadge();
    document.title = { '/': 'Summit Outfitters', '/cart': 'Cart · Summit Outfitters', '/checkout': 'Checkout · Summit Outfitters', '/confirmation': 'Order confirmed · Summit Outfitters' }[path];
    window.scrollTo(0, 0);
  }
  function go(path) {
    history.pushState({}, '', path);
    render();
  }

  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-link]');
    if (link) { e.preventDefault(); return go(new URL(link.href).pathname); }
    const btn = e.target.closest('button');
    if (!btn) return;
    const cart = state.cart;
    if (btn.dataset.add) { cart[btn.dataset.add] = (cart[btn.dataset.add] || 0) + 1; state.cart = cart; toast('Added to cart'); return; }
    if (btn.dataset.inc) { cart[btn.dataset.inc] += 1; state.cart = cart; return render(); }
    if (btn.dataset.dec) { cart[btn.dataset.dec] -= 1; if (cart[btn.dataset.dec] <= 0) delete cart[btn.dataset.dec]; state.cart = cart; return render(); }
    if (btn.dataset.remove) { delete cart[btn.dataset.remove]; state.cart = cart; return render(); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.dataset.qty) {
      const cart = state.cart;
      const n = parseInt(e.target.value, 10);
      if (!n || n <= 0) delete cart[e.target.dataset.qty]; else cart[e.target.dataset.qty] = n;
      state.cart = cart;
      render();
    }
    if (e.target.name === 'shipping') {
      const t = totals(e.target.value);
      $('#co-shipping').textContent = t.shipping ? `$${money(t.shipping)}` : 'Free';
      $('#co-total').textContent = `$${money(t.total)}`;
    }
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'coupon-form') {
      e.preventDefault();
      const code = $('#coupon').value.trim().toUpperCase();
      const msg = $('#coupon-msg');
      if (!code) return;
      if (!CODES[code]) { state.code = ''; msg.innerHTML = '<span class="msg--err">We don’t recognise that code</span>'; return; }
      if (CODES[code].expired) { state.code = ''; msg.innerHTML = '<span class="msg--err">This code has expired</span>'; return; }
      state.code = code;
      render();
      return;
    }
    if (e.target.id === 'checkout-form') {
      e.preventDefault();
      const form = e.target;
      let firstBad = null;
      for (const el of form.querySelectorAll('[required]')) {
        el.classList.remove('invalid');
        const old = el.parentElement.querySelector('.err');
        if (old) old.remove();
        if (!el.value.trim()) {
          el.classList.add('invalid');
          const s = document.createElement('span');
          s.className = 'err';
          s.textContent = 'Required';
          el.parentElement.appendChild(s);
          firstBad = firstBad || el;
        }
      }
      if (firstBad) return firstBad.focus();
      const fd = new FormData(form);
      const t = totals(fd.get('shipping'));
      const number = `SO-${String(Math.floor(100000 + Math.random() * 900000))}`;
      sessionStorage.setItem('order', JSON.stringify({ number, name: fd.get('name'), email: fd.get('email'), items: items(), shipping: t.shipping, total: t.total }));
      state.cart = {};
      state.code = '';
      go('/confirmation');
    }
  });
  window.addEventListener('popstate', render);
  render();
})();
