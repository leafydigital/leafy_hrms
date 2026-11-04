

    (function () {

      // Only on non-touch devices

      if (!window.matchMedia('(pointer: fine)').matches) return;



      const dot = document.getElementById('cursorDot');

      const ring = document.getElementById('cursorRing');



      let mouseX = 0, mouseY = 0;

      let ringX = 0, ringY = 0;

      let rafId;



      // Smooth ring follow via RAF

      function animateRing() {

        ringX += (mouseX - ringX) * 0.12;

        ringY += (mouseY - ringY) * 0.12;

        ring.style.left = ringX + 'px';

        ring.style.top = ringY + 'px';

        rafId = requestAnimationFrame(animateRing);

      }

      animateRing();



      // Dot follows immediately

      document.addEventListener('mousemove', (e) => {

        mouseX = e.clientX;

        mouseY = e.clientY;

        dot.style.left = mouseX + 'px';

        dot.style.top = mouseY + 'px';

        dot.classList.remove('hidden');

        ring.classList.remove('hidden');

      });



      // Hide when leaving window

      document.addEventListener('mouseleave', () => {

        dot.classList.add('hidden');

        ring.classList.add('hidden');

      });



      document.addEventListener('mouseenter', () => {

        dot.classList.remove('hidden');

        ring.classList.remove('hidden');

      });



      // Click effect

      document.addEventListener('mousedown', () => {

        dot.classList.add('clicking');

        ring.classList.add('clicking');

      });



      document.addEventListener('mouseup', () => {

        dot.classList.remove('clicking');

        ring.classList.remove('clicking');

      });



      // Hover detection — buttons, links, interactive elements

      const hoverTargets = 'a, button, .btn, .card, .task-card, .nav-links a, .hamburger, .filter-btn, .whatsapp-float, .nav-logo, .footer-logo, [onclick]';



      document.addEventListener('mouseover', (e) => {

        const target = e.target.closest(hoverTargets);

        if (target) {

          dot.classList.add('hovering');

          ring.classList.add('hovering');

          dot.classList.remove('on-text');

          ring.classList.remove('on-text');

        }

      });



      document.addEventListener('mouseout', (e) => {

        const target = e.target.closest(hoverTargets);

        if (target) {

          dot.classList.remove('hovering');

          ring.classList.remove('hovering');

        }

      });



      // Text cursor on inputs and textareas

      const textTargets = 'input, textarea, select, p, h1, h2, h3, h4, span, label';



      document.addEventListener('mouseover', (e) => {

        const target = e.target.closest('input, textarea, select');

        if (target) {

          dot.classList.add('on-text');

          ring.classList.add('on-text');

        }

      });



      document.addEventListener('mouseout', (e) => {

        const target = e.target.closest('input, textarea, select');

        if (target) {

          dot.classList.remove('on-text');

          ring.classList.remove('on-text');

        }

      });

    })();

  