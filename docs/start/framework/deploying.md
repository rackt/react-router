---
title: Deploying
hidden: true
---

# Deploying

<docs-warning>
  This document is a work in progress, and will be moved to the deployment guides.
</docs-warning>

React Router can be deployed two ways:

- Fullstack Hosting
- Static Hosting

To get the most benefits from React and React Router, we recommend fullstack hosting.

## Fullstack Hosting

You can get the most out of React and React Router by deploying to a fullstack hosting provider.

### Cloudflare

Click this button to automatically deploy a starter project with your GitHub account:

[![Deploy to Cloudflare][cloudflare_button]][cloudflare]

This template includes:

- SQL database with Cloudflare D1
- Key Value storage with Cloudflare KV
- Asset upload and storage with Cloudflare R2
- Image uploads, storage, and optimized `<Image/>` component with Cloudflare Images

[View it live →](https://react-router-template.pages.dev)

### Epic Stack (Fly.io)

Start with the Epic Stack template and follow the instructions in the README:

```
npx degit @epicweb-dev/template my-app
```

This maximalist template includes a lot, including, but not limited to:

- Regional hosting on Fly.io
- Multi-region, distributed, SQLite Database with LiteFS and Prisma
- Image hosting
- Error monitoring with Sentry
- Grafana Dashboards of the running app
- CI with GitHub actions
- Authentication with Permissions
- Full unit/integration testing setup
- Transactional Email with Resend

[View it live →](https://react-router-template.fly.dev)

### Ion (AWS)

Start with the ion template and follow the instructions in the README:

```
npx degit @sst/react-template my-app
```

This template includes:

- Data Persistence with DynamoDB
- Delayed Jobs with Amazon SQS
- Image uploads, storage, and optimized `<Image/>` component with S3
- Asset uploads and storage with S3

[View it live →](#TODO)

### Netlify

Click this button to automatically deploy a starter project with your GitHub account:

[![Deploy to Netlify][netlify_button]][netlify_spa]

This template includes:

- Integration with Supabase
- Optimized Image Transforms with `<Image/>` and Netlify Image CDN

[View it live →](#TODO)

### Vercel

Click this button to automatically deploy a starter project with your GitHub account:

[![Deploy to Vercel][vercel_button]][vercel_spa]

This template includes:

- Postgres database integration with Vercel Postgres
- Optimized Image Transforms with `<Image/>` and Vercel images
- ISR for statically pre-rendered routes

[View it live →](#TODO)

### Manual Fullstack Deployment

If you want to deploy to your own server or a different hosting provider, see the [Manual Deployment](../how-to/manual-deployment) guide.

## Static Hosting

React Router doesn't require a server and can run on any static hosting provider.

### Popular Static Hosting Providers

You can get started with the following Deploy Now buttons:

[![Deploy SPA Cloudflare][cloudflare_button]][cloudflare_spa]

[![Deploy Netlify SPA][netlify_button]][netlify_spa]

[![Deploy Vercel SPA][vercel_button]][vercel_spa]

### Manual Static Hosting

Ensure the `ssr` flag is `false` in your Vite config:

```ts
import react from "@react-router/dev/vite";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [react({ ssr: false })],
});
```

Build the app:

```shellscript
npx vite build
```

And then deploy the `build/client` folder to any static host.

You'll need to ensure that all requests are routed to `index.html`. This is different with every host/server, so you'll need to find out how with your host/server.

[netlify_button]: https://www.netlify.com/img/deploy/button.svg
[netlify_spa]: https://app.netlify.com/start/deploy?repository=https://github.com/ryanflorence/templates&create_from_path=netlify-spa
[netlify_spa]: https://app.netlify.com/start/deploy?repository=https://github.com/ryanflorence/templates&create_from_path=netlify
[vercel_button]: https://vercel.com/button
[vercel_spa]: https://vercel.com/new/clone?repository-url=https://github.com/ryanflorence/templates/tree/main/vercel-spa
[cloudflare_button]: https://deploy.workers.cloudflare.com/button
[cloudflare_spa]: https://deploy.workers.cloudflare.com/?url=https://github.com/ryanflorence/templates/tree/main/cloudflare-spa
[cloudflare]: https://deploy.workers.cloudflare.com/?url=https://github.com/ryanflorence/templates/tree/main/cloudflare
