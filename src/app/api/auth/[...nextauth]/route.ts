import { handlers } from '@/auth';

/** production build 시 /api/auth/* 가 404 HTML로 prerender 되지 않도록 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const { GET, POST } = handlers;
