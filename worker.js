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

  return new Response(versIcs(donnees), {
    headers: {
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
    l.push('BEGIN:VEVENT', `UID:${e.id}@trameapp.app`, `DTSTAMP:${maintenant}`);
    l.push(`LAST-MODIFIED:${horodatageUtc(e.updated_at)}`);
    if (e.all_day) {
      const debut = dateLocale(e.starts_at, e.time_zone);
      l.push(`DTSTART;VALUE=DATE:${debut}`, `DTEND;VALUE=DATE:${finJournee(e, debut)}`);
    } else {
      l.push(`DTSTART;TZID=${e.time_zone}:${heureLocale(e.starts_at, e.time_zone)}`);
      l.push(`DTEND;TZID=${e.time_zone}:${heureLocale(e.ends_at, e.time_zone)}`);
    }
    if (e.rrule) {
      l.push(`RRULE:${e.rrule.replace(/^RRULE:/i, '')}`);
      for (const annulee of e.cancelled ?? []) {
        l.push(
          e.all_day
            ? `EXDATE;VALUE=DATE:${dateLocale(annulee, e.time_zone)}`
            : `EXDATE;TZID=${e.time_zone}:${heureLocale(annulee, e.time_zone)}`
        );
      }
    }
    l.push(`SUMMARY:${echapper(e.title)}`);
    if (e.location) l.push(`LOCATION:${echapper(e.location)}`);
    if (e.notes) l.push(`DESCRIPTION:${echapper(e.notes)}`);
    l.push('END:VEVENT');
  }
  l.push('END:VCALENDAR');
  return l.map(replier).join('\r\n') + '\r\n';
}

function echapper(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
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
  if (cible.protocol !== 'https:' || !HOTES.some((h) => h.test(cible.hostname))) {
    return texte('Seuls les agendas Google, Outlook et iCloud sont acceptés.', 400);
  }

  const rep = await fetch(cible.toString(), { redirect: 'follow' });
  if (!rep.ok) return texte(`L’agenda a répondu ${rep.status}.`, 502);
  const corps = await rep.text();
  if (corps.length > TAILLE_MAX) return texte('Agenda trop volumineux.', 413);
  return new Response(corps, {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function texte(message, statut) {
  return new Response(message, { status: statut, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
