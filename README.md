# Carte de mes randonnées sur le GR34

Carte partagée, protégée par mot de passe, des randonnées enregistrées avec Strava.
HTML statique (Leaflet + tuiles OpenStreetMap), hébergé sur GitHub Pages.

## Organisation

| Fichier | Rôle |
|---|---|
| `index.html` | Carte publique en lecture seule : demande le mot de passe, déchiffre `data/randonnees.enc.json` |
| `admin.html` | Administration : import des GPX/TCX (éventuellement `.gz`), stockage dans le navigateur (IndexedDB), choix des randonnées « GR34 », export chiffré |
| `commun.js` | Code partagé : carte, dessin des traces, format GeoJSON |
| `chiffrement.js` | Chiffrement Web Crypto : PBKDF2-SHA256 (600 000 itérations) puis AES-GCM 256, contenu compressé en gzip |
| `data/randonnees.enc.json` | Seules données publiées, chiffrées |

Les traces en clair ne sont jamais dans ce dépôt. Le navigateur peut effacer le stockage local :
garder une sauvegarde GeoJSON (bouton « Exporter la sauvegarde » de `admin.html`) hors du dépôt.

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

Fond de carte © [contributeurs OpenStreetMap](https://www.openstreetmap.org/copyright).
Bibliothèque [Leaflet](https://leafletjs.com/) 1.9.4.
