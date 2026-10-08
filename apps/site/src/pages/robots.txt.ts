import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const host = site ? new URL(site).host : 'localhost:4321';
  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: https://${host}/sitemap-index.xml`,
    '',
  ].join('\n');
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
