

    // ─── SCROLL-BASED NAVIGATION ───

    function showPage(id) {

      const el = document.getElementById('page-' + id);

      if (el) {

        const top = el.getBoundingClientRect().top + window.scrollY - 68;

        window.scrollTo({ top: top, behavior: 'smooth' });

      }

    }



    // Scroll to a specific section by ID

    function showSection(sectionId) {

      const target = document.getElementById(sectionId);

      if (target) {

        const top = target.getBoundingClientRect().top + window.scrollY - 80;

        window.scrollTo({ behavior: 'smooth', top: top });

      }

    }



    // ─── ACTIVE NAV ON SCROLL ───

    const pages = ['home', 'about', 'services', 'services-des', 'projects', 'contact'];



    function updateActiveNav() {

      let current = 'home';

      pages.forEach(id => {

        const el = document.getElementById('page-' + id);

        if (el) {

          const rect = el.getBoundingClientRect();

          if (rect.top <= 100) current = id;

        }

      });

      document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));

      const navEl = document.getElementById('nav-' + current);

      if (navEl) navEl.classList.add('active');

    }



    window.addEventListener('scroll', updateActiveNav, { passive: true });



    // ─── LOAD: scroll to hash or top ───

    window.addEventListener('load', () => {

      const hash = window.location.hash.replace('#', '');

      if (hash) {

        setTimeout(() => showPage(hash), 100);

      }

      updateActiveNav();

    });



    // ─── HAMBURGER ───

    document.getElementById('hamburger').addEventListener('click', function () {

      const menu = document.getElementById('mobileMenu');

      menu.classList.toggle('open');

    });



    function closeMobile() {

      document.getElementById('mobileMenu').classList.remove('open');

    }



    // ─── FADE UP OBSERVER ───

    function initFadeUp() {

      const els = document.querySelectorAll('.fade-up');

      if ('IntersectionObserver' in window) {

        const obs = new IntersectionObserver((entries) => {

          entries.forEach(e => {

            if (e.isIntersecting) {

              e.target.classList.add('visible');

              obs.unobserve(e.target);

            }

          });

        }, { threshold: 0.1 });

        els.forEach((el, i) => {

          obs.observe(el);

        });

      } else {

        els.forEach(el => el.classList.add('visible'));

      }

    }



    // ─── PROJECT FILTER ───

    function filterProjects(type, btn) {



      // Active button

      document.querySelectorAll('.filter-btn').forEach(b => {

        b.classList.remove('active');

      });



      btn.classList.add('active');



      // Filter projects (scoped to the full portfolio page only)

      document.querySelectorAll('#page-projects-des .project-card').forEach(card => {



        if (

          type === 'all' ||

          card.dataset.status === type

        ) {



          card.style.display = '';



        } else {



          card.style.display = 'none';



        }



      });

    }



    // ─── CONTACT FORM (Web3Forms) ───

    async function submitForm(e) {

      e.preventDefault();

      const form = e.target;

      const btn = document.getElementById('submitBtn');



      // Grab values for WhatsApp

      const name = document.getElementById('fname').value.trim();

      const email = document.getElementById('femail').value.trim();

      const phone = document.getElementById('fphone').value.trim();

      const service = document.getElementById('fservice').value;

      const message = document.getElementById('fmessage').value.trim();



      // Button loading state

      btn.textContent = 'Sending...';

      btn.disabled = true;

      btn.style.opacity = '0.7';



      const serviceLabels = {

        'website-design': 'Website Design', 'landing-page': 'Landing Page',

        'website-redesign': 'Website Redesign',

        smm: 'Social Media Marketing', smmm: 'Social Media Management', seo: 'SEO',

        ads: 'Paid Ads', im: 'Influencer Marketing', email: 'Email Marketing', other: 'Other / Not Sure'

      };

      const serviceLabel = serviceLabels[service] || service;



      // Build WhatsApp link

      const waPhone = '919074026830';

      const waText = encodeURIComponent(

        `Hi Leafy Digital! I just submitted an enquiry via your website.



` +

        `*Name:* ${name}

` +

        `*Email:* ${email}

` +

        `*Phone:* ${phone || 'Not provided'}

` +

        `*Service:* ${serviceLabel}

` +

        `*Message:* ${message}`

      );

      const waLink = `https://wa.me/${waPhone}?text=${waText}`;



      try {

        // Submit to Web3Forms API

        const formData = new FormData(form);

        // Add service label as readable text

        formData.set('service', serviceLabel);



        const response = await fetch('https://api.web3forms.com/submit', {

          method: 'POST',

          body: formData

        });



        const result = await response.json();



        if (result.success) {

          // Success — show confirmation + WhatsApp button

          document.getElementById('whatsappFollowup').href = waLink;

          btn.style.display = 'none';

          const successEl = document.getElementById('formSuccess');

          successEl.style.display = 'flex';

          form.reset();

        } else {

          throw new Error(result.message || 'Submission failed');

        }



      } catch (err) {

        console.error('Form error:', err);

        // Still show WhatsApp fallback so client can reach you

        document.getElementById('whatsappFollowup').href = waLink;

        btn.textContent = 'Send Message →';

        btn.disabled = false;

        btn.style.opacity = '1';

        // Show a gentle error

        alert('There was an issue sending your message. Please use WhatsApp to reach us directly — we respond within the hour!');

      }

    }



    // ─── INLINE SERVICE EXPAND ───

    let activeInlineType = { home: null, des: null };



    function toggleServiceInline(type, context) {

      context = context || 'home';

      const panelId = context === 'des' ? 'inline-service-panel-des' : 'inline-service-panel';

      const headerId = context === 'des' ? 'inline-service-header-des' : 'inline-service-header';

      const gridId = context === 'des' ? 'inline-service-grid-des' : 'inline-service-grid';

      const panel = document.getElementById(panelId);



      // If same type clicked again, collapse

      if (activeInlineType[context] === type) {

        panel.style.display = 'none';

        activeInlineType[context] = null;

        resetBtn(type, context, false);

        return;

      }



      // Reset previously active button

      if (activeInlineType[context]) {

        resetBtn(activeInlineType[context], context, false);

      }



      activeInlineType[context] = type;

      const d = modalData[type];

      if (!d) return;



      document.getElementById(headerId).innerHTML = `

        <span class="section-label">${d.label}</span>

        <h2>${d.title}</h2>

        <p>${d.desc}</p>`;

      document.getElementById(gridId).innerHTML = d.services.map(s => `

        <div class="svc-mini-card">

          <div class="smc-emoji">${s.emoji}</div>

          <h4>${s.name}</h4>

          <p>${s.desc}</p>

          <button class="btn btn-primary btn-sm" onclick="showPage('contact');document.getElementById('fservice').value='${s.value}'"> Get a Quote → </button>

        </div>`).join('');



      panel.style.display = 'block';

      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });



      // Update button label

      resetBtn(type, context, true);

    }



    function resetBtn(type, context, isActive) {

      const suffix = context === 'des' ? 'des' : 'home';

      const btn = document.getElementById('btn-' + type + '-' + suffix);

      if (!btn) return;

      if (isActive) {

        btn.textContent = 'Show Less ↑';

      } else {

        btn.textContent = 'Know More →';

      }

    }



    // ─── SERVICE MODALS ───

    const modalData = {

      marketing: {

        icon: '📈',

        label: 'Digital Marketing',

        title: 'Digital Marketing Services',

        desc: 'Get found on Google, run ads that convert, and build your social presence.',

        services: [

          { emoji: '🔍', name: 'Local SEO & Google Business Profile', value: 'local-seo', desc: 'Rank in the top 3 on Google Maps when customers search for your service nearby.' },

          { emoji: '💳', name: 'Google Ads Management', value: 'google-ads', desc: 'Search and Display campaigns that bring qualified leads — not just clicks.' },

          { emoji: '📱', name: 'Social Media Marketing', value: 'social-media', desc: 'Consistent content and paid campaigns across Facebook and Instagram.' },

          { emoji: '📊', name: 'Website Audit & Optimisation', value: 'other', desc: 'Full technical and marketing audit — speed, SEO, UX, conversion rate.' },

        ]

      },

      websites: {

        icon: '🌐',

        label: 'Website Design',

        title: 'Website Design & Development',

        desc: 'Fast, mobile-first websites built to convert visitors into enquiries.',

        services: [

          { emoji: '🏠', name: 'Business Website Design', value: 'website-design', desc: 'Professional 5-page website — fast, mobile-first, SEO-ready and built to convert.' },

          { emoji: '🎯', name: 'Landing Pages & Funnels', value: 'landing-page', desc: 'Single-purpose pages designed to convert ad traffic into bookings.' },

          { emoji: '🔄', name: 'Website Redesign', value: 'website-redesign', desc: 'Breathe new life into an outdated site — faster, modern, mobile-friendly.' },

          { emoji: '⚡', name: 'Speed & SEO Optimisation', value: 'website-redesign', desc: 'Fix Core Web Vitals, boost load times and clean up technical SEO.' },

        ]

      }

    };



    function openServiceModal(type) {

      const d = modalData[type];

      if (!d) return;

      document.getElementById('svcModalHeader').innerHTML = `

        <span class="section-label">${d.label}</span>

        <h2>${d.title}</h2>

        <p>${d.desc}</p>`;

      document.getElementById('svcModalGrid').innerHTML = d.services.map(s => `

        <div class="svc-mini-card">

          <div class="smc-emoji">${s.emoji}</div>

          <h4>${s.name}</h4>

          <p>${s.desc}</p>

          <button class="btn btn-primary btn-sm" onclick="closeServiceModal();showPage('contact');document.getElementById('fservice').value='${s.value}'"> Get a Quote → </button>

        </div>`).join('');

      document.getElementById('svcModalOverlay').classList.add('open');

      document.body.style.overflow = 'hidden';

    }



    function closeServiceModal() {

      document.getElementById('svcModalOverlay').classList.remove('open');

      document.body.style.overflow = '';

    }



    function selectServiceAndContact(serviceValue) {



      closeServiceModal();



      // Open contact section/page

      showPage('contact');



      setTimeout(() => {



        // Get dropdown

        const serviceSelect = document.getElementById('fservice');



        // Set selected option

        if (serviceSelect) {

          serviceSelect.value = serviceValue;

        }



        // Smooth scroll to form

        const form = document.getElementById('contactForm');



        if (form) {

          form.scrollIntoView({

            behavior: 'smooth'

          });

        }



      }, 200);

    }



    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeServiceModal(); });



    // ─── INIT ───

    initFadeUp();

  