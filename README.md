# Parrhesia

Parrhesia (pa-REE-zha, Greek for frank and honest speech) is a web app for laying out debates as argument maps and debating more constructively. Two people or two teams build a shared map of premises, reasons, objections and conclusions, record where each side stands on every box, and fork pivotal premises into sub-debates.

See [docs/SPEC.md](docs/SPEC.md) for the v1 spec and milestones.

## Develop

```sh
npm install
npm run dev          # dev server against the real Firebase project
npm test             # unit tests (Vitest)
npm run test:rules   # security rules and data-layer tests on the Firestore emulator (needs Java 21)
npm run lint
npm run build
```

To develop without touching real data, start the emulators with `npm run emulators` and run the dev server with `VITE_USE_EMULATORS=true npm run dev`.

The Firebase web config in `.env` is public by design; access is controlled by `firestore.rules`.

### Admin access

Importing debates is admin-only. To make an account the admin, sign in once, copy its User UID from Firebase console → Authentication → Users, then in Firestore create a collection `admins` with a document whose ID is that UID (any field, such as `note: "admin"`). Sign out and back in.

### Deploy

The app deploys to GitHub Pages at https://mendus59.github.io/argument_map/ on every push to `main` (`.github/workflows/pages.yml`). One-time setup: in the repo's Settings → Pages, set Source to "GitHub Actions", and in Firebase console → Authentication → Settings → Authorized domains, add `mendus59.github.io`. Security rules still deploy separately (below, or by pasting into the console).

Firebase Hosting also works:

```sh
npx firebase login
npx firebase deploy --only firestore   # rules and indexes
npm run build && npx firebase deploy --only hosting
```

## Stack

React + TypeScript (Vite), React Flow for the map, Firebase (Auth with Google sign-in, Firestore, Realtime Database for presence, Hosting).
