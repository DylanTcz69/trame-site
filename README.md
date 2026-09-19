# Site public de Trame

Trois pages HTML statiques, sans dépendance, sans script et sans requête vers
un autre domaine (pas même une police distante). C'est volontaire : le site
affirme qu'il ne piste personne, il faut que ce soit vérifiable en lisant la
source.

| Fichier                 | Rôle                                                        |
| ----------------------- | ----------------------------------------------------------- |
| `index.html`            | Vitrine grand public : promesse, modules, import, aide.      |
| `securite.html`         | Vitrine technique : modèle d'autorisation, tests, risques.   |
| `confidentialite.html`  | Politique de confidentialité (exigée par l'App Store).       |
| `style.css`             | Direction artistique « Tissage » vive, jetons identiques à l'app. |

## Avant publication

1. Remplacer `[ADRESSE COURRIEL À COMPLÉTER]` dans les trois pages.
2. Remplacer `[NOM À COMPLÉTER]` dans `confidentialite.html`.
3. Ajouter les captures d'écran dans `captures/` et décommenter la section
   « À quoi ça ressemble » de `index.html`.

## Publier sur GitHub Pages

Le site vit dans un dépôt **public** distinct, pour que publier ne signifie
jamais exposer le code de l'application.

```bash
# Depuis un dossier vide, hors du dépôt trame
git init trame-site
```

Copier le contenu de ce dossier dedans, pousser sur un dépôt public nommé
`trame-site`, puis dans Settings › Pages, choisir la branche `main` et le
dossier racine. L'adresse devient `https://trameapp.app`.
