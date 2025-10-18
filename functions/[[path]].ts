const SESSION_COOKIE = 'esphome_session';
const STATE_COOKIE = 'esphome_oauth_state';
const SESSION_MAX_AGE = 60 * 60 * 4; // 4 hours
const STATE_MAX_AGE = 600; // 10 minutes
type PagesContext<Env> = {
  request: Request;
  env: Env;
  params: Record<string, string | undefined>;
  next: () => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
};

type PagesFunction<Env = unknown> = (context: PagesContext<Env>) => Promise<Response>;

interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_OAUTH_REDIRECT_URI: string;
  SESSION_SECRET: string;
  GITHUB_REPO_OWNER: string;
  GITHUB_REPO_NAME: string;
  GITHUB_WORKFLOW_ID: string;
  GITHUB_WORKFLOW_REF?: string;
  FRONTEND_URL?: string;
  ALLOWED_ORIGINS?: string;
  GITHUB_REQUIRE_PRIVATE_REPO?: string;
}

type WorkflowRun = {
  id: number;
  status: string | null;
  conclusion: string | null;
  html_url: string | null;
  name?: string | null;
  head_commit?: {
    message?: string;
  } | null;
};

type WorkflowArtifact = {
  id: number;
  name: string;
  expired: boolean;
};

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return buildCorsResponse(request, env, new Response(null, { status: 204 }));
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const isAuthPath =
    path === '/auth/login' ||
    path === '/auth/logout' ||
    path === '/auth/callback';
  const isApiPath = path === '/api' || path === '/api/session' || path.startsWith('/api/');

  try {
    if (!isAuthPath && !isApiPath) {
      return context.next();
    }

    if (request.method === 'GET' && path === '/auth/login') {
      return buildCorsResponse(request, env, await handleLogin(request, env));
    }

    if (request.method === 'GET' && path === '/auth/callback') {
      return buildCorsResponse(request, env, await handleCallback(request, env));
    }

    if ((request.method === 'POST' || request.method === 'GET') && path === '/auth/logout') {
      return buildCorsResponse(request, env, await handleLogout(request, env));
    }

    if (request.method === 'GET' && path === '/api/session') {
      return buildCorsResponse(request, env, await handleSession(request, env));
    }

    if (request.method === 'POST' && path === '/api/compile') {
      return buildCorsResponse(request, env, await handleCompile(request, env));
    }

    if (request.method === 'GET' && path.startsWith('/api/status/')) {
      const id = decodeURIComponent(path.replace('/api/status/', ''));
      return buildCorsResponse(request, env, await handleStatus(request, env, id));
    }

    if (request.method === 'GET' && path.startsWith('/api/artifacts/')) {
      const segments = path.split('/').filter(Boolean);
      if (segments.length !== 4) {
        return buildCorsResponse(
          request,
          env,
          jsonResponse({ message: 'Invalid artifact request' }, 400)
        );
      }
      const [, , runId, artifactId] = segments;
      return buildCorsResponse(
        request,
        env,
        await handleArtifact(request, env, Number(runId), Number(artifactId))
      );
    }

    return context.next();
  } catch (error) {
    console.error('Pages function unhandled error', error);
    return buildCorsResponse(
      request,
      env,
      jsonResponse({ message: 'Internal Server Error' }, 500)
    );
  }
};

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const state = crypto.randomUUID();
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  const scopes = getRequiredScopes(env);
  authorizeUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', env.GITHUB_OAUTH_REDIRECT_URI);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('scope', scopes.join(' '));
  authorizeUrl.searchParams.set('allow_signup', 'false');

  const headers = new Headers();
  headers.set('Location', authorizeUrl.toString());
  const secure = isSecureRequest(request);
  headers.append(
    'Set-Cookie',
    serializeCookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      maxAge: STATE_MAX_AGE
    })
  );
  return new Response(null, { status: 302, headers });
}

async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return jsonResponse({ message: 'Missing OAuth code or state' }, 400);
  }

  const cookies = parseCookies(request.headers.get('Cookie'));
  const storedState = cookies.get(STATE_COOKIE);
  if (!storedState || storedState !== state) {
    return jsonResponse({ message: 'Invalid OAuth state' }, 400);
  }

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json'
    },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: env.GITHUB_OAUTH_REDIRECT_URI
    })
  });

  if (!tokenResponse.ok) {
    console.error('GitHub OAuth token exchange failed', await tokenResponse.text());
    return jsonResponse({ message: 'OAuth token exchange failed' }, 502);
  }

  const tokenJson = (await tokenResponse.json()) as {
    access_token?: string;
  };

  const accessToken = tokenJson.access_token;
  if (!accessToken) {
    return jsonResponse({ message: 'OAuth token missing in response' }, 502);
  }

  const secure = isSecureRequest(request);
  const sessionValue = await createSessionValue(accessToken, env.SESSION_SECRET);
  const headers = new Headers();
  headers.append(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, sessionValue, {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      maxAge: SESSION_MAX_AGE
    })
  );
  headers.append(
    'Set-Cookie',
    serializeCookie(STATE_COOKIE, '', {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      maxAge: 0
    })
  );

  const redirectUrl = env.FRONTEND_URL ?? '/';
  headers.set('Location', redirectUrl);
  return new Response(null, { status: 302, headers });
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const headers = new Headers();
  const secure = isSecureRequest(request);
  headers.append(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, '', {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      maxAge: 0
    })
  );
  const redirectUrl = env.FRONTEND_URL ?? '/';
  headers.set('Location', redirectUrl);
  return new Response(null, { status: 302, headers });
}

async function handleSession(request: Request, env: Env): Promise<Response> {
  const token = await readSessionToken(request, env.SESSION_SECRET);
  if (!token) {
    return jsonResponse({ authenticated: false });
  }

  const userResp = await githubRequest(token, 'https://api.github.com/user', {
    method: 'GET'
  });

  if (userResp.status === 401) {
    return jsonResponse({ authenticated: false });
  }

  if (!userResp.ok) {
    console.error('Failed to fetch GitHub user', userResp.status, await userResp.text());
    return jsonResponse({ authenticated: false }, userResp.status);
  }

  const body = (await userResp.json()) as {
    login: string;
    avatar_url?: string;
    html_url?: string;
    name?: string;
  };

  const scopesHeader = userResp.headers.get('X-OAuth-Scopes') ?? '';
  const tokenScopes = scopesHeader
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);

  const requiredScopes = getRequiredScopes(env);
  const missingScopes = requiredScopes.filter((scope) => !tokenScopes.includes(scope));

  return jsonResponse({
    authenticated: true,
    user: {
      login: body.login,
      name: body.name ?? null,
      avatarUrl: body.avatar_url ?? null,
      htmlUrl: body.html_url ?? null
    },
    tokenScopes,
    missingScopes,
    repo: {
      owner: env.GITHUB_REPO_OWNER,
      name: env.GITHUB_REPO_NAME,
      workflowId: env.GITHUB_WORKFLOW_ID,
      ref: env.GITHUB_WORKFLOW_REF ?? 'main'
    }
  });
}

async function handleCompile(request: Request, env: Env): Promise<Response> {
  const token = await readSessionToken(request, env.SESSION_SECRET);
  if (!token) {
    return jsonResponse({ message: '未登录或会话已失效' }, 401);
  }

  let body: {
    encodedYaml?: string;
    deviceName?: string;
    board?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ message: '请求体必须是 JSON' }, 400);
  }

  const encodedYaml = body.encodedYaml;
  if (!encodedYaml || typeof encodedYaml !== 'string') {
    return jsonResponse({ message: '缺少 encodedYaml 字段' }, 400);
  }

  const decodedLength = decodeBase64Length(encodedYaml);
  if (decodedLength <= 0 || decodedLength > 200_000) {
    return jsonResponse({ message: 'YAML 大小不合法，请检查内容' }, 400);
  }

  const requestId = crypto.randomUUID();
  const inputs: Record<string, string> = {
    encoded_yaml: encodedYaml,
    request_id: requestId
  };
  if (body.deviceName) {
    inputs.device_name = body.deviceName;
  }
  if (body.board) {
    inputs.board = body.board;
  }

  const dispatchResp = await githubRequest(
    token,
    `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/actions/workflows/${env.GITHUB_WORKFLOW_ID}/dispatches`,
    {
      method: 'POST',
      body: JSON.stringify({
        ref: env.GITHUB_WORKFLOW_REF ?? 'main',
        inputs
      })
    }
  );

  if (!dispatchResp.ok) {
    console.error('Failed to dispatch workflow', dispatchResp.status, await dispatchResp.text());
    return jsonResponse({ message: '触发 GitHub Workflow 失败' }, dispatchResp.status);
  }

  const matchedRun = await findRunByRequestId(token, env, requestId);

  return jsonResponse({
    requestId,
    runId: matchedRun?.id ?? null,
    htmlUrl: matchedRun?.html_url ?? null,
    message: matchedRun
      ? 'Workflow 已触发'
      : 'Workflow 正在初始化，请稍后查询状态'
  });
}

async function handleStatus(request: Request, env: Env, identifier: string): Promise<Response> {
  const token = await readSessionToken(request, env.SESSION_SECRET);
  if (!token) {
    return jsonResponse({ message: '未登录或会话已失效' }, 401);
  }

  let run: WorkflowRun | null = null;
  if (/^\d+$/.test(identifier)) {
    const runResp = await githubRequest(
      token,
      `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/actions/runs/${identifier}`,
      { method: 'GET' }
    );

    if (runResp.status === 404) {
      return jsonResponse({ message: '未找到对应的 Workflow 运行' }, 404);
    }

    if (!runResp.ok) {
      console.error('Failed to fetch workflow run', runResp.status, await runResp.text());
      return jsonResponse({ message: '获取 Workflow 状态失败' }, runResp.status);
    }

    run = (await runResp.json()) as WorkflowRun;
  } else {
    run = await findRunByRequestId(token, env, identifier);
    if (!run) {
      return jsonResponse({ message: '未找到对应的 Workflow 运行' }, 404);
    }
  }

  const artifactsResp = await githubRequest(
    token,
    `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/actions/runs/${run.id}/artifacts`,
    { method: 'GET' }
  );

  if (!artifactsResp.ok) {
    console.error(
      'Failed to fetch workflow artifacts',
      artifactsResp.status,
      await artifactsResp.text()
    );
    return jsonResponse({ message: '获取 Workflow 产物失败' }, artifactsResp.status);
  }

  const artifactsJson = (await artifactsResp.json()) as { artifacts: WorkflowArtifact[] };
  const validArtifact = artifactsJson.artifacts.find((item) => !item.expired) ?? null;

  return jsonResponse({
    runId: run.id,
    status: run.status,
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
    artifactUrl: validArtifact ? `/api/artifacts/${run.id}/${validArtifact.id}` : null,
    artifact: validArtifact
      ? {
          id: validArtifact.id,
          name: validArtifact.name
        }
      : null,
    message: run.name ?? run.head_commit?.message ?? ''
  });
}

async function handleArtifact(
  request: Request,
  env: Env,
  runId: number,
  artifactId: number
): Promise<Response> {
  const token = await readSessionToken(request, env.SESSION_SECRET);
  if (!token) {
    return jsonResponse({ message: '未登录或会话已失效' }, 401);
  }

  let artifactResp = await githubRequest(
    token,
    `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/actions/artifacts/${artifactId}/zip`,
    {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'application/octet-stream'
      }
    }
  );

  if (artifactResp.status >= 300 && artifactResp.status < 400) {
    const location = artifactResp.headers.get('Location');
    if (!location) {
      console.error('Artifact redirect missing location');
      return jsonResponse({ message: '下载产物失败' }, 502);
    }

    const followResp = await fetch(location, {
      method: 'GET',
      headers: {
        'User-Agent': 'esphome-online-compiler/1.0'
      }
    });

    if (!followResp.ok) {
      console.error('Failed to follow artifact redirect', followResp.status, await followResp.text());
      return jsonResponse({ message: '下载产物失败' }, followResp.status);
    }

    artifactResp = followResp;
  }

  if (!artifactResp.ok) {
    console.error('Failed to download artifact', artifactResp.status, await artifactResp.text());
    return jsonResponse({ message: '下载产物失败' }, artifactResp.status);
  }

  const headers = new Headers(artifactResp.headers);
  headers.set(
    'Content-Disposition',
    headers.get('Content-Disposition') ??
      `attachment; filename="artifact-${artifactId}-run-${runId}.zip"`
  );
  headers.set('Content-Type', 'application/zip');
  return new Response(artifactResp.body, {
    status: artifactResp.status,
    headers
  });
}

async function findRunByRequestId(token: string, env: Env, requestId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const runsResp = await githubRequest(
      token,
      `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/actions/workflows/${env.GITHUB_WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=25`,
      {
        method: 'GET'
      }
    );

    if (!runsResp.ok) {
      console.error('Failed to list workflow runs', runsResp.status, await runsResp.text());
      return null;
    }

    const runsJson = (await runsResp.json()) as { workflow_runs: WorkflowRun[] };
    const matched = runsJson.workflow_runs.find((run) => run.name?.includes(requestId));
    if (matched) {
      return matched;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return null;
}

async function githubRequest(token: string, url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/vnd.github+json');
  }
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('X-GitHub-Api-Version', '2022-11-28');
  if (!headers.has('User-Agent')) {
    headers.set('User-Agent', 'esphome-online-compiler/1.0');
  }

  return fetch(url, {
    ...init,
    headers
  });
}

async function createSessionValue(token: string, secret: string): Promise<string> {
  const encoded = base64UrlEncodeString(token);
  const signature = await sign(encoded, secret);
  return `${encoded}.${signature}`;
}

async function readSessionToken(request: Request, secret: string): Promise<string | null> {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const raw = cookies.get(SESSION_COOKIE);
  if (!raw) {
    return null;
  }
  const [encoded, signature] = raw.split('.');
  if (!encoded || !signature) {
    return null;
  }
  const expected = await sign(encoded, secret);
  if (!timingSafeEqual(signature, expected)) {
    return null;
  }
  try {
    return base64UrlDecodeToString(encoded);
  } catch (error) {
    console.error('Failed to decode session token', error);
    return null;
  }
}

function parseCookies(cookieHeader: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!cookieHeader) {
    return map;
  }
  const pairs = cookieHeader.split(/; */);
  for (const pair of pairs) {
    const [key, ...rest] = pair.split('=');
    if (!key) continue;
    const value = rest.join('=');
    map.set(key.trim(), value?.trim());
  }
  return map;
}

type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  maxAge?: number;
  path?: string;
};

function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${value}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.httpOnly) {
    parts.push('HttpOnly');
  }
  if (options.secure) {
    parts.push('Secure');
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  if (typeof options.maxAge === 'number') {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  return parts.join('; ');
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

function decodeBase64Length(encoded: string): number {
  try {
    const restored = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padding = restored.length % 4 === 0 ? 0 : 4 - (restored.length % 4);
    const padded = restored + '='.repeat(padding);
    return atob(padded).length;
  } catch {
    return -1;
  }
}

async function sign(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncodeString(value: string): string {
  const encoder = new TextEncoder();
  return base64UrlEncode(encoder.encode(value));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlDecodeToString(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = padded.length % 4 === 0 ? 0 : 4 - (padded.length % 4);
  const normalized = padded + '='.repeat(padding);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function buildCorsResponse(request: Request, env: Env, response: Response): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get('Origin');
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (origin && allowedOrigins.length > 0) {
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Vary', 'Origin');
      headers.set('Access-Control-Allow-Credentials', 'true');
      headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type');
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function getRequiredScopes(env: Env): string[] {
  const requirePrivate =
    typeof env.GITHUB_REQUIRE_PRIVATE_REPO === 'string' &&
    env.GITHUB_REQUIRE_PRIVATE_REPO.toLowerCase() === 'true';
  return requirePrivate ? ['repo', 'workflow'] : ['public_repo', 'workflow'];
}

function isSecureRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (url.protocol === 'https:') {
    return true;
  }
  const forwardedProto = request.headers.get('X-Forwarded-Proto');
  return forwardedProto?.toLowerCase() === 'https';
}
