/*
 * Le seul script du site. Aucune bibliothèque, aucune requête réseau, aucune
 * mesure d'audience : tout se passe dans la page.
 */
(function () {
  'use strict';
  var calme = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Apparition au défilement ------------------------------------------
  var aReveler = document.querySelectorAll('.revele, .sommaire .ligne');
  if ('IntersectionObserver' in window && !calme) {
    var obs = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('vu'); obs.unobserve(e.target); }
      });
    }, { threshold: 0.2 });
    aReveler.forEach(function (el, i) {
      // Léger décalage entre voisins : le sommaire se tisse ligne à ligne.
      el.style.transitionDelay = (i % 2) * 0.12 + 's';
      obs.observe(el);
    });
  } else {
    aReveler.forEach(function (el) { el.classList.add('vu'); });
  }

  // --- La visite : le téléphone suit l'étape lue --------------------------
  var etapes = document.querySelectorAll('.etape');
  var ecrans = document.querySelectorAll('.telephone img');
  function montrer(n) {
    ecrans.forEach(function (img, i) { img.classList.toggle('montre', i === n); });
    etapes.forEach(function (e, i) { e.classList.toggle('active', i === n); });
  }
  if ('IntersectionObserver' in window && etapes.length) {
    var obsEtape = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (e) {
        // En carrousel (téléphone), c'est le glissement qui décide.
        var rail = document.querySelector('.etapes');
        if (rail && rail.scrollWidth > rail.clientWidth + 4) return;
        if (e.isIntersecting) montrer(Number(e.target.dataset.ecran));
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    etapes.forEach(function (e) { obsEtape.observe(e); });
  }
  montrer(0);

  var rail = document.querySelector('.etapes');
  var jauge = document.querySelectorAll('.jauge i');
  function suivreCarrousel() {
    if (rail.scrollWidth <= rail.clientWidth + 4) return; // pas en carrousel (PC)
    var largeur = etapes[0].getBoundingClientRect().width + 16;
    var n = Math.max(0, Math.min(etapes.length - 1, Math.round(rail.scrollLeft / largeur)));
    montrer(n);
    jauge.forEach(function (j, i) { j.classList.toggle('faite', i <= n); });
  }
  if (rail) {
    rail.addEventListener('scroll', suivreCarrousel, { passive: true });
    suivreCarrousel();
  }

  // --- Le trait « maintenant » avance doucement sur la trame ---------------
  // Deux dessins (PC et téléphone), chacun avec sa propre largeur.
  [['maintenant', 110, 990, 260], ['maintenant-m', 10, 350, 70]].forEach(function (c) {
    var ligne = document.getElementById(c[0]);
    if (!ligne || calme) return;
    var x = c[3];
    setInterval(function () {
      x = x >= c[2] ? c[1] : x + (c[0] === 'maintenant' ? 1 : 0.4);
      ligne.setAttribute('x1', x);
      ligne.setAttribute('x2', x);
    }, 80);
  });

  // --- Démonstration du temps réel ----------------------------------------
  var form = document.getElementById('demo-form');
  var saisie = document.getElementById('demo-saisie');
  var chezCamille = document.getElementById('demo-camille');
  var chezHugo = document.getElementById('demo-hugo');
  var signal = document.getElementById('demo-signal');
  if (!form) return;
  var toucheParVisiteur = false;
  // Les articles déjà présents se cochent aussi, au clavier comme au doigt.
  document.querySelectorAll('.demo li').forEach(function (li) {
    li.tabIndex = 0;
    li.setAttribute('role', 'checkbox');
    li.setAttribute('aria-checked', 'false');
  });

  function ajouter(liste, texte) {
    var li = document.createElement('li');
    li.textContent = texte; // textContent : jamais de HTML venu de la saisie.
    li.className = 'neuf';
    li.tabIndex = 0;
    li.setAttribute('role', 'checkbox');
    li.setAttribute('aria-checked', 'false');
    liste.appendChild(li);
    // Pas plus de six lignes : les plus anciennes laissent la place.
    while (liste.children.length > 6) liste.removeChild(liste.firstChild);
  }
  // Cocher un article : il se barre ici, la perle file chez l'autre, puis il
  // disparaît des deux listes (comme « Nettoyer » dans l'app).
  function cocher(li) {
    if (li.classList.contains('coche')) return;
    var texte = li.textContent;
    var autre = li.parentNode === chezCamille ? chezHugo : chezCamille;
    li.classList.add('coche');
    li.setAttribute('aria-checked', 'true');
    lancerPerle();
    var jumeau = [].find.call(autre.children, function (x) { return x.textContent === texte && !x.classList.contains('coche'); });
    setTimeout(function () { if (jumeau) jumeau.classList.add('coche'); }, 650);
    setTimeout(function () {
      [li, jumeau].forEach(function (x) { if (x) x.classList.add('part'); });
      setTimeout(function () { [li, jumeau].forEach(function (x) { if (x && x.parentNode) x.parentNode.removeChild(x); }); }, 380);
    }, 1300);
  }
  [chezCamille, chezHugo].forEach(function (liste) {
    liste.addEventListener('click', function (ev) {
      if (ev.target.tagName === 'LI') { toucheParVisiteur = true; cocher(ev.target); }
    });
    liste.addEventListener('keydown', function (ev) {
      if (ev.target.tagName === 'LI' && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); cocher(ev.target); }
    });
  });
  function lancerPerle() {
    var perle = document.getElementById('demo-lien');
    if (!perle) return;
    perle.classList.remove('passe');
    void perle.offsetWidth; // relance l'animation
    perle.classList.add('passe');
  }

  function envoyer(texte) {
    texte = texte.trim().slice(0, 40);
    if (!texte) return;
    ajouter(chezCamille, texte);
    signal.textContent = '● synchronisation…';
    lancerPerle();
    signal.classList.add('actif');
    setTimeout(function () {
      ajouter(chezHugo, texte);
      signal.textContent = '● à jour';
      setTimeout(function () { signal.classList.remove('actif'); }, 1200);
    }, 650);
  }
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    envoyer(saisie.value);
    saisie.value = '';
    toucheParVisiteur = true;
  });

  // Tant que personne n'y touche, la démonstration se joue toute seule quand
  // elle devient visible.
  var exemples = ['Beurre', 'Café', 'Citrons', 'Pain de mie', 'Yaourts'];
  var demo = document.querySelector('.demo');
  if ('IntersectionObserver' in window && !calme) {
    var dejaJoue = false;
    new IntersectionObserver(function (entrees) {
      if (dejaJoue || !entrees[0].isIntersecting) return;
      dejaJoue = true;
      exemples.slice(0, 3).forEach(function (mot, i) {
        setTimeout(function () { if (!toucheParVisiteur) envoyer(mot); }, 1200 + i * 2200);
      });
    }, { threshold: 0.6 }).observe(demo);
  }
})();
