# Family Tree Manager

Multi-family web app to record, manage and visualize family trees.

- Product spec: [docs/SPEC.md](docs/SPEC.md)

## Client demo

The current build is a frontend-only demo with sample data stored in the browser (spec decision #9).

```bash
pnpm install
pnpm dev          # http://127.0.0.1:3100
```

Sign in by picking a sample user (Super Admin, Family Admin, Viewer). "Reset demo data" in the account menu restores the sample families.

To serve it from a server: `docker build -t family-tree-demo .` then `docker run -p 8080:80 family-tree-demo`.

