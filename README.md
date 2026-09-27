# Carte de mes randonnées

Carte personnelle des randonnées enregistrées avec Strava, en HTML statique (Leaflet + tuiles OpenStreetMap).

- Les traces sont importées à la main (fichiers GPX/TCX exportés depuis strava.com, éventuellement `.gz`).
- Elles sont stockées **uniquement dans le navigateur** (IndexedDB) : ce dépôt ne contient que le code.
- Le navigateur peut effacer ces données : garder une sauvegarde en fichier.

## Test en local

La page doit être servie en HTTP (pas ouverte en `file://`), notamment pour que le navigateur envoie
l'en-tête `Referer` exigé par la [politique des tuiles OSM](https://operations.osmfoundation.org/policies/tiles/).

## Déploiement

GitHub Pages, source « Deploy from a branch », branche `main`, dossier `/ (root)`.

## Crédits

Fond de carte © [contributeurs OpenStreetMap](https://www.openstreetmap.org/copyright).
Bibliothèque [Leaflet](https://leafletjs.com/) 1.9.4.
