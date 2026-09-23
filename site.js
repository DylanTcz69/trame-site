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
        if (e.isIntersecting) montrer(Number(e.target.dataset.ecran));
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    etapes.forEach(function (e) { obsEtape.observe(e); });
  }
  montrer(0);

  // --- Le trait « maintenant » avance doucement sur la trame ---------------
  var mnt = document.getElementById('maintenant');
  if (mnt && !calme) {
    var x = 260;
    setInterval(function () {
      x = x >= 990 ? 110 : x + 1;
      mnt.setAttribute('x1', x);
      mnt.setAttribute('x2', x);
    }, 80);
  }

  // --- Démonstration du temps réel ----------------------------------------
  var form = document.getElementById('demo-form');
  var saisie = document.getElementById('demo-saisie');
  var chezCamille = document.getElementById('demo-camille');
  var chezHugo = document.getElementById('demo-hugo');
  var signal = document.getElementById('demo-signal');
  if (!form) return;

  function ajouter(liste, texte) {
    var li = document.createElement('li');
    li.textContent = texte; // textContent : jamais de HTML venu de la saisie.
    li.className = 'neuf';
    liste.appendChild(li);
    // Pas plus de six lignes : les plus anciennes laissent la place.
    while (liste.children.length > 6) liste.removeChild(liste.firstChild);
  }
  function envoyer(texte) {
    texte = texte.trim().slice(0, 40);
    if (!texte) return;
    ajouter(chezCamille, texte);
    signal.textContent = '● synchronisation…';
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
  var toucheParVisiteur = false;
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
