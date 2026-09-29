# Carte de mes randonnées sur le GR34

Carte partagée, protégée par mot de passe, des randonnées enregistrées avec Strava.
HTML statique (Leaflet + tuiles OpenStreetMap), hébergé sur GitHub Pages.

## Organisation

| Fichier | Rôle |
|---|---|
| `index.html` | Carte publique en lecture seule : demande le mot de passe, déchiffre `data/randonnees.enc.json` |
| `admin.html` | Administration : import des GPX/TCX (éventuellement `.gz`), stockage dans le navigateur (IndexedDB), choix des randonnées « GR34 », export chiffré |
| `commun.js` | Code partagé : carte, dessin des traces, format GeoJSON |
| `progression.js` | Calcul des portions du GR34 parcourues (utilisé par `admin.html`) |
| `chiffrement.js` | Chiffrement Web Crypto : PBKDF2-SHA256 (600 000 itérations) puis AES-GCM 256, contenu compressé en gzip |
| `data/randonnees.enc.json` | Randonnées publiées, chiffrées |
| `data/gr34.geojson` | Tracé de référence du GR34, en clair (données ouvertes OSM) |
| `outils/extraire-gr34.html` | Régénère `data/gr34.geojson` depuis OpenStreetMap |

## Tracé du GR34

Source : relation OpenStreetMap [7790332](https://www.openstreetmap.org/relation/7790332) (« superroute » Chemin des Douaniers),
© contributeurs OpenStreetMap, licence [ODbL](https://www.openstreetmap.org/copyright). `data/gr34.geojson` est une base
dérivée : elle reste sous licence ODbL.

Les sous-relations dont le nom contient « variante » ou « liaison » sont marquées `role: variante`, les autres `role: principal`.
Les ways de chaque tronçon sont fusionnées en lignes continues, sans allègement ni arrondi des coordonnées.
Pour mettre à jour : ouvrir `outils/extraire-gr34.html` (servi en HTTP), « Télécharger depuis OpenStreetMap »,
« Enregistrer gr34.geojson », remplacer `data/gr34.geojson`, puis commit et push.

Les traces en clair ne sont jamais dans ce dépôt. Le navigateur peut effacer le stockage local :
garder une sauvegarde GeoJSON (bouton « Exporter la sauvegarde » de `admin.html`) hors du dépôt.

## Calcul de la progression

Calculé dans `admin.html` sur les randonnées cochées « GR34 », puis inclus dans le fichier chiffré au moment de l'export.
Seul le tracé principal compte (pas les variantes).

1. Le tracé principal est découpé en morceaux d'au plus 10 m.
2. Un morceau est parcouru si une trace passe à moins de la **tolérance** (40 m par défaut) de son milieu, dans une
   direction proche (écart d'angle ≤ 45°). Au-delà du départ et de l'arrivée d'une trace, rien n'est compté.
3. Les **trous** de moins de 100 m entre deux portions parcourues sont comblés ; les portions de moins de 200 m
   sont retirées (croisements, frôlements). Un morceau parcouru plusieurs fois ne compte qu'une fois.
4. **Contournements** : quand une trace quitte le GR34 puis le rejoint plus loin (balisage modifié, sentier parallèle),
   la portion du GR34 contournée est listée dans l'admin. Elle ne compte que si vous choisissez « Compter la portion ».
   La décision est enregistrée avec la randonnée (navigateur et sauvegarde GeoJSON).

Les réglages se modifient dans « Réglages du calcul » (mémorisés dans le navigateur).
Limite connue : un chemin parallèle à moins de la tolérance du GR34 est compté comme le GR34.

## Mettre à jour la carte

1. Exporter le GPX depuis strava.com (menu « … » puis « Export GPX »).
2. Dans `admin.html` : ajouter le fichier, cocher « GR34 », puis « Exporter pour publication ».
3. Remplacer `data/randonnees.enc.json` par le fichier téléchargé, puis `git add`, `git commit`, `git push`.

Le mot de passe doit être long : le fichier chiffré est public et peut être attaqué hors ligne.

## Test en local

La page doit être servie en HTTP sur `localhost` (pas ouverte en `file://`) : Web Crypto exige un contexte sécurisé,
et la [politique des tuiles OSM](https://operations.osmfoundation.org/policies/tiles/) exige un en-tête `Referer`.

## Déploiement

GitHub Pages, source « Deploy from a branch », branche `main`, dossier `/ (root)`.

## Crédits

Fond de carte et tracé du GR34 © [contributeurs OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL.
Bibliothèque [Leaflet](https://leafletjs.com/) 1.9.4.
