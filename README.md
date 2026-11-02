# Argument Mapper

A web app for laying out debates as argument maps and debating more constructively. Two people or two teams build a shared map of premises, reasons, objections and conclusions, record where each side stands on every box, and fork pivotal premises into sub-debates.

See [docs/SPEC.md](docs/SPEC.md) for the v1 spec and milestones.

## Develop

```sh
npm install
npm run dev      # start the dev server
npm test         # unit tests (Vitest)
npm run lint
npm run build
```

The app currently shows a read-only sample debate. Firebase is wired in from milestone 1; copy `.env.example` to `.env.local` and fill in your Firebase project's web app config to enable it.

## Stack

React + TypeScript (Vite), React Flow for the map, Firebase (Auth with Google sign-in, Firestore, Realtime Database for presence, Hosting).
