This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Waitlist

Sign-ups post to `/api/waitlist` and are stored in Upstash Redis (one hash, `waitlist:emails`:
lower-cased email → first sign-up time). Duplicates are reported, not stored twice; a hidden
honeypot field catches simple bots, and each IP gets 5 sign-ups a minute.

Setup on Vercel:

1. Project → **Storage** → **Upstash for Redis** → create (free plan) and connect it to this project.
   That sets `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).
2. Project → Settings → Environment Variables → add `WAITLIST_ADMIN_TOKEN`, a long random password.
3. Redeploy, so the new variables reach the running site.

Until storage is connected the form answers "Sign-ups open shortly" rather than pretending to save.

Export every sign-up as CSV: open `/api/waitlist/export?token=<WAITLIST_ADMIN_TOKEN>`, or send the
token as `Authorization: Bearer <token>`. Without `WAITLIST_ADMIN_TOKEN` set, that route returns 404.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
