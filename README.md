# Site public de Trame — https://trameapp.app

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

## Reste à faire

- Ajouter les captures d'écran dans `captures/` et décommenter la section
  « À quoi ça ressemble » de `index.html`.

## Comment publier

La source de vérité est ce dossier, dans le dépôt privé. Le dépôt public
[`trame-site`](https://github.com/DylanTcz69/trame-site) ne contient que les
fichiers du site : publier ne doit jamais exposer le code de l'application.

```
powershell -ExecutionPolicy Bypass -File site\publier.ps1
```

Le script recopie les fichiers listés, commite et pousse. **Cloudflare Pages**
(projet `trame-site`) déploie automatiquement en une minute environ, sur
`trameapp.app` et `www.trameapp.app`.

## Domaine et courriel (Cloudflare)

- DNS, certificat et hébergement : Cloudflare, zone `trameapp.app`.
- `bonjour@` et `securite@` : Cloudflare Email Routing, **redirection seule** —
  on ne peut pas répondre depuis ces adresses.
- Envoi : Brevo, domaine authentifié par DKIM (`brevo1`/`brevo2._domainkey`).
  Le SPF n'inclut **pas** Brevo, et c'est normal : le domaine d'enveloppe est
  celui de Brevo, l'alignement DMARC passe donc par DKIM.
- DMARC en `p=none` (observation). À durcir en `quarantine` puis `reject`
  après quelques semaines de rapports propres.
