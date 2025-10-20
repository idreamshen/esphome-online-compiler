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
  GITHUB_SERVICE_TOKEN?: string;
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

type WorkflowJob = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
};

type TokenSource = 'service' | 'session';

type TokenCandidate = {
  source: TokenSource;
  token: string;
};

type TokenStrategy = {
  candidates: TokenCandidate[];
  lastSuccessful?: TokenCandidate;
};

type GithubRequestResult = {
  response: Response;
  source: TokenSource | null;
  attempted: TokenSource[];
};

type GithubErrorPayload = {
  message: string;
  serviceTokenDegraded?: boolean;
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

    if (request.method === 'GET' && path.startsWith('/api/jobs/')) {
      const jobId = decodeURIComponent(path.replace('/api/jobs/', ''));
      return buildCorsResponse(request, env, await handleJobLogs(request, env, jobId));
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
  const serviceTokenAvailable = Boolean(env.GITHUB_SERVICE_TOKEN?.trim());
  const repoInfo = {
    owner: env.GITHUB_REPO_OWNER,
    name: env.GITHUB_REPO_NAME,
    workflowId: env.GITHUB_WORKFLOW_ID,
    ref: env.GITHUB_WORKFLOW_REF ?? 'main'
  };
  if (!token) {
    return jsonResponse({
      authenticated: false,
      serviceTokenAvailable,
      defaultTokenSource: serviceTokenAvailable ? 'service' : 'session',
      repo: repoInfo
    });
  }

  const userResp = await githubRequest(token, 'https://api.github.com/user', {
    method: 'GET'
  });

  if (userResp.status === 401) {
    return jsonResponse({
      authenticated: false,
      serviceTokenAvailable,
      defaultTokenSource: serviceTokenAvailable ? 'service' : 'session',
      repo: repoInfo
    });
  }

  if (!userResp.ok) {
    console.error('Failed to fetch GitHub user', userResp.status, await userResp.text());
    return jsonResponse(
      {
        authenticated: false,
        serviceTokenAvailable,
        defaultTokenSource: serviceTokenAvailable ? 'service' : 'session',
        repo: repoInfo
      },
      userResp.status
    );
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
    serviceTokenAvailable,
    defaultTokenSource: serviceTokenAvailable ? 'service' : 'session',
    user: {
      login: body.login,
      name: body.name ?? null,
      avatarUrl: body.avatar_url ?? null,
      htmlUrl: body.html_url ?? null
    },
    tokenScopes,
    missingScopes,
    repo: repoInfo
  });
}

async function handleCompile(request: Request, env: Env): Promise<Response> {
  let body: {
    encodedYaml?: string;
    deviceName?: string;
    board?: string;
    useUserToken?: boolean;
    artifactPassword?: string;
    esphomeVersion?: string;
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
  const artifactPassword =
    typeof body.artifactPassword === 'string' ? body.artifactPassword.trim() : '';

  if (!artifactPassword) {
    return jsonResponse({ message: '压缩包密码不能为空' }, 400);
  }

  if (artifactPassword.length < 8 || artifactPassword.length > 64) {
    return jsonResponse({ message: '压缩包密码长度需在 8 到 64 个字符之间' }, 400);
  }

  if (!/^[A-Za-z0-9]+$/.test(artifactPassword)) {
    return jsonResponse({ message: '压缩包密码仅支持字母与数字' }, 400);
  }

  const esphomeVersion =
    typeof body.esphomeVersion === 'string' ? body.esphomeVersion.trim() : '';
  if (esphomeVersion) {
    if (esphomeVersion.length > 64) {
      return jsonResponse({ message: 'ESPHome 版本号过长，请检查输入' }, 400);
    }
    if (!/^[0-9A-Za-z.+_-]+$/.test(esphomeVersion)) {
      return jsonResponse({ message: 'ESPHome 版本仅支持字母、数字和 . + _ - 符号' }, 400);
    }
  }

  const inputs: Record<string, string> = {
    encoded_yaml: encodedYaml,
    request_id: requestId,
    artifact_password: artifactPassword
  };
  if (body.deviceName) {
    inputs.device_name = body.deviceName;
  }
  if (body.board) {
    inputs.board = body.board;
  }
  if (esphomeVersion) {
    inputs.esphome_version = esphomeVersion;
  }

  const preferUserToken = body.useUserToken === true;
  const strategy = await resolveTokenStrategy(request, env, preferUserToken ? 'session' : null);
  if (strategy.candidates.length === 0) {
    return jsonResponse(
      {
        message: preferUserToken
          ? '尚未登录 GitHub，无法使用个人授权'
          : '平台未配置可用的 GitHub 凭据，请登录 GitHub 后再试'
      },
      401
    );
  }

  const dispatchResult = await githubRequestWithStrategy(
    strategy,
    `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/actions/workflows/${env.GITHUB_WORKFLOW_ID}/dispatches`,
    {
      method: 'POST',
      body: JSON.stringify({
        ref: env.GITHUB_WORKFLOW_REF ?? 'main',
        inputs
      })
    }
  );

  const dispatchResp = dispatchResult.response;
  if (!dispatchResp.ok) {
    const errorText = await dispatchResp.text();
    console.error(
      'Failed to dispatch workflow',
      dispatchResp.status,
      errorText || dispatchResp.statusText
    );
    const errorPayload = buildGithubErrorPayload(
      dispatchResp.status,
      dispatchResult.source,
      dispatchResult.attempted,
      strategy
    );
    return jsonResponse(errorPayload, dispatchResp.status);
  }

  const matchedRun = await findRunByRequestId(strategy, env, requestId);

  return jsonResponse({
    requestId,
    runId: matchedRun?.id ?? null,
    htmlUrl: matchedRun?.html_url ?? null,
    tokenSource: dispatchResult.source ?? null,
    message: matchedRun
      ? 'Workflow 已触发'
      : 'Workflow 正在初始化，请稍后查询状态'
  });
}

async function handleStatus(request: Request, env: Env, identifier: string): Promise<Response> {
  const preference = deriveTokenPreference(request);
  const strategy = await resolveTokenStrategy(request, env, preference);
  if (strategy.candidates.length === 0) {
    return jsonResponse({ message: '缺少可用的 GitHub 凭据，请登录后重试' }, 401);
  }

  let run: WorkflowRun | null = null;
  if (/^\d+$/.test(identifier)) {
    const runResult = await githubRequestWithStrategy(
      strategy,
      `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/actions/runs/${identifier}`,
      { method: 'GET' }
    );
    const runResp = runResult.response;
    const runText = await runResp.text();

    if (runResp.status === 404) {
      return jsonResponse({ message: '未找到对应的 Workflow 运行' }, 404);
    }

    if (!runResp.ok) {
      console.error('Failed to fetch workflow run', runResp.status, runText || runResp.statusText);
    const errorPayload = buildGithubErrorPayload(
      runResp.status,
      runResult.source,
      runResult.attempted,
      strategy
    );
    return jsonResponse(errorPayload, runResp.status);
    }

    run = JSON.parse(runText) as WorkflowRun;
  } else {
    run = await findRunByRequestId(strategy, env, identifier);
    if (!run) {
      return jsonResponse({ message: '未找到对应的 Workflow 运行' }, 404);
    }
  }

  const artifactsResult = await githubRequestWithStrategy(
    strategy,
    `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/actions/runs/${run.id}/artifacts`,
    { method: 'GET' }
  );
  const artifactsResp = artifactsResult.response;
  const artifactsText = await artifactsResp.text();

  if (!artifactsResp.ok) {
    console.error(
      'Failed to fetch workflow artifacts',
      artifactsResp.status,
      artifactsText || artifactsResp.statusText
    );
    const errorPayload = buildGithubErrorPayload(
      artifactsResp.status,
      artifactsResult.source,
      artifactsResult.attempted,
      strategy
    );
    return jsonResponse(errorPayload, artifactsResp.status);
  }

  const artifactsJson = JSON.parse(artifactsText) as { artifacts: WorkflowArtifact[] };
  const validArtifact = artifactsJson.artifacts.find((item) => !item.expired) ?? null;

  let failedJobId: number | null = null;
  if (run.status === 'completed' && run.conclusion !== 'success') {
    const jobsResult = await githubRequestWithStrategy(
      strategy,
      `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/actions/runs/${run.id}/jobs`,
      { method: 'GET' }
    );
    if (jobsResult.response.ok) {
      const jobsJson = (await jobsResult.response.json()) as { jobs: WorkflowJob[] };
      const failedJob = jobsJson.jobs.find((job) => job.conclusion === 'failure');
      if (failedJob) {
        failedJobId = failedJob.id;
      }
    }
  }

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
    message: run.name ?? run.head_commit?.message ?? '',
    failedJobId
  });
}

async function handleArtifact(
  request: Request,
  env: Env,
  runId: number,
  artifactId: number
): Promise<Response> {
  const preference = deriveTokenPreference(request);
  const strategy = await resolveTokenStrategy(request, env, preference);
  if (strategy.candidates.length === 0) {
    return jsonResponse({ message: '缺少可用的 GitHub 凭据，请登录后重试' }, 401);
  }

  const artifactResult = await githubRequestWithStrategy(
    strategy,
    `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/actions/artifacts/${artifactId}/zip`,
    {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'application/vnd.github+json'
      }
    }
  );
  let artifactResp = artifactResult.response;

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
    const errorText = await artifactResp.text();
    console.error('Failed to download artifact', artifactResp.status, errorText || artifactResp.statusText);
    const isGitHubResponse = artifactResp === artifactResult.response;
    return jsonResponse(
      {
        ...(isGitHubResponse
          ? buildGithubErrorPayload(
              artifactResp.status,
              artifactResult.source,
              artifactResult.attempted,
              strategy
            )
          : { message: '下载产物失败' })
      },
      artifactResp.status
    );
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

async function handleJobLogs(request: Request, env: Env, jobId: string): Promise<Response> {
  const preference = deriveTokenPreference(request);
  const strategy = await resolveTokenStrategy(request, env, preference);
  if (strategy.candidates.length === 0) {
    return jsonResponse({ message: '缺少可用的 GitHub 凭据，请登录后重试' }, 401);
  }

  const jobIdNum = parseInt(jobId, 10);
  if (isNaN(jobIdNum)) {
    return jsonResponse({ message: 'Invalid job ID' }, 400);
  }

  const logsResult = await githubRequestWithStrategy(
    strategy,
    `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/actions/jobs/${jobIdNum}/logs`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json'
      }
    }
  );

  if (!logsResult.response.ok) {
    const errorText = await logsResult.response.text();
    console.error('Failed to fetch job logs', logsResult.response.status, errorText || logsResult.response.statusText);
    const errorPayload = buildGithubErrorPayload(
      logsResult.response.status,
      logsResult.source,
      logsResult.attempted,
      strategy
    );
    return jsonResponse(errorPayload, logsResult.response.status);
  }

  const logs = await logsResult.response.text();
  const errorLogs = extractErrorContext(logs);

  return jsonResponse({
    errorLogs: errorLogs.length > 0 ? errorLogs.join('\n') : null
  });
}

function extractErrorContext(logs: string): string[] {
  const lines = logs.split('\n');
  const errorIndices: number[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    if (/error/i.test(lines[i])) {
      errorIndices.push(i);
    }
  }

  if (errorIndices.length === 0) {
    return [];
  }

  const contextLines = new Set<number>();
  const contextSize = 10;
  
  for (const errorIndex of errorIndices) {
    const start = Math.max(0, errorIndex - contextSize);
    const end = Math.min(lines.length - 1, errorIndex + contextSize);
    
    for (let i = start; i <= end; i++) {
      contextLines.add(i);
    }
  }

  const sortedIndices = Array.from(contextLines).sort((a, b) => a - b);
  const result: string[] = [];
  let lastIndex = -2;
  
  for (const index of sortedIndices) {
    if (index > lastIndex + 1) {
      if (result.length > 0) {
        result.push('...');
      }
    }
    result.push(lines[index]);
    lastIndex = index;
  }

  return result;
}

async function findRunByRequestId(strategy: TokenStrategy, env: Env, requestId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const runsResult = await githubRequestWithStrategy(
      strategy,
      `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/actions/workflows/${env.GITHUB_WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=25`,
      {
        method: 'GET'
      }
    );
    const runsResp = runsResult.response;
    const runsText = await runsResp.text();

    if (!runsResp.ok) {
      console.error(
        'Failed to list workflow runs',
        runsResp.status,
        runsText || runsResp.statusText
      );
      return null;
    }

    const runsJson = JSON.parse(runsText) as { workflow_runs: WorkflowRun[] };
    const matched = runsJson.workflow_runs.find((run) => run.name?.includes(requestId));
    if (matched) {
      return matched;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return null;
}

function deriveTokenPreference(request: Request): TokenSource | null {
  const headerPref = parseTokenSourceValue(request.headers.get('X-GitHub-Token-Source'));
  if (headerPref) {
    return headerPref;
  }

  try {
    const url = new URL(request.url);
    return parseTokenSourceValue(url.searchParams.get('token_source'));
  } catch (error) {
    console.warn('Failed to parse token preference from URL', error);
    return null;
  }
}

function parseTokenSourceValue(value: string | null): TokenSource | null {
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (normalized === 'service' || normalized === 'session') {
    return normalized as TokenSource;
  }
  return null;
}

async function resolveTokenStrategy(
  request: Request,
  env: Env,
  override: TokenSource | null
): Promise<TokenStrategy> {
  const serviceToken =
    typeof env.GITHUB_SERVICE_TOKEN === 'string' && env.GITHUB_SERVICE_TOKEN.trim().length > 0
      ? env.GITHUB_SERVICE_TOKEN.trim()
      : null;
  const sessionToken = await readSessionToken(request, env.SESSION_SECRET);
  const preference = override ?? deriveTokenPreference(request);

  const order: TokenSource[] = [];
  const pushUnique = (source: TokenSource) => {
    if (!order.includes(source)) {
      order.push(source);
    }
  };

  if (preference) {
    pushUnique(preference);
    pushUnique(preference === 'service' ? 'session' : 'service');
  } else {
    pushUnique('service');
    pushUnique('session');
  }

  const candidates: TokenCandidate[] = [];
  for (const source of order) {
    if (source === 'service' && serviceToken) {
      candidates.push({ source, token: serviceToken });
    } else if (source === 'session' && sessionToken) {
      candidates.push({ source, token: sessionToken });
    }
  }

  return { candidates };
}

async function githubRequestWithStrategy(
  strategy: TokenStrategy,
  url: string,
  init: RequestInit
): Promise<GithubRequestResult> {
  if (strategy.candidates.length === 0) {
    throw new Error('No GitHub tokens available for request');
  }

  const attempted: TokenSource[] = [];
  const tried = new Set<TokenSource>();
  const orderedCandidates = strategy.lastSuccessful
    ? [
        strategy.lastSuccessful,
        ...strategy.candidates.filter((candidate) => candidate !== strategy.lastSuccessful)
      ]
    : strategy.candidates;

  let response: Response | null = null;
  let source: TokenSource | null = null;

  for (const candidate of orderedCandidates) {
    if (tried.has(candidate.source)) {
      continue;
    }
    tried.add(candidate.source);
    attempted.push(candidate.source);

    response = await githubRequest(candidate.token, url, init);
    source = candidate.source;

    if (shouldRetryWithFallback(response) && tried.size < strategy.candidates.length) {
      response.body?.cancel();
      response = null;
      source = null;
      continue;
    }

    strategy.lastSuccessful = candidate;
    break;
  }

  if (!response) {
    throw new Error('Failed to execute GitHub request with available tokens');
  }

  return {
    response,
    source,
    attempted
  };
}

function shouldRetryWithFallback(response: Response): boolean {
  return response.status === 401 || response.status === 403 || response.status === 429;
}

function hasCandidate(strategy: TokenStrategy, source: TokenSource): boolean {
  return strategy.candidates.some((candidate) => candidate.source === source);
}

function hasAttemptedSource(attempted: TokenSource[], source: TokenSource): boolean {
  return attempted.includes(source);
}

function buildGithubErrorPayload(
  status: number,
  source: TokenSource | null,
  attempted: TokenSource[],
  strategy: TokenStrategy
): GithubErrorPayload {
  const hasService = hasCandidate(strategy, 'service');
  const hasSession = hasCandidate(strategy, 'session');
  const attemptedSession = hasAttemptedSource(attempted, 'session');
  const payload: GithubErrorPayload = {
    message: '触发 GitHub Workflow 失败'
  };

  const markServiceDegraded = () => {
    payload.serviceTokenDegraded = true;
  };

  if (status === 401) {
    if (source === 'session') {
      payload.message = 'GitHub 授权已失效，请退出后重新登录';
      return payload;
    }
    if (source === 'service') {
      markServiceDegraded();
      payload.message = hasSession
        ? 'GitHub 身份验证失败，请使用个人授权后再试'
        : 'GitHub 身份验证失败，请登录后再试';
      return payload;
    }
    payload.message = 'GitHub 身份验证失败，请稍后重试';
    return payload;
  }

  if (status === 403 || status === 429) {
    if (source === 'session') {
      payload.message = '当前授权缺少必要权限，请退出后重新授权并勾选 workflow/public_repo 权限';
      return payload;
    }
    if (source === 'service') {
      markServiceDegraded();
      if (!hasSession) {
        payload.message = 'GitHub 拒绝了请求，请登录后使用个人授权再试';
        return payload;
      }
      if (!attemptedSession) {
        payload.message = 'GitHub 拒绝了请求，正在尝试使用个人授权，请稍候重试';
        return payload;
      }
      payload.message = 'GitHub 拒绝了请求，请稍后再试或检查权限';
      return payload;
    }
    payload.message = 'GitHub 拒绝了请求，请稍后再试';
    return payload;
  }

  if (status === 404) {
    payload.message = 'GitHub 上未找到相关资源，请检查 Workflow 配置';
    return payload;
  }

  if (status === 422) {
    payload.message = 'GitHub 拒绝了请求参数，请检查 YAML 或 Workflow 输入';
    return payload;
  }

  if (status >= 500) {
    payload.message = 'GitHub 服务暂时不可用，请稍后重试';
    return payload;
  }

  if (source === 'session' && hasService && !hasAttemptedSource(attempted, 'service')) {
    payload.message = '个人授权不可用，请重试或改用平台默认凭据';
    return payload;
  }

  if (source === 'service' && hasSession && !hasAttemptedSource(attempted, 'session')) {
    markServiceDegraded();
    payload.message = '当前请求未能使用平台凭据完成，请尝试使用个人授权';
    return payload;
  }

  return payload;
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
