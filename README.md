This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Accounts (sign in with Google)

`/account` signs people in with Google; accounts live in the same Upstash Redis (`user:<google id>`).
Every tool works without signing in.

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → **OAuth consent screen**:
   External, app name Stellr, your email; publish it.
2. **Credentials** → Create credentials → **OAuth client ID** → Web application. Authorised redirect URI:
   `https://<your domain>/api/auth/google/callback` (for example `https://stellr-coral.vercel.app/api/auth/google/callback`).
3. Vercel → Settings → Environment Variables: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
   (optionally `AUTH_SECRET`, a long random string that signs sessions). Redeploy.

Until both Google variables are set, `/account` says sign-in isn't switched on yet.

## Waitlist (closed)

Every tool is open, so the landing page no longer collects emails. Sign-ups made earlier are still
in Upstash Redis (hash `waitlist:emails`). Export them as CSV from
`/api/waitlist/export?token=<WAITLIST_ADMIN_TOKEN>` (or `Authorization: Bearer <token>`); without
`WAITLIST_ADMIN_TOKEN` set, that route returns 404.

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
