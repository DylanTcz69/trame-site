/**
 * Programme de trameapp.app (Cloudflare Worker, devant les fichiers statiques).
 *
 * Il ne répond qu'à quelques adresses (flux d'agenda, relais .ics, liens
 * universels, vidéos /media/) ; tout le reste est servi tel quel.
 *
 *   /agenda/<jeton>.ics  Flux d'abonnement : l'agenda du foyer au format
 *                        iCalendar, pour Google Agenda, Outlook ou l'iPhone.
 *                        Le jeton (48 caractères, migration 0025) est la
 *                        seule protection : c'est une adresse secrète, comme
 *                        celles de Google.
 *
 *   /ics-proxy?url=…     Relit un agenda Google, Outlook ou iCloud pour la
 *                        VERSION WEB, que le navigateur empêche de lire
 *                        directement (CORS). Réservé aux personnes connectées
 *                        à Trame et limité à ces trois hébergeurs : ce n'est
 *                        pas un relais ouvert.
 *
 * La clé publishable de Supabase est une variable secrète Cloudflare
 * (SUPABASE_PUBLISHABLE_KEY), jamais écrite ici.
 */

const SUPABASE = 'https://mbijadlknqwdvvhbhnod.supabase.co';

/** En-têtes ajoutés aux réponses du programme (flux, relais, messages d'erreur). */
const ENTETES_SURES = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

/** Hébergeurs d'agendas acceptés par le relais. */
const HOTES = [
  /^calendar\.google\.com$/,
  /^outlook\.(live|office365|office)\.com$/,
  /^p\d+-caldav\.icloud\.com$/,
];

const TAILLE_MAX = 5 * 1024 * 1024;

/**
 * Liens universels iOS : trameapp.app/join/<jeton> ouvre l'app installée
 * au lieu du navigateur. R7BXVGC68G est l'identifiant (public) de l'équipe
 * Apple ; com.tracz.trame celui de l'app.
 */
export const LIENS_APPLE = {
  applinks: {
    details: [{ appIDs: ['R7BXVGC68G.com.tracz.trame'], components: [{ '/': '/join/*' }] }],
  },
};

/**
 * Vidéos du site (/media/…) : Safari et l'iPhone n'acceptent de lire une vidéo
 * que si le serveur sait répondre aux requêtes PARTIELLES (« Range: bytes=… »,
 * réponse 206). Les fichiers statiques de Cloudflare répondent 200 avec le
 * fichier entier : la boucle du haut de la page ne se lançait donc pas sur
 * Apple. Les fichiers sont petits (moins de 2 Mo) : on les lit en entier et on
 * en renvoie la tranche demandée. Exporté pour les tests (tests-worker.mjs).
 */
export async function servirMedia(requete, env) {
  const methode = requete.method;
  if (methode !== 'GET' && methode !== 'HEAD') return env.ASSETS.fetch(requete);
  const entier = await env.ASSETS.fetch(new Request(requete.url, { method: 'GET' }));
  if (!entier.ok) return entier;

  const tout = await entier.arrayBuffer();
  const total = tout.byteLength;
  const entetes = new Headers(entier.headers);
  entetes.set('accept-ranges', 'bytes');
  entetes.delete('content-range');

  const plage = /^bytes=(\d*)-(\d*)$/.exec((requete.headers.get('range') ?? '').trim());
  if (!plage || (plage[1] === '' && plage[2] === '')) {
    entetes.set('content-length', String(total));
    return new Response(methode === 'HEAD' ? null : tout, { status: 200, headers: entetes });
  }
  let debut;
  let fin;
  if (plage[1] === '') {
    // « bytes=-500 » : les 500 derniers octets.
    debut = Math.max(0, total - Number(plage[2]));
    fin = total - 1;
  } else {
    debut = Number(plage[1]);
    fin = plage[2] === '' ? total - 1 : Math.min(Number(plage[2]), total - 1);
  }
  if (debut >= total || debut > fin) {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}`, 'accept-ranges': 'bytes' } });
  }
  entetes.set('content-range', `bytes ${debut}-${fin}/${total}`);
  entetes.set('content-length', String(fin - debut + 1));
  return new Response(methode === 'HEAD' ? null : tout.slice(debut, fin + 1), { status: 206, headers: entetes });
}

export default {
  async fetch(requete, env) {
    const url = new URL(requete.url);
    const agenda = url.pathname.match(/^\/agenda\/([0-9a-f]{48})(?:\.ics)?$/);
    if (agenda) return flux(agenda[1], env);
    if (url.pathname === '/ics-proxy') return relais(requete, url, env);
    if (url.pathname.startsWith('/media/')) return servirMedia(requete, env);
    if (url.pathname === '/.well-known/apple-app-site-association') {
      return new Response(JSON.stringify(LIENS_APPLE), {
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
      });
    }
    return env.ASSETS.fetch(requete);
  },
};

// -----------------------------------------------------------------------------
// Flux sortant
// -----------------------------------------------------------------------------

async function flux(jeton, env) {
  const rep = await fetch(`${SUPABASE}/rest/v1/rpc/calendar_feed`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ feed_token: jeton }),
  });
  if (!rep.ok) return texte('Agenda indisponible pour le moment.', 503);
  const donnees = await rep.json();
  if (!donnees) return texte('Ce lien d’agenda n’existe pas ou a été supprimé.', 404);

  let corpsIcs;
  try {
    corpsIcs = versIcs(donnees);
  } catch {
    return texte('Agenda indisponible pour le moment.', 503);
  }
  return new Response(corpsIcs, {
    headers: {
      ...ENTETES_SURES,
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'private, max-age=300',
      'x-robots-tag': 'noindex',
    },
  });
}

/** Exporté pour les tests (site/tests-worker.mjs). */
export function versIcs({ name, events }) {
  const l = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Trame//Agenda du foyer//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${echapper(`Trame · ${name}`)}`,
    // Indication aux clients qui la respectent (Apple, Thunderbird) ; Google
    // garde son propre rythme, de l'ordre de quelques heures.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  const maintenant = horodatageUtc(new Date().toISOString());
  for (const e of events) {
    // Un événement mal formé est ignoré : il ne doit jamais casser tout le flux.
    if (!fuseauValide(e.time_zone)) continue;
    const brute = e.rrule ? String(e.rrule).replace(/^RRULE:/i, '') : '';
    const rrule = brute && RRULE_OK.test(brute) ? brute : null;
    const ev = [];
    try {
      ev.push('BEGIN:VEVENT', `UID:${nettoyer(e.id)}@trameapp.app`, `DTSTAMP:${maintenant}`);
      ev.push(`LAST-MODIFIED:${horodatageUtc(e.updated_at)}`);
      if (e.all_day) {
        const debut = dateLocale(e.starts_at, e.time_zone);
        ev.push(`DTSTART;VALUE=DATE:${debut}`, `DTEND;VALUE=DATE:${finJournee(e, debut)}`);
      } else {
        ev.push(`DTSTART;TZID=${e.time_zone}:${heureLocale(e.starts_at, e.time_zone)}`);
        ev.push(`DTEND;TZID=${e.time_zone}:${heureLocale(e.ends_at, e.time_zone)}`);
      }
      if (rrule) {
        ev.push(`RRULE:${rrule}`);
        for (const annulee of e.cancelled ?? []) {
          ev.push(
            e.all_day
              ? `EXDATE;VALUE=DATE:${dateLocale(annulee, e.time_zone)}`
              : `EXDATE;TZID=${e.time_zone}:${heureLocale(annulee, e.time_zone)}`
          );
        }
      }
      ev.push(`SUMMARY:${echapper(e.title)}`);
      if (e.location) ev.push(`LOCATION:${echapper(e.location)}`);
      if (e.notes) ev.push(`DESCRIPTION:${echapper(e.notes)}`);
      ev.push('END:VEVENT');
    } catch {
      continue;
    }
    l.push(...ev);
  }
  l.push('END:VCALENDAR');
  return l.map(replier).join('\r\n') + '\r\n';
}

/** Caractères autorisés dans une règle de récurrence : jamais de retour à la ligne. */
const RRULE_OK = /^[A-Za-z0-9=;,:+\-\/ ]{1,500}$/;

/** Remplace les caractères de contrôle (sauf tabulation) et les séparateurs de ligne Unicode. */
function nettoyer(v) {
  let sortie = '';
  for (const c of String(v)) {
    const n = c.codePointAt(0);
    const interdit = (n < 32 && n !== 9) || n === 127 || n === 0x2028 || n === 0x2029;
    sortie += interdit ? ' ' : c;
  }
  return sortie;
}

/** Échappement iCalendar : \r seul, \r\n et \n deviennent tous « \n » ; plus aucune ligne injectable. */
function echapper(v) {
  return String(v)
    .split(/\r\n|\r|\n/)
    .map((ligne) => nettoyer(ligne).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,'))
    .join('\\n');
}

function fuseauValide(tz) {
  if (typeof tz !== 'string' || !/^[A-Za-z0-9_\/+\-]{1,64}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Lignes de 75 octets au plus, suite précédée d'une espace (RFC 5545). */
function replier(ligne) {
  const enc = new TextEncoder();
  const morceaux = [];
  let courant = '';
  let octets = 0;
  for (const c of ligne) {
    const n = enc.encode(c).length;
    const max = morceaux.length ? 74 : 75;
    if (octets + n > max) {
      morceaux.push(courant);
      courant = '';
      octets = 0;
    }
    courant += c;
    octets += n;
  }
  morceaux.push(courant);
  return morceaux.join('\r\n ');
}

function horodatageUtc(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function morceaux(iso, fuseau) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-GB', {
    timeZone: fuseau,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))) p[x.type] = x.value;
  return p;
}

/** Heure murale dans le fuseau de saisie : « 20260923T090000 ». */
function heureLocale(iso, fuseau) {
  const p = morceaux(iso, fuseau);
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
}

function dateLocale(iso, fuseau) {
  const p = morceaux(iso, fuseau);
  return `${p.year}${p.month}${p.day}`;
}

/**
 * Fin EXCLUSIVE d'un événement sur la journée. Trame range la fin soit à
 * minuit du lendemain (import .ics), soit dans la dernière journée (saisie) :
 * les deux donnent le bon jour.
 */
function finJournee(e, debut) {
  const p = morceaux(e.ends_at, e.time_zone);
  let fin = `${p.year}${p.month}${p.day}`;
  const minuit = p.hour === '00' && p.minute === '00' && p.second === '00';
  if (!minuit || fin <= debut) fin = lendemain(fin);
  return fin;
}

function lendemain(aaaammjj) {
  const d = new Date(Date.UTC(+aaaammjj.slice(0, 4), +aaaammjj.slice(4, 6) - 1, +aaaammjj.slice(6, 8) + 1));
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// -----------------------------------------------------------------------------
// Relais entrant (version web seulement)
// -----------------------------------------------------------------------------

const SAUTS_MAX = 3;

/** Hôte autorisé pour le relais : https et liste blanche (voir HOTES). */
export const hoteAutorise = (u) => u.protocol === 'https:' && HOTES.some((h) => h.test(u.hostname));

/** Lit le corps d'une réponse sans dépasser `max` octets ; null si trop gros. */
export async function lireBorne(rep, max) {
  const l = Number(rep.headers.get('content-length'));
  if (Number.isFinite(l) && l > max) return null;
  const lecteur = rep.body.getReader();
  const morceaux = [];
  let n = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      await lecteur.cancel();
      return null;
    }
    morceaux.push(value);
  }
  const tout = new Uint8Array(n);
  let p = 0;
  for (const m of morceaux) {
    tout.set(m, p);
    p += m.length;
  }
  return new TextDecoder().decode(tout);
}

/**
 * Télécharge un agenda en suivant à la main au plus SAUTS_MAX redirections, dont
 * chacune doit rester chez un hébergeur autorisé : une redirection ouverte chez
 * Google ne peut plus mener le relais ailleurs. Exporté pour les tests.
 */
export async function telecharger(depart, recuperer = fetch) {
  let courante = depart;
  for (let saut = 0; saut <= SAUTS_MAX; saut++) {
    const rep = await recuperer(courante.toString(), { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if (rep.status >= 300 && rep.status < 400) {
      let suite;
      try {
        suite = new URL(rep.headers.get('location') ?? '', courante);
      } catch {
        return texte('Redirection invalide.', 502);
      }
      if (!hoteAutorise(suite)) return texte('Redirection refusée.', 502);
      courante = suite;
      continue;
    }
    if (!rep.ok) return texte(`L’agenda a répondu ${rep.status}.`, 502);
    const corps = await lireBorne(rep, TAILLE_MAX);
    if (corps === null) return texte('Agenda trop volumineux.', 413);
    return new Response(corps, {
      headers: { ...ENTETES_SURES, 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return texte('Trop de redirections.', 502);
}

async function relais(requete, url, env) {
  const jwt = (requete.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return texte('Connexion requise.', 401);
  const moi = await fetch(`${SUPABASE}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${jwt}` },
  });
  if (!moi.ok) return texte('Connexion requise.', 401);

  let cible;
  try {
    cible = new URL((url.searchParams.get('url') ?? '').replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    return texte('Adresse invalide.', 400);
  }
  if (!hoteAutorise(cible)) {
    return texte('Seuls les agendas Google, Outlook et iCloud sont acceptés.', 400);
  }

  return telecharger(cible);
}

function texte(message, statut) {
  return new Response(message, { status: statut, headers: { ...ENTETES_SURES, 'content-type': 'text/plain; charset=utf-8' } });
}
