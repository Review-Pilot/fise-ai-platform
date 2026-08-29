# Fise staging safety checklist

This branch is intentionally not connected to live Cloudflare.

## Approved Website Studio administrator

- sebslabbert1@gmail.com

Set additional administrators only through the `WEBSITE_STUDIO_ADMIN_EMAILS` non-secret variable as a comma-separated list.

## Before the first staging deployment

1. Create a new Worker named `fise-ai-platform-staging`.
2. Create a new D1 database named `fise-ai-platform-staging-db`.
3. Create a new R2 bucket named `fise-ai-platform-staging-files`.
4. Create `fise-website-scans-staging` and `fise-website-scans-staging-dlq` queues.
5. Create or confirm the separate `review-pilot-website-staging` Worker. Do not point staging at production.
6. Copy `wrangler.staging.example.jsonc` to `wrangler.staging.jsonc`.
7. Replace `REPLACE_WITH_STAGING_D1_DATABASE_ID` with the new staging database ID.
8. Add staging-only `OPENAI_API_KEY` and `RESEND_API_KEY` secrets. Use a separate OpenAI project with a low budget and a Resend test domain.
9. Add complete D1 migrations for every application table before initialising the staging database.
10. Protect the staging workers.dev address with Cloudflare Access and allow only approved testers.

## Required safety tests

- A signed-in non-admin receives HTTP 403 for every Website Studio API route.
- Only the approved administrator can open `/dashboard/website`.
- HTML, SVG, XML and script uploads receive HTTP 415.
- Documents are downloaded rather than rendered inline.
- Images and approved video formats still render.
- Lead values beginning with `=`, `+`, `-` or `@` are neutralised in CSV exports.
- Scan and Website AI queue messages are consumed and failed messages reach the dead-letter queue.
- Staging contains no production D1, R2, Queue, service binding, OpenAI key, Resend key or customer data.

## Deployment rule

The default `npm run deploy` command performs a dry run only. A staging deployment must use the deliberately-created `wrangler.staging.jsonc` file. Do not deploy the root production configuration until the staging tests pass and a production release is explicitly approved.
